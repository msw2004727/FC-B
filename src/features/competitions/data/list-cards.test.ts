import { describe, expect, it } from 'vitest';
import { taipeiMs } from '../format';
import { competition, NOW } from '../testing/screen-fixtures';
import {
  assembleInAppCards,
  daysUntilFirstMatch,
  filterInAppCards,
  formatInAppWhenWhere,
  passesInAppStatus,
  statusLineFor,
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

  it('狀態行：招募寫截止、預熱寫天數、進行中與冠軍沒有資料就留空', () => {
    const doc = competition();
    expect(statusLineFor(doc, 'recruit', NOW, undefined, undefined)).toEqual({ kind: 'deadline', date: '12/20 23:59' });
    expect(statusLineFor(doc, 'warm', taipeiMs(2026, 12, 10, 12, 0), undefined, undefined)).toEqual({ kind: 'warm', days: 30 });
    expect(statusLineFor(doc, 'live', NOW, undefined, undefined)).toBeNull();
    expect(statusLineFor(doc, 'live', NOW, { count: 3, time: '14:30' }, undefined)).toEqual({
      kind: 'live', count: 3, time: '14:30',
    });
    expect(statusLineFor(doc, 'live', NOW, { count: 3, time: '  ' }, undefined)).toBeNull();
    expect(statusLineFor(doc, 'done', NOW, undefined, undefined)).toBeNull();
    expect(statusLineFor(doc, 'done', NOW, undefined, '  ')).toBeNull();
    expect(statusLineFor(doc, 'done', NOW, undefined, '海風隊')).toEqual({ kind: 'champion', name: '海風隊' });
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
      championByCid: new Map([['hosted', '海風隊']]),
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
      line: { kind: 'champion', name: '海風隊' },
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
