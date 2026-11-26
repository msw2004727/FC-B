import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentChildren, ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CpCallError } from '../data/cp-callables';
import { summaryShardIdOf } from '../data/schedule-load';
import type { EntryDoc, StandingDoc, SummaryEntry } from '../data/types';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { taipeiMs } from '../format';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import {
  FIRST_MATCH,
  LAST_MATCH,
  adultDivision,
  competition,
  idleActions,
  memberActor,
  screenEnv,
} from '../testing/screen-fixtures';
import CompetitionDetailPage, { FOREGROUND_RELOAD_MIN_MS } from './CompetitionDetailPage';
import CompetitionManagePage from './CompetitionManagePage';
import NewCompetitionPage from './NewCompetitionPage';
import RosterPage from './RosterPage';

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'visibilityState');
});

function mount(node: ComponentChildren) {
  return render(<LocationProvider>{node}</LocationProvider>);
}

function draw(env: CpInjectedEnv, Page: ComponentType) {
  return mount(
    <CpEnvProvider value={env}>
      <Page />
    </CpEnvProvider>,
  );
}

function summary(partial: Partial<SummaryEntry> & Pick<SummaryEntry, 'id' | 'k' | 'st'>): SummaryEntry {
  return {
    dv: 'dv_adult',
    r: 1,
    no: 1,
    v: '1號場',
    h: { id: 'en_h', n: '海風隊' },
    a: { id: 'en_a', n: '山貓隊' },
    s: [0, 0],
    wo: null,
    ...partial,
  };
}

function standings(hasUnresolvedTie: boolean): StandingDoc {
  return {
    id: 'dv_adult__group__A',
    divisionId: 'dv_adult',
    groupId: 'A',
    version: 1,
    hasUnresolvedTie,
    manualOverride: null,
    ranking: null,
    updatedAt: null,
    rows: [
      {
        teamId: 'club_wind', name: '海風隊', played: 4, win: 3, draw: 1, loss: 0,
        goalsFor: 10, goalsAgainst: 3, goalDiff: 7, points: 10, rank: 1,
        hasUnresolvedTie: false, tiedWith: [], decidedBy: null,
      },
      {
        teamId: 'club_b', name: '銀河隊', played: 4, win: 1, draw: 2, loss: 1,
        goalsFor: 5, goalsAgainst: 5, goalDiff: 0, points: 5, rank: 5,
        hasUnresolvedTie, tiedWith: hasUnresolvedTie ? ['club_c'] : [], decidedBy: null,
      },
      {
        teamId: 'club_c', name: '一二三四五六七八九十示範隊', played: 4, win: 1, draw: 2, loss: 1,
        goalsFor: 4, goalsAgainst: 8, goalDiff: -4, points: 5, rank: 6,
        hasUnresolvedTie, tiedWith: hasUnresolvedTie ? ['club_b'] : [], decidedBy: null,
      },
    ],
  };
}

const crestRows: EntryDoc[] = [
  {
    id: 'en_h', dvId: 'dv_adult', teamId: 'club_wind', name: '海風隊',
    status: 'approved', rosterCount: 7, rosterConfirmed: true, teamLogo: null,
  },
];

describe('詳情四狀態', () => {
  // 新外觀卡 1b-3：封面拿掉，分類字收進頂部記分板；頁首改成小字「賽事」，賽事名稱是板內唯一的 h1。
  it('招募沿用報名資訊，分類在頂部不亮燈的板上，核准隊伍用 28 隊徽、整列是連結', () => {
    const view = draw(screenEnv('detail-rep'), CompetitionDetailPage);
    expect(view.container.querySelector('.cp3-cover')).toBeNull();
    expect(readFileSync('src/features/competitions/competitions.css', 'utf8')).not.toContain('.cp3-cover');
    const board = view.container.querySelector('.d2-hero .d2-board');
    expect(board?.classList.contains('d2-sb--lit')).toBe(false);
    expect(board?.querySelector('.d2-board__cat')?.textContent).toBe('聯賽');
    expect(board?.querySelectorAll('.d2-cell')[0]?.querySelector('.d2-cell__k')?.textContent).toBe('報名截止');
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(view.container.querySelector('h1')?.className).toBe('d2-board__name');
    expect(view.container.querySelector('.cps-top__crumb')?.textContent).toBe('賽事');
    expect(view.container.textContent ?? '').toContain('以俱樂部報隊');
    expect(view.container.textContent ?? '').not.toContain('賽事詳情');
    expect(view.container.textContent ?? '').not.toContain('距開賽');
    // 新外觀卡 1b-5：組別卡隊伍列整列是連結（.d2-div__team），隊徽 48→28
    const crest = view.container.querySelector('.cps-li .cp3-crest');
    expect(crest?.getAttribute('style')?.replace(/\s/g, '')).toContain('width:28px');
    expect(crest?.closest('a')?.className).toBe('d2-div__team');
    expect(crest?.closest('a')?.querySelector('.cps-li__tag')?.textContent).toBe('已核准');
    expect(crest?.textContent).toBe('示');
  });

  it('預熱顯示距開賽天數與賽程、積分分頁', () => {
    const env = screenEnv('detail-rep');
    const view = draw({
      ...env,
      now: taipeiMs(2026, 12, 21, 12, 0),
      schedule: {
        summary: [summary({ id: 'm1', k: FIRST_MATCH, st: 'scheduled' })],
        standings: [],
      },
    }, CompetitionDetailPage);
    const cells = [...view.container.querySelectorAll('.d2-board .d2-cell')].map((node) => node.textContent);
    expect(cells[1]).toBe('距開賽19天');
    expect(view.container.querySelector('.d2-board')?.classList.contains('d2-sb--lit')).toBe(false);
    expect(view.container.textContent ?? '').toContain('預熱中');
    expect(screen.getByRole('tab', { name: '賽程' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '積分' })).toBeTruthy();
    expect(view.container.textContent ?? '').toContain('1月9日　週六');
    // 新外觀卡 1b-4：時間與場地分成兩個節點；比賽列隊徽 22→24
    expect(view.container.querySelector('.cp3-m .cp3-m__when')?.textContent).toBe('08:001號場');
    expect(view.container.querySelector('.cp3-m .cp3-m__court')?.textContent).toBe('1號場');
    expect(view.container.textContent ?? '').toContain('vs');
    expect(view.container.querySelector('.cp3-m .cp3-crest')?.getAttribute('style')?.replace(/\s/g, '')).toContain('width:24px');
  });

  it('盃賽封面與進行中徽章、待確認場次在同一畫面', () => {
    const env = screenEnv('detail-rep');
    const bundle = env.bundle;
    if (!bundle?.competition) throw new Error('缺詳情');
    const longName = '一二三四五六七八九十示範隊';
    const view = draw({
      ...env,
      now: taipeiMs(2027, 1, 9, 12, 0),
      bundle: {
        ...bundle,
        competition: competition({ category: 'cup' }),
        entries: [...bundle.entries, ...crestRows],
      },
      schedule: {
        summary: [
          summary({ id: 'am', k: taipeiMs(2027, 1, 9, 9, 0), st: 'finished', s: [2, 1] }),
          summary({
            id: 'pm', k: taipeiMs(2027, 1, 9, 14, 30), st: 'scheduled', v: '2號場',
            h: { id: 'en_h', n: longName }, a: { id: 'en_a', n: '山貓隊' },
          }),
          summary({ id: 'late', k: taipeiMs(2027, 1, 9, 15, 30), st: 'scheduled', v: '3號場' }),
          summary({ id: 'tbd', k: null, st: 'postponed', v: null, wo: null }),
          summary({ id: 'wo', k: LAST_MATCH, st: 'walkover', wo: 'away', s: [0, 2], v: '1號場' }),
        ],
        standings: [],
      },
    }, CompetitionDetailPage);
    expect(view.container.querySelector('.d2-board__cat')?.textContent).toBe('盃賽');
    expect(view.container.querySelector('.d2-board')?.classList.contains('d2-sb--lit')).toBe(true);
    expect(screen.getByText('進行中')).toBeTruthy();
    expect(screen.getByText('待確認')).toBeTruthy();
    // 「今天 3 場・下一場 14:30」拆成兩格：下一場（只有一場，帶場地與對戰）｜今天 3 場
    const cells = [...view.container.querySelectorAll('.d2-board .d2-cell')];
    expect(cells[0]?.querySelector('.d2-cell__k')?.textContent).toBe('下一場2號場');
    expect(cells[0]?.querySelector('.d2-num')?.textContent).toBe('14:30');
    expect(cells[0]?.classList.contains('d2-cell--now')).toBe(true);
    expect(cells[1]?.textContent).toBe('今天3場');
    expect(view.container.textContent ?? '').toContain('2：1');
    expect(view.container.textContent ?? '').toContain('時間待定');
    expect(view.container.textContent ?? '').toContain('改期');
    expect(view.container.textContent ?? '').toContain('棄權');
    const name = [...view.container.querySelectorAll('.cp3-tn em')].find((node) => node.textContent === longName);
    expect(name?.textContent).toBe(longName);
    const sheet = readFileSync('src/features/competitions/competitions.css', 'utf8');
    expect(sheet).toMatch(/\.cp3-tn em \{[^}]*text-overflow:\s*ellipsis/);
    expect(sheet).toMatch(/\.cp3-tn em \{[^}]*white-space:\s*nowrap/);
  });

  it('已結束有冠軍、積分欄與可展開賽程；未裁定同分同名次', () => {
    const env = screenEnv('detail-rep');
    const bundle = env.bundle;
    if (!bundle?.competition) throw new Error('缺詳情');
    const rows = [summary({ id: 'final', k: LAST_MATCH, st: 'confirmed', s: [1, 0] })];
    const view = draw({
      ...env,
      now: taipeiMs(2027, 1, 11, 12, 0),
      bundle: { ...bundle, competition: competition(), entries: [...bundle.entries, ...crestRows] },
      schedule: { summary: rows, standings: [standings(true)] },
    }, CompetitionDetailPage);
    expect(view.container.textContent ?? '').toContain('已結束');
    // 冠軍搬到頂部玻璃卡（只有一組：「冠軍｜隊名」一行）
    expect(view.container.querySelector('.d2-hero .d2-plain .d2-plain__champ span')?.textContent).toBe('海風隊');
    const head = view.container.querySelector('.cp3-st__r--h');
    expect(head?.textContent).toBe('名次隊名賽勝和負進/失淨勝積分');
    expect(view.container.querySelector('.cp3-st__r--top')?.textContent).toContain('海風隊');
    // 新外觀卡 3-4：積分榜隊徽 20 → 24（字章 12px）
    expect(view.container.querySelector('.cp3-st .cp3-crest')?.getAttribute('style')?.replace(/\s/g, '')).toContain('width:24px');
    expect(view.container.textContent ?? '').toContain('+7');
    expect(view.container.textContent ?? '').toContain('10/3');
    const ties = view.container.querySelectorAll('.cp3-st__r .rk small');
    expect([...ties].map((node) => node.textContent)).toEqual(['同分', '同分']);
    expect(view.container.textContent ?? '').toContain('5同分');
    expect(view.container.textContent ?? '').not.toContain('6同分');
    expect(view.container.textContent ?? '').not.toContain('組別 1');
    const fold = screen.getByRole('button', { name: '賽程' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.textContent ?? '').not.toContain('18:00');
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: '賽程（1 場）' })).toBeTruthy();
    // 新外觀卡 1b-4：時間與場地分成兩個節點；完整比分在視覺隱藏那一段
    expect(view.container.querySelector('.cp3-m .cp3-m__when')?.textContent).toBe('18:001號場');
    expect(view.container.textContent ?? '').toContain('1：0');
  });

  it('多組冠軍各列一位；第 1 名未裁定不寫隊名', () => {
    const env = screenEnv('detail-rep');
    const bundle = env.bundle;
    if (!bundle?.competition) throw new Error('缺詳情');
    const named = standings(false);
    named.divisionName = '公開組';
    const pending: StandingDoc = {
      id: 'dv_u12__group__A',
      divisionId: 'dv_u12',
      groupId: 'A',
      version: 1,
      hasUnresolvedTie: true,
      manualOverride: null,
      ranking: null,
      updatedAt: null,
      rows: [
        {
          teamId: 'club_b', name: '銀河隊', played: 4, win: 1, draw: 2, loss: 1,
          goalsFor: 5, goalsAgainst: 5, goalDiff: 0, points: 5, rank: 1,
          hasUnresolvedTie: true, tiedWith: ['club_c'], decidedBy: null,
        },
        {
          teamId: 'club_c', name: '山貓隊', played: 4, win: 1, draw: 2, loss: 1,
          goalsFor: 4, goalsAgainst: 8, goalDiff: -4, points: 5, rank: 2,
          hasUnresolvedTie: true, tiedWith: ['club_b'], decidedBy: null,
        },
      ],
    };
    const view = draw({
      ...env,
      now: taipeiMs(2027, 1, 11, 12, 0),
      bundle: { ...bundle, competition: competition(), entries: [...bundle.entries, ...crestRows] },
      schedule: { summary: [], standings: [named, pending] },
    }, CompetitionDetailPage);
    // 多組冠軍在頂部玻璃卡：組名與隊名分成兩格
    expect([...view.container.querySelectorAll('.d2-plain__champs dt, .d2-plain__champs dd')].map((node) => node.textContent)).toEqual([
      '公開組', '海風隊',
      '組別 2', '冠軍待主辦裁定',
    ]);
    const headings = [...view.container.querySelectorAll('h3.cp3-day')].map((node) => node.textContent);
    expect(headings).toEqual(['公開組', '組別 2']);
  });

  it('同一時間兩場：板上只寫時間，兩列都掛「下一場」；進行中列比分青綠（新外觀卡 1b-4）', () => {
    const view = draw(screenEnv('real-live-twin-next'), CompetitionDetailPage);
    const first = view.container.querySelector('.d2-board .d2-cell');
    expect(first?.querySelector('.d2-cell__k')?.textContent).toBe('下一場');
    expect(first?.querySelector('.d2-cell__t')).toBeNull();
    const nextRows = [...view.container.querySelectorAll('.cp3-m.cp3-m--next')];
    expect(nextRows).toHaveLength(2);
    for (const row of nextRows) {
      expect(row.querySelector('.d2-tag--next')?.textContent).toBe('下一場');
      expect(row.querySelector('.cp3-m__when b')?.textContent).toBe('14:30');
    }
    expect(view.container.querySelectorAll('.d2-tag--next')).toHaveLength(2);
  });

  it('主辦專用卡在頂部正下方：小字「主辦專用」、草稿的「發布」在第一行右邊，入口一列一個（新外觀卡 1b-5；11-21 加「編輯賽事」在最後）', () => {
    const view = draw(screenEnv('real-draft-host'), CompetitionDetailPage);
    const card = view.container.querySelector('nav.d2-manage');
    expect(card?.previousElementSibling?.classList.contains('d2-hero')).toBe(true);
    expect(card?.querySelector('.d2-manage__k span')?.textContent).toBe('主辦專用');
    expect(card?.querySelector('.d2-manage__k .ui-button')?.textContent).toBe('發布');
    expect([...(card?.querySelectorAll(':scope > .ui-button') ?? [])].map((node) => node.textContent)).toEqual(['報隊管理', '排賽程', '賽程管理', '編輯賽事']);
    expect(screen.queryByRole('button', { name: '以俱樂部報隊' })).toBeNull();
  });

  it('五個組別的冠軍最多列三行，超過寫「等 5 組」（新外觀卡 1b-3）', () => {
    const view = draw(screenEnv('real-done-five'), CompetitionDetailPage);
    expect(view.container.querySelectorAll('.d2-plain__champs dd')).toHaveLength(3);
    expect(view.container.querySelector('.d2-plain__more')?.textContent).toBe('等 5 組');
  });

  it('已結束展開失敗就收合，並顯示讀取失敗與重試', async () => {
    const repo = createFakeCpRepo({
      competitions: [competition({ id: 'cup' })],
      entries: { cup: crestRows },
      standings: { cup: [standings(false)] },
      summary: {
        cup: [{ id: 'all', entries: [summary({ id: 'final', k: LAST_MATCH, st: 'confirmed', s: [1, 0] })] }],
      },
    });
    const orig = repo.listSummary.bind(repo);
    let fail = true;
    repo.listSummary = async (cid) => {
      if (fail) throw new Error('讀取失敗');
      return orig(cid);
    };
    const view = draw({
      actor: memberActor,
      repo,
      actions: idleActions(),
      now: taipeiMs(2027, 1, 11, 12, 0),
      route: { cid: 'cup' },
    }, CompetitionDetailPage);
    const fold = await screen.findByRole('button', { name: '賽程' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('讀取失敗')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重試' })).toBeTruthy();
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.textContent ?? '').not.toContain('18:00');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByRole('button', { name: '賽程（1 場）' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '賽程（1 場）' }).getAttribute('aria-expanded')).toBe('true');
    expect(view.container.textContent ?? '').toContain('18:00');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('名單隊徽', () => {
  it('名單標題旁用 48 隊徽，不另讀隊徽查詢', () => {
    const view = draw(screenEnv('roster'), RosterPage);
    const crest = view.container.querySelector('.cp3-roster-head .cp3-crest');
    expect(crest?.getAttribute('style')?.replace(/\s/g, '')).toContain('width:48px');
    expect(crest?.textContent).toBe('示');
    expect(view.container.textContent ?? '').toContain('示範隊A');
  });
});

describe('建賽分類', () => {
  it('步驟 1 預設聯賽，改成盃賽後建立時送出', async () => {
    const actions = idleActions();
    const create = vi.fn(actions.create);
    draw({ ...screenEnv('wizard-1'), actions: { ...actions, create } }, NewCompetitionPage);
    const league = screen.getByRole('radio', { name: '聯賽' }) as HTMLInputElement;
    expect(league.checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '盃賽' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('button', { name: '建立賽事' })).toBeTruthy();
    expect(screen.getByText('盃賽')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]?.[0]).toMatchObject({ category: 'cup' });
  });

  it('報隊管理可以改分類；失敗時退回原本的選項', async () => {
    const actions = idleActions();
    const update = vi.fn(actions.update);
    const view = draw({ ...screenEnv('host-pending'), actions: { ...actions, update } }, CompetitionManagePage);
    fireEvent.click(screen.getByRole('button', { name: '編輯賽事資訊' }));
    fireEvent.click(screen.getByRole('radio', { name: '友誼賽' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ cid: 'cup', category: 'friendly' }));
    expect((screen.getByRole('radio', { name: '友誼賽' }) as HTMLInputElement).checked).toBe(true);
    view.unmount();

    const failing = vi.fn(async () => {
      throw new CpCallError('UNKNOWN', {});
    });
    draw({ ...screenEnv('host-pending'), actions: { ...actions, update: failing } }, CompetitionManagePage);
    fireEvent.click(screen.getByRole('button', { name: '編輯賽事資訊' }));
    fireEvent.click(screen.getByRole('radio', { name: '盃賽' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByRole('radio', { name: '聯賽' }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('回前景重讀', () => {
  function setVisibility(value: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  }

  it('60 秒內重回前景不讀；滿 60 秒才重讀摘要，隊徽仍用頁內快取', async () => {
    const base = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(base);
    try {
      const repo = createFakeCpRepo({
        competitions: [competition({ id: 'cup' })],
        divisions: { cup: [adultDivision] },
        entries: { cup: crestRows },
        summary: {
          cup: [{ id: summaryShardIdOf(FIRST_MATCH), entries: [summary({ id: 'm1', k: FIRST_MATCH, st: 'scheduled' })] }],
        },
      });
      const view = draw({
        actor: memberActor,
        repo,
        actions: idleActions(),
        now: taipeiMs(2026, 12, 21, 12, 0),
        route: { cid: 'cup' },
      }, CompetitionDetailPage);
      // 新外觀卡 1b-3：「距開賽 19 天」拆成頂部數字格的小標與數字
      expect(await screen.findByText('距開賽')).toBeTruthy();
      expect(repo.calls()).toEqual([
        'getCompetition', 'listDivisions', 'listEntriesForCrest', 'getStaffWithAssignment', 'getSummaryShard',
      ]);
      expect(repo.readCount()).toBeLessThanOrEqual(40);
      expect(repo.calls()).not.toContain('listSummary');
      expect(repo.calls()).not.toContain('listMatches');
      expect(repo.calls()).not.toContain('listEntries');

      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
      await Promise.resolve();
      expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(1);

      setVisibility('visible');
      nowSpy.mockReturnValue(base + FOREGROUND_RELOAD_MIN_MS - 1);
      document.dispatchEvent(new Event('visibilitychange'));
      const early = new Event('pageshow');
      Object.defineProperty(early, 'persisted', { value: true });
      window.dispatchEvent(early);
      await Promise.resolve();
      expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(1);
      expect(repo.calls().filter((name) => name === 'listEntriesForCrest')).toHaveLength(1);

      nowSpy.mockReturnValue(base + FOREGROUND_RELOAD_MIN_MS);
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(2));
      expect(repo.calls().filter((name) => name === 'listEntriesForCrest')).toHaveLength(1);
      expect(repo.calls()).not.toContain('listSummary');
      expect(repo.calls()).not.toContain('listMatches');
      expect(repo.calls()).not.toContain('listEntries');

      nowSpy.mockReturnValue(base + FOREGROUND_RELOAD_MIN_MS * 2);
      const back = new Event('pageshow');
      Object.defineProperty(back, 'persisted', { value: true });
      window.dispatchEvent(back);
      await waitFor(() => expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(3));
      expect(repo.calls().filter((name) => name === 'listEntriesForCrest')).toHaveLength(1);
      expect(repo.calls()).not.toContain('listSummary');
      expect(view.container.textContent ?? '').toContain('海風隊');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('已結束重回前景不讀', async () => {
    const base = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(base);
    try {
      const repo = createFakeCpRepo({
        competitions: [competition({ id: 'cup' })],
        entries: { cup: crestRows },
        standings: { cup: [standings(false)] },
      });
      draw({
        actor: memberActor,
        repo,
        actions: idleActions(),
        now: taipeiMs(2027, 1, 11, 12, 0),
        route: { cid: 'cup' },
      }, CompetitionDetailPage);
      expect(await screen.findByText('已結束')).toBeTruthy();
      const before = [...repo.calls()];
      setVisibility('visible');
      nowSpy.mockReturnValue(base + FOREGROUND_RELOAD_MIN_MS * 3);
      document.dispatchEvent(new Event('visibilitychange'));
      const back = new Event('pageshow');
      Object.defineProperty(back, 'persisted', { value: true });
      window.dispatchEvent(back);
      await Promise.resolve();
      expect(repo.calls()).toEqual(before);
      expect(repo.calls()).not.toContain('getSummaryShard');
      expect(repo.calls()).not.toContain('listSummary');
    } finally {
      nowSpy.mockRestore();
    }
  });
});
