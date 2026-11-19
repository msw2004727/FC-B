import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { InAppListCard } from '../data/list-cards';
import { summaryShardIdOf } from '../data/schedule-load';
import type { SummaryEntry } from '../data/types';
import { CpEnvProvider } from '../env';
import { taipeiMs } from '../format';
import { loadCompetitionsDict, makeCompetitionsT } from '../i18n';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import { NOW, competition, idleActions, memberActor } from '../testing/screen-fixtures';
import { InAppCardList } from './InAppCardList';
import { InAppSection } from './InAppSection';

const IDE = '\u3000';
const EN = '\u2013';
const DOT = '\u30FB';

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
});

function card(partial: Partial<InAppListCard> & Pick<InAppListCard, 'cid' | 'name' | 'category' | 'phase'>): InAppListCard {
  return {
    dates: '',
    line: null,
    mine: false,
    ended: partial.phase === 'done',
    statusMark: null,
    ...partial,
  };
}

describe('站內卡文案與分類小標', () => {
  it('進行中用預覽句子；沒有下一場只寫場數；已結束不寫冠軍；小標有文字；封面不載圖', async () => {
    const ct = makeCompetitionsT(await loadCompetitionsDict('zh-TW'));
    render(
      <InAppCardList
        cards={[
          card({
            cid: 'live',
            name: '示範盃五人制足球賽',
            category: 'cup',
            phase: 'live',
            dates: `2027/01/09 ${EN} 01/10${IDE}示範運動公園`,
            line: { kind: 'live', count: 3, time: '14:30' },
          }),
          card({
            cid: 'count',
            name: '只剩場數',
            category: 'league',
            phase: 'live',
            line: { kind: 'today', count: 2 },
          }),
          card({
            cid: 'done',
            name: '秋季聯賽',
            category: 'league',
            phase: 'done',
            dates: `2026/10/03 ${EN} 11/21`,
            line: null,
          }),
        ]}
        ct={ct}
        status="open"
        onlyMine={false}
        showCreate={false}
        onStatus={() => {}}
        onOnlyMine={() => {}}
        onCreate={() => {}}
        onOpen={() => {}}
      />,
    );
    const live = document.querySelector('[data-cid="live"]');
    expect(live?.querySelector('.cpl-st--live')?.textContent).toContain('進行中');
    expect(live?.querySelector('.cpl-line')?.textContent).toBe(`今天 3 場${DOT}下一場 14:30`);
    expect(live?.querySelector('.cpl-line--hl')).toBeTruthy();
    expect(live?.querySelector('.cpl-chip')?.textContent).toBe('盃賽');
    expect(live?.querySelector('.cpl-chip')?.className).toContain('cpl-chip--cup');
    expect(live?.querySelector('.cpl-cover--cup')).toBeTruthy();
    expect(live?.querySelector('img')).toBeNull();
    expect(document.querySelector('[data-cid="count"] .cpl-line')?.textContent).toBe('今天 2 場');
    expect(document.querySelector('[data-cid="count"] .cpl-line--hl')).toBeTruthy();
    const done = document.querySelector('[data-cid="done"]');
    expect(done?.classList.contains('ended')).toBe(true);
    expect(done?.querySelector('.cpl-line')).toBeNull();
    const select = screen.getByRole('combobox', { name: '狀態' });
    expect(select.id).not.toBe('cpl-status');
    expect(select.id.length).toBeGreaterThan(0);
    const onlyMine = screen.getByRole('checkbox', { name: '只看我的' });
    expect(onlyMine.id).not.toBe('cpl-only-mine');
    expect(onlyMine.id.length).toBeGreaterThan(0);
    expect(select.id).not.toBe(onlyMine.id);
    for (const chip of document.querySelectorAll('.cpl-chip')) {
      expect((chip.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
    expect(document.querySelector('[class*="amber"]')).toBeNull();
  });
});

describe('站內清單篩選不重讀', () => {
  function repoFor() {
    return createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      mine: {
        uid_member: [{ id: 'm1', cid: 'mine_only', roles: ['host'], host: true, name: '只屬於我', category: 'cup' }],
      },
      competitions: [
        competition({ id: 'rec_lg', name: '招募聯賽', category: 'league', hostType: 'personal', hostTeamId: null }),
        competition({
          id: 'warm_cup',
          name: '預熱盃',
          category: 'cup',
          hostType: 'personal',
          hostTeamId: null,
          regCloseAt: taipeiMs(2026, 12, 9, 23, 59),
          firstMatchAt: taipeiMs(2026, 12, 13, 9, 0),
          lastMatchAt: taipeiMs(2026, 12, 14, 18, 0),
        }),
        competition({
          id: 'live_fr',
          name: '進行友誼',
          category: 'friendly',
          hostType: 'personal',
          hostTeamId: null,
          regCloseAt: taipeiMs(2026, 12, 1, 23, 59),
          firstMatchAt: NOW - 60 * 60 * 1000,
          lastMatchAt: NOW + 24 * 60 * 60 * 1000,
        }),
        competition({
          id: 'done_lg',
          name: '結束聯賽',
          category: 'league',
          hostType: 'personal',
          hostTeamId: null,
          regCloseAt: taipeiMs(2026, 9, 1, 23, 59),
          firstMatchAt: taipeiMs(2026, 10, 3, 8, 0),
          lastMatchAt: taipeiMs(2026, 11, 21, 18, 0),
        }),
      ],
    });
  }

  async function chooseStatus(value: string): Promise<void> {
    const select = screen.getByRole('combobox', { name: '狀態' }) as HTMLSelectElement;
    select.value = value;
    await act(async () => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('預設未結束，切狀態、分類、只看我的都不加查詢', async () => {
    const repo = repoFor();
    const env = { actor: memberActor, repo, actions: idleActions(), now: NOW };
    const view = render(
      <LocationProvider>
        <CpEnvProvider value={env}>
          <InAppSection />
        </CpEnvProvider>
      </LocationProvider>,
    );
    expect(await screen.findByText('招募聯賽')).toBeTruthy();
    const select = screen.getByRole('combobox', { name: '狀態' }) as HTMLSelectElement;
    expect(select.value).toBe('open');
    expect([...select.options].map((option) => option.text)).toEqual([
      '未結束', '招募中', '預熱中', '進行中', '已結束', '全部',
    ]);
    expect(document.querySelector('[data-cid="done_lg"]')).toBeNull();

    const rec = document.querySelector('[data-cid="rec_lg"]');
    expect(rec?.querySelector('.tc-card-dates')?.textContent).toBe(`2027/01/09 ${EN} 01/10${IDE}示範球場`);
    expect(rec?.querySelector('.cpl-line')?.textContent).toBe(`報名截止${IDE}12/20 23:59`);
    expect(rec?.querySelector('.cpl-line')?.classList.contains('cpl-line--hl')).toBe(false);
    expect(rec?.querySelector('.cpl-st--recruit')?.textContent).toContain('招募中');

    const warm = document.querySelector('[data-cid="warm_cup"]');
    expect(warm?.querySelector('.cpl-line')?.textContent).toBe('距開賽 3 天');
    expect(warm?.querySelector('.cpl-line--hl')).toBeTruthy();
    expect(warm?.querySelector('.cpl-chip--cup')?.textContent).toBe('盃賽');

    const live = document.querySelector('[data-cid="live_fr"]');
    expect(live?.querySelector('.cpl-st--live')?.textContent).toContain('進行中');
    expect(live?.querySelector('.cpl-line')).toBeNull();
    expect(live?.querySelector('img')).toBeNull();
    expect(screen.getByText('只屬於我')).toBeTruthy();
    expect(screen.getByRole('button', { name: '建立賽事' })).toBeTruthy();
    // 站內按鈕元件，不是舊站 primary-btn（B 前台沒有那套樣式，會變瀏覽器原生灰框；顧問 §3.294 P2-3）
    expect(screen.getByRole('button', { name: '建立賽事' }).className).toContain('ui-button');

    await waitFor(() => {
      expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(1);
    });
    const reads = repo.calls().slice();
    expect(reads).toEqual(['getLaunch', 'listMine', 'listPublic', 'getSummaryShard']);

    await chooseStatus('warm');
    expect(document.querySelector('[data-cid="warm_cup"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="rec_lg"]')).toBeNull();
    expect(document.querySelector('[data-cid="live_fr"]')).toBeNull();

    await chooseStatus('done');
    const done = document.querySelector('[data-cid="done_lg"]');
    expect(done?.classList.contains('ended')).toBe(true);
    expect(done?.querySelector('.cpl-st--done')?.textContent).toContain('已結束');
    expect(done?.querySelector('.cpl-line')).toBeNull();
    expect(document.querySelector('[data-cid="warm_cup"]')).toBeNull();

    await chooseStatus('all');
    expect(document.querySelector('[data-cid="done_lg"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="rec_lg"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="mine_only"]')).toBeTruthy();

    await chooseStatus('open');
    fireEvent.click(screen.getByRole('checkbox', { name: '只看我的' }));
    expect(screen.getByText('只屬於我')).toBeTruthy();
    expect(document.querySelector('[data-cid="rec_lg"]')).toBeNull();
    expect(document.querySelector('[data-cid="warm_cup"]')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: '只看我的' }));
    view.rerender(
      <LocationProvider>
        <CpEnvProvider value={env}>
          <InAppSection tab="cup" />
        </CpEnvProvider>
      </LocationProvider>,
    );
    expect(document.querySelector('[data-cid="warm_cup"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="mine_only"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="rec_lg"]')).toBeNull();
    expect(document.querySelector('[data-cid="live_fr"]')).toBeNull();
    expect(repo.calls()).toEqual(reads);
  });
});

function shardRow(partial: Partial<SummaryEntry> & Pick<SummaryEntry, 'id' | 'k' | 'st'>): SummaryEntry {
  return {
    dv: 'dv',
    r: 1,
    no: 1,
    v: null,
    h: { id: 'h', n: '主' },
    a: { id: 'a', n: '客' },
    s: [0, 0],
    wo: null,
    ...partial,
  };
}

function liveDoc(id: string, name: string, category: 'league' | 'cup' | 'friendly') {
  return competition({
    id,
    name,
    category,
    hostType: 'personal',
    hostTeamId: null,
    regCloseAt: taipeiMs(2026, 12, 1, 23, 59),
    firstMatchAt: NOW - 60 * 60 * 1000,
    lastMatchAt: NOW + 24 * 60 * 60 * 1000,
  });
}

describe('進行中卡當日摘要', () => {
  const shard = summaryShardIdOf(NOW);

  function section(repo: ReturnType<typeof createFakeCpRepo>, tab: 'all' | 'league' | 'cup' | 'friendly' = 'all', active = true) {
    const env = { actor: memberActor, repo, actions: idleActions(), now: NOW };
    return (
      <LocationProvider>
        <CpEnvProvider value={env}>
          <InAppSection tab={tab} active={active} />
        </CpEnvProvider>
      </LocationProvider>
    );
  }

  it('只讀畫面上的進行中卡；再出現不重讀；空片留空；沒有下一場只寫場數', async () => {
    const seen: string[] = [];
    const repo = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      competitions: [
        liveDoc('live_lg', '進行聯賽', 'league'),
        liveDoc('live_cup', '進行盃', 'cup'),
        liveDoc('live_empty', '空片友誼', 'friendly'),
        competition({
          id: 'done_lg',
          name: '結束聯賽',
          category: 'league',
          hostType: 'personal',
          hostTeamId: null,
          regCloseAt: taipeiMs(2026, 9, 1, 23, 59),
          firstMatchAt: taipeiMs(2026, 10, 3, 8, 0),
          lastMatchAt: taipeiMs(2026, 11, 21, 18, 0),
        }),
      ],
      summary: {
        live_lg: [{
          id: shard,
          entries: [
            shardRow({ id: 'past', k: NOW - 60 * 60 * 1000, st: 'scheduled' }),
            shardRow({ id: 'next', k: NOW + 2 * 60 * 60 * 1000, st: 'scheduled' }),
            shardRow({ id: 'skip', k: NOW + 3 * 60 * 60 * 1000, st: 'live' }),
          ],
        }],
        live_cup: [{
          id: shard,
          entries: [
            shardRow({ id: 'gone', k: NOW - 30 * 60 * 1000, st: 'finished' }),
            shardRow({ id: 'tbd', k: null, st: 'scheduled' }),
          ],
        }],
        live_empty: [{ id: shard, entries: [] }],
      },
    });
    const orig = repo.getSummaryShard.bind(repo);
    repo.getSummaryShard = async (cid, shardId) => {
      seen.push(`${cid}:${shardId}`);
      return orig(cid, shardId);
    };
    const view = render(section(repo, 'league'));
    expect(await screen.findByText('進行聯賽')).toBeTruthy();
    await waitFor(() => {
      expect(seen).toEqual([`live_lg:${shard}`]);
      expect(document.querySelector('[data-cid="live_lg"] .cpl-line')?.textContent).toBe(`今天 3 場${DOT}下一場 14:00`);
    });
    expect(document.querySelector('[data-cid="live_cup"]')).toBeNull();
    expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(1);
    expect(repo.calls().filter((name) => name !== 'getSummaryShard')).toEqual(['getLaunch', 'listMine', 'listPublic']);

    view.rerender(section(repo, 'all'));
    await waitFor(() => {
      expect(seen).toEqual([
        `live_lg:${shard}`,
        `live_cup:${shard}`,
        `live_empty:${shard}`,
      ]);
      expect(document.querySelector('[data-cid="live_cup"] .cpl-line')?.textContent).toBe('今天 2 場');
      expect(document.querySelector('[data-cid="live_empty"] .cpl-line')).toBeNull();
    });
    expect(document.querySelector('[data-cid="done_lg"]')).toBeNull();
    expect(seen.some((row) => row.startsWith('done_lg'))).toBe(false);
    expect(repo.calls()).toHaveLength(3 + 3);

    view.rerender(section(repo, 'league'));
    view.rerender(section(repo, 'all'));
    const select = screen.getByRole('combobox', { name: '狀態' }) as HTMLSelectElement;
    select.value = 'done';
    await act(async () => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    select.value = 'open';
    await act(async () => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '只看我的' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '只看我的' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(seen).toEqual([
      `live_lg:${shard}`,
      `live_cup:${shard}`,
      `live_empty:${shard}`,
    ]);
    expect(repo.calls().some((name) => name === 'listSummary' || name === 'listStandings' || name === 'listMatches' || name === 'listEntriesForCrest')).toBe(false);
  });

  it('來源由外部切回站內（active false→true）後 repo.calls() 不增加', async () => {
    const repo = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      competitions: [liveDoc('live_fr', '進行友誼', 'friendly')],
      summary: {
        live_fr: [{ id: shard, entries: [shardRow({ id: 'n', k: NOW + 60 * 60 * 1000, st: 'scheduled' })] }],
      },
    });
    const view = render(section(repo, 'all', true));
    expect(await screen.findByText('進行友誼')).toBeTruthy();
    await waitFor(() => {
      expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(1);
      expect(document.querySelector('[data-cid="live_fr"] .cpl-line')?.textContent).toBe(`今天 1 場${DOT}下一場 13:00`);
    });
    view.rerender(section(repo, 'all', false));
    expect(document.querySelector('[data-inapp]')).toBeNull();
    const reads = repo.calls().slice();
    view.rerender(section(repo, 'all', true));
    expect(await screen.findByText('進行友誼')).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(repo.calls()).toEqual(reads);
  });

  it('一開始停在外部不讀摘要片，切到站內才補讀畫面上的進行中卡', async () => {
    const repo = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      competitions: [liveDoc('live_fr', '進行友誼', 'friendly')],
    });
    const view = render(section(repo, 'all', false));
    await waitFor(() => expect(repo.calls()).toEqual(['getLaunch', 'listMine', 'listPublic']));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(repo.calls().some((name) => name === 'getSummaryShard')).toBe(false);
    view.rerender(section(repo, 'all', true));
    await waitFor(() => expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(1));
    const reads = repo.calls().slice();
    view.rerender(section(repo, 'all', false));
    view.rerender(section(repo, 'all', true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(repo.calls()).toEqual(reads);
  });

  it('當日摘要失敗不快取，卡片再出現會重讀', async () => {
    let fail = true;
    const repo = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      competitions: [liveDoc('live_fr', '進行友誼', 'friendly')],
      summary: {
        live_fr: [{ id: shard, entries: [shardRow({ id: 'n', k: NOW + 60 * 60 * 1000, st: 'scheduled' })] }],
      },
    });
    const orig = repo.getSummaryShard.bind(repo);
    repo.getSummaryShard = async (cid, shardId) => {
      const rows = await orig(cid, shardId);
      if (fail) throw new Error('shard');
      return rows;
    };
    render(section(repo));
    expect(await screen.findByText('進行友誼')).toBeTruthy();
    await waitFor(() => expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector('[data-cid="live_fr"] .cpl-line')).toBeNull();
    const select = screen.getByRole('combobox', { name: '狀態' }) as HTMLSelectElement;
    select.value = 'warm';
    await act(async () => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    fail = false;
    select.value = 'open';
    await act(async () => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(2);
      expect(document.querySelector('[data-cid="live_fr"] .cpl-line')?.textContent).toBe(`今天 1 場${DOT}下一場 13:00`);
    });
  });
});
