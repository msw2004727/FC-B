import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCallFn,
  mockWriteOpLog,
  mockGetFirebase,
  mockDoc,
  mockGetDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockGetDocs,
} = vi.hoisted(() => ({
  mockCallFn: vi.fn(),
  mockWriteOpLog: vi.fn(),
  mockGetFirebase: vi.fn(),
  mockDoc: vi.fn(),
  mockGetDoc: vi.fn(),
  mockCollection: vi.fn(),
  mockQuery: vi.fn(),
  mockWhere: vi.fn(),
  mockGetDocs: vi.fn(),
}));

vi.mock('@/data/callables', async () => {
  const actual = await vi.importActual<typeof import('@/data/callables')>('@/data/callables');
  return { ...actual, callFn: mockCallFn };
});

vi.mock('@/data/op-log', () => ({
  writeOpLog: mockWriteOpLog,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: mockGetFirebase,
}));

vi.mock('firebase/firestore', () => ({
  doc: mockDoc,
  getDoc: mockGetDoc,
  collection: mockCollection,
  query: mockQuery,
  where: mockWhere,
  getDocs: mockGetDocs,
}));

import { CallableError } from '@/data/callables';
import type { ConfirmedRosterPerson } from './attendance-roster-model';
import {
  ADJUST_EXP_TIMEOUT_MESSAGE,
  ADJUST_EXP_TIMEOUT_MS,
  AUTO_EXP_MAX_ABS,
  COMPLETE_ACTIVITY_DEDUPE_AFTER_END_MS,
  COMPLETE_ACTIVITY_DEDUPE_WINDOW_MS,
  COMPLETE_ACTIVITY_END_FALLBACK_MS,
  CONFIRM_ATTENDANCE_TIMEOUT_MESSAGE,
  CONFIRM_ATTENDANCE_TIMEOUT_MS,
  buildAttendanceDesired,
  buildCompleteActivityReason,
  buildCompleteActivityRequestId,
  hasPriorCompleteActivityGrant,
  loadCompleteActivityExpAmount,
  resolveCompleteActivityDedupeWindow,
  settleAttendance,
  type SettleAttendanceInput,
  type SettleAttendanceResult,
} from './attendance-settle';

function person(
  uid: string,
  overrides: Partial<ConfirmedRosterPerson> = {},
): ConfirmedRosterPerson {
  return {
    name: uid,
    displayName: uid,
    uid,
    isCompanion: false,
    hasSelfReg: true,
    proxyOnly: false,
    displayBadges: [],
    teamKey: null,
    regDocId: null,
    teamReservationTeamId: null,
    teamReservationTeamName: null,
    teamSeatSource: null,
    ...overrides,
  };
}

function input(overrides: Partial<SettleAttendanceInput> = {}): SettleAttendanceInput {
  return {
    event: {
      id: 'ce_100',
      title: '週日友誼賽',
      date: '2026/10/25 09:00~11:00',
    },
    people: [person('U123')],
    getSelection: () => ({ checkin: false, checkout: true, note: ' 已確認 ' }),
    operatorUid: 'admin_uid',
    operatorName: '管理員小明',
    ...overrides,
  };
}

function rules(value: unknown = 10, exists = true) {
  return {
    exists: () => exists,
    data: () => ({ complete_activity: value }),
  };
}

function logs(...records: Array<Record<string, unknown>>) {
  return {
    docs: records.map((record) => ({ data: () => record })),
  };
}

function confirm(expTargets: unknown = ['U123']) {
  return { success: true, added: 2, removed: 1, expTargets };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function expectOk(
  result: SettleAttendanceResult,
): asserts result is Extract<SettleAttendanceResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`非預期結算失敗：${result.error}`);
}

function adjustCalls() {
  return mockCallFn.mock.calls.filter(([name]) => name === 'adjustExp');
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetFirebase.mockResolvedValue({ db: { __fakeDb: true } });
  mockDoc.mockImplementation((_db: unknown, coll: string, id: string) => ({
    kind: 'doc',
    coll,
    id,
  }));
  mockCollection.mockImplementation((_db: unknown, coll: string) => ({
    kind: 'collection',
    coll,
  }));
  mockWhere.mockImplementation((field: string, op: string, value: unknown) => ({
    field,
    op,
    value,
  }));
  mockQuery.mockImplementation((ref: unknown, ...constraints: unknown[]) => ({
    ref,
    constraints,
  }));
  mockGetDoc.mockResolvedValue(rules());
  mockGetDocs.mockResolvedValue(logs());
  mockWriteOpLog.mockResolvedValue(undefined);
  mockCallFn.mockImplementation(async (name: string) => {
    if (name === 'confirmEventAttendance') return confirm();
    if (name === 'adjustExp') return { success: true, results: [{ targetId: 'U', success: true }] };
    throw new Error(`未預期的 Callable：${name}`);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('純函式與常數', () => {
  it('保留約定的逾時、時間窗與金額上限', () => {
    expect(CONFIRM_ATTENDANCE_TIMEOUT_MS).toBe(30_000);
    expect(ADJUST_EXP_TIMEOUT_MS).toBe(15_000);
    expect(COMPLETE_ACTIVITY_DEDUPE_WINDOW_MS).toBe(86_400_000);
    expect(AUTO_EXP_MAX_ABS).toBe(100);
    expect(CONFIRM_ATTENDANCE_TIMEOUT_MESSAGE).toBe('結算逾時，請重新整理後再試');
    expect(ADJUST_EXP_TIMEOUT_MESSAGE).toBe('發放經驗值逾時');
  });

  it('reason 與 requestId 逐字符合 A 文案與決定性鍵', () => {
    expect(buildCompleteActivityReason('週日友誼賽')).toBe('自動：完成活動（週日友誼賽）');
    expect(buildCompleteActivityReason('')).toBe('自動：完成活動');
    expect(buildCompleteActivityReason(' 週日友誼賽 ')).toBe('自動：完成活動（ 週日友誼賽 ）');
    expect(buildCompleteActivityReason(' ')).toBe('自動：完成活動（ ）');
    expect(buildCompleteActivityRequestId('U123', 'ce_100'))
      .toBe('autoexp_U123_complete_activity_ce_100');
  });

  it('本人與同行者使用 roster uid，排除不可結算列、連帶簽到並保留第一個 key', () => {
    const self = person(' U123 ');
    const companionWithId = person('comp_001', {
      isCompanion: true,
      ownerUid: 'U123',
      hasSelfReg: false,
    });
    const companionWithoutId = person('U123_小美', {
      name: '小美',
      isCompanion: true,
      ownerUid: 'U123',
      hasSelfReg: false,
    });
    const duplicate = person('U123', { name: '後面的重複列' });
    const people = [
      self,
      companionWithId,
      companionWithoutId,
      person('course', { courseLinkedRegistration: true, regDocId: 'reg_1' }),
      person('header', { isTeamHeader: true }),
      person('placeholder', { isTeamPlaceholder: true }),
      person('separator', { isTeamGeneralSeparator: true }),
      person('proxy', { proxyOnly: true }),
      person('legacy_proxy', { isProxyOnly: true }),
      person('ambiguous', { attendanceAmbiguous: true }),
      person(' \t '),
      duplicate,
    ];
    const getSelection = vi.fn((row: ConfirmedRosterPerson) => {
      if (row === self) return { checkin: false, checkout: true, note: ' 未 trim ' };
      if (row === companionWithId) return { checkin: true };
      return null;
    });

    expect(buildAttendanceDesired(people, getSelection)).toEqual({
      U123: { checkin: true, checkout: true, note: ' 未 trim ' },
      comp_001: { checkin: true, checkout: false, note: '' },
      U123_小美: { checkin: false, checkout: false, note: '' },
    });
    expect(getSelection.mock.calls.map(([row]) => row)).toEqual([
      self,
      companionWithId,
      companionWithoutId,
    ]);
  });

  it('課程旗標沒有 regDocId 時保留該列，undefined selection 正規化為未簽到', () => {
    expect(buildAttendanceDesired(
      [person('U123', { courseLinkedRegistration: true, regDocId: null })],
      () => undefined,
    )).toEqual({
      U123: { checkin: false, checkout: false, note: '' },
    });
  });

  it('特殊物件 key 也保留第一列且不改變 prototype', () => {
    const desired = buildAttendanceDesired(
      [person('__proto__'), person('__proto__'), person('constructor')],
      () => ({ checkin: true }),
    );
    expect(Object.keys(desired)).toEqual(['__proto__', 'constructor']);
    expect(Object.getPrototypeOf(desired)).toBe(Object.prototype);
    expect(desired['__proto__']).toEqual({
      checkin: true,
      checkout: false,
      note: '',
    });
  });
});

describe('resolveCompleteActivityDedupeWindow', () => {
  it('保留結束後 72 小時與結束時間 fallback 24 小時常數', () => {
    expect(COMPLETE_ACTIVITY_DEDUPE_AFTER_END_MS).toBe(72 * 60 * 60 * 1000);
    expect(COMPLETE_ACTIVITY_END_FALLBACK_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('完整起訖使用開始前 24 小時至結束後 72 小時', () => {
    expect(resolveCompleteActivityDedupeWindow('2026/10/25 09:00~11:00')).toEqual({
      sinceMs: new Date(2026, 9, 24, 9, 0).getTime(),
      untilMs: new Date(2026, 9, 28, 11, 0).getTime(),
    });
  });

  it('無結束時間時以開始 + 24 小時為結束', () => {
    expect(resolveCompleteActivityDedupeWindow('2026/10/25 09:00')).toEqual({
      sinceMs: new Date(2026, 9, 24, 9, 0).getTime(),
      untilMs: new Date(2026, 9, 25, 9, 0).getTime() + 96 * 60 * 60 * 1000,
    });
  });

  it('只有日期時以當天零時為開始並套用 fallback', () => {
    expect(resolveCompleteActivityDedupeWindow('2026/10/25')).toEqual({
      sinceMs: new Date(2026, 9, 24, 0, 0).getTime(),
      untilMs: new Date(2026, 9, 25, 0, 0).getTime() + 96 * 60 * 60 * 1000,
    });
  });

  it('跨午夜時使用隔天的結束時刻', () => {
    expect(resolveCompleteActivityDedupeWindow('2026/10/25 23:00~01:00')).toEqual({
      sinceMs: new Date(2026, 9, 24, 23, 0).getTime(),
      untilMs: new Date(2026, 9, 26, 1, 0).getTime() + 72 * 60 * 60 * 1000,
    });
  });

  it('結束等於開始時使用隔天同時刻，支援單位數小時', () => {
    expect(resolveCompleteActivityDedupeWindow('2026/10/25 09:00~9:00')).toEqual({
      sinceMs: new Date(2026, 9, 24, 9, 0).getTime(),
      untilMs: new Date(2026, 9, 26, 9, 0).getTime() + 72 * 60 * 60 * 1000,
    });
  });

  it.each([
    '2026/10/25 09:00~xx',
    '2026/10/25 09:00~25:00',
    '2026/10/25 09:00~11:60',
    '2026/10/25 09:00~11:5',
    '2026/10/25 09:00~11.5:00',
    '2026/10/25 09:00~-1:00',
    '2026/10/25 09:00~',
  ])('結束時間格式壞時使用 fallback：%s', (date) => {
    expect(resolveCompleteActivityDedupeWindow(date)).toEqual({
      sinceMs: new Date(2026, 9, 24, 9, 0).getTime(),
      untilMs: new Date(2026, 9, 25, 9, 0).getTime() + 96 * 60 * 60 * 1000,
    });
  });

  it.each(['無法解析', '', null, undefined, 123, '999999/10/25 09:00~11:00'])('無法解析時回 null：%j', (date) => {
    expect(resolveCompleteActivityDedupeWindow(date)).toBeNull();
  });
});

describe('loadCompleteActivityExpAmount', () => {
  it.each([
    ['字串金額', '12', 12],
    ['正上限', 100, 100],
    ['負上限', -100, -100],
    ['負小數', -1.5, -1.5],
  ])('%s 可發放', async (_label, value, amount) => {
    mockGetDoc.mockResolvedValue(rules(value));
    await expect(loadCompleteActivityExpAmount()).resolves.toEqual({ ok: true, amount });
    expect(mockDoc).toHaveBeenCalledWith(
      { __fakeDb: true },
      'siteConfig',
      'autoExpRules',
    );
  });

  it.each([
    ['數字零', 0, 'zero'],
    ['字串零', '0', 'zero'],
    ['空字串', '', 'zero'],
    ['null', null, 'zero'],
    ['NaN', NaN, 'unreadable'],
    ['正無限', Infinity, 'unreadable'],
    ['負無限', -Infinity, 'unreadable'],
    ['無法轉數字', '不是數字', 'unreadable'],
    ['超過正上限', 100.1, 'out_of_range'],
    ['超過負上限', -101, 'out_of_range'],
  ])('%s 不可發放', async (_label, value, reason) => {
    mockGetDoc.mockResolvedValue(rules(value));
    await expect(loadCompleteActivityExpAmount()).resolves.toEqual({ ok: false, reason });
  });

  it('欄位 undefined 視為零', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({}) });
    await expect(loadCompleteActivityExpAmount()).resolves.toEqual({
      ok: false,
      reason: 'zero',
    });
  });

  it('文件不存在視為零', async () => {
    mockGetDoc.mockResolvedValue(rules(10, false));
    await expect(loadCompleteActivityExpAmount()).resolves.toEqual({
      ok: false,
      reason: 'zero',
    });
  });

  it('讀取失敗回 unreadable 並記錄 warn', async () => {
    const error = new Error('讀取失敗');
    mockGetDoc.mockRejectedValue(error);
    await expect(loadCompleteActivityExpAmount()).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
    expect(console.warn).toHaveBeenCalledWith(
      '[attendance-settle] loadCompleteActivityExpAmount failed',
      error,
    );
  });
});

describe('hasPriorCompleteActivityGrant', () => {
  it.each([
    ['上界剛好命中', 2000, true],
    ['上界加 1 毫秒不命中', 2001, false],
  ])('%s', async (_label, createdAt, expected) => {
    mockGetDocs.mockResolvedValueOnce(logs({ createdAt }));
    await expect(hasPriorCompleteActivityGrant('U123', '原因', 1000, 2000))
      .resolves.toBe(expected);
  });

  it.each([
    ['低於下界', 999, false],
    ['等於下界', 1000, true],
    ['晚於下界', 2001, true],
  ])('untilMs 為 null 時只看下界：%s', async (_label, createdAt, expected) => {
    mockGetDocs.mockResolvedValueOnce(logs({ createdAt }));
    await expect(hasPriorCompleteActivityGrant('U123', '原因', 1000, null))
      .resolves.toBe(expected);
  });

  it('sinceMs 為 null 時忽略上界與 createdAt，任一筆即命中', async () => {
    mockGetDocs.mockResolvedValueOnce(logs({ createdAt: 2001 }));
    await expect(hasPriorCompleteActivityGrant('U123', '原因', null, 2000))
      .resolves.toBe(true);
    mockGetDocs.mockResolvedValueOnce(logs({}));
    await expect(hasPriorCompleteActivityGrant('U123', '原因', null, 2000))
      .resolves.toBe(true);
    mockGetDocs.mockResolvedValueOnce(logs());
    await expect(hasPriorCompleteActivityGrant('U123', '原因', null, 2000))
      .resolves.toBe(false);
  });

  it('只使用 uid、正規化 reason 兩個等值條件', async () => {
    const reason = `  ${'長'.repeat(220)}  `;
    mockGetDocs.mockResolvedValue(logs({ createdAt: 1000 }));

    await expect(hasPriorCompleteActivityGrant('U123', reason, 1000)).resolves.toBe(true);

    expect(mockCollection).toHaveBeenCalledWith({ __fakeDb: true }, 'expLogs');
    expect(mockWhere.mock.calls).toEqual([
      ['uid', '==', 'U123'],
      ['reason', '==', '長'.repeat(200)],
    ]);
    expect(mockQuery).toHaveBeenCalledExactlyOnceWith(
      { kind: 'collection', coll: 'expLogs' },
      { field: 'uid', op: '==', value: 'U123' },
      { field: 'reason', op: '==', value: '長'.repeat(200) },
    );
  });

  it.each([
    ['Timestamp 邊界', { toMillis: () => 1000 }, true],
    ['number 邊界', 1000, true],
    ['Date 邊界', new Date(1000), true],
    ['窗內', 1001, true],
    ['窗外', 999, false],
    ['缺少欄位', undefined, false],
    ['null', null, false],
    ['時間字串', '2026-10-25T09:00:00Z', false],
    ['無效 Date', new Date(NaN), false],
    ['NaN', NaN, false],
    ['無限數', Infinity, false],
    ['無效 Timestamp 回傳', { toMillis: () => '1000' }, false],
    ['Timestamp 拋錯', { toMillis: () => { throw new Error('壞時間'); } }, false],
  ])('%s 正確判斷 createdAt', async (_label, createdAt, expected) => {
    mockGetDocs.mockResolvedValue(logs({ createdAt, time: '10/25 09:00' }));
    await expect(hasPriorCompleteActivityGrant('U123', '原因', 1000))
      .resolves.toBe(expected);
  });

  it('不使用 expLogs.time，缺少 createdAt 不算命中', async () => {
    mockGetDocs.mockResolvedValue(logs({ time: '10/25 09:00' }));
    await expect(hasPriorCompleteActivityGrant('U123', '原因', 1000)).resolves.toBe(false);
  });

  it('sinceMs 為 null 時任何一筆都算命中，零筆則不命中', async () => {
    mockGetDocs.mockResolvedValueOnce(logs({}));
    await expect(hasPriorCompleteActivityGrant('U123', '原因', null)).resolves.toBe(true);
    mockGetDocs.mockResolvedValueOnce(logs());
    await expect(hasPriorCompleteActivityGrant('U123', '原因', null)).resolves.toBe(false);
  });

  it('遍歷紀錄直到找到時間窗內的一筆', async () => {
    mockGetDocs.mockResolvedValue(logs(
      {},
      { createdAt: 999 },
      { createdAt: { toMillis: () => 1000 } },
    ));
    await expect(hasPriorCompleteActivityGrant('U123', '原因', 1000)).resolves.toBe(true);
  });

  it('查詢錯誤往外拋', async () => {
    const error = new Error('permission-denied');
    mockGetDocs.mockRejectedValue(error);
    await expect(hasPriorCompleteActivityGrant('U123', '原因', null)).rejects.toBe(error);
  });
});

describe('settleAttendance', () => {
  it('逐字送出 confirm、adjustExp 與操作紀錄 payload', async () => {
    const result = await settleAttendance(input());

    expect(mockCallFn.mock.calls).toEqual([
      [
        'confirmEventAttendance',
        {
          eventId: 'ce_100',
          desired: {
            U123: { checkin: true, checkout: true, note: ' 已確認 ' },
          },
        },
      ],
      [
        'adjustExp',
        {
          mode: 'auto',
          targets: ['U123'],
          amount: 10,
          reason: '自動：完成活動（週日友誼賽）',
          operatorLabel: '系統',
          requestId: 'autoexp_U123_complete_activity_ce_100',
        },
      ],
    ]);
    expect(mockWriteOpLog).toHaveBeenCalledExactlyOnceWith({
      type: 'manual_attendance',
      typeName: '編輯簽到',
      content: '活動 週日友誼賽 已套用編輯簽到（共 1 人，3 筆操作）',
      actorUid: 'admin_uid',
      operator: '管理員小明',
    });
    expect(result).toEqual({
      ok: true,
      added: 2,
      removed: 1,
      targets: ['U123'],
      granted: ['U123'],
      skippedAlready: [],
      skippedZeroAmount: false,
      failed: [],
    });
  });

  it.each([
    ['空標題', '', '自動：完成活動'],
    ['非字串標題', 123, '自動：完成活動'],
    ['未提供標題', undefined, '自動：完成活動'],
    ['保留標題空白', ' 友誼賽 ', '自動：完成活動（ 友誼賽 ）'],
  ])('%s 使用正確 reason', async (_label, title, reason) => {
    await settleAttendance(input({ event: { id: 'ce_100', title } }));
    expect(adjustCalls()[0]?.[1]).toEqual({
      mode: 'auto',
      targets: ['U123'],
      amount: 10,
      reason,
      operatorLabel: '系統',
      requestId: 'autoexp_U123_complete_activity_ce_100',
    });
  });

  it('缺 expTargets 時回空陣列，不讀金額但仍寫一次操作紀錄', async () => {
    mockCallFn.mockResolvedValueOnce({ success: true, added: 0, removed: 0 });
    const result = await settleAttendance(input());

    expectOk(result);
    expect(result.targets).toEqual([]);
    expect(result.granted).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skippedZeroAmount).toBe(false);
    expect(mockWriteOpLog).toHaveBeenCalledTimes(1);
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(adjustCalls()).toHaveLength(0);
  });

  it.each([null, {}, 'U123', []])('expTargets=%j 不產生 targets', async (targets) => {
    mockCallFn.mockResolvedValueOnce(confirm(targets));
    const result = await settleAttendance(input());
    expectOk(result);
    expect(result.targets).toEqual([]);
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(adjustCalls()).toHaveLength(0);
  });

  it('targets 只收字串，trim、去重且保留順序', async () => {
    mockCallFn.mockResolvedValueOnce(confirm([' U123 ', '', 123, null, 'U123', ' U456 ']));
    const result = await settleAttendance(input());
    expectOk(result);
    expect(result.targets).toEqual(['U123', 'U456']);
    expect(result.granted).toEqual(['U123', 'U456']);
    expect(adjustCalls()).toHaveLength(2);
  });

  it.each([
    ['零金額', 0, true, false, 'zero'],
    ['文件不存在', 10, false, false, 'zero'],
    ['讀取失敗', 10, true, true, 'unreadable'],
    ['非有限數', Infinity, true, false, 'unreadable'],
    ['超過正上限', 101, true, false, 'out_of_range'],
    ['超過負上限', -101, true, false, 'out_of_range'],
  ])('%s 整批跳過，不查 expLogs 或消耗 requestId', async (
    _label,
    value,
    exists,
    rejects,
    reason,
  ) => {
    mockCallFn.mockResolvedValueOnce(confirm(['U123', 'U456']));
    if (rejects) {
      mockGetDoc.mockRejectedValueOnce(new Error('讀取失敗'));
    } else {
      mockGetDoc.mockResolvedValueOnce(rules(value, exists));
    }

    const result = await settleAttendance(input());

    expectOk(result);
    expect(result.targets).toEqual(['U123', 'U456']);
    expect(result.skippedZeroAmount).toBe(true);
    expect(result.amountSkipReason).toBe(reason);
    expect(result.granted).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skippedAlready).toEqual([]);
    expect(adjustCalls()).toHaveLength(0);
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(mockWriteOpLog).toHaveBeenCalledTimes(1);
  });

  it('未設定金額整批跳過', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    const result = await settleAttendance(input());
    expectOk(result);
    expect(result.skippedZeroAmount).toBe(true);
    expect(result.amountSkipReason).toBe('zero');
    expect(result.granted).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(adjustCalls()).toHaveLength(0);
  });

  it('開始前 24 小時邊界命中 expLogs，跳過發放', async () => {
    const since = new Date(2026, 9, 25, 9).getTime() - 86_400_000;
    mockGetDocs.mockResolvedValueOnce(logs({ createdAt: { toMillis: () => since } }));
    const result = await settleAttendance(input());

    expectOk(result);
    expect(result.skippedAlready).toEqual([{ uid: 'U123', source: 'expLogs' }]);
    expect(result.granted).toEqual([]);
    expect(adjustCalls()).toHaveLength(0);
    expect(mockWhere.mock.calls).toEqual([
      ['uid', '==', 'U123'],
      ['reason', '==', '自動：完成活動（週日友誼賽）'],
    ]);
  });

  it('舊紀錄早於開始前 24 小時，不阻擋發放', async () => {
    const since = new Date(2026, 9, 25, 9).getTime() - 86_400_000;
    mockGetDocs.mockResolvedValueOnce(logs({ createdAt: since - 1 }));
    const result = await settleAttendance(input());

    expectOk(result);
    expect(result.granted).toEqual(['U123']);
    expect(result.skippedAlready).toEqual([]);
    expect(adjustCalls()).toHaveLength(1);
  });

  it('同名不同場的舊紀錄在窗外，新場仍發放並使用新 eventId', async () => {
    mockGetDocs.mockResolvedValueOnce(logs({
      uid: 'U123',
      reason: '自動：完成活動（週日友誼賽）',
      createdAt: new Date(2026, 9, 18, 11),
    }));
    const result = await settleAttendance(input({
      event: { id: 'ce_101', title: '週日友誼賽', date: '2026/10/25 09:00~11:00' },
    }));

    expectOk(result);
    expect(result.granted).toEqual(['U123']);
    expect(adjustCalls()[0]?.[1]).toEqual({
      mode: 'auto',
      targets: ['U123'],
      amount: 10,
      reason: '自動：完成活動（週日友誼賽）',
      operatorLabel: '系統',
      requestId: 'autoexp_U123_complete_activity_ce_101',
    });
  });

  it('晚 3 天結算仍查得到 A 在活動當天發的紀錄，跳過發放', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 28, 20));
    mockGetDocs.mockResolvedValueOnce(logs({ createdAt: new Date(2026, 9, 25, 11, 5) }));
    const result = await settleAttendance(input());

    expectOk(result);
    expect(result.skippedAlready).toEqual([{ uid: 'U123', source: 'expLogs' }]);
    expect(adjustCalls()).toHaveLength(0);
  });

  it('晚 10 天結算，下一場同名活動（7 天後）已發過的紀錄不影響本場，仍發放', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 20));
    mockGetDocs.mockResolvedValueOnce(logs({
      createdAt: new Date(2026, 10, 1, 11, 5),
    }));

    const result = await settleAttendance(input());

    expectOk(result);
    expect(result.granted).toEqual(['U123']);
    expect(result.skippedAlready).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(adjustCalls()).toHaveLength(1);
  });

  it.each([
    ['結束後 72 小時邊界命中', 0, true],
    ['結束後 72 小時超過 1 毫秒不命中', 1, false],
  ])('%s', async (_label, offsetMs, expectedHit) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 20));
    const untilMs = new Date(2026, 9, 25, 11, 0).getTime() + 72 * 60 * 60 * 1000;
    mockGetDocs.mockResolvedValueOnce(logs({ createdAt: untilMs + offsetMs }));

    const result = await settleAttendance(input());

    expectOk(result);
    expect(result.skippedAlready).toEqual(
      expectedHit ? [{ uid: 'U123', source: 'expLogs' }] : [],
    );
    expect(result.granted).toEqual(expectedHit ? [] : ['U123']);
    expect(result.failed).toEqual([]);
    expect(adjustCalls()).toHaveLength(expectedHit ? 0 : 1);
  });

  it.each([
    ['開始 + 96 小時命中', 0, true],
    ['開始 + 96 小時超過 1 毫秒不命中', 1, false],
  ])('無結束時間時以開始 + 24h 為結束：%s', async (_label, offsetMs, expectedHit) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 20));
    const untilMs = new Date(2026, 9, 25, 9, 0).getTime() + 96 * 60 * 60 * 1000;
    mockGetDocs.mockResolvedValueOnce(logs({ createdAt: untilMs + offsetMs }));

    const result = await settleAttendance(input({
      event: { id: 'ce_100', title: '週日友誼賽', date: '2026/10/25 09:00' },
    }));

    expectOk(result);
    expect(result.skippedAlready).toEqual(
      expectedHit ? [{ uid: 'U123', source: 'expLogs' }] : [],
    );
    expect(result.granted).toEqual(expectedHit ? [] : ['U123']);
    expect(result.failed).toEqual([]);
    expect(adjustCalls()).toHaveLength(expectedHit ? 0 : 1);
  });

  it('年份超出 Date 範圍時比照無法解析，任何舊紀錄都算命中', async () => {
    mockGetDocs.mockResolvedValueOnce(logs({ createdAt: new Date(2026, 9, 25, 11) }));
    const result = await settleAttendance(input({
      event: { id: 'ce_100', title: '週日友誼賽', date: '999999/10/25 09:00~11:00' },
    }));

    expectOk(result);
    expect(result.skippedAlready).toEqual([{ uid: 'U123', source: 'expLogs' }]);
    expect(adjustCalls()).toHaveLength(0);
  });

  it('日期無法解析時，任何舊紀錄都算命中', async () => {
    mockGetDocs.mockResolvedValueOnce(logs({ time: '01/01 00:00' }));
    const result = await settleAttendance(input({
      event: { id: 'ce_100', title: '週日友誼賽', date: '無法解析' },
    }));

    expectOk(result);
    expect(result.skippedAlready).toEqual([{ uid: 'U123', source: 'expLogs' }]);
    expect(adjustCalls()).toHaveLength(0);
  });

  it('查詢失敗不呼叫該人的 adjustExp，但繼續下一人', async () => {
    mockCallFn.mockResolvedValueOnce(confirm(['U123', 'U456']));
    mockGetDocs
      .mockRejectedValueOnce(new Error('permission-denied'))
      .mockResolvedValueOnce(logs());

    const result = await settleAttendance(input());

    expectOk(result);
    expect(result.failed).toEqual([{ uid: 'U123', error: 'dedupe_query_failed' }]);
    expect(result.granted).toEqual(['U456']);
    expect(adjustCalls()).toHaveLength(1);
    expect(adjustCalls()[0]?.[1]).toMatchObject({ targets: ['U456'] });
  });

  it('每人先查 expLogs 再 adjustExp，未滿五人時兩人可同時發放', async () => {
    const order: string[] = [];
    const bothAdjusting = deferred<void>();
    let adjusting = 0;
    const release = deferred<void>();

    mockGetDocs.mockImplementation(async (
      query: { constraints?: Array<{ field?: string; value?: unknown }> },
    ) => {
      const uid = query.constraints?.find((item) => item.field === 'uid')?.value;
      order.push(`查:${String(uid)}`);
      return logs();
    });
    mockCallFn.mockImplementation(async (
      name: string,
      request: { targets?: string[] },
    ) => {
      if (name === 'confirmEventAttendance') return confirm(['uidA', 'uidB']);
      const uid = request.targets?.[0];
      order.push(`開始:${uid}`);
      adjusting += 1;
      if (adjusting === 2) bothAdjusting.resolve(undefined);
      await release.promise;
      order.push(`完成:${uid}`);
      return { success: true, results: [{ targetId: uid, success: true }] };
    });

    const pending = settleAttendance(input({
      event: { id: 'evtA', title: '週日友誼賽', date: '2026/10/25 09:00~11:00' },
      people: [person('uidA'), person('uidB')],
    }));
    try {
      await bothAdjusting.promise;

      expect(order.indexOf('查:uidA')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('查:uidA')).toBeLessThan(order.indexOf('開始:uidA'));
      expect(order.indexOf('查:uidB')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('查:uidB')).toBeLessThan(order.indexOf('開始:uidB'));
      expect(order.some((step) => step.startsWith('完成:'))).toBe(false);
      expect(adjustCalls()).toHaveLength(2);
      expect(mockGetDocs).toHaveBeenCalledTimes(2);

      release.resolve(undefined);
      const result = await pending;

      expectOk(result);
      expect(result.granted).toEqual(['uidA', 'uidB']);
      expect(order).toContain('完成:uidA');
      expect(order).toContain('完成:uidB');
    } finally {
      release.resolve(undefined);
      await pending.catch(() => undefined);
    }
  });

  it('單人失敗不影響其他人，且不重試已送出的 requestId', async () => {
    mockCallFn
      .mockResolvedValueOnce(confirm(['U1', 'U2', 'U3', 'U4']))
      .mockRejectedValueOnce(new Error('網路錯誤'))
      .mockResolvedValueOnce({
        success: true,
        results: [{ targetId: 'U2', success: false, error: 'not_found' }],
      })
      .mockResolvedValueOnce({ success: true, deduplicated: true })
      .mockResolvedValueOnce({ success: true, results: [{ targetId: 'U4', success: true }] });

    const result = await settleAttendance(input());

    expectOk(result);
    expect(result.failed).toEqual([
      { uid: 'U1', error: '網路錯誤' },
      { uid: 'U2', error: 'not_found' },
    ]);
    expect(result.skippedAlready).toEqual([{ uid: 'U3', source: 'requestId' }]);
    expect(result.granted).toEqual(['U4']);
    expect(adjustCalls().map(([, payload]) => payload.targets)).toEqual([
      ['U1'],
      ['U2'],
      ['U3'],
      ['U4'],
    ]);
  });

  it.each([
    [{ success: true, results: [{ success: false }] }, 'adjust_failed'],
    [{ success: true, results: [{ success: false, error: '' }] }, 'adjust_failed'],
    [{ success: false }, 'unexpected_response'],
    [{}, 'unexpected_response'],
    [{ success: true }, 'unexpected_response'],
    [{ success: true, results: [] }, 'unexpected_response'],
  ])('adjustExp 回應 %j 正確列入 failed', async (response, error) => {
    mockCallFn.mockResolvedValueOnce(confirm()).mockResolvedValueOnce(response);
    const result = await settleAttendance(input());
    expectOk(result);
    expect(result.failed).toEqual([{ uid: 'U123', error }]);
    expect(result.granted).toEqual([]);
    expect(adjustCalls()).toHaveLength(1);
  });

  it('deduplicated 優先於 results 的失敗狀態', async () => {
    mockCallFn.mockResolvedValueOnce(confirm()).mockResolvedValueOnce({
      success: true,
      deduplicated: true,
      results: [{ success: false, error: 'not_found' }],
    });
    const result = await settleAttendance(input());
    expectOk(result);
    expect(result.skippedAlready).toEqual([{ uid: 'U123', source: 'requestId' }]);
    expect(result.failed).toEqual([]);
    expect(result.granted).toEqual([]);
  });

  it('confirm 逾時後不寫日誌、不讀金額、不發放，並清除 timer', async () => {
    vi.useFakeTimers();
    const remote = deferred<ReturnType<typeof confirm>>();
    mockCallFn.mockReturnValueOnce(remote.promise);

    const pending = settleAttendance(input({ confirmTimeoutMs: 20 }));
    await vi.advanceTimersByTimeAsync(20);

    await expect(pending).resolves.toEqual({
      ok: false,
      stage: 'confirm',
      error: '結算逾時，請重新整理後再試',
    });
    expect(mockWriteOpLog).not.toHaveBeenCalled();
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(adjustCalls()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    // 遠端逾時後才完成，不得補做本地後續步驟。
    remote.resolve(confirm());
    await Promise.resolve();
    expect(mockWriteOpLog).not.toHaveBeenCalled();
    expect(adjustCalls()).toHaveLength(0);
  });

  it('adjustExp 單人逾時列入 failed 並繼續下一人，不重試', async () => {
    vi.useFakeTimers();
    const firstStarted = deferred<void>();
    const firstRemote = deferred<{ success: boolean }>();

    mockCallFn.mockImplementation(async (
      name: string,
      request: { targets?: string[] },
    ) => {
      if (name === 'confirmEventAttendance') return confirm(['U123', 'U456']);
      if (request.targets?.[0] === 'U123') {
        firstStarted.resolve(undefined);
        return await firstRemote.promise;
      }
      return { success: true, results: [{ targetId: 'U456', success: true }] };
    });

    const pending = settleAttendance(input({ adjustTimeoutMs: 20 }));
    await firstStarted.promise;
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;

    expectOk(result);
    expect(result.failed).toEqual([{ uid: 'U123', error: '發放經驗值逾時' }]);
    expect(result.granted).toEqual(['U456']);
    expect(adjustCalls()).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);

    firstRemote.resolve({ success: true });
    await Promise.resolve();
    expect(result.granted).toEqual(['U456']);
    expect(adjustCalls()).toHaveLength(2);
  });

  it('成功與拒絕路徑都清除 timer', async () => {
    vi.useFakeTimers();
    mockCallFn.mockResolvedValueOnce(confirm()).mockRejectedValueOnce(new Error('發放失敗'));

    const result = await settleAttendance(input());

    expectOk(result);
    expect(result.failed).toEqual([{ uid: 'U123', error: '發放失敗' }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('confirm CallableError 保留 code 且不做任何後續操作', async () => {
    vi.useFakeTimers();
    mockCallFn.mockRejectedValueOnce(new CallableError('permission-denied', '無權限結算'));

    await expect(settleAttendance(input())).resolves.toEqual({
      ok: false,
      stage: 'confirm',
      error: '無權限結算',
      code: 'permission-denied',
    });
    expect(mockCallFn).toHaveBeenCalledTimes(1);
    expect(mockWriteOpLog).not.toHaveBeenCalled();
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('confirm 一般錯誤不附 code', async () => {
    mockCallFn.mockRejectedValueOnce(new Error('連線失敗'));
    await expect(settleAttendance(input())).resolves.toEqual({
      ok: false,
      stage: 'confirm',
      error: '連線失敗',
    });
    expect(mockWriteOpLog).not.toHaveBeenCalled();
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(adjustCalls()).toHaveLength(0);
  });

  it('confirm success=false 視為失敗，不繼續發放', async () => {
    mockCallFn.mockResolvedValueOnce({ success: false, added: 0, removed: 0 });
    await expect(settleAttendance(input())).resolves.toEqual({
      ok: false,
      stage: 'confirm',
      error: 'unexpected_response',
    });
    expect(mockWriteOpLog).not.toHaveBeenCalled();
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(adjustCalls()).toHaveLength(0);
  });

  it('操作紀錄意外拋錯仍繼續發放', async () => {
    mockWriteOpLog.mockRejectedValueOnce(new Error('日誌失敗'));
    const result = await settleAttendance(input());

    expectOk(result);
    expect(result.granted).toEqual(['U123']);
    expect(mockWriteOpLog).toHaveBeenCalledTimes(1);
    expect(adjustCalls()).toHaveLength(1);
  });

  it('操作日誌未完成仍讀金額並發放', async () => {
    const logStarted = deferred<void>();
    const releaseLog = deferred<void>();
    const amountStarted = deferred<void>();
    mockWriteOpLog.mockImplementationOnce(async () => {
      logStarted.resolve(undefined);
      await releaseLog.promise;
    });
    mockGetDoc.mockImplementationOnce(async () => {
      amountStarted.resolve(undefined);
      return rules();
    });

    const pending = settleAttendance(input());
    await logStarted.promise;
    await amountStarted.promise;
    expect(mockGetDoc).toHaveBeenCalledTimes(1);
    expect(adjustCalls()).toHaveLength(0);

    releaseLog.resolve(undefined);
    const result = await pending;
    expectOk(result);
    expect(result.granted).toEqual(['U123']);
    expect(adjustCalls()).toHaveLength(1);
  });

  it('三十人發放同時不超過五人且全部發到、requestId 不變', async () => {
    const targets = Array.from({ length: 30 }, (_, index) => (
      index === 0 ? 'uidA' : index === 1 ? 'uidB' : `targetA${index}`
    ));
    let inFlight = 0;
    let maxInFlight = 0;
    const reachedCap = deferred<void>();
    const release = deferred<void>();

    mockGetDocs.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (inFlight === 5) reachedCap.resolve(undefined);
      return logs();
    });
    mockCallFn.mockImplementation(async (
      name: string,
      request: { targets?: string[]; requestId?: string },
    ) => {
      if (name === 'confirmEventAttendance') {
        return { success: true, added: 0, removed: 0, expTargets: targets };
      }
      const uid = request.targets?.[0] ?? '';
      expect(request.requestId).toBe(buildCompleteActivityRequestId(uid, 'evtA'));
      try {
        await release.promise;
        return { success: true, results: [{ targetId: uid, success: true }] };
      } finally {
        inFlight -= 1;
      }
    });

    const pending = settleAttendance(input({
      event: { id: 'evtA', title: '週日友誼賽', date: '2026/10/25 09:00~11:00' },
      people: [person('uidA')],
    }));
    try {
      await reachedCap.promise;
      await vi.waitFor(() => expect(adjustCalls().length).toBe(5));

      expect(inFlight).toBe(5);
      expect(maxInFlight).toBeLessThanOrEqual(5);
      expect(mockGetDocs).toHaveBeenCalledTimes(5);

      release.resolve(undefined);
      const result = await pending;

      expectOk(result);
      expect(maxInFlight).toBe(5);
      expect(result.granted).toEqual(targets);
      expect(new Set(result.granted).size).toBe(30);
      expect(result.failed).toEqual([]);
      expect(adjustCalls()).toHaveLength(30);
      expect(adjustCalls().map(([, payload]) => payload.requestId).sort()).toEqual(
        targets.map((uid) => buildCompleteActivityRequestId(uid, 'evtA')).sort(),
      );
    } finally {
      release.resolve(undefined);
      await pending.catch(() => undefined);
    }
  });

  it('部分失敗時其他人照發且失敗清單正確', async () => {
    const targets = ['uidA', 'uidB', 'targetA'];
    mockCallFn.mockImplementation(async (
      name: string,
      request: { targets?: string[]; requestId?: string },
    ) => {
      if (name === 'confirmEventAttendance') {
        return { success: true, added: 1, removed: 0, expTargets: targets };
      }
      const uid = request.targets?.[0] ?? '';
      expect(request.requestId).toBe(buildCompleteActivityRequestId(uid, 'evtA'));
      if (uid === 'targetA') {
        return { success: true, results: [{ targetId: uid, success: false, error: 'not_found' }] };
      }
      return { success: true, results: [{ targetId: uid, success: true }] };
    });

    const result = await settleAttendance(input({
      event: { id: 'evtA', title: '週日友誼賽', date: '2026/10/25 09:00~11:00' },
      people: [person('uidA'), person('uidB')],
    }));

    expectOk(result);
    expect(result.failed).toEqual([{ uid: 'targetA', error: 'not_found' }]);
    expect(result.granted).toEqual(['uidA', 'uidB']);
    expect(result.skippedAlready).toEqual([]);
    expect(adjustCalls().map(([, payload]) => payload.targets?.[0]).sort()).toEqual([
      'targetA',
      'uidA',
      'uidB',
    ]);
  });

  it('同一人只發一次', async () => {
    mockCallFn.mockResolvedValueOnce(confirm(['uidA', ' uidA ', 'uidA']));
    const result = await settleAttendance(input({
      event: { id: 'evtA', title: '週日友誼賽', date: '2026/10/25 09:00~11:00' },
      people: [person('uidA')],
    }));

    expectOk(result);
    expect(result.targets).toEqual(['uidA']);
    expect(result.granted).toEqual(['uidA']);
    expect(adjustCalls()).toHaveLength(1);
    expect(adjustCalls()[0]?.[1]).toMatchObject({
      targets: ['uidA'],
      requestId: 'autoexp_uidA_complete_activity_evtA',
    });
  });

  it('操作日誌拒絕不影響結果也不產生未處理 rejection', async () => {
    const reasons: unknown[] = [];
    const onProcess = (reason: unknown): void => {
      reasons.push(reason);
    };
    const onWindow = (event: PromiseRejectionEvent): void => {
      reasons.push(event.reason);
      event.preventDefault();
    };
    process.on('unhandledRejection', onProcess);
    window.addEventListener('unhandledrejection', onWindow);
    mockWriteOpLog.mockRejectedValueOnce(new Error('日誌失敗'));
    mockCallFn.mockImplementation(async (name: string) => {
      if (name === 'confirmEventAttendance') return confirm(['uidA']);
      if (name === 'adjustExp') {
        return { success: true, results: [{ targetId: 'uidA', success: true }] };
      }
      throw new Error(`未預期的 Callable：${name}`);
    });

    try {
      const result = await settleAttendance(input({
        event: { id: 'evtA', title: '週日友誼賽', date: '2026/10/25 09:00~11:00' },
        people: [person('uidA')],
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(reasons).toEqual([]);
      expectOk(result);
      expect(result.granted).toEqual(['uidA']);
      expect(mockWriteOpLog).toHaveBeenCalledTimes(1);
      expect(adjustCalls()).toHaveLength(1);
    } finally {
      process.off('unhandledRejection', onProcess);
      window.removeEventListener('unhandledrejection', onWindow);
    }
  });

  it('只在經驗值發放期間攔截關閉分頁，結束後移除', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const releaseAmount = deferred<void>();
    const amountStarted = deferred<void>();
    const releaseAdjust = deferred<void>();
    const adjustStarted = deferred<void>();
    mockGetDoc.mockImplementationOnce(async () => {
      amountStarted.resolve(undefined);
      await releaseAmount.promise;
      return rules();
    });
    mockCallFn.mockImplementation(async (name: string) => {
      if (name === 'confirmEventAttendance') return confirm(['uidA']);
      adjustStarted.resolve(undefined);
      await releaseAdjust.promise;
      return { success: true, results: [{ targetId: 'uidA', success: true }] };
    });

    const pending = settleAttendance(input({
      event: { id: 'evtA', title: '週日友誼賽', date: '2026/10/25 09:00~11:00' },
      people: [person('uidA')],
    }));
    try {
      await amountStarted.promise;
      expect(add.mock.calls.some(([type]) => type === 'beforeunload')).toBe(false);

      releaseAmount.resolve(undefined);
      await adjustStarted.promise;
      const registration = add.mock.calls.find(([type]) => type === 'beforeunload');
      const handler = registration?.[1] as ((event: BeforeUnloadEvent) => void) | undefined;
      expect(handler).toEqual(expect.any(Function));
      if (!handler) throw new Error('未註冊 beforeunload');
      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      handler(event);
      expect(event.defaultPrevented).toBe(true);

      releaseAdjust.resolve(undefined);
      const result = await pending;
      expectOk(result);
      expect(result.granted).toEqual(['uidA']);
      expect(remove).toHaveBeenCalledWith('beforeunload', handler);
    } finally {
      releaseAmount.resolve(undefined);
      releaseAdjust.resolve(undefined);
      await pending.catch(() => undefined);
    }
  });

  it('經驗值發放失敗後移除關閉分頁攔截', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    mockCallFn.mockImplementation(async (name: string) => {
      if (name === 'confirmEventAttendance') return confirm(['uidA']);
      throw new Error('網路錯誤');
    });

    const result = await settleAttendance(input({
      event: { id: 'evtA', title: '週日友誼賽', date: '2026/10/25 09:00~11:00' },
      people: [person('uidA')],
    }));

    expectOk(result);
    expect(result.failed).toEqual([{ uid: 'uidA', error: '網路錯誤' }]);
    expect(result.granted).toEqual([]);
    const handler = add.mock.calls.find(([type]) => type === 'beforeunload')?.[1];
    expect(handler).toEqual(expect.any(Function));
    expect(remove).toHaveBeenCalledWith('beforeunload', handler);
  });
});
