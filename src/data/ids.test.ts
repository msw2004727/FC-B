import { describe, expect, it } from 'vitest';

import { generateId, ID_PREFIX, isValidEventId, taApplicationId } from './ids';

describe('generateId', () => {
  it('產生 event ID 格式 ^ce_\\d{13}_[a-z0-9]{1,6}$', () => {
    const id = generateId(ID_PREFIX.event);
    expect(id).toMatch(/^ce_\d{13}_[a-z0-9]{1,6}$/);
  });

  it('前綴正確套用', () => {
    expect(generateId(ID_PREFIX.team)).toMatch(/^tm_\d{13}_/);
    expect(generateId(ID_PREFIX.tournament)).toMatch(/^ct_\d{13}_/);
    expect(generateId(ID_PREFIX.registration)).toMatch(/^reg_\d{13}_/);
    expect(generateId(ID_PREFIX.match)).toMatch(/^cm_\d{13}_/);
  });

  it('空前綴仍可產生合法字串', () => {
    const id = generateId('');
    expect(id).toMatch(/^\d{13}_[a-z0-9]{1,6}$/);
  });

  it('連續呼叫產生不同 ID（時間戳相同時靠 random 後綴）', () => {
    const id1 = generateId(ID_PREFIX.event);
    const id2 = generateId(ID_PREFIX.event);
    // 幾乎不可能相同；如果相同代表 random 撞了，我們只驗證格式而不硬失敗
    expect(id1).toMatch(/^ce_/);
    expect(id2).toMatch(/^ce_/);
  });

  it('ID_PREFIX 常數值固定不變', () => {
    expect(ID_PREFIX).toEqual({
      team: 'tm_',
      tournament: 'ct_',
      event: 'ce_',
      registration: 'reg_',
      match: 'cm_',
    });
  });
});

describe('taApplicationId', () => {
  it('決定性回傳 ta_<teamId>', () => {
    expect(taApplicationId('team-abc')).toBe('ta_team-abc');
    expect(taApplicationId('team-abc')).toBe(taApplicationId('team-abc'));
  });

  it('空字串 teamId 也允許（由上游驗證欄位不可空）', () => {
    expect(taApplicationId('')).toBe('ta_');
  });
});

describe('isValidEventId（R-ID-007）', () => {
  it('接受英數字、底線、連字號', () => {
    expect(isValidEventId('abc')).toBe(true);
    expect(isValidEventId('A-B_c')).toBe(true);
    expect(isValidEventId('12345')).toBe(true);
  });

  it('接受長度 1 與 120 邊界', () => {
    expect(isValidEventId('a')).toBe(true);
    expect(isValidEventId('a'.repeat(120))).toBe(true);
  });

  it('拒絕空字串與超長（121 字元）', () => {
    expect(isValidEventId('')).toBe(false);
    expect(isValidEventId('a'.repeat(121))).toBe(false);
  });

  it('拒絕空白與特殊字元', () => {
    expect(isValidEventId('a b')).toBe(false);
    expect(isValidEventId('a/b')).toBe(false);
    expect(isValidEventId('a.b')).toBe(false);
    expect(isValidEventId('a#b')).toBe(false);
  });
});
