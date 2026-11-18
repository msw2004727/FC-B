import { describe, expect, it } from 'vitest';
import { taipeiMs } from '../format';
import { competition, NOW } from '../testing/screen-fixtures';
import type { SummaryEntry } from './types';
import {
  assembleInAppCards,
  daysUntilFirstMatch,
  filterInAppCards,
  formatInAppWhenWhere,
  passesInAppStatus,
  statusLineFor,
  todayFromShard,
} from './list-cards';

const IDE = '\u3000';
const EN = '\u2013';

describe('站內卡片純函式', () => {
  it('日期用比賽期間；同一年省略結束年；同一天不重複；地點用第一個有名稱的場地', () => {
    const doc = competition();
    expect(formatInAppWhenWhere(doc)).toBe(`2027/01/09 ${EN} 01/10${IDE}示範球場`);
    expect(formatInAppWhenWhere({
      ...doc,
      firstMatchAt: taipeiMs(2026, 12, 30, 8, 0),
      lastMatchAt: taipeiMs(2027, 1, 2, 18, 0),
    })).toBe(`2026/12/30 ${EN} 2027/01/02${IDE}示範球場`);
    expect(formatInAppWhenWhere({
      ...doc,
      firstMatchAt: taipeiMs(2027, 2, 6, 8, 0),
      lastMatchAt: taipeiMs(2027, 2, 6, 18, 0),
    })).toBe(`2027/02/06${IDE}示範球場`);
    expect(formatInAppWhenWhere({ ...doc, venues: [{ ...doc.venues[0]!, name: '  ' }] })).toBe(`2027/01/09 ${EN} 01/10`);
  });

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
    expect(cards.map((card) => card.cid)).toEqual(['later', 'early', 'hosted', 'named']);
    expect(cards.map((card) => card.name)).toEqual(['較晚', '較早', '主辦盃', '只有名稱']);
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
    expect(cards.find((card) => card.cid === 'named')).toMatchObject({ phase: null, mine: true, dates: '' });

    const tied = competition({ id: 'b', name: '乙', firstMatchAt: later.firstMatchAt });
    const sameTime = assembleInAppCards({
      publicDocs: [later, tied],
      hosted: [],
      mine: [],
      now: NOW,
    });
    expect(sameTime.map((card) => card.cid)).toEqual(['b', 'later']);

    const named = cards.find((card) => card.cid === 'named')!;
    expect(passesInAppStatus(named, 'open')).toBe(true);
    expect(passesInAppStatus(named, 'all')).toBe(true);
    expect(passesInAppStatus(named, 'recruit')).toBe(false);
    expect(filterInAppCards(cards, 'all', 'open', true).map((card) => card.cid)).toEqual(['later', 'named']);
    expect(filterInAppCards(cards, 'friendly', 'all', false).map((card) => card.cid)).toEqual(['named']);
    expect(filterInAppCards(cards, 'all', 'done', false).map((card) => card.cid)).toEqual(['hosted']);
  });
});
