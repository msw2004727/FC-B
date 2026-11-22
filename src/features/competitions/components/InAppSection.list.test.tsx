import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import type { InAppListCard } from '../data/list-cards';
import { summaryShardIdOf } from '../data/schedule-load';
import type { SummaryEntry } from '../data/types';
import { CpEnvProvider } from '../env';
import { taipeiMs } from '../format';
import { loadCompetitionsDict, makeCompetitionsT } from '../i18n';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import { CpCallError } from '../data/cp-callables';
import { NOW, adminActor, competition, idleActions, memberActor } from '../testing/screen-fixtures';
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

const STATUS_LABEL: Record<string, string> = { open: '未結束', recruit: '招募中', warm: '預熱中', live: '進行中', done: '已結束', all: '全部' };

/** 狀態頁籤（站長 11-22 起取代下拉選單）：點那一格。 */
function statusTabs(): HTMLElement {
  return screen.getByRole('group', { name: '狀態' });
}
async function pickStatus(value: string): Promise<void> {
  await act(async () => {
    fireEvent.click(within(statusTabs()).getByRole('button', { name: STATUS_LABEL[value] }));
  });
}

/** 卡上的「今天」資訊：玻璃卡是重點句整句；卡板是數字格（小標 數字單位，以「・」接）。都沒有回空字串。 */
function infoOf(cid: string): string {
  const el = document.querySelector(`[data-cid="${cid}"]`);
  if (!el) return '';
  // 進行中摘要未回時預留的那一列（.cpl-cells--wait）不算內容
  return [...el.querySelectorAll('.d2-cells:not(.cpl-cells--wait) .d2-cell')]
    .map((cell) => `${cell.querySelector('.d2-cell__k')?.textContent ?? ''} ${cell.querySelector('.d2-cell__v')?.textContent ?? ''}`)
    .join(DOT);
}

function card(partial: Partial<InAppListCard> & Pick<InAppListCard, 'cid' | 'name' | 'category' | 'phase'>): InAppListCard {
  return {
    date: '',
    venue: '',
    firstMatchAt: null,
    line: null,
    mine: false,
    ended: partial.phase === 'done',
    statusMark: null,
    cover: '',
    ...partial,
  };
}

describe('站內卡文案與分類小標', () => {
  it('進行中用預覽句子；沒有下一場只寫場數；已結束不寫冠軍；分類是文字；沒有封面與圖', async () => {
    const ct = makeCompetitionsT(await loadCompetitionsDict('zh-TW'));
    render(
      <InAppCardList
        cards={[
          card({
            cid: 'live',
            name: '示範盃五人制足球賽',
            category: 'cup',
            phase: 'live',
            date: `2027/01/09 ${EN} 01/10`,
            venue: '示範運動公園',
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
            date: `2026/10/03 ${EN} 11/21`,
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
    // 站長 11-22（顧問 §3.565）：每一張都是記分板卡；重點句拆成數字格、分類在板的右上
    const live = document.querySelector('[data-cid="live"]');
    expect(live?.querySelector('.d2-sb.d2-sb--lit .d2-sb__st')?.textContent).toContain('進行中');
    expect(infoOf('live')).toBe(`下一場 14:30${DOT}今天 3場`);
    expect(live?.querySelector('.cpl-sb__cat')?.textContent).toBe('盃賽');
    expect(live?.querySelector('.cpl-meta__date')?.textContent).toBe(`2027/01/09 ${EN} 01/10`);
    expect(live?.querySelector('.cpl-meta__venue')?.textContent).toBe('示範運動公園');
    expect(document.querySelector('img, [class*="cover"], [class*="chip"], .tc-card, .tc-chip')).toBeNull();
    expect(infoOf('count')).toBe('今天 2場');
    const done = document.querySelector('[data-cid="done"]');
    expect(done?.classList.contains('ended')).toBe(true);
    expect(done?.querySelector('.d2-cells')).toBeNull();
    expect([...document.querySelectorAll('[data-cid]')].every((el) => el.classList.contains('cpl-card--board') && el.querySelector('.d2-sb'))).toBe(true);
    expect(statusTabs().querySelectorAll('button')).toHaveLength(5);
    const onlyMine = screen.getByRole('checkbox', { name: '只看我的' });
    expect(onlyMine.id).not.toBe('cpl-only-mine');
    expect(onlyMine.id.length).toBeGreaterThan(0);
    expect(document.querySelector('[class*="amber"]')).toBeNull();
  });
});

describe('卡板與狀態標籤（清-4）', () => {
  function list(cards: InAppListCard[], ct: ReturnType<typeof makeCompetitionsT>) {
    return (
      <InAppCardList
        cards={cards}
        ct={ct}
        status="open"
        onlyMine={false}
        showCreate
        onStatus={() => {}}
        onOnlyMine={() => {}}
        onCreate={() => {}}
        onOpen={() => {}}
      />
    );
  }

  it('兩場進行中：兩張都是亮燈記分板卡（狀態、分類、名稱、日期・場地、數字格）（站長 11-22 每張都是板）', async () => {
    const dict = await loadCompetitionsDict('zh-TW');
    render(
      <InAppCardList
        cards={[
          card({ cid: 'a', name: '甲盃', category: 'cup', phase: 'live', date: `2027/01/09 ${EN} 01/10`, venue: '示範球場', line: { kind: 'live', count: 3, time: '14:30' } }),
          card({ cid: 'b', name: '乙盃', category: 'league', phase: 'live', line: { kind: 'today', count: 2 } }),
        ]}
        ct={makeCompetitionsT(dict)}
        status="open"
        onlyMine={false}
        showCreate
        onStatus={() => {}}
        onOnlyMine={() => {}}
        onCreate={() => {}}
        onOpen={() => {}}
      />,
    );
    const boards = document.querySelectorAll('.cpl-card--board');
    expect(boards).toHaveLength(2);
    const a = document.querySelector('[data-inapp] > .cpl-card');
    expect(a?.getAttribute('data-cid')).toBe('a');
    expect(a?.querySelector('.d2-sb.d2-sb--lit')).toBeTruthy();
    expect(a?.querySelector('.d2-sb__st')?.textContent).toBe('進行中');
    expect(a?.querySelector('.cpl-sb__cat')?.textContent).toBe('盃賽');
    expect(a?.querySelector('.cpl-card__name')?.textContent).toBe('甲盃');
    expect(a?.querySelector('.cpl-meta__date')?.textContent).toBe(`2027/01/09 ${EN} 01/10`);
    expect(a?.querySelector('.cpl-meta__venue')?.textContent).toBe('示範球場');
    expect(a?.querySelector('.cpl-meta__cat')).toBeNull();
    expect(a?.querySelector('.d2-cell--now .d2-num')?.textContent).toBe('14:30');
    expect(infoOf('a')).toBe(`下一場 14:30${DOT}今天 3場`);
    expect(a?.querySelector('a')?.getAttribute('href')).toBe('/competitions/a');
    const b = document.querySelector('[data-cid="b"]');
    expect(b?.querySelector('.d2-sb.d2-sb--lit .d2-sb__st')?.textContent).toBe('進行中');
    expect(infoOf('b')).toBe('今天 2場');
    // 「建立賽事」在篩選列最後一個
    expect(document.querySelector('.cpl-toolbar')?.lastElementChild?.textContent).toBe('建立賽事');
  });

  it('預熱、招募當板不亮燈；數字格是距開賽 N 天、報名截止日期時間', async () => {
    const dict = await loadCompetitionsDict('zh-TW');
    const ct = makeCompetitionsT(dict);
    const one = (c: InAppListCard) => (
      <InAppCardList cards={[c]} ct={ct} status="open" onlyMine={false} showCreate={false}
        onStatus={() => {}} onOnlyMine={() => {}} onCreate={() => {}} onOpen={() => {}} />
    );
    const view = render(one(card({ cid: 'w', name: '預熱', category: 'league', phase: 'warm', line: { kind: 'warm', days: 3 } })));
    expect(document.querySelector('.d2-sb')).toBeTruthy();
    expect(document.querySelector('.d2-sb--lit')).toBeNull();
    expect(infoOf('w')).toBe('距開賽 3天');
    view.rerender(one(card({ cid: 'r', name: '招募', category: 'league', phase: 'recruit', line: { kind: 'deadline', date: '12/20 23:59' } })));
    expect(document.querySelector('.d2-sb__st')?.textContent).toBe('招募中');
    expect(document.querySelector('.d2-num')?.textContent).toBe('12/20 23:59');
    expect(infoOf('r')).toBe('報名截止 12/20 23:59');
  });

  it('已延期、已取消：板上狀態寫已延期／已取消、不亮燈、不畫數字格', async () => {
    const dict = await loadCompetitionsDict('zh-TW');
    render(
      <InAppCardList
        cards={[
          card({ cid: 'pp', name: '延期', category: 'league', phase: 'warm', statusMark: 'postponed', line: { kind: 'warm', days: 3 } }),
          card({ cid: 'cc', name: '取消', category: 'league', phase: 'done', statusMark: 'cancelled' }),
        ]}
        ct={makeCompetitionsT(dict)}
        status="open"
        onlyMine={false}
        showCreate={false}
        onStatus={() => {}}
        onOnlyMine={() => {}}
        onCreate={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(document.querySelector('[data-cid="pp"] .d2-sb__st')?.textContent).toBe('已延期');
    expect(document.querySelector('[data-cid="pp"] .d2-cells')).toBeNull();
    expect(document.querySelector('[data-cid="cc"] .d2-sb__st')?.textContent).toBe('已取消');
    expect(document.querySelector('.d2-sb--lit')).toBeNull();
  });

  it('沒有日期的舊「我的賽事」：板上只有分類與名稱，沒有日期列與數字格', async () => {
    const ct = makeCompetitionsT(await loadCompetitionsDict('zh-TW'));
    render(list([card({ cid: 'n', name: '只有名稱', category: 'friendly', phase: null })], ct));
    expect(document.querySelector('[data-cid="n"] .cpl-sb__cat')?.textContent).toBe('友誼賽');
    expect(document.querySelector('[data-cid="n"] .d2-sb__st')?.textContent).toBe('');
    expect(document.querySelector('[data-cid="n"] .cpl-meta')).toBeNull();
    expect(document.querySelector('[data-cid="n"] .d2-cells')).toBeNull();
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

  it('預設全部（站長 11-22），切狀態、分類、只看我的都不加查詢', async () => {
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
    const tabs = [...statusTabs().querySelectorAll('button')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['全部', '招募中', '預熱中', '進行中', '已結束']);
    expect(tabs.map((tab) => tab.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(document.querySelector('[data-cid="done_lg"]')).toBeTruthy();

    const rec = document.querySelector('[data-cid="rec_lg"]');
    expect(rec?.querySelector('.cpl-meta__date')?.textContent).toBe(`2027/01/09 ${EN} 01/10`);
    expect(rec?.querySelector('.cpl-meta__venue')?.textContent).toBe('示範球場');
    expect(infoOf('rec_lg')).toBe('報名截止 12/20 23:59');
    expect(rec?.querySelector('.d2-sb__st')?.textContent).toContain('招募中');

    const live = document.querySelector('[data-cid="live_fr"]');
    expect(live?.querySelector('.d2-sb--lit .d2-sb__st')?.textContent).toContain('進行中');
    // 摘要還沒回：不畫數字格，只預留那一列的高度
    expect(infoOf('live_fr')).toBe('');
    expect(live?.querySelector('.cpl-cells--wait')).not.toBeNull();
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

    // 每張都是記分板卡（站長 11-22）：進行中那張今天沒有場次仍在最上面、預留數字格高度；預熱中那張也是板、不亮燈。
    expect(document.querySelector('[data-inapp] > .cpl-card')?.getAttribute('data-cid')).toBe('live_fr');
    const warm = document.querySelector('[data-cid="warm_cup"]');
    expect(warm?.classList.contains('cpl-card--board')).toBe(true);
    expect(warm?.querySelector('.d2-sb--lit')).toBeNull();
    expect(warm?.querySelector('.d2-sb__st')?.textContent).toBe('預熱中');
    expect(warm?.querySelector('.cpl-sb__cat')?.textContent).toBe('盃賽');
    expect(infoOf('warm_cup')).toBe('距開賽 3天');
    expect(document.querySelectorAll('.cpl-card--board')).toHaveLength(document.querySelectorAll('.cpl-card').length);

    await pickStatus('warm');
    expect(document.querySelector('[data-cid="warm_cup"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="rec_lg"]')).toBeNull();
    expect(document.querySelector('[data-cid="live_fr"]')).toBeNull();

    await pickStatus('done');
    const done = document.querySelector('[data-cid="done_lg"]');
    expect(done?.classList.contains('ended')).toBe(true);
    expect(done?.querySelector('.d2-sb__st')?.textContent).toContain('已結束');
    expect(done?.querySelector('.d2-cells')).toBeNull();
    expect(document.querySelector('[data-cid="warm_cup"]')).toBeNull();

    await pickStatus('all');
    expect(document.querySelector('[data-cid="done_lg"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="rec_lg"]')).toBeTruthy();
    expect(document.querySelector('[data-cid="mine_only"]')).toBeTruthy();

    await pickStatus('recruit');
    expect(document.querySelector('[data-cid="done_lg"]')).toBeNull();
    await pickStatus('all');
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
      // 只有它一張，摘要回來後是亮燈的卡板：數字格「下一場 14:00」「今天 3 場」。
      expect(infoOf('live_lg')).toBe(`下一場 14:00${DOT}今天 3場`);
    });
    expect(document.querySelector('[data-cid="live_lg"] .d2-sb--lit')).toBeTruthy();
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
      // 每張都是記分板卡：有摘要的畫數字格；空片那張不畫、維持預留高度。
      expect(infoOf('live_cup')).toBe('今天 2場');
      expect(infoOf('live_lg')).toBe(`下一場 14:00${DOT}今天 3場`);
      expect(infoOf('live_empty')).toBe('');
      expect(document.querySelector('[data-cid="live_empty"] .cpl-cells--wait')).not.toBeNull();
    });
    // 預設全部（站長 11-22）：已結束的卡在畫面上，但不讀當日摘要。
    expect(document.querySelector('[data-cid="done_lg"]')).not.toBeNull();
    expect(seen.some((row) => row.startsWith('done_lg'))).toBe(false);
    expect(repo.calls()).toHaveLength(3 + 3);

    view.rerender(section(repo, 'league'));
    view.rerender(section(repo, 'all'));
    await pickStatus('done');
    await pickStatus('all');
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
      expect(infoOf('live_fr')).toBe(`下一場 13:00${DOT}今天 1場`);
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
    expect(infoOf('live_fr')).toBe('');
    await pickStatus('warm');
    fail = false;
    await pickStatus('all');
    await waitFor(() => {
      expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(2);
      expect(infoOf('live_fr')).toBe(`下一場 13:00${DOT}今天 1場`);
    });
  });

  it('進行中排最上面；摘要回來（空片）也不換位置、不換版面（每張都是板，取代原本只挑一張卡板）；讀取次數不變', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repo = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      competitions: [
        competition({
          id: 'warm_cup',
          name: '預熱盃',
          category: 'cup',
          hostType: 'personal',
          hostTeamId: null,
          regCloseAt: taipeiMs(2026, 12, 1, 23, 59),
          firstMatchAt: taipeiMs(2027, 2, 1, 8, 0),
          lastMatchAt: taipeiMs(2027, 2, 2, 18, 0),
        }),
        liveDoc('live_fr', '進行友誼', 'friendly'),
      ],
      summary: { live_fr: [{ id: shard, entries: [] }] },
    });
    const orig = repo.getSummaryShard.bind(repo);
    repo.getSummaryShard = async (cid, shardId) => {
      await gate;
      return orig(cid, shardId);
    };
    const order = (): string[] => [...document.querySelectorAll('[data-cid]')].map((el) => el.getAttribute('data-cid') ?? '');
    render(section(repo));
    expect(await screen.findByText('進行友誼')).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(order()).toEqual(['live_fr', 'warm_cup']);
    const before = document.querySelector('[data-cid="live_fr"] .d2-sb')?.className;
    release();
    await waitFor(() => expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(order()).toEqual(['live_fr', 'warm_cup']);
    expect(document.querySelector('[data-cid="live_fr"] .d2-sb')?.className).toBe(before);
  });
});

// 站長 11-21 預設站內後，站內 0 場時訪客第一眼不能是空白（顧問 11-21）：一行空狀態，沿用 cpl-xmsg，不加副標。
describe('站內 0 場的空狀態', () => {
  it('公開清單 0 場（訪客）：篩選列照畫，下面一行「目前沒有站內賽事」', async () => {
    const repo = createFakeCpRepo({ launch: { isPublic: true, bannedWords: [] }, competitions: [] });
    const env = { actor: { ...memberActor, uid: null }, repo, actions: idleActions(), now: NOW };
    render(
      <LocationProvider>
        <CpEnvProvider value={env}>
          <InAppSection />
        </CpEnvProvider>
      </LocationProvider>,
    );
    const msg = await screen.findByText('目前沒有站內賽事');
    expect(msg.tagName).toBe('P');
    expect(msg.className).toBe('cpl-xmsg');
    expect(document.querySelectorAll('.cpl-xmsg')).toHaveLength(1);
    expect(document.querySelector('[data-inapp="competitions"] .cpl-toolbar')).toBeTruthy();
    expect(document.querySelector('[data-cid]')).toBeNull();
  });

  it('有卡時不畫空狀態', async () => {
    const ct = makeCompetitionsT(await loadCompetitionsDict('zh-TW'));
    render(
      <InAppCardList
        cards={[card({ cid: 'a', name: '有一場', category: 'cup', phase: 'recruit' })]}
        ct={ct}
        status="open"
        onlyMine={false}
        showCreate={false}
        onStatus={() => undefined}
        onOnlyMine={() => undefined}
        onCreate={() => undefined}
        onOpen={() => undefined}
      />,
    );
    expect(screen.queryByText('目前沒有站內賽事')).toBeNull();
  });
});

describe('清單卡刪除鈕（站長 11-22）', () => {
  afterEach(() => {
    _resetAppConfirmForTest();
  });
  const docs = () => createFakeCpRepo({
    launch: { isPublic: true, bannedWords: [] },
    competitions: [
      competition({ id: 'rec_lg', name: '招募聯賽', category: 'league', hostType: 'personal', hostTeamId: null }),
      competition({ id: 'rec_cup', name: '招募盃', category: 'cup', hostType: 'personal', hostTeamId: null }),
      competition({
        id: 'live_fr', name: '進行友誼', category: 'friendly', hostType: 'personal', hostTeamId: null,
        regCloseAt: taipeiMs(2026, 12, 1, 23, 59), firstMatchAt: NOW - 60 * 60 * 1000, lastMatchAt: NOW + 24 * 60 * 60 * 1000,
      }),
      competition({
        id: 'live_pp', name: '延期進行', category: 'cup', hostType: 'personal', hostTeamId: null, status: 'postponed',
        regCloseAt: taipeiMs(2026, 12, 1, 23, 59), firstMatchAt: NOW - 60 * 60 * 1000, lastMatchAt: NOW + 24 * 60 * 60 * 1000,
      }),
      competition({
        id: 'done_lg', name: '結束聯賽', category: 'league', hostType: 'personal', hostTeamId: null,
        regCloseAt: taipeiMs(2026, 9, 1, 23, 59), firstMatchAt: taipeiMs(2026, 10, 3, 8, 0), lastMatchAt: taipeiMs(2026, 11, 21, 18, 0),
      }),
    ],
  });
  function draw(actor: typeof adminActor, deleteCompetition = vi.fn(async ({ cid }: { cid: string }) => ({ cid, deleted: true as const }))) {
    const repo = docs();
    render(
      <LocationProvider>
        <CpEnvProvider value={{ actor, repo, actions: { ...idleActions(), deleteCompetition }, now: NOW }}>
          <InAppSection />
        </CpEnvProvider>
        <AppConfirmHost />
      </LocationProvider>,
    );
    return { repo, deleteCompetition };
  }

  it('一般用戶看不到刪除鈕', async () => {
    draw(memberActor);
    expect(await screen.findByText('招募聯賽')).toBeTruthy();
    expect(document.querySelector('.cpl-del')).toBeNull();
  });

  it('管理員身分還在確認（rolePending）時不畫刪除鈕', async () => {
    draw({ ...adminActor, rolePending: true });
    expect(await screen.findByText('招募聯賽')).toBeTruthy();
    expect(document.querySelector('.cpl-del')).toBeNull();
  });

  it('刪到一半（伺服器已封鎖）：確認框改寫繼續刪除、卡片留著（審查 P3-4）', async () => {
    const deleteCompetition = vi.fn(async (): Promise<{ cid: string; deleted: true }> => { throw new CpCallError('INTERNAL', {}); });
    const { repo } = draw(adminActor, deleteCompetition);
    expect(await screen.findByText('招募聯賽')).toBeTruthy();
    const orig = repo.getCompetition.bind(repo);
    repo.getCompetition = async (cid: string) => {
      const doc = await orig(cid);
      return doc ? { ...doc, hidden: true, deletingAt: NOW } : doc;
    };
    fireEvent.click(document.querySelector('[data-cid="rec_lg"] .cpl-del') as HTMLButtonElement);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getAllByRole('button').at(-1)!);
    const ack = await screen.findByRole('checkbox', { name: '我了解刪除後無法復原' });
    fireEvent.click(ack);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)); });
    fireEvent.click(screen.getAllByRole('button', { name: '刪除賽事' }).at(-1) as HTMLButtonElement);
    await waitFor(() => expect(deleteCompetition).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '繼續刪除' }).length).toBeGreaterThan(0));
    expect(document.querySelector('[data-cid="rec_lg"]')).not.toBeNull();
  });

  it('管理員：右下角刪除鈕 → 第一次確認取消不刪；確認後第二次要勾選、等 0.6 秒才刪，刪完卡片消失', async () => {
    const { deleteCompetition } = draw(adminActor);
    expect(await screen.findByText('招募聯賽')).toBeTruthy();
    // 進行中（含整場延期但階段仍是進行中）不放；招募兩張與已結束各一個（站長 11-22）
    await screen.findByText('結束聯賽');
    expect(document.querySelector('[data-cid="live_fr"]')).not.toBeNull();
    expect(document.querySelector('[data-cid="live_fr"] .cpl-del')).toBeNull();
    expect(document.querySelector('[data-cid="live_pp"][data-phase="live"][data-mark="postponed"]')).not.toBeNull();
    expect(document.querySelector('[data-cid="live_pp"] .cpl-del')).toBeNull();
    expect(document.querySelector('[data-cid="done_lg"] .cpl-del')).not.toBeNull();
    expect(document.querySelectorAll('.cpl-del')).toHaveLength(3);
    const del = () => document.querySelector('[data-cid="rec_lg"] .cpl-del') as HTMLButtonElement;
    expect(del().getAttribute('aria-label')).toBe('刪除賽事：招募聯賽');
    // 按鈕不在連結裡
    expect(del().closest('a')).toBeNull();

    // 第一次確認：取消 → 不開第二個框、不刪
    fireEvent.click(del());
    const first = await screen.findByRole('alertdialog');
    expect(first.textContent).toContain('要刪除「招募聯賽」嗎？');
    // 確認框按鈕：取消在左、確定在右
    fireEvent.click(within(first).getAllByRole('button')[0]!);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('checkbox', { name: '我了解刪除後無法復原' })).toBeNull();

    // 第一次確認通過 → 第二次確認框
    fireEvent.click(del());
    fireEvent.click(within(await screen.findByRole('alertdialog')).getAllByRole('button').at(-1)!);
    const ack = await screen.findByRole('checkbox', { name: '我了解刪除後無法復原' });
    const confirmBtn = () => screen.getAllByRole('button', { name: '刪除賽事' }).at(-1) as HTMLButtonElement;
    fireEvent.click(confirmBtn());
    expect(deleteCompetition).not.toHaveBeenCalled();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(ack);
      await act(async () => { vi.advanceTimersByTime(700); });
    } finally {
      vi.useRealTimers();
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(deleteCompetition).toHaveBeenCalledWith({ cid: 'rec_lg' }));
    await waitFor(() => expect(document.querySelector('[data-cid="rec_lg"]')).toBeNull());
    expect(document.querySelector('[data-cid="rec_cup"]')).not.toBeNull();
    expect(deleteCompetition).toHaveBeenCalledTimes(1);
  });
});
