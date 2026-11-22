import { describe, expect, it } from 'vitest';
import { formatTaipeiShort, taipeiMs } from '../format';
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

  it('即將開放（站長 11-22）：招募階段且報名還沒開始寫開放時間、卡片帶 soon；開始那一刻起改回報名截止', () => {
    const doc = competition();
    const before = doc.regOpenAt - 1;
    expect(statusLineFor(doc, 'recruit', before, undefined)).toEqual({ kind: 'opens', date: formatTaipeiShort(doc.regOpenAt) });
    expect(statusLineFor(doc, 'recruit', doc.regOpenAt, undefined)).toEqual({ kind: 'deadline', date: '12/20 23:59' });
    const at = (now: number) => assembleInAppCards({ publicDocs: [doc], hosted: [], mine: [], now })[0];
    expect(at(before)).toMatchObject({ phase: 'recruit', soon: true, line: { kind: 'opens' } });
    expect(at(doc.regOpenAt)).toMatchObject({ phase: 'recruit', soon: false, line: { kind: 'deadline' } });
    expect(at(taipeiMs(2026, 12, 21, 12, 0))?.soon).toBe(false);
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

  it('封面：卡只帶一個清單用圖（有 card 用 card、舊賽事退原圖 url）；下架（含主辦查詢帶進來的）或沒封面都是空字串', () => {
    const cover = { url: 'https://example.test/cover.webp', thumb: 'https://example.test/thumb.webp' };
    const card = 'https://example.test/card.webp';
    const cards = assembleInAppCards({
      publicDocs: [
        { ...competition({ id: 'with', name: '有圖' }), cover },
        { ...competition({ id: 'card', name: '有卡片圖' }), cover: { ...cover, card } },
        { ...competition({ id: 'hidden', name: '下架' }), cover: { ...cover, card }, hidden: true },
        { ...competition({ id: 'none', name: '沒圖' }), cover: null },
      ],
      // 主辦俱樂部那條查詢不濾下架：下架的也一樣不帶封面（清單沒有管理員例外）
      hosted: [{ ...competition({ id: 'hosted_hidden', name: '主辦下架', hostTeamId: 'club_a' }), cover, hidden: true }],
      mine: [{ cid: 'named', name: '只有名稱', category: 'friendly', doc: null }],
      now: NOW,
    });
    const by = (cid: string) => cards.find((item) => item.cid === cid);
    expect(by('with')?.cover).toBe(cover.url);
    expect(by('card')?.cover).toBe(card);
    expect(by('card')).not.toHaveProperty('thumb');
    for (const cid of ['hidden', 'none', 'hosted_hidden', 'named']) expect(by(cid)?.cover).toBe('');
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

});
