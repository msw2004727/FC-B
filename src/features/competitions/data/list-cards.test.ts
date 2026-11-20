import { describe, expect, it } from 'vitest';
import { taipeiMs } from '../format';
import { competition, NOW } from '../testing/screen-fixtures';
import type { SummaryEntry } from './types';
import {
  assembleInAppCards,
  daysUntilFirstMatch,
  filterInAppCards,
  firstVenueName,
  formatInAppDates,
  isTrulyLive,
  passesInAppStatus,
  pickInAppBoard,
  statusLineFor,
  todayFromShard,
  type InAppListCard,
} from './list-cards';

const IDE = '\u3000';
const EN = '\u2013';

describe('站內卡片純函式', () => {
  it('距開賽是台北日曆日差，當天與已過都是 0', () => {
    const now = taipeiMs(2026, 12, 10, 12, 0);
    expect(daysUntilFirstMatch(now, taipeiMs(2026, 12, 13, 9, 0))).toBe(3);
    expect(daysUntilFirstMatch(now, taipeiMs(2026, 12, 10, 23, 0))).toBe(0);
    expect(daysUntilFirstMatch(now, taipeiMs(2026, 12, 9, 8, 0))).toBe(0);
  });

  it('狀態行：招募寫截止、預熱寫天數、進行中沒資料留空、已結束不寫冠軍', () => {
    const doc = competition();
    expect(statusLineFor(doc, 'recruit', NOW, undefined)).toEqual({ kind: 'deadline', date: '12/20 23:59' });
    expect(statusLineFor(doc, 'warm', taipeiMs(2026, 12, 10, 12, 0), undefined)).toEqual({ kind: 'warm', days: 30 });
    expect(statusLineFor(doc, 'live', NOW, undefined)).toBeNull();
    expect(statusLineFor(doc, 'live', NOW, { count: 0, time: null })).toBeNull();
    expect(statusLineFor(doc, 'live', NOW, { count: 3, time: '14:30' })).toEqual({
      kind: 'live', count: 3, time: '14:30',
    });
    expect(statusLineFor(doc, 'live', NOW, { count: 3, time: '  ' })).toEqual({ kind: 'today', count: 3 });
    expect(statusLineFor(doc, 'live', NOW, { count: 3, time: null })).toEqual({ kind: 'today', count: 3 });
    expect(statusLineFor(doc, 'done', NOW, { count: 2, time: '09:00' })).toBeNull();
  });

  it('當日摘要片：場數是片長；下一場是時間 ≥ now 且 scheduled 的最早一場', () => {
    const now = taipeiMs(2026, 12, 10, 12, 0);
    const row = (partial: Partial<SummaryEntry> & Pick<SummaryEntry, 'id'>): SummaryEntry => ({
      dv: 'dv',
      r: 1,
      no: 1,
      k: null,
      v: null,
      h: { id: 'h', n: '主' },
      a: { id: 'a', n: '客' },
      s: [0, 0],
      st: 'scheduled',
      wo: null,
      ...partial,
    });
    expect(todayFromShard([], now)).toBeNull();
    expect(todayFromShard([
      row({ id: 'past', k: taipeiMs(2026, 12, 10, 9, 0) }),
      row({ id: 'now', k: now }),
      row({ id: 'later', k: taipeiMs(2026, 12, 10, 15, 0), st: 'confirmed' }),
      row({ id: 'next', k: taipeiMs(2026, 12, 10, 14, 30) }),
      row({ id: 'tbd', k: null }),
    ], now)).toEqual({ count: 5, time: '12:00' });
    expect(todayFromShard([
      row({ id: 'past', k: taipeiMs(2026, 12, 10, 9, 0), st: 'finished' }),
      row({ id: 'tbd', k: null }),
    ], now)).toEqual({ count: 2, time: null });
    expect(todayFromShard([
      row({ id: 'off', k: taipeiMs(2026, 12, 10, 13, 0), st: 'cancelled' }),
      row({ id: 'moved', k: taipeiMs(2026, 12, 10, 13, 30), st: 'postponed' }),
      row({ id: 'next', k: taipeiMs(2026, 12, 10, 14, 0), st: 'scheduled' }),
    ], now)).toEqual({ count: 2, time: '14:00' });
    expect(todayFromShard([
      row({ id: 'off', k: now, st: 'cancelled' }),
    ], now)).toBeNull();
  });

  it('合併去重、我的與主辦做記號、沒時間的排後面；未結束仍含未知階段', () => {
    const early = competition({ id: 'early', name: '較早', firstMatchAt: taipeiMs(2026, 12, 1, 8, 0) });
    const later = competition({ id: 'later', name: '較晚', firstMatchAt: taipeiMs(2027, 3, 1, 8, 0) });
    const hosted = competition({
      id: 'hosted',
      name: '主辦盃',
      hostTeamId: 'club_a',
      firstMatchAt: taipeiMs(2026, 10, 1, 8, 0),
      lastMatchAt: taipeiMs(2026, 10, 2, 18, 0),
    });
    const cards = assembleInAppCards({
      publicDocs: [early, later],
      hosted: [hosted],
      mine: [
        { cid: 'later', name: '不該蓋過公開名稱', category: 'cup', doc: competition({ id: 'later', name: '另一個名' }) },
        { cid: 'named', name: '只有名稱', category: 'friendly', doc: null },
      ],
      now: NOW,
      todayByCid: new Map([['early', { count: 2, time: '09:00' }]]),
    });
    // early 正在進行中，排最上面；其餘照首場新到舊，沒時間的排後面。
    expect(cards.map((card) => card.cid)).toEqual(['early', 'later', 'hosted', 'named']);
    expect(cards.map((card) => card.name)).toEqual(['較早', '較晚', '主辦盃', '只有名稱']);
    expect(cards.find((card) => card.cid === 'later')).toMatchObject({ mine: true, name: '較晚' });
    expect(cards.find((card) => card.cid === 'early')).toMatchObject({
      mine: false,
      line: { kind: 'live', count: 2, time: '09:00' },
    });
    expect(cards.find((card) => card.cid === 'hosted')).toMatchObject({
      mine: true,
      ended: true,
      line: null,
    });
    expect(cards.find((card) => card.cid === 'named')).toMatchObject({
      phase: null, mine: true, date: '', venue: '', firstMatchAt: null,
    });
    expect(cards.find((card) => card.cid === 'later')).toMatchObject({
      date: `2027/03/01 ${EN} 01/10`,
      venue: '示範球場',
      firstMatchAt: later.firstMatchAt,
    });

    const tied = competition({ id: 'b', name: '乙', firstMatchAt: later.firstMatchAt });
    const sameTime = assembleInAppCards({
      publicDocs: [later, tied],
      hosted: [],
      mine: [],
      now: NOW,
    });
    expect(sameTime.map((card) => card.cid)).toEqual(['b', 'later']);
    const marked = assembleInAppCards({
      publicDocs: [
        competition({ id: 'late_comp', name: '延期盃', status: 'postponed' }),
        competition({ id: 'stop_comp', name: '取消盃', status: 'cancelled' }),
      ],
      hosted: [],
      mine: [],
      now: NOW,
    });
    expect(marked.find((card) => card.cid === 'late_comp')?.statusMark).toBe('postponed');
    expect(marked.find((card) => card.cid === 'stop_comp')?.statusMark).toBe('cancelled');
    expect(marked.find((card) => card.cid === 'stop_comp')?.ended).toBe(true);

    const named = cards.find((card) => card.cid === 'named')!;
    expect(passesInAppStatus(named, 'open')).toBe(true);
    expect(passesInAppStatus(named, 'all')).toBe(true);
    expect(passesInAppStatus(named, 'recruit')).toBe(false);
    expect(filterInAppCards(cards, 'all', 'open', true).map((card) => card.cid)).toEqual(['later', 'named']);
    expect(filterInAppCards(cards, 'friendly', 'all', false).map((card) => card.cid)).toEqual(['named']);
    expect(filterInAppCards(cards, 'all', 'done', false).map((card) => card.cid)).toEqual(['hosted']);
  });

  it('日期與場地拆成兩個欄位；同一年省略結束年；同一天不重複；地點用第一個有名稱的場地', () => {
    const doc = competition();
    expect(formatInAppDates(doc)).toBe(`2027/01/09 ${EN} 01/10`);
    expect(formatInAppDates({
      firstMatchAt: taipeiMs(2026, 12, 30, 8, 0),
      lastMatchAt: taipeiMs(2027, 1, 2, 18, 0),
    })).toBe(`2026/12/30 ${EN} 2027/01/02`);
    expect(formatInAppDates({
      firstMatchAt: taipeiMs(2027, 2, 6, 8, 0),
      lastMatchAt: taipeiMs(2027, 2, 6, 18, 0),
    })).toBe('2027/02/06');
    expect(firstVenueName(doc)).toBe('示範球場');
    expect(firstVenueName({ venues: [] })).toBe('');
    expect(firstVenueName({
      venues: [{ ...doc.venues[0]!, name: '  ' }, { ...doc.venues[0]!, name: ' 第二球場 ' }],
    })).toBe('第二球場');
    const [card] = assembleInAppCards({ publicDocs: [doc], hosted: [], mine: [], now: NOW });
    expect(card).toMatchObject({ date: `2027/01/09 ${EN} 01/10`, venue: '示範球場', firstMatchAt: doc.firstMatchAt });
  });

  it('排序：真的在進行中排最上面（延期的不算）；彼此之間與其餘照首場新到舊、沒時間的排後', () => {
    const liveOld = competition({ id: 'live_old', name: '進行中舊', firstMatchAt: taipeiMs(2026, 11, 1, 8, 0) });
    const liveNew = competition({ id: 'live_new', name: '進行中新', firstMatchAt: taipeiMs(2026, 12, 5, 8, 0) });
    const livePostponed = competition({
      id: 'live_pp', name: '延期中', status: 'postponed', firstMatchAt: taipeiMs(2026, 12, 8, 8, 0),
    });
    const warm = competition({
      id: 'warm',
      name: '預熱',
      regCloseAt: taipeiMs(2026, 12, 1, 8, 0),
      firstMatchAt: taipeiMs(2027, 2, 1, 8, 0),
      lastMatchAt: taipeiMs(2027, 2, 2, 8, 0),
    });
    const recruit = competition({ id: 'recruit', name: '招募', firstMatchAt: taipeiMs(2027, 1, 9, 8, 0) });
    const done = competition({
      id: 'done', name: '結束', firstMatchAt: taipeiMs(2026, 10, 1, 8, 0), lastMatchAt: taipeiMs(2026, 10, 2, 8, 0),
    });
    const cards = assembleInAppCards({
      publicDocs: [done, recruit, liveOld, warm, livePostponed, liveNew],
      hosted: [],
      mine: [{ cid: 'zz_named', name: '只有名稱', category: 'cup', doc: null }],
      now: NOW,
    });
    expect(cards.map((card) => card.cid)).toEqual(['live_new', 'live_old', 'warm', 'recruit', 'live_pp', 'done', 'zz_named']);
    expect(cards.map((card) => card.phase)).toEqual(['live', 'live', 'warm', 'recruit', 'live', 'done', null]);
    expect(isTrulyLive(cards.find((card) => card.cid === 'live_pp')!)).toBe(false);
    expect(isTrulyLive(cards[0]!)).toBe(true);
  });

  describe('卡板判定', () => {
    const base: InAppListCard = {
      cid: 'x',
      name: 'x',
      category: 'league',
      phase: 'recruit',
      date: '',
      venue: '',
      firstMatchAt: 1000,
      line: null,
      mine: false,
      ended: false,
      statusMark: null,
    };
    const card = (partial: Partial<InAppListCard> & Pick<InAppListCard, 'cid'>): InAppListCard => ({ ...base, ...partial });
    const LIVE = { kind: 'live', count: 3, time: '14:30' } as const;
    const TODAY = { kind: 'today', count: 2 } as const;
    const WARM = { kind: 'warm', days: 3 } as const;
    const DEADLINE = { kind: 'deadline', date: '12/20 23:59' } as const;
    const ids = (list: readonly InAppListCard[]): string[] => list.map((item) => item.cid);

    it('一場進行中、今天有比賽：它是卡板、在最上面', () => {
      const list = [card({ cid: 'warm', phase: 'warm', line: WARM }), card({ cid: 'live', phase: 'live', line: LIVE })];
      const out = pickInAppBoard(list, new Set(['live']));
      expect(out.boardCid).toBe('live');
      expect(ids(out.cards)).toEqual(['live', 'warm']);
    });

    it('兩場以上進行中、今天都有比賽：首場最早的是卡板，其餘緊接在後、順序不變', () => {
      const list = [
        card({ cid: 'b_new', phase: 'live', line: LIVE, firstMatchAt: 300 }),
        card({ cid: 'a_old', phase: 'live', line: TODAY, firstMatchAt: 100 }),
        card({ cid: 'c_mid', phase: 'live', line: LIVE, firstMatchAt: 200 }),
        card({ cid: 'warm', phase: 'warm', line: WARM, firstMatchAt: 50 }),
      ];
      const out = pickInAppBoard(list, new Set(['b_new', 'a_old', 'c_mid']));
      expect(out.boardCid).toBe('a_old');
      expect(ids(out.cards)).toEqual(['a_old', 'b_new', 'c_mid', 'warm']);
    });

    it('進行中今天都沒比賽（或讀取失敗）、另有預熱中：預熱中的是卡板，進行中的排第二起', () => {
      const list = [
        card({ cid: 'live', phase: 'live', line: null }),
        card({ cid: 'warm', phase: 'warm', line: WARM }),
        card({ cid: 'recruit', phase: 'recruit', line: DEADLINE }),
      ];
      const out = pickInAppBoard(list, new Set(['live']));
      expect(out.boardCid).toBe('warm');
      expect(ids(out.cards)).toEqual(['warm', 'live', 'recruit']);
    });

    it('沒有進行中：預熱中優先於招募中；同一種取首場最早，再平手取 cid 小的', () => {
      const mixed = [
        card({ cid: 'r1', phase: 'recruit', line: DEADLINE, firstMatchAt: 10 }),
        card({ cid: 'w_late', phase: 'warm', line: WARM, firstMatchAt: 500 }),
        card({ cid: 'w_b', phase: 'warm', line: WARM, firstMatchAt: 200 }),
        card({ cid: 'w_a', phase: 'warm', line: WARM, firstMatchAt: 200 }),
      ];
      const out = pickInAppBoard(mixed, new Set());
      expect(out.boardCid).toBe('w_a');
      expect(ids(out.cards)).toEqual(['w_a', 'r1', 'w_late', 'w_b']);
      const recruitOnly = [
        card({ cid: 'r_late', phase: 'recruit', line: DEADLINE, firstMatchAt: 900 }),
        card({ cid: 'r_early', phase: 'recruit', line: DEADLINE, firstMatchAt: 100 }),
      ];
      expect(pickInAppBoard(recruitOnly, new Set()).boardCid).toBe('r_early');
    });

    it('等待：有一張真的在進行中的卡摘要還沒有結果，就先不放板、清單原樣', () => {
      const list = [
        card({ cid: 'live_a', phase: 'live', line: LIVE }),
        card({ cid: 'live_b', phase: 'live', line: null }),
        card({ cid: 'warm', phase: 'warm', line: WARM }),
      ];
      const waiting = pickInAppBoard(list, new Set(['live_a']));
      expect(waiting.boardCid).toBeNull();
      expect(waiting.cards).toBe(list);
      expect(pickInAppBoard(list, new Set(['live_a', 'live_b'])).boardCid).toBe('live_a');
    });

    it('延期的進行中卡不必等、也沒有資格；已取消、已結束、只有名稱、沒有重點句的都沒有資格', () => {
      const postponedLive = card({ cid: 'pp', phase: 'live', line: LIVE, statusMark: 'postponed' });
      expect(pickInAppBoard([postponedLive, card({ cid: 'warm', phase: 'warm', line: WARM })], new Set()).boardCid)
        .toBe('warm');
      const none = [
        postponedLive,
        card({ cid: 'pp_warm', phase: 'warm', line: WARM, statusMark: 'postponed' }),
        card({ cid: 'cx', phase: 'done', line: null, statusMark: 'cancelled', ended: true }),
        card({ cid: 'done', phase: 'done', line: null, ended: true }),
        card({ cid: 'named', phase: null, line: null, firstMatchAt: null }),
        card({ cid: 'recruit_no_line', phase: 'recruit', line: null }),
      ];
      const out = pickInAppBoard(none, new Set());
      expect(out.boardCid).toBeNull();
      expect(out.cards).toBe(none);
    });

    it('篩選成已結束：沒有板；空清單也沒有板', () => {
      const doneOnly = [card({ cid: 'd1', phase: 'done', ended: true }), card({ cid: 'd2', phase: 'done', ended: true })];
      expect(pickInAppBoard(doneOnly, new Set()).boardCid).toBeNull();
      expect(pickInAppBoard([], new Set()).boardCid).toBeNull();
    });
  });
});
