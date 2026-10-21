/**
 * `event-create.ts` 純函式與 Callable 邊界測試。
 *
 * 涵蓋：
 *   - buildCreateEventPayload：初始常數、id 格式、clientRequestId、缺 payloadRevision/Digest、
 *     isPublic、Date 型別、addons_use 檢查。
 *   - buildEditEventUpdates：不含統計 / 禁改欄位、status 四段規則、有報名時 max 改走 Callable。
 *   - changeEventCapacity：Callable 呼叫契約（mock `@/data/callables.callFn`）。
 *   - updateEventBasics：有報名 + max 變動時，會先 updateDoc 再呼叫 callFn。
 *
 * 時區無關策略：
 *   - `event-create.ts` 內 `buildStartEnd` 走本地時區；golden 內的 ISO 是 UTC 字串。
 *   - 比較時把兩邊都化為「同一個 YYYY-MM-DDTHH:mm 本地時間的毫秒數」，
 *     因此測試不依賴 `TZ` 環境變數。
 *   - `now` / `regOpenTime` 一律用 UTC 明確建構，避免跨日邊界。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock：@/data/callables ──────────────────────────

const { callFnMock } = vi.hoisted(() => ({ callFnMock: vi.fn() }));

vi.mock('@/data/callables', () => ({
  callFn: callFnMock,
  registerMock: vi.fn(),
  clearMocks: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));

// ── Mock：firebase/firestore（updateEventBasics / createEvent 會動態 import）──

const { updateDocMock, txGetMock, txSetMock } = vi.hoisted(() => ({
  updateDocMock: vi.fn(),
  txGetMock: vi.fn(),
  txSetMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, coll: string, id: string) => ({ path: `${coll}/${id}` })),
  updateDoc: updateDocMock,
  runTransaction: vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ get: txGetMock, set: txSetMock })),
  serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__'),
}));

// ── Mock：@/data/firebase（避免真的取 Firebase instance）──

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { kind: 'db' } })),
}));

// ── 受測模組（mock 已套用）──

import {
  ADDON_UPSELL_MESSAGE,
  applyAddonGate,
  buildCreateEventPayload,
  buildEditEventUpdates,
  changeEventCapacity,
  createEvent,
  newEventId,
  updateEventBasics,
  EventCreateError,
  type CreateEventContext,
  type CreateEventForm,
  type EventForEdit,
} from '@/features/events/data/event-create';
import goldenData from './__fixtures__/event-create-golden.json';

// ── 測試輔助 ─────────────────────────────────────────

/**
 * 把 golden 內 UTC ISO 字串視作「本地時間」解析，與 `buildStartEnd` 行為一致。
 * 例：golden `2026-05-15T15:00:00.000Z` → `new Date('2026-05-15T15:00')` 的毫秒。
 */
function goldenTimestampToLocalMs(isoString: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/i.exec(isoString);
  if (!m) return new Date(isoString).getTime();
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`).getTime();
}

/** 把 golden 物件內已知的 Date 欄位轉為與 payload 同基準的毫秒數。 */
function hydrateGoldenDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hydrateGoldenDates);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof v === 'string' &&
        (key === 'startTimestamp' || key === 'endTimestamp' || key === 'lockAt')
      ) {
        out[key] = goldenTimestampToLocalMs(v);
      } else {
        out[key] = hydrateGoldenDates(v);
      }
    }
    return out;
  }
  return value;
}

/** 把 payload 內 Date 轉為毫秒；其餘遞迴；鍵以字母序輸出以便 golden 比對。 */
function serializeForGolden(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(serializeForGolden);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = serializeForGolden((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function expectMatchesGolden(actual: unknown, goldenExpected: unknown): void {
  expect(serializeForGolden(actual)).toEqual(hydrateGoldenDates(goldenExpected));
}

function buildForm(overrides: Partial<CreateEventForm> = {}): CreateEventForm {
  return {
    title: '週末練球',
    type: 'friendly',
    location: '台北市大安運動中心',
    dateVal: '2026-05-15',
    startTime: '15:00',
    endTime: '17:00',
    max: 20,
    minAge: 0,
    notes: '',
    sportTag: 'basketball',
    regOpenTime: null,
    image: 'https://example.com/cover.jpg',
    creatorName: '小明',
    delegates: [],
    regionEnabled: false,
    region: '',
    cities: [],
    feeEnabled: false,
    fee: 0,
    teamOnly: false,
    creatorTeamId: null,
    creatorTeamName: null,
    creatorTeamIds: [],
    creatorTeamNames: [],
    genderRestrictionEnabled: false,
    allowedGender: '',
    privateEvent: false,
    socialLinksEnabled: false,
    socialLinks: [],
    earlyBirdEnabled: false,
    earlyBirdCost: 0,
    earlyBirdPolicyVersion: null,
    ...overrides,
  };
}

function buildCtx(overrides: Partial<CreateEventContext> = {}): CreateEventContext {
  return {
    uid: 'uid_user_golden',
    role: 'user',
    capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    rolePermissions: null,
    userGrants: null,
    customRoles: [],
    now: new Date('2026-05-01T00:00:00.000Z'),
    generateId: () => 'ce_golden_user_basic',
    ...overrides,
  };
}

// ── buildCreateEventPayload ───────────────────────────

describe('buildCreateEventPayload', () => {
  it('一般 user 建立：與 golden 一致', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expectMatchesGolden(payload, goldenData.createUserBasic.payload);
  });

  it('coach 建立：與 golden 一致', () => {
    const form = buildForm({ title: '教練帶練', creatorName: '王教練' });
    const ctx = buildCtx({ uid: 'uid_coach_golden', role: 'coach' });
    const payload = buildCreateEventPayload(form, ctx, 'ce_golden_coach');
    expectMatchesGolden(payload, goldenData.createCoach.payload);
  });

  it('admin 建立：與 golden 一致', () => {
    const form = buildForm({ title: '全站活動', creatorName: '李管理員' });
    const ctx = buildCtx({ uid: 'uid_admin_golden', role: 'admin' });
    const payload = buildCreateEventPayload(form, ctx, 'ce_golden_admin');
    expectMatchesGolden(payload, goldenData.createAdmin.payload);
  });

  it('user 有 addons_use 帶 fee + private：與 golden 一致', () => {
    const form = buildForm({
      title: '收費私密練球',
      creatorName: '陳收費',
      feeEnabled: true,
      fee: 100,
      privateEvent: true,
    });
    const ctx = buildCtx({
      uid: 'uid_user_addons_golden',
      capabilities: ['user.activity.basic_create', 'user.activity.addons_use'],
    });
    const payload = buildCreateEventPayload(form, ctx, 'ce_golden_user_addons');
    expectMatchesGolden(payload, goldenData.createUserWithAddons.payload);
  });

  it('Date 型別：startTimestamp / endTimestamp 為 Date 實例', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(payload.startTimestamp).toBeInstanceOf(Date);
    expect(payload.endTimestamp).toBeInstanceOf(Date);
  });

  it('start / end 走本地時區（不依賴執行環境 TZ）', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    // 期望值也用同一種 local-time 解析，因此在任何 TZ 下都成立。
    expect(payload.startTimestamp.getTime()).toBe(
      new Date('2026-05-15T15:00').getTime(),
    );
    expect(payload.endTimestamp.getTime()).toBe(new Date('2026-05-15T17:00').getTime());
  });

  it('不寫 payloadRevision / payloadDigest', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect('payloadRevision' in payload).toBe(false);
    expect('payloadDigest' in payload).toBe(false);
  });

  it('初始常數正確', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(payload.current).toBe(0);
    expect(payload.waitlist).toBe(0);
    expect(payload.participants).toEqual([]);
    expect(payload.waitlistNames).toEqual([]);
    expect(payload.contact).toBe('');
    expect(payload.icon).toBe('');
    expect(payload.countdown).toBe('即將開始');
  });

  it('isPublic === !!teamOnly', () => {
    const p1 = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(p1.isPublic).toBe(false);

    const p2 = buildCreateEventPayload(
      buildForm({ teamOnly: true }),
      buildCtx({ role: 'admin', uid: 'uid_admin_golden' }),
      'ce_golden_admin',
    );
    expect(p2.teamOnly).toBe(true);
    expect(p2.isPublic).toBe(true);
  });

  it('status：regOpenTime 在未來 → upcoming', () => {
    const form = buildForm({ regOpenTime: '2026-06-01T00:00:00Z' });
    const payload = buildCreateEventPayload(form, buildCtx(), 'ce_golden_user_basic');
    expect(payload.status).toBe('upcoming');
  });

  it('status：regOpenTime 為 null → open', () => {
    const payload = buildCreateEventPayload(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(payload.status).toBe('open');
  });

  it('id 格式不符時擲出 INVALID_ID', () => {
    try {
      buildCreateEventPayload(buildForm(), buildCtx(), 'bad_id');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EventCreateError);
      expect((err as EventCreateError).code).toBe('INVALID_ID');
    }
  });

  it('無 basic_create 且無 event.create grant → 擲出 BASIC_CREATE_REQUIRED', () => {
    const ctx = buildCtx({ capabilities: [] });
    try {
      buildCreateEventPayload(buildForm(), ctx, 'ce_golden_user_basic');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EventCreateError);
      expect((err as EventCreateError).code).toBe('BASIC_CREATE_REQUIRED');
    }
  });

  it('addons 有內容但 user 缺 addons_use → 照 A 清掉加值欄位、照常建立（R-CAP-004）', () => {
    const form = buildForm({ privateEvent: true, feeEnabled: true, fee: 100 });
    const gate = applyAddonGate(form, buildCtx(), null);
    expect(gate.stripped).toBe(true);
    const payload = buildCreateEventPayload(form, buildCtx(), 'ce_golden_user_basic');
    expect(payload.privateEvent).toBe(false);
    expect(payload.feeEnabled).toBe(false);
    expect(payload.fee).toBe(0);
    expect(ADDON_UPSELL_MESSAGE).toBe('如需更多功能請聯繫官方Line@');
  });

  it('缺 addons_use 時 GPS 也一併關閉、座標寫 null（A gpsEnabled=false）', () => {
    const form = buildForm({
      mapPickerEnabled: true, gpsEnabled: true, lat: 25.03, lng: 121.56,
      mapAddress: '台北', mapProvider: 'google', mapLocationConfirmed: true,
    });
    const payload = buildCreateEventPayload(form, buildCtx(), 'ce_golden_user_basic');
    expect(payload.gpsEnabled).toBe(false);
    expect(payload.lat).toBeNull();
    expect(payload.lng).toBeNull();
    expect(payload.mapAddress).toBeNull();
    expect(payload.mapLocationConfirmed).toBe(false);
  });

  it('沒有委託人管理權的 user 建立 → delegates 寫空（A _canManageEventDelegates(null)）', () => {
    const form = buildForm({ delegates: [{ uid: 'uid_d', name: '小華' }] });
    const payload = buildCreateEventPayload(form, buildCtx(), 'ce_golden_user_basic');
    expect(payload.delegates).toEqual([]);
    expect(payload.delegateUids).toEqual([]);
    const withAssign = buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.delegate_assign'],
    });
    expect(buildCreateEventPayload(form, withAssign, 'ce_golden_user_basic').delegateUids)
      .toEqual(['uid_d']);
  });

  it('gradient 由 type 推導（A GRADIENT_MAP），不吃表單', () => {
    const payload = buildCreateEventPayload(buildForm({ type: 'camp' }), buildCtx(), 'ce_golden_user_basic');
    expect(payload.gradient).toBe('linear-gradient(135deg,#ec4899,#be185d)');
  });

  it('分隊：寫入 teams、balanceCap、selfSelectLockHours，lockAt＝開始前 N 小時', () => {
    const ctx = buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.addons_use'],
    });
    const teams = [
      { key: 'A', color: '#EF4444', name: '紅隊' },
      { key: 'B', color: '#3B82F6', name: '藍隊' },
    ];
    const form = buildForm({
      teamSplit: { enabled: true, mode: 'self-select', balanceCap: true, selfSelectLockHours: 3, teams },
    });
    const payload = buildCreateEventPayload(form, ctx, 'ce_golden_user_basic');
    expect(payload.teamSplit).toEqual({
      enabled: true,
      mode: 'self-select',
      balanceCap: true,
      selfSelectLockHours: 3,
      teams,
      lockAt: new Date(new Date('2026-05-15T15:00').getTime() - 3 * 3_600_000),
    });
  });
});

// ── buildEditEventUpdates ─────────────────────────────

describe('buildEditEventUpdates', () => {
  const existing = (overrides: Partial<EventForEdit> = {}): EventForEdit => ({
    id: 'ce_golden_user_basic',
    creatorUid: 'uid_user_golden',
    privateEvent: false,
    delegateUids: [],
    status: 'open',
    current: 0,
    waitlist: 0,
    max: 20,
    ...overrides,
  });

  function editForm(overrides: Partial<CreateEventForm> = {}): CreateEventForm {
    return buildForm({ title: '週末練球（已更新）', ...overrides });
  }

  function ownCtx(): CreateEventContext {
    return buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    });
  }

  function coachCtx(): CreateEventContext {
    return buildCtx({
      uid: 'uid_user_golden',
      role: 'coach',
      capabilities: [],
    });
  }

  it('owner 基本編輯：與 golden 一致', () => {
    const result = buildEditEventUpdates(existing(), editForm(), ownCtx());
    expectMatchesGolden(result.updates, goldenData.editOwnerBasic.updates);
    expect(result.capacityChange).toBeNull();
  });

  it('不含 6 個 Rules 禁改欄位', () => {
    const result = buildEditEventUpdates(existing(), editForm(), ownCtx());
    for (const forbidden of [
      'viewCount',
      'id',
      'clientRequestId',
      'creatorUid',
      'payloadRevision',
      'payloadDigest',
    ]) {
      expect(forbidden in result.updates).toBe(false);
    }
  });

  it('不含統計欄位（current / waitlist / participants / waitlistNames / realCurrent / *_WithUid）', () => {
    const result = buildEditEventUpdates(existing(), editForm(), ownCtx());
    for (const stat of [
      'current',
      'waitlist',
      'participants',
      'waitlistNames',
      'realCurrent',
      'participantsWithUid',
      'waitlistWithUid',
    ]) {
      expect(stat in result.updates).toBe(false);
    }
  });

  it('current=0 且 max 未改 → max 名額寫入 updates，capacityChange=null', () => {
    const result = buildEditEventUpdates(existing(), editForm({ max: 20 }), ownCtx());
    expect(result.updates.max).toBe(20);
    expect(result.capacityChange).toBeNull();
  });

  it('current > 0 且 max 有改 → updates 不含 max，capacityChange = newMax', () => {
    const result = buildEditEventUpdates(
      existing({ current: 5 }),
      editForm({ max: 30 }),
      ownCtx(),
    );
    expect('max' in result.updates).toBe(false);
    expect(result.capacityChange).toBe(30);
  });

  it('current > 0 但 max 未改 → capacityChange=null', () => {
    const result = buildEditEventUpdates(
      existing({ current: 5 }),
      editForm({ max: 20 }),
      ownCtx(),
    );
    expect('max' in result.updates).toBe(false);
    expect(result.capacityChange).toBeNull();
  });

  it('waitlist > 0 且 max 有改 → capacityChange = newMax', () => {
    const result = buildEditEventUpdates(
      existing({ waitlist: 2 }),
      editForm({ max: 25 }),
      ownCtx(),
    );
    expect('max' in result.updates).toBe(false);
    expect(result.capacityChange).toBe(25);
  });

  // ── status 四段規則 ───────────────────────────────
  // 1) user 無管理入口 → 不寫 status（既有測試）
  // 2) 有管理入口 + regOpenTime 未來 → upcoming
  // 3) 有管理入口 + regOpenTime 已過 + existing upcoming + 未滿 → open
  // 4) 有管理入口 + regOpenTime 已過 + existing upcoming + 已滿 → full
  // 5) 有管理入口 + existing ended / cancelled → 不寫
  // 6) 有管理入口 + regOpenTime 已過 + existing open → 不寫

  it('status 規則 A：user 無管理入口 → 不寫 status', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'open' }),
      editForm({ regOpenTime: '2026-06-01T00:00:00Z' }),
      ownCtx(),
    );
    expect(result.updates.status).toBeUndefined();
  });

  it('status 規則 B：coach 有管理入口 + regOpenTime 未來 → upcoming', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'open' }),
      editForm({ regOpenTime: '2026-06-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBe('upcoming');
  });

  it('status 規則 C：regOpenTime 已過 + existing upcoming + 未滿 → open', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'upcoming', current: 5, max: 20 }),
      editForm({ regOpenTime: '2026-04-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBe('open');
  });

  it('status 規則 D：regOpenTime 已過 + existing upcoming + 已滿 → full', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'upcoming', current: 20, max: 20 }),
      editForm({ regOpenTime: '2026-04-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBe('full');
  });

  it('status 規則 E：existing ended → 不寫 status（即使 regOpenTime 未來）', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'ended' }),
      editForm({ regOpenTime: '2026-06-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBeUndefined();
  });

  it('status 規則 F：existing cancelled → 不寫 status', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'cancelled' }),
      editForm({ regOpenTime: '2026-06-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBeUndefined();
  });

  it('status 規則 G：regOpenTime 已過 + existing open → 不寫 status', () => {
    const result = buildEditEventUpdates(
      existing({ status: 'open' }),
      editForm({ regOpenTime: '2026-04-01T00:00:00Z' }),
      coachCtx(),
    );
    expect(result.updates.status).toBeUndefined();
  });

  it('限定俱樂部：有 event.edit_all 才寫 teamOnly／creatorTeam*（A 編輯分支）', () => {
    const form = editForm({
      teamOnly: true, creatorTeamId: 'tm_1', creatorTeamName: '甲隊',
      creatorTeamIds: ['tm_1'], creatorTeamNames: ['甲隊'],
    });
    const admin = buildCtx({ role: 'admin', capabilities: [], rolePermissions: ['event.edit_all'] });
    const adminResult = buildEditEventUpdates(existing({ creatorUid: 'uid_other' }), form, admin);
    expect(adminResult.updates.teamOnly).toBe(true);
    expect(adminResult.updates.creatorTeamIds).toEqual(['tm_1']);

    const coach = buildCtx({ role: 'coach', capabilities: [], rolePermissions: [] });
    const coachResult = buildEditEventUpdates(existing(), form, coach);
    expect('teamOnly' in coachResult.updates).toBe(false);
    expect('creatorTeamId' in coachResult.updates).toBe(false);
  });

  it('編輯：user 缺 addons_use 勾私密 → addonsStripped，updates 不含加值欄位', () => {
    const result = buildEditEventUpdates(existing(), editForm({ privateEvent: true }), ownCtx());
    expect(result.addonsStripped).toBe(true);
    expect('privateEvent' in result.updates).toBe(false);
    expect('feeEnabled' in result.updates).toBe(false);
  });

  it('EDIT_NOT_ALLOWED：非 owner 且無可編輯授權 → 擲出', () => {
    const stranger = buildCtx({
      uid: 'uid_stranger',
      capabilities: [],
      role: 'user',
    });
    try {
      buildEditEventUpdates(existing(), editForm(), stranger);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EventCreateError);
      expect((err as EventCreateError).code).toBe('EDIT_NOT_ALLOWED');
    }
  });
});

// ── Callable 邊界：changeEventCapacity ────────────────

describe('changeEventCapacity', () => {
  beforeEach(() => {
    callFnMock.mockReset();
    callFnMock.mockResolvedValue({
      success: true,
      promoted: 0,
      demoted: 0,
      current: 0,
      waitlist: 0,
    });
  });

  it('呼叫 callFn("adjustEventCapacity", { eventId, newMax })', async () => {
    await changeEventCapacity('ce_test_1', 30);
    expect(callFnMock).toHaveBeenCalledWith('adjustEventCapacity', {
      eventId: 'ce_test_1',
      newMax: 30,
    });
  });

  it('callFn 失敗 → 包成 EventCreateError("CAPACITY_ADJUST_FAILED")', async () => {
    callFnMock.mockRejectedValueOnce(new Error('boom'));
    try {
      await changeEventCapacity('ce_test_1', 30);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EventCreateError);
      expect((err as EventCreateError).code).toBe('CAPACITY_ADJUST_FAILED');
    }
  });
});

// ── Callable 邊界：updateEventBasics（有報名 → 走 Callable，不直寫 max）──

describe('updateEventBasics', () => {
  const existingCapacity: EventForEdit = {
    id: 'ce_golden_user_basic',
    creatorUid: 'uid_user_golden',
    status: 'open',
    current: 5,
    waitlist: 0,
    max: 20,
  };

  beforeEach(() => {
    updateDocMock.mockReset();
    updateDocMock.mockResolvedValue(undefined);
    callFnMock.mockReset();
    callFnMock.mockResolvedValue({
      success: true,
      promoted: 0,
      demoted: 0,
      current: 5,
      waitlist: 0,
    });
  });

  it('有報名 (current>0) + max 改動 → 先 updateDoc、再 callFn adjustEventCapacity', async () => {
    const form = buildForm({ title: '週末練球（已更新）', max: 30 });
    const ctx = buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    });

    const result = await updateEventBasics(existingCapacity, form, ctx);

    expect(result.capacityChange).toBe(30);
    expect('max' in result.updates).toBe(false);

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(callFnMock).toHaveBeenCalledTimes(1);
    expect(callFnMock).toHaveBeenCalledWith('adjustEventCapacity', {
      eventId: 'ce_golden_user_basic',
      newMax: 30,
    });
  });

  it('有報名但 max 未改 → 不呼叫 callFn', async () => {
    const form = buildForm({ title: '週末練球（已更新）', max: 20 });
    const ctx = buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    });

    const result = await updateEventBasics(existingCapacity, form, ctx);

    expect(result.capacityChange).toBeNull();
    expect('max' in result.updates).toBe(false);
    expect(callFnMock).not.toHaveBeenCalled();
  });

  it('無報名 (current=0) → max 直寫進 updates，不呼叫 callFn', async () => {
    const noCapacity: EventForEdit = { ...existingCapacity, current: 0, max: 20 };
    const form = buildForm({ title: '週末練球（已更新）', max: 30 });
    const ctx = buildCtx({
      capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    });

    const result = await updateEventBasics(noCapacity, form, ctx);

    expect(result.capacityChange).toBeNull();
    expect(result.updates.max).toBe(30);
    expect(callFnMock).not.toHaveBeenCalled();
  });
});

// ── Callable 邊界：createEvent ────────────────────────

describe('createEvent', () => {
  beforeEach(() => {
    txGetMock.mockReset();
    txSetMock.mockReset();
  });

  it('newEventId 用 ctx.generateId 產生一次；不符 Rules 樣式即擲出', () => {
    expect(newEventId(buildCtx())).toBe('ce_golden_user_basic');
    expect(() => newEventId(buildCtx({ generateId: () => 'bad id' }))).toThrow(EventCreateError);
  });

  it('文件不存在 → 以 transaction 寫入，alreadyExisted=false', async () => {
    txGetMock.mockResolvedValue({ exists: () => false });
    const result = await createEvent(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(result.alreadyExisted).toBe(false);
    expect(txSetMock).toHaveBeenCalledTimes(1);
    const written = txSetMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(written.id).toBe('ce_golden_user_basic');
    expect(written.clientRequestId).toBe('ce_golden_user_basic');
    expect(written.createdAt).toBe('__SERVER_TIMESTAMP__');
    expect('payloadRevision' in written).toBe(false);
    expect('payloadDigest' in written).toBe(false);
  });

  it('重試：同一 id 已由本人建立 → 視為成功、不覆寫', async () => {
    txGetMock.mockResolvedValue({ exists: () => true, data: () => ({ creatorUid: 'uid_user_golden' }) });
    const result = await createEvent(buildForm(), buildCtx(), 'ce_golden_user_basic');
    expect(result.alreadyExisted).toBe(true);
    expect(txSetMock).not.toHaveBeenCalled();
  });

  it('同一 id 已被他人使用 → ID_TAKEN，不覆寫', async () => {
    txGetMock.mockResolvedValue({ exists: () => true, data: () => ({ creatorUid: 'uid_other' }) });
    await expect(createEvent(buildForm(), buildCtx(), 'ce_golden_user_basic'))
      .rejects.toMatchObject({ code: 'ID_TAKEN' });
    expect(txSetMock).not.toHaveBeenCalled();
  });
});
