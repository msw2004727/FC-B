/**
 * A07～A10 / Functions 契約回歸測試。
 * 本次環境無法啟動命令工具，以下測試尚未執行。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  addDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  collection: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn() },
  Timestamp: { now: vi.fn(), fromDate: vi.fn() },
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {}, auth: null, functions: null })),
}));

vi.mock('./visibility', () => ({
  isEventVisibleToUser: vi.fn(),
}));

import * as firestore from 'firebase/firestore';
import {
  CallableError,
  clearMocks,
  registerMock,
  startRecording,
  stopRecording,
} from '@/data/callables';
import type {
  CancelRegistrationResponse,
  RegisterForEventResponse,
} from '@/data/contract/callables';
import { on } from '@/core/events';

import {
  buildCancelPayload,
  buildRegisterPayload,
  cancelRegistration,
  precheckSignup,
  registerForEvent,
  SignupError,
  type CancelOperationContext,
  type OperationAuth,
  type SignupOperationContext,
  type SignupParticipant,
  type SignupSnapshot,
} from './signup';
import { registerSelection } from './signup-selection';
import {
  invalidateViewerRegistrations,
  readViewerRegistrationsCached,
} from './viewer-registrations-cache';
import type { EventDoc, RegistrationDoc, ViewerContext } from './types';
import { isEventVisibleToUser } from './visibility';

const mockedVisible = vi.mocked(isEventVisibleToUser);
const FIXED_MS = 1_700_000_000_000;
const START_MS = Date.parse('2030-05-09T15:00:00+08:00');

function makeViewer(overrides: Partial<ViewerContext> = {}): ViewerContext {
  return {
    uid: 'u1',
    teamIds: new Set<string>(),
    hasPermission: () => false,
    roleLevel: 0,
    ...overrides,
  };
}

function makeSnapshot(eventId: string, uid = 'u1'): SignupSnapshot {
  return {
    event: { id: eventId, status: 'open' },
    viewer: makeViewer({ uid }),
    registrations: [],
    profileComplete: true,
    participantCheck: { ok: true },
    earlyBirdWindow: false,
    teamSignupAllowed: true,
    requiresTeamSelection: false,
  };
}

function signupContext(
  overrides: Partial<SignupSnapshot> = {},
  initialUid = 'u1',
) {
  let auth: OperationAuth = { uid: initialUid, generation: 1 };
  const load = vi.fn(async (eventId: string, _participants: readonly SignupParticipant[]) => ({
    ...makeSnapshot(eventId, auth.uid ?? ''),
    ...overrides,
  }));
  const context: SignupOperationContext = {
    getAuth: () => ({ ...auth }),
    load,
  };
  return {
    context,
    load,
    setAuth(uid: string | null) {
      auth = { uid, generation: auth.generation + 1 };
    },
  };
}

function cancelContext(event: Partial<EventDoc> = {}, initialUid = 'u1') {
  let auth: OperationAuth = { uid: initialUid, generation: 1 };
  const load = vi.fn(async (eventId: string) => ({
    event: { id: eventId, status: 'open', ...event },
  }));
  const context: CancelOperationContext = {
    getAuth: () => ({ ...auth }),
    load,
  };
  return {
    context,
    load,
    setAuth(uid: string | null) {
      auth = { uid, generation: auth.generation + 1 };
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function recorded(name: string) {
  return stopRecording().filter((call) => call.name === name);
}

beforeEach(() => {
  vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
  vi.clearAllMocks();
  clearMocks();
  startRecording();
  mockedVisible.mockReset();
  mockedVisible.mockReturnValue(true);
});

afterEach(() => {
  expect(firestore.setDoc).not.toHaveBeenCalled();
  expect(firestore.updateDoc).not.toHaveBeenCalled();
  expect(firestore.addDoc).not.toHaveBeenCalled();
  expect(firestore.deleteDoc).not.toHaveBeenCalled();
  expect(firestore.writeBatch).not.toHaveBeenCalled();
  expect(firestore.runTransaction).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  stopRecording();
  clearMocks();
});

describe('buildRegisterPayload：A07/A09 golden payload', () => {
  it('A07 本人，public eventId 原樣傳入', () => {
    expect(buildRegisterPayload({
      eventId: 'public-event',
      user: { uid: 'u1', displayName: 'Alice' },
      now: FIXED_MS,
      randomSuffix: 'abc',
    })).toEqual({
      eventId: 'public-event',
      participants: [{ userId: 'u1', userName: 'Alice' }],
      requestId: `u1_public-event_${FIXED_MS}_abc`,
    });
  });

  it('舊 companions 介面維持本人加同行者', () => {
    expect(buildRegisterPayload({
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      companions: [
        { companionId: 'c1', companionName: 'Bob' },
        { companionId: 'c2', companionName: 'Carol' },
      ],
      now: FIXED_MS,
      randomSuffix: 'xyz',
    })).toEqual({
      eventId: 'evt1',
      participants: [
        { userId: 'u1', userName: 'Alice' },
        { userId: 'u1', userName: 'Alice', companionId: 'c1', companionName: 'Bob' },
        { userId: 'u1', userName: 'Alice', companionId: 'c2', companionName: 'Carol' },
      ],
      requestId: `u1_evt1_${FIXED_MS}_xyz`,
    });
  });

  it('A09 只替同行者報名，不補本人並保留選取順序', () => {
    expect(buildRegisterPayload({
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      participants: [
        { type: 'companion', companionId: 'c2', companionName: 'Carol' },
        { type: 'companion', companionId: 'c1', companionName: 'Bob' },
      ],
      now: FIXED_MS,
      randomSuffix: 'abc',
    })).toEqual({
      eventId: 'evt1',
      participants: [
        { userId: 'u1', userName: 'Alice', companionId: 'c2', companionName: 'Carol' },
        { userId: 'u1', userName: 'Alice', companionId: 'c1', companionName: 'Bob' },
      ],
      requestId: `u1_evt1_${FIXED_MS}_abc`,
    });
  });

  it('A09 明確選本人及同行者', () => {
    expect(buildRegisterPayload({
      eventId: 'evt1',
      user: { uid: 'u1', name: 'Alice' },
      participants: [
        { type: 'self' },
        { type: 'companion', companionId: 'c1', companionName: 'Bob' },
      ],
      now: FIXED_MS,
      randomSuffix: 'abc',
    })).toEqual({
      eventId: 'evt1',
      participants: [
        { userId: 'u1', userName: 'Alice' },
        { userId: 'u1', userName: 'Alice', companionId: 'c1', companionName: 'Bob' },
      ],
      requestId: `u1_evt1_${FIXED_MS}_abc`,
    });
  });

  it.each([
    [{ uid: 'u1', displayName: '   ', name: 'Alice' }, '   '],
    [{ uid: 'u1', displayName: '', name: ' Alice ' }, ' Alice '],
    [{ uid: 'u1', displayName: null, name: '' }, '用戶'],
  ])('名稱使用 A 的 || 語意：%j', (user, expected) => {
    expect(buildRegisterPayload({ eventId: 'evt1', user }).participants[0]?.userName).toBe(expected);
  });

  it('早鳥、teamKey 與 trim 後的席位 ID', () => {
    expect(buildRegisterPayload({
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      earlyBirdAccepted: true,
      earlyBirdExpectedCost: 120,
      teamKey: 'red',
      preferredTeamReservationTeamId: ' teamA ',
      now: FIXED_MS,
      randomSuffix: 'abc',
    })).toEqual({
      eventId: 'evt1',
      participants: [{ userId: 'u1', userName: 'Alice' }],
      requestId: `u1_evt1_${FIXED_MS}_abc`,
      earlyBirdAccepted: true,
      earlyBirdExpectedCost: 120,
      teamKey: 'red',
      preferredTeamReservationTeamId: 'teamA',
    });
  });

  it('空白席位 ID 不送出；未確認早鳥不帶早鳥欄位', () => {
    const payload = buildRegisterPayload({
      eventId: 'evt1',
      user: { uid: 'u1' },
      earlyBirdAccepted: false,
      earlyBirdExpectedCost: 120,
      preferredTeamReservationTeamId: '   ',
    });
    expect(payload).not.toHaveProperty('preferredTeamReservationTeamId');
    expect(payload).not.toHaveProperty('earlyBirdAccepted');
    expect(payload).not.toHaveProperty('earlyBirdExpectedCost');
  });

  it('10 位同行者合法，11 人或零人拒絕', () => {
    const participants: SignupParticipant[] = Array.from({ length: 10 }, (_, index) => ({
      type: 'companion',
      companionId: `c${index}`,
      companionName: `同行者 ${index}`,
    }));
    const base = { eventId: 'evt1', user: { uid: 'u1' } };
    expect(buildRegisterPayload({ ...base, participants }).participants).toHaveLength(10);
    expect(() => buildRegisterPayload({ ...base, participants: [] })).toThrow(SignupError);
    expect(() => buildRegisterPayload({
      ...base,
      participants: [{ type: 'self' }, ...participants],
    })).toThrow(SignupError);
  });

  it('拒絕後端會誤判為同行者的非首位本人', () => {
    expect(() => buildRegisterPayload({
      eventId: 'evt1',
      user: { uid: 'u1' },
      participants: [
        { type: 'companion', companionId: 'c1', companionName: 'Bob' },
        { type: 'self' },
      ],
    })).toThrow('Functions 僅將第一筆');
  });

  it('拒絕混用新舊選人欄位及空 eventId／UID', () => {
    expect(() => buildRegisterPayload({
      eventId: 'evt1',
      user: { uid: 'u1' },
      participants: [{ type: 'self' }],
      companions: [],
    })).toThrow(SignupError);
    expect(() => buildRegisterPayload({
      eventId: ' ',
      user: { uid: 'u1' },
    })).toThrow(SignupError);
    expect(() => buildRegisterPayload({
      eventId: 'evt1',
      user: { uid: '' },
    })).toThrow(SignupError);
  });
});

describe('buildCancelPayload：A08/A10 golden payload', () => {
  it('A08 本人取消', () => {
    expect(buildCancelPayload({
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['reg1'],
      kind: 'self',
      now: FIXED_MS,
      randomSuffix: 'ab',
    })).toEqual({
      eventId: 'evt1',
      registrationIds: ['reg1'],
      reason: 'user_cancel',
      requestId: `cancel_u1_evt1_${FIXED_MS}_ab`,
    });
  });

  it('A10 同行者取消，沒有 random 尾碼', () => {
    expect(buildCancelPayload({
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['reg2', 'reg3'],
      kind: 'companion',
      now: FIXED_MS,
    })).toEqual({
      eventId: 'evt1',
      registrationIds: ['reg2', 'reg3'],
      reason: 'user_cancel',
      requestId: `cancel_companion_u1_evt1_${FIXED_MS}`,
    });
  });

  it('A08 選取結果去空值、最多 20 筆，不修改輸入', () => {
    const ids = ['', ...Array.from({ length: 21 }, (_, index) => `r${index}`)];
    const payload = buildCancelPayload({
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ids,
      kind: 'self',
    });
    expect(payload.registrationIds).toEqual(Array.from({ length: 20 }, (_, index) => `r${index}`));
    expect(ids).toHaveLength(22);
  });

  it('A10 超過 20 筆拒絕，不默默截斷；空選取亦拒絕', () => {
    const base = { eventId: 'evt1', userId: 'u1', kind: 'companion' as const };
    expect(() => buildCancelPayload({
      ...base,
      registrationIds: Array.from({ length: 21 }, (_, index) => `r${index}`),
    })).toThrow(SignupError);
    expect(() => buildCancelPayload({ ...base, registrationIds: [] })).toThrow(SignupError);
  });
});

const activeSelf: RegistrationDoc = {
  eventId: 'evt1',
  userId: 'u1',
  status: 'confirmed',
  participantType: 'self',
};

describe('precheckSignup', () => {
  it('未登入拒絕', () => {
    expect(precheckSignup(
      { id: 'evt1', status: 'open' },
      makeViewer({ uid: null }),
      [],
      new Date(FIXED_MS),
    )).toMatchObject({ ok: false, reason: 'login_required' });
  });

  it('可見性只收到目標活動歷史及 operator', () => {
    mockedVisible.mockReturnValue(false);
    const viewer = makeViewer();
    const other = { ...activeSelf, eventId: 'other' };
    const result = precheckSignup(
      { id: 'evt1', status: 'open' },
      viewer,
      [activeSelf, other],
      new Date(FIXED_MS),
    );
    expect(result).toMatchObject({ ok: false, messageKey: 'event.signup.unavailable' });
    expect(mockedVisible).toHaveBeenCalledWith(
      { id: 'evt1', status: 'open' },
      viewer,
      [activeSelf],
    );
  });

  it.each(['ended', 'cancelled'])('%s 狀態拒絕', (status) => {
    expect(precheckSignup(
      { id: 'evt1', status },
      makeViewer(),
      [],
      new Date(FIXED_MS),
    )).toMatchObject({ ok: false, reason: 'event_ended' });
  });

  it('一般 upcoming 拒絕，合法且確認的 A07 早鳥通過', () => {
    const event = { id: 'evt1', status: 'upcoming' };
    expect(precheckSignup(event, makeViewer(), [], new Date(FIXED_MS))).toMatchObject({
      ok: false,
      reason: 'event_not_open',
    });
    expect(precheckSignup(event, makeViewer(), [], new Date(FIXED_MS), {
      earlyBirdWindow: true,
      earlyBirdAccepted: true,
    })).toEqual({ ok: true });
    expect(precheckSignup(event, makeViewer(), [], new Date(FIXED_MS), {
      earlyBirdWindow: true,
    })).toMatchObject({ ok: false, reason: 'early_bird_confirm_required' });
  });

  it('A09 選人流程不因早鳥旗標而放行 upcoming', () => {
    expect(precheckSignup(
      { id: 'evt1', status: 'upcoming' },
      makeViewer(),
      [],
      new Date(FIXED_MS),
      {
        participants: [{ type: 'companion', companionId: 'c1', companionName: 'Bob' }],
        earlyBirdWindow: true,
        earlyBirdAccepted: true,
      },
    )).toMatchObject({ ok: false, reason: 'event_not_open' });
  });

  it('不同活動歷史不阻擋，當場 active self 才阻擋', () => {
    const event = { id: 'evt1', status: 'open' };
    expect(precheckSignup(
      event,
      makeViewer(),
      [{ ...activeSelf, eventId: 'other' }],
      new Date(FIXED_MS),
    )).toEqual({ ok: true });
    expect(precheckSignup(event, makeViewer(), [activeSelf], new Date(FIXED_MS))).toMatchObject({
      ok: false,
      reason: 'already_registered',
    });
  });

  it('本人已報名仍可單獨加同行者', () => {
    expect(precheckSignup(
      { id: 'evt1', status: 'open' },
      makeViewer(),
      [activeSelf],
      new Date(FIXED_MS),
      { participants: [{ type: 'companion', companionId: 'c1', companionName: 'Bob' }] },
    )).toEqual({ ok: true });
  });

  it.each(['cancelled', 'removed'])('%s 本人紀錄不阻擋', (status) => {
    expect(precheckSignup(
      { id: 'evt1', status: 'open' },
      makeViewer(),
      [{ ...activeSelf, status }],
      new Date(FIXED_MS),
    )).toEqual({ ok: true });
  });

  it('有 companionId 的 legacy 紀錄不當成本人', () => {
    const legacy = { ...activeSelf, participantType: undefined, companionId: 'c1' };
    expect(precheckSignup(
      { id: 'evt1', status: 'open' },
      makeViewer(),
      [legacy],
      new Date(FIXED_MS),
    )).toEqual({ ok: true });
  });

  it('teamOnly 不以 owner/admin 可見性權限推論報名資格', () => {
    const event = { id: 'evt1', status: 'open', teamOnly: true, ownerUid: 'u1' };
    const viewer = makeViewer({ roleLevel: 4, hasPermission: () => true });
    expect(precheckSignup(event, viewer, [], new Date(FIXED_MS))).toMatchObject({
      ok: false,
      reason: 'event_team_only_restricted',
    });
    expect(precheckSignup(event, viewer, [], new Date(FIXED_MS), {
      teamSignupAllowed: true,
    })).toEqual({ ok: true });
  });

  it.each([
    [START_MS - 1, true],
    [START_MS, false],
    [START_MS + 1, false],
  ])('H1 報名開始時間邊界 %s', (now, allowed) => {
    expect(precheckSignup(
      { id: 'evt1', status: 'open', date: '2030/05/09 15:00~17:00' },
      makeViewer(),
      [],
      new Date(now),
    ).ok).toBe(allowed);
  });

  it('不使用首頁 parser 的連字號日期或 startAt fallback', () => {
    expect(precheckSignup(
      {
        id: 'evt1',
        status: 'open',
        date: '2000-01-01 00:00',
        startAt: 1,
      },
      makeViewer(),
      [],
      new Date(FIXED_MS),
    )).toEqual({ ok: true });
  });
});

describe('registerForEvent：正式入口守衛', () => {
  it('缺 context 拒絕，不走未檢查 Callable', async () => {
    await expect(registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1' },
    })).rejects.toMatchObject({ originalCode: 'CONTEXT_REQUIRED' });
    expect(recorded('registerForEvent')).toHaveLength(0);
  });

  it('成功只送 Callable，並發布成功事件', async () => {
    registerMock('registerForEvent', async () => ({ success: true }));
    const harness = signupContext();
    const listener = vi.fn();
    const off = on('registration:created', listener);
    try {
      await registerForEvent({
        eventId: 'evt1',
        user: { uid: 'u1', displayName: 'Alice' },
        context: harness.context,
      });
      expect(harness.load).toHaveBeenCalledWith('evt1', [{ type: 'self' }]);
      expect(recorded('registerForEvent')).toHaveLength(1);
      expect(listener).toHaveBeenCalledWith({ eventId: 'evt1', userId: 'u1' });
    } finally {
      off();
    }
  });

  it('本人已報名後只加同行者，實際 payload 仍只有同行者', async () => {
    registerMock('registerForEvent', async () => ({ success: true }));
    const harness = signupContext({ registrations: [activeSelf] });
    await registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      participants: [{ type: 'companion', companionId: 'c1', companionName: 'Bob' }],
      context: harness.context,
    });
    expect(recorded('registerForEvent')[0]?.request).toMatchObject({
      participants: [
        { userId: 'u1', userName: 'Alice', companionId: 'c1', companionName: 'Bob' },
      ],
    });
  });

  it('黑名單／私密守衛拒絕時不送 Callable，文案逐字一致', async () => {
    mockedVisible.mockReturnValue(false);
    await expect(registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1' },
      context: signupContext().context,
    })).rejects.toMatchObject({
      messageKey: 'event.signup.unavailable',
      message: '此活動目前無法報名',
    });
    expect(recorded('registerForEvent')).toHaveLength(0);
  });

  it('同行者流程只對 operator 呼叫可見性守衛', async () => {
    registerMock('registerForEvent', async () => ({ success: true }));
    const harness = signupContext({
      event: { id: 'evt1', status: 'open', blockedUids: ['c1'] },
    });
    await registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1' },
      participants: [{ type: 'companion', companionId: 'c1', companionName: 'Bob' }],
      context: harness.context,
    });
    expect(mockedVisible).toHaveBeenCalledTimes(1);
    expect(mockedVisible.mock.calls[0]?.[1].uid).toBe('u1');
  });

  it.each([
    ['profile', { profileComplete: false }, 'profile_incomplete'],
    [
      'gender',
      {
        participantCheck: {
          ok: false,
          reason: 'gender_restricted',
          messageKey: 'event.signup.error.genderRestricted',
        },
      },
      'gender_restricted',
    ],
    [
      'age',
      {
        participantCheck: {
          ok: false,
          reason: 'age_restricted',
          messageKey: 'event.signup.ageRestricted',
        },
      },
      'age_restricted',
    ],
    ['team', { requiresTeamSelection: true }, 'team_selection_required'],
  ] as const)('%s 守衛失敗不送 Callable', async (_name, overrides, reason) => {
    await expect(registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1' },
      context: signupContext(overrides).context,
    })).rejects.toMatchObject({ originalCode: reason });
    expect(recorded('registerForEvent')).toHaveLength(0);
  });

  it('upcoming 合法早鳥可經正式入口送出', async () => {
    registerMock('registerForEvent', async () => ({ success: true }));
    const harness = signupContext({
      event: { id: 'evt1', status: 'upcoming' },
      earlyBirdWindow: true,
    });
    await registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1' },
      earlyBirdAccepted: true,
      earlyBirdExpectedCost: 120,
      context: harness.context,
    });
    expect(recorded('registerForEvent')[0]?.request).toMatchObject({
      earlyBirdAccepted: true,
      earlyBirdExpectedCost: 120,
    });
  });

  it('載入期間切換身分：送出前拒絕', async () => {
    const snapshot = deferred<SignupSnapshot>();
    const entered = deferred<void>();
    const harness = signupContext();
    harness.load.mockImplementation(async () => {
      entered.resolve();
      return snapshot.promise;
    });
    const operation = registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1' },
      context: harness.context,
    });
    await entered.promise;
    harness.setAuth('u2');
    const assertion = expect(operation).rejects.toMatchObject({ originalCode: 'AUTH_CHANGED' });
    snapshot.resolve(makeSnapshot('evt1'));
    await assertion;
    expect(recorded('registerForEvent')).toHaveLength(0);
  });

  it('Callable 錯誤轉成 SignupError', async () => {
    registerMock('registerForEvent', async () => {
      throw new CallableError('failed-precondition', 'PROFILE_INCOMPLETE', 'PROFILE_INCOMPLETE');
    });
    await expect(registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1' },
      context: signupContext().context,
    })).rejects.toMatchObject({
      name: 'SignupError',
      code: 'failed-precondition',
      originalCode: 'PROFILE_INCOMPLETE',
      messageKey: 'event.signup.error.profileIncomplete',
    });
  });

  it('deduplicated 回應不發布 created', async () => {
    registerMock('registerForEvent', async () => ({ success: true, deduplicated: true }));
    const listener = vi.fn();
    const off = on('registration:created', listener);
    try {
      await registerForEvent({
        eventId: 'evt1',
        user: { uid: 'u1' },
        context: signupContext().context,
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });
});

describe('防連點及認證世代', () => {
  it('同內容共用 Promise；成功清除後重新載入最新資料', async () => {
    const pending = deferred<RegisterForEventResponse>();
    registerMock('registerForEvent', () => pending.promise);
    const harness = signupContext();
    const input = { eventId: 'evt1', user: { uid: 'u1' }, context: harness.context };

    const first = registerForEvent(input);
    const second = registerForEvent(input);
    expect(first).toBe(second);
    pending.resolve({ success: true });
    await first;
    expect(recorded('registerForEvent')).toHaveLength(1);

    startRecording();
    await registerForEvent(input);
    expect(harness.load).toHaveBeenCalledTimes(2);
    expect(recorded('registerForEvent')).toHaveLength(1);
  });

  it('失敗也清除，重試重新檢查並送出', async () => {
    let attempts = 0;
    registerMock('registerForEvent', async () => {
      attempts += 1;
      if (attempts === 1) throw new CallableError('unavailable', 'temporary', '');
      return { success: true };
    });
    const harness = signupContext();
    const input = { eventId: 'evt1', user: { uid: 'u1' }, context: harness.context };
    await expect(registerForEvent(input)).rejects.toBeInstanceOf(SignupError);
    await expect(registerForEvent(input)).resolves.toMatchObject({ success: true });
    expect(harness.load).toHaveBeenCalledTimes(2);
    expect(recorded('registerForEvent')).toHaveLength(2);
  });

  it('同活動不同同行者選取不合併', async () => {
    const pending = deferred<RegisterForEventResponse>();
    registerMock('registerForEvent', () => pending.promise);
    const harness = signupContext();
    const base = { eventId: 'evt1', user: { uid: 'u1' }, context: harness.context };
    const first = registerForEvent({
      ...base,
      participants: [{ type: 'companion', companionId: 'c1', companionName: 'Bob' }],
    });
    const second = registerForEvent({
      ...base,
      participants: [{ type: 'companion', companionId: 'c2', companionName: 'Carol' }],
    });
    expect(first).not.toBe(second);
    pending.resolve({ success: true });
    await Promise.all([first, second]);
    expect(recorded('registerForEvent')).toHaveLength(2);
  });

  it('切換帳號不共用舊 Promise，舊請求完成不發布事件', async () => {
    const pending = deferred<RegisterForEventResponse>();
    const entered = deferred<void>();
    let count = 0;
    registerMock('registerForEvent', async () => {
      count += 1;
      if (count === 1) {
        entered.resolve();
        return pending.promise;
      }
      return { success: true };
    });
    const harness = signupContext();
    const listener = vi.fn();
    const off = on('registration:created', listener);
    try {
      const first = registerForEvent({
        eventId: 'evt1',
        user: { uid: 'u1' },
        context: harness.context,
      });
      await entered.promise;
      harness.setAuth('u2');
      const second = registerForEvent({
        eventId: 'evt1',
        user: { uid: 'u2' },
        context: harness.context,
      });
      expect(first).not.toBe(second);
      await second;
      const assertion = expect(first).rejects.toMatchObject({ originalCode: 'AUTH_CHANGED' });
      pending.resolve({ success: true });
      await assertion;
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ eventId: 'evt1', userId: 'u2' });
      expect(recorded('registerForEvent')).toHaveLength(2);
    } finally {
      off();
    }
  });

  it('A → B → A 仍以世代拒絕舊完成事件', async () => {
    const pending = deferred<RegisterForEventResponse>();
    const entered = deferred<void>();
    registerMock('registerForEvent', async () => {
      entered.resolve();
      return pending.promise;
    });
    const harness = signupContext();
    const listener = vi.fn();
    const off = on('registration:created', listener);
    try {
      const first = registerForEvent({
        eventId: 'evt1',
        user: { uid: 'u1' },
        context: harness.context,
      });
      await entered.promise;
      harness.setAuth('u2');
      harness.setAuth('u1');
      const assertion = expect(first).rejects.toMatchObject({ originalCode: 'AUTH_CHANGED' });
      pending.resolve({ success: true });
      await assertion;
      expect(listener).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });
});

describe('cancelRegistration：時間守衛與不同操作', () => {
  it.each([
    [START_MS - 1, true],
    [START_MS, false],
    [START_MS + 1, false],
  ])('H1 A08 開始時間邊界 %s', async (now, allowed) => {
    registerMock('cancelRegistration', async () => ({ success: true }));
    const harness = cancelContext({ date: '2030/05/09 15:00~17:00' });
    const operation = cancelRegistration({
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind: 'self',
      now,
      context: harness.context,
    });
    if (allowed) {
      await expect(operation).resolves.toMatchObject({ success: true });
    } else {
      await expect(operation).rejects.toMatchObject({
        originalCode: 'EVENT_STARTED',
        message: '活動已於開始時間結束，無法取消報名',
      });
    }
    expect(recorded('cancelRegistration')).toHaveLength(allowed ? 1 : 0);
  });

  it.each(['ended', 'cancelled'])('A08 %s 狀態即使日期在未來仍拒絕', async (status) => {
    await expect(cancelRegistration({
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind: 'self',
      now: FIXED_MS,
      context: cancelContext({ status, date: '2030/05/09 15:00~17:00' }).context,
    })).rejects.toMatchObject({
      originalCode: 'EVENT_ENDED',
      message: '活動已開始，無法再取消報名',
    });
    expect(recorded('cancelRegistration')).toHaveLength(0);
  });

  it('A10 不擅自加入 A08 時間限制', async () => {
    registerMock('cancelRegistration', async () => ({ success: true }));
    await expect(cancelRegistration({
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind: 'companion',
      context: cancelContext({ status: 'ended', date: '2000/01/01 00:00' }).context,
    })).resolves.toMatchObject({ success: true });
    expect(recorded('cancelRegistration')).toHaveLength(1);
  });

  it('相同取消內容共用 Promise，不同目標分別送出且 requestId 不碰撞', async () => {
    const pending = deferred<CancelRegistrationResponse>();
    registerMock('cancelRegistration', () => pending.promise);
    const harness = cancelContext();
    const base = {
      eventId: 'evt1',
      userId: 'u1',
      kind: 'companion' as const,
      now: FIXED_MS,
      context: harness.context,
    };
    const first = cancelRegistration({ ...base, registrationIds: ['r1'] });
    const duplicate = cancelRegistration({ ...base, registrationIds: ['r1'] });
    const second = cancelRegistration({ ...base, registrationIds: ['r2'] });
    expect(first).toBe(duplicate);
    expect(first).not.toBe(second);
    pending.resolve({ success: true });
    await Promise.all([first, second]);

    const calls = recorded('cancelRegistration');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.request).toMatchObject({ registrationIds: ['r1'] });
    expect(calls[1]?.request).toMatchObject({ registrationIds: ['r2'] });
    const firstRequest = calls[0]?.request as { requestId?: string } | undefined;
    const secondRequest = calls[1]?.request as { requestId?: string } | undefined;
    expect(firstRequest?.requestId).toMatch(/^cancel_companion_u1_evt1_\d+$/);
    expect(secondRequest?.requestId).not.toBe(firstRequest?.requestId);
  });

  it('取消失敗清除進行中狀態並保留錯誤映射', async () => {
    let attempts = 0;
    registerMock('cancelRegistration', async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new CallableError('permission-denied', 'PERMISSION_DENIED', 'PERMISSION_DENIED');
      }
      return { success: true };
    });
    const input = {
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind: 'self' as const,
      context: cancelContext().context,
    };
    await expect(cancelRegistration(input)).rejects.toMatchObject({
      name: 'SignupError',
      originalCode: 'PERMISSION_DENIED',
      messageKey: 'event.cancel.error.permissionDenied',
    });
    await expect(cancelRegistration(input)).resolves.toMatchObject({ success: true });
    expect(recorded('cancelRegistration')).toHaveLength(2);
  });

  it('取消完成時身分已改變，不發布 cancelled', async () => {
    const pending = deferred<CancelRegistrationResponse>();
    const entered = deferred<void>();
    registerMock('cancelRegistration', async () => {
      entered.resolve();
      return pending.promise;
    });
    const harness = cancelContext();
    const listener = vi.fn();
    const off = on('registration:cancelled', listener);
    try {
      const operation = cancelRegistration({
        eventId: 'evt1',
        userId: 'u1',
        registrationIds: ['r1'],
        kind: 'self',
        context: harness.context,
      });
      await entered.promise;
      harness.setAuth('u2');
      const assertion = expect(operation).rejects.toMatchObject({ originalCode: 'AUTH_CHANGED' });
      pending.resolve({ success: true });
      await assertion;
      expect(listener).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it('成功取消發布事件，deduplicated 不重複發布', async () => {
    let attempts = 0;
    registerMock('cancelRegistration', async () => {
      attempts += 1;
      return { success: true, deduplicated: attempts > 1 };
    });
    const listener = vi.fn();
    const off = on('registration:cancelled', listener);
    const input = {
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind: 'self' as const,
      context: cancelContext().context,
    };
    try {
      await cancelRegistration(input);
      await cancelRegistration(input);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ eventId: 'evt1', userId: 'u1' });
    } finally {
      off();
    }
  });
});

describe('T-086a：快照重用、逾時與 requestId', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function selfInput(
    harness: ReturnType<typeof signupContext>,
    extra: Partial<Parameters<typeof registerForEvent>[0]> = {},
  ): Parameters<typeof registerForEvent>[0] {
    return { eventId: 'evtA', user: { uid: 'uidA' }, context: harness.context, ...extra };
  }

  it('對照：未傳快照時頁面 1 次＋函式內 1 次＝讀 2 次', async () => {
    registerMock('registerForEvent', async () => ({ success: true }));
    const harness = signupContext({}, 'uidA');
    await harness.context.load('evtA', [{ type: 'self' }]);
    await registerForEvent(selfInput(harness));
    expect(harness.load).toHaveBeenCalledTimes(2);
    expect(recorded('registerForEvent')).toHaveLength(1);
  });

  it('同組快照在 3000ms 內：函式內 0 次（前 2 後 1）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_MS);
    registerMock('registerForEvent', async () => ({ success: true }));
    const harness = signupContext({}, 'uidA');
    const pageSnapshot = await harness.context.load('evtA', [{ type: 'self' }]);
    vi.setSystemTime(FIXED_MS + 3000);
    await registerForEvent(selfInput(harness, {
      snapshot: pageSnapshot,
      snapshotLoadedAt: FIXED_MS,
      snapshotGeneration: 1,
      snapshotParticipants: [{ type: 'self' }],
    }));
    expect(harness.load).toHaveBeenCalledTimes(1);
    expect(recorded('registerForEvent')).toHaveLength(1);
  });

  it.each([
    ['超過 3000ms', { snapshotLoadedAt: FIXED_MS - 3001 }],
    ['讀取時間在未來', { snapshotLoadedAt: FIXED_MS + 1 }],
    ['uid 不同', { snapshot: makeSnapshot('evtA', 'uidB') }],
    ['活動不同', { snapshot: makeSnapshot('targetA', 'uidA') }],
    ['世代不同', { snapshotGeneration: 2 }],
    ['participants 不同', {
      snapshotParticipants: [{ type: 'companion', companionId: 'c1', companionName: 'Bob' }],
    }],
    ['缺 participants', { snapshotParticipants: undefined }],
    ['缺讀取時間', { snapshotLoadedAt: undefined }],
  ] as const)('%s → 照舊重讀', async (_name, overrides) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_MS);
    registerMock('registerForEvent', async () => ({ success: true }));
    const harness = signupContext({}, 'uidA');
    await registerForEvent(selfInput(harness, {
      snapshot: makeSnapshot('evtA', 'uidA'),
      snapshotLoadedAt: FIXED_MS,
      snapshotGeneration: 1,
      snapshotParticipants: [{ type: 'self' }],
      ...overrides,
    }));
    expect(harness.load).toHaveBeenCalledTimes(1);
    expect(harness.load).toHaveBeenCalledWith('evtA', [{ type: 'self' }]);
    expect(recorded('registerForEvent')).toHaveLength(1);
  });

  it('早鳥報名即使快照新鮮也重讀', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_MS);
    registerMock('registerForEvent', async () => ({ success: true }));
    const harness = signupContext({}, 'uidA');
    await registerForEvent(selfInput(harness, {
      snapshot: makeSnapshot('evtA', 'uidA'),
      snapshotLoadedAt: FIXED_MS,
      snapshotGeneration: 1,
      snapshotParticipants: [{ type: 'self' }],
      earlyBirdAccepted: true,
      earlyBirdExpectedCost: 10,
    })).catch(() => undefined);
    expect(harness.load).toHaveBeenCalledTimes(1);
  });

  it('重用的快照仍走前置檢查：活動已結束不送 Callable', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_MS);
    const harness = signupContext({}, 'uidA');
    await expect(registerForEvent(selfInput(harness, {
      snapshot: { ...makeSnapshot('evtA', 'uidA'), event: { id: 'evtA', status: 'ended' } },
      snapshotLoadedAt: FIXED_MS,
      snapshotGeneration: 1,
      snapshotParticipants: [{ type: 'self' }],
    }))).rejects.toMatchObject({ originalCode: 'event_ended' });
    expect(harness.load).not.toHaveBeenCalled();
    expect(recorded('registerForEvent')).toHaveLength(0);
  });

  it('重用的快照仍以送出當下時間檢查開始時間', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START_MS);
    const harness = signupContext({}, 'uidA');
    await expect(registerForEvent(selfInput(harness, {
      snapshot: {
        ...makeSnapshot('evtA', 'uidA'),
        event: { id: 'evtA', status: 'open', date: '2030/05/09 15:00~17:00' },
      },
      snapshotLoadedAt: START_MS - 10,
      snapshotGeneration: 1,
      snapshotParticipants: [{ type: 'self' }],
    }))).rejects.toMatchObject({ originalCode: 'event_started' });
    expect(harness.load).not.toHaveBeenCalled();
    expect(recorded('registerForEvent')).toHaveLength(0);
  });

  it('連續兩次報名 requestId 不同；失敗後再按也換新 requestId', async () => {
    const requestIds: string[] = [];
    let attempts = 0;
    registerMock('registerForEvent', async (request) => {
      requestIds.push(String(request.requestId));
      attempts += 1;
      if (attempts === 2) throw new CallableError('unavailable', 'temporary', '');
      return { success: true };
    });
    const harness = signupContext({}, 'uidA');
    const input = selfInput(harness, { now: FIXED_MS });
    await registerForEvent(input);
    await expect(registerForEvent(input)).rejects.toBeInstanceOf(SignupError);
    await registerForEvent(input);
    expect(requestIds).toHaveLength(3);
    expect(new Set(requestIds).size).toBe(3);
  });

  it('連續兩次取消 requestId 不同', async () => {
    const requestIds: string[] = [];
    registerMock('cancelRegistration', async (request) => {
      requestIds.push(String(request.requestId));
      return { success: true };
    });
    const harness = cancelContext({}, 'uidA');
    const input = {
      eventId: 'evtA',
      userId: 'uidA',
      registrationIds: ['targetA'],
      kind: 'self' as const,
      now: FIXED_MS,
      randomSuffix: 'abc',
      context: harness.context,
    };
    await cancelRegistration(input);
    await cancelRegistration(input);
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).not.toBe(requestIds[1]);
  });

  async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  }

  it('報名 Callable 超過 15000ms：拒絕 CALLABLE_TIMEOUT、不重送、計時器清掉', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = deferred<RegisterForEventResponse>();
    let calls = 0;
    registerMock('registerForEvent', () => {
      calls += 1;
      return pending.promise;
    });
    const harness = signupContext({}, 'uidA');
    const operation = registerForEvent(selfInput(harness));
    const assertion = expect(operation).rejects.toMatchObject({
      name: 'SignupError',
      code: 'deadline-exceeded',
      originalCode: 'CALLABLE_TIMEOUT',
      messageKey: 'event.signup.error.unknown',
      message: '連線逾時，請檢查網路後重新整理再試',
    });
    await flushMicrotasks();
    expect(calls).toBe(1);
    // Callable 15 秒逾時之外，送出標記還有一顆 90 秒上限計時器。
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    pending.resolve({ success: true });
    await flushMicrotasks();
    expect(calls).toBe(1);
    expect(recorded('registerForEvent')).toHaveLength(1);
  });

  it('取消 Callable 超過 15000ms：拒絕 CALLABLE_TIMEOUT、不重送、計時器清掉', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = deferred<CancelRegistrationResponse>();
    let calls = 0;
    registerMock('cancelRegistration', () => {
      calls += 1;
      return pending.promise;
    });
    const operation = cancelRegistration({
      eventId: 'evtA',
      userId: 'uidA',
      registrationIds: ['targetA'],
      kind: 'self',
      context: cancelContext({}, 'uidA').context,
    });
    const assertion = expect(operation).rejects.toMatchObject({
      code: 'deadline-exceeded',
      originalCode: 'CALLABLE_TIMEOUT',
      messageKey: 'event.cancel.error.unknown',
    });
    await flushMicrotasks();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    pending.resolve({ success: true });
    await flushMicrotasks();
    expect(calls).toBe(1);
  });

  it('Callable 在逾時前完成：計時器清掉', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    registerMock('registerForEvent', async () => ({ success: true }));
    registerMock('cancelRegistration', async () => ({ success: true }));
    await registerForEvent(selfInput(signupContext({}, 'uidA')));
    await cancelRegistration({
      eventId: 'evtA',
      userId: 'uidA',
      registrationIds: ['targetA'],
      kind: 'self',
      context: cancelContext({}, 'uidA').context,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('逾時後再按：重新讀取並換新 requestId', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const requestIds: string[] = [];
    const never = new Promise<RegisterForEventResponse>(() => {});
    registerMock('registerForEvent', (request) => {
      requestIds.push(String(request.requestId));
      return requestIds.length === 1 ? never : { success: true };
    });
    const harness = signupContext({}, 'uidA');
    const first = registerForEvent(selfInput(harness));
    const assertion = expect(first).rejects.toMatchObject({ originalCode: 'CALLABLE_TIMEOUT' });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    await registerForEvent(selfInput(harness));
    expect(harness.load).toHaveBeenCalledTimes(2);
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).not.toBe(requestIds[1]);
  });
});

// T-087c：T-087a 伺服器新檢查的 details 代碼（message＝中文、details＝代碼）。
// 修正前這些代碼不在對照表，會落到通用失敗 key。
describe('T-087c：伺服器新錯誤代碼對照', () => {
  const REGISTER_CASES = [
    ['EVENT_UNAVAILABLE', '此活動目前無法報名', 'eventUnavailable'],
    ['AGE_RESTRICTED', '此活動限 18 歲以上報名', 'ageRestricted'],
    ['BIRTHDAY_REQUIRED', '請先補齊生日資料後再報名', 'birthdayRequired'],
    ['REQUEST_ID_CONFLICT', '請重新整理後再試', 'requestIdConflict'],
    ['PARTICIPANT_NOT_ALLOWED', '無權限執行此操作', 'participantNotAllowed'],
  ] as const;

  it.each(REGISTER_CASES)('報名 %s → 專屬 key', async (code, message, key) => {
    registerMock('registerForEvent', async () => {
      throw new CallableError('failed-precondition', message, code);
    });
    await expect(registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1' },
      context: signupContext().context,
    })).rejects.toMatchObject({
      name: 'SignupError',
      originalCode: code,
      messageKey: `event.signup.error.${key}`,
      message,
    });
  });

  it.each(REGISTER_CASES)('只報同行者 %s → 專屬 key', async (code, message, key) => {
    registerMock('registerForEvent', async () => {
      throw new CallableError('failed-precondition', message, code);
    });
    await expect(registerSelection({
      eventId: 'evt1',
      user: { uid: 'u1' },
      participants: [{ type: 'companion', companionId: 'c1', companionName: 'Bob' }],
    }, false)).rejects.toMatchObject({
      name: 'SignupError',
      originalCode: code,
      messageKey: `event.signup.error.${key}`,
    });
  });

  const CANCEL_CASES = [
    ['EVENT_ENDED', '活動已開始，無法再取消報名', 'eventEnded'],
    ['EVENT_STARTED', '活動已於開始時間結束，無法取消報名', 'eventStarted'],
    ['REQUEST_ID_CONFLICT', '請重新整理後再試', 'requestIdConflict'],
  ] as const;

  // 本機快照仍未開始（伺服器時間或最新狀態先到），由伺服器擋下。
  it.each([
    ...CANCEL_CASES.map(([code, message, key]) => ['self', code, message, key] as const),
    ...CANCEL_CASES.map(([code, message, key]) => ['companion', code, message, key] as const),
  ])('取消（%s）%s → 專屬 key 並保留伺服器文案', async (kind, code, message, key) => {
    registerMock('cancelRegistration', async () => {
      throw new CallableError('failed-precondition', message, code);
    });
    await expect(cancelRegistration({
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind,
      context: cancelContext().context,
    })).rejects.toMatchObject({
      name: 'SignupError',
      originalCode: code,
      messageKey: `event.cancel.error.${key}`,
      message,
    });
    expect(recorded('cancelRegistration')).toHaveLength(1);
  });

  it('同行者勾選取消（companion_toggle）EVENT_STARTED → 專屬 key', async () => {
    registerMock('cancelRegistration', async () => {
      throw new CallableError('failed-precondition', '活動已於開始時間結束，無法取消報名', 'EVENT_STARTED');
    });
    await expect(cancelRegistration({
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind: 'companion',
      companionToggle: true,
      context: cancelContext().context,
    })).rejects.toMatchObject({
      originalCode: 'EVENT_STARTED',
      messageKey: 'event.cancel.error.eventStarted',
    });
    expect(recorded('cancelRegistration')[0]?.request).toMatchObject({ reason: 'companion_toggle' });
  });
});

// 第 6 項若解讀為 A10 同樣要求取消時間守衛則不成立：附件 A10 的 _confirmCompanionCancelUnlocked 未檢查活動狀態或開始時間，故只為 A08 本人取消補上該守衛。

describe('O5：寫入成功後失效登入者全歷史快取', () => {
  async function primeCache() {
    invalidateViewerRegistrations();
    const loader = vi.fn(async (): Promise<RegistrationDoc[]> => []);
    await readViewerRegistrationsCached('u1', loader);
    await readViewerRegistrationsCached('u1', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    return loader;
  }

  it('報名成功後下一次讀取重新呼叫 loader', async () => {
    registerMock('registerForEvent', async () => ({ success: true }));
    const loader = await primeCache();
    await registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      context: signupContext().context,
    });
    await readViewerRegistrationsCached('u1', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('只選同行者的報名成功也失效', async () => {
    registerMock('registerForEvent', async () => ({ success: true }));
    const loader = await primeCache();
    await registerSelection({
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      participants: [{ type: 'companion', companionId: 'c1', companionName: 'Bob' }],
      context: signupContext({ registrations: [activeSelf] }).context,
    }, false);
    await readViewerRegistrationsCached('u1', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('取消成功後下一次讀取重新呼叫 loader（deduplicated 也失效）', async () => {
    registerMock('cancelRegistration', async () => ({ success: true, deduplicated: true }));
    const loader = await primeCache();
    await cancelRegistration({
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind: 'self',
      context: cancelContext().context,
    });
    await readViewerRegistrationsCached('u1', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('報名失敗不失效（沒有寫入）', async () => {
    registerMock('registerForEvent', async () => {
      throw new CallableError('failed-precondition', 'REG_NOT_OPEN', 'REG_NOT_OPEN');
    });
    const loader = await primeCache();
    await expect(registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      context: signupContext().context,
    })).rejects.toBeInstanceOf(SignupError);
    await readViewerRegistrationsCached('u1', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
