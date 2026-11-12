import { describe, expect, it } from 'vitest';
import { buildRegCapacityBar, REG_BAR_MAX_WAIT_SHARE, sumTeamReservationUsed } from './reg-capacity-bar';
import { actualConfirmedCount, type DetailEvent } from './detail-model';

const team = (reservedSlots: number, usedSlots: number) => ({
  teamId: 't', reservedSlots, usedSlots, remainingSlots: Math.max(0, reservedSlots - usedSlots),
});

function bar(over: Partial<Parameters<typeof buildRegCapacityBar>[0]> = {}) {
  return buildRegCapacityBar({
    teamReservationSummaries: [],
    confirmedCount: 0,
    reservedRemainingCount: 0,
    waitlistCount: 0,
    maxCount: 24,
    ...over,
  });
}

describe('sumTeamReservationUsed', () => {
  it('每隊取 min(usedSlots, reservedSlots) 加總；超出保留額的團隊報名不算團隊已報', () => {
    expect(sumTeamReservationUsed([team(6, 4), team(2, 5)])).toBe(6);
  });
  it('非陣列、缺欄位、負數都當 0', () => {
    expect(sumTeamReservationUsed(undefined)).toBe(0);
    expect(sumTeamReservationUsed([null, { reservedSlots: -3, usedSlots: 2 }, { usedSlots: 'x' }])).toBe(0);
  });
});

describe('buildRegCapacityBar', () => {
  it('max=0 不畫條', () => {
    expect(bar({ maxCount: 0, confirmedCount: 5 })).toBeNull();
  });

  it('情境乙：一般 10、團隊已報 4、團隊未報 4、空 6，無候補', () => {
    const m = bar({ teamReservationSummaries: [team(8, 4)], confirmedCount: 14, reservedRemainingCount: 4 })!;
    expect(m.segments).toEqual([
      { key: 'general', count: 10, pct: 41.667 },
      { key: 'team', count: 4, pct: 16.667 },
      { key: 'team-open', count: 4, pct: 16.667 },
    ]);
    expect(m.mainBasis).toBe(100);
    expect(m.waitBasis).toBe(0);
    expect(m.legend.map(i => `${i.label} ${i.count}`)).toEqual(['一般 10', '團隊 4', '保留 4']);
  });

  it('情境甲：額滿 24、候補 3，候補膠囊按比例（上限＋候補）', () => {
    const m = bar({ teamReservationSummaries: [team(6, 4)], confirmedCount: 22, reservedRemainingCount: 2, waitlistCount: 3 })!;
    expect(m.segments.map(s => [s.key, s.count])).toEqual([['general', 18], ['team', 4], ['team-open', 2]]);
    expect(m.waitBasis).toBe(11.111);
    expect(m.mainBasis).toBe(88.889);
    expect(m.legend.map(i => i.key)).toEqual(['general', 'team', 'team-open', 'wait']);
  });

  it('候補很多時候補膠囊最多占 30%', () => {
    const m = bar({ confirmedCount: 24, waitlistCount: 40 })!;
    expect(m.waitBasis).toBe(REG_BAR_MAX_WAIT_SHARE * 100);
    expect(m.mainBasis).toBe(70);
    expect(m.legend.map(i => `${i.label} ${i.count}`)).toEqual(['已報 24', '候補 40']);
  });

  it('usedSlots > reservedSlots：團隊已報只算保留額內，其餘算一般', () => {
    const m = bar({ teamReservationSummaries: [team(2, 5)], confirmedCount: 10 })!;
    expect(m.segments.map(s => [s.key, s.count])).toEqual([['general', 8], ['team', 2]]);
  });

  it('團隊已報不超過實際正取（資料暫時不同步時不出負數）', () => {
    const m = bar({ teamReservationSummaries: [team(6, 6)], confirmedCount: 3 })!;
    expect(m.segments.map(s => [s.key, s.count])).toEqual([['team', 3]]);
  });

  it('正取＋團隊未報超過上限時以實際總數當滿格，不溢出', () => {
    const m = bar({ maxCount: 10, confirmedCount: 9, reservedRemainingCount: 3 })!;
    const total = m.segments.reduce((sum, s) => sum + s.pct, 0);
    expect(total).toBeCloseTo(100, 2);
    expect(m.segments.find(s => s.key === 'general')?.pct).toBe(75);
  });

  it('只有一般已報時不出圖例；空活動條內沒有色段', () => {
    expect(bar({ confirmedCount: 18 })!.legend).toEqual([]);
    const empty = bar()!;
    expect(empty.segments).toEqual([]);
    expect(empty.legend).toEqual([]);
  });

  it('沒有團隊已報時一般段標「已報」，圖例只列數量 > 0 的項目', () => {
    const m = bar({ confirmedCount: 12, reservedRemainingCount: 4 })!;
    expect(m.legend.map(i => `${i.label} ${i.count}`)).toEqual(['已報 12', '保留 4']);
  });
});

describe('actualConfirmedCount（報名卡 N）', () => {
  const ev = (over: Record<string, unknown>) => ({ id: 'e', ...over }) as DetailEvent;

  it('有 realCurrent 用它，不用已含團隊未報的 current', () => {
    expect(actualConfirmedCount(ev({ current: 18, realCurrent: 14, teamReservationSummaries: [team(8, 4)] }))).toBe(14);
  });
  it('缺 realCurrent 時退回 current 扣團隊未報（同 A _getEventActualConfirmedCount）', () => {
    expect(actualConfirmedCount(ev({ current: 18, teamReservationSummaries: [team(8, 4)] }))).toBe(14);
  });
  it('沒有團隊保留時等於 current', () => {
    expect(actualConfirmedCount(ev({ current: 7 }))).toBe(7);
  });
  // 審查 P2 修正：A 以 `||` 串接會讓 0 誤退回名單筆數；B 算出 0 就是 0。
  it('realCurrent 為 0 時就是 0，即使名單非空', () => {
    expect(actualConfirmedCount(ev({ realCurrent: 0, current: 3, participantsWithUid: [{ uid: 'a' }], participants: ['甲'] }))).toBe(0);
  });
  it('current 扣團隊未報後為 0 時就是 0，不退回名單', () => {
    expect(actualConfirmedCount(ev({ current: 3, teamReservationSummaries: [team(3, 0)], participants: ['甲'] }))).toBe(0);
  });
  it('realCurrent 為 null／空字串視為缺欄，改用 current 扣團隊未報', () => {
    expect(actualConfirmedCount(ev({ realCurrent: null, current: 5, teamReservationSummaries: [team(4, 2)] }))).toBe(3);
    expect(actualConfirmedCount(ev({ realCurrent: '', current: 5 }))).toBe(5);
  });
  it('realCurrent 與 current 都缺欄時才退回 participantsWithUid／participants 筆數', () => {
    expect(actualConfirmedCount(ev({ participantsWithUid: [{ uid: 'a' }, { uid: 'b' }], participants: ['甲'] }))).toBe(2);
    expect(actualConfirmedCount(ev({ current: null, realCurrent: 'x', participants: ['甲'] }))).toBe(1);
  });
  it('remainingSlots 為負數或非數字時正取不增加', () => {
    expect(actualConfirmedCount(ev({ current: 5, teamReservationSummaries: [{ remainingSlots: -3 }, { remainingSlots: 'x' }] }))).toBe(5);
  });
});
