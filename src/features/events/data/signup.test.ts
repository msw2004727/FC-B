/**
 * golden payload 與行為測試。
 *
 * - payload 期望值依 A07/A08/A09/A10 的組法**手算**，並在註解標明對應行號／變數。
 * - Callable 一律走 `@/data/callables` 的 mock 模式與 recorder。
 * - 直寫 fallback 不存在：透過 mock `firebase/firestore` 斷言「成功／失敗」皆未觸發任何寫入。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock firebase/firestore（若 signup.ts 誤引入直寫，測試會抓到）。
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

// visibility 由外部控制，專測 precheck 的各分支；可見性本身的細節不在本層職責。
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
  type RecordedCall,
} from '@/data/callables';
import type { RegisterForEventResponse } from '@/data/contract/callables';
import { on } from '@/core/events';

import {
  buildCancelPayload,
  buildRegisterPayload,
  cancelRegistration,
  precheckSignup,
  registerForEvent,
  SignupError,
  type BuildCancelPayloadInput,
  type BuildRegisterPayloadInput,
  type CancelRegistrationInput,
  type RegisterForEventInput,
} from './signup';
import type { EventDoc, RegistrationDoc, ViewerContext } from './types';
import { isEventVisibleToUser } from './visibility';

const mockedVisible = vi.mocked(isEventVisibleToUser);

const FIXED_MS = 1_700_000_000_000;

beforeEach(() => {
  vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
  clearMocks();
  startRecording();
  mockedVisible.mockReset();
  mockedVisible.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  stopRecording();
  clearMocks();
});

// ── golden payload（純函式） ──────────────────────────

describe('buildRegisterPayload（golden，對照 A 前端 cfPayload）', () => {
  it('本人報名：A07 line ~1966 signupRequestId / line ~1968 cfPayload', () => {
    const input: BuildRegisterPayloadInput = {
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      now: FIXED_MS,
      randomSuffix: 'abc',
    };
    const payload = buildRegisterPayload(input);

    // A07:
    //   signupRequestId = `${userId}_${id}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
    //   cfPayload = { eventId: id, participants: [{ userId, userName }], requestId: signupRequestId }
    //   userName = user.displayName || user.name || '用戶'
    expect(payload).toEqual({
      eventId: 'evt1',
      participants: [{ userId: 'u1', userName: 'Alice' }],
      requestId: `u1_evt1_${FIXED_MS}_abc`,
    });
  });

  it('本人 + 2 位同行者：A09 line ~365 requestId / cfParticipants（companion userId 同主報名人）', () => {
    const input: BuildRegisterPayloadInput = {
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      companions: [
        { companionId: 'c1', companionName: 'Bob' },
        { companionId: 'c2', companionName: 'Carol' },
      ],
      now: FIXED_MS,
      randomSuffix: 'xyz',
    };
    const payload = buildRegisterPayload(input);

    // A09:
    //   companionSignupRequestId = `${userId}_${eventId}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
    //   cfParticipants = participantList.map(p => { if self → { userId, userName }; else →
    //     { userId, userName, companionId, companionName } })  // userId 皆為主報名人 uid
    expect(payload).toEqual({
      eventId: 'evt1',
      participants: [
        { userId: 'u1', userName: 'Alice' },
        { userId: 'u1', userName: 'Alice', companionId: 'c1', companionName: 'Bob' },
        { userId: 'u1', userName: 'Alice', companionId: 'c2', companionName: 'Carol' },
      ],
      requestId: `u1_evt1_${FIXED_MS}_xyz`,
    });
  });

  it('候補：payload 與本人報名相同（候補為 server 判定，A 沒有候補專屬欄位）', () => {
    const payload = buildRegisterPayload({
      eventId: 'evt1',
      user: { uid: 'u1', name: 'Alice' },
      now: FIXED_MS,
      randomSuffix: 'abc',
    });
    // A07：確認前端 cfPayload 只有 eventId/participants/requestId（+earlyBird/teamKey/preferred…），
    // 沒有 `waitlisted` 等欄位——正取／候補由 CF 依餘額判定。
    expect(payload).toEqual({
      eventId: 'evt1',
      participants: [{ userId: 'u1', userName: 'Alice' }],
      requestId: `u1_evt1_${FIXED_MS}_abc`,
    });
  });

  it('早鳥（earlyBirdAccepted）與 teamReservation：payload 多帶對應欄位', () => {
    const payload = buildRegisterPayload({
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      earlyBirdAccepted: true,
      earlyBirdExpectedCost: 120,
      preferredTeamReservationTeamId: 'teamRsv1',
      now: FIXED_MS,
      randomSuffix: 'abc',
    });
    // A07：
    //   if (isEarlyBirdSignup) { cfPayload.earlyBirdAccepted = true; cfPayload.earlyBirdExpectedCost = earlyBirdCost; }
    //   if (selectedTeamReservationTeamId) cfPayload.preferredTeamReservationTeamId = selectedTeamReservationTeamId;
    expect(payload).toEqual({
      eventId: 'evt1',
      participants: [{ userId: 'u1', userName: 'Alice' }],
      requestId: `u1_evt1_${FIXED_MS}_abc`,
      earlyBirdAccepted: true,
      earlyBirdExpectedCost: 120,
      preferredTeamReservationTeamId: 'teamRsv1',
    });
  });
});

describe('buildCancelPayload（golden，對照 A 前端 cfPayload）', () => {
  it('取消本人：A08 line ~2618 cancelRequestId', () => {
    const input: BuildCancelPayloadInput = {
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['reg1'],
      kind: 'self',
      now: FIXED_MS,
      randomSuffix: 'ab',
    };
    const payload = buildCancelPayload(input);

    // A08:
    //   cancelRequestId = `cancel_${userId}_${id}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
    //   cfPayload = { eventId: id, registrationIds, reason: 'user_cancel', requestId: cancelRequestId }
    expect(payload).toEqual({
      eventId: 'evt1',
      registrationIds: ['reg1'],
      reason: 'user_cancel',
      requestId: `cancel_u1_evt1_${FIXED_MS}_ab`,
    });
  });

  it('取消同行者：A10 line ~621 cancel_companion requestId（無 random 尾碼）', () => {
    const input: BuildCancelPayloadInput = {
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['reg2', 'reg3'],
      kind: 'companion',
      now: FIXED_MS,
    };
    const payload = buildCancelPayload(input);

    // A10：
    //   companionCancelRequestId = `cancel_companion_${userId}_${eventId}_${Date.now()}`
    //   cfPayload = { eventId, registrationIds: checked, reason: 'user_cancel', requestId }
    expect(payload).toEqual({
      eventId: 'evt1',
      registrationIds: ['reg2', 'reg3'],
      reason: 'user_cancel',
      requestId: `cancel_companion_u1_evt1_${FIXED_MS}`,
    });
  });
});

// ── precheckSignup 每個拒絕分支 ────────────────────────

function makeViewer(overrides: Partial<ViewerContext> = {}): ViewerContext {
  return {
    uid: 'u1',
    teamIds: new Set<string>(),
    hasPermission: () => false,
    roleLevel: 0,
    ...overrides,
  };
}

const activeSelfReg: RegistrationDoc = {
  userId: 'u1',
  status: 'confirmed',
  participantType: 'self',
};

describe('precheckSignup', () => {
  it('可見性失敗（黑名單／私密）→ event.signup.unavailable（A07 line ~1802）', () => {
    mockedVisible.mockReturnValueOnce(false);
    const r = precheckSignup({ id: 'evt1', status: 'open' }, makeViewer(), [], new Date());
    expect(r).toEqual({
      ok: false,
      reason: 'event_unavailable',
      messageKey: 'event.signup.unavailable',
    });
  });

  it('status=ended → event.signup.ended（A07 line ~1810）', () => {
    const r = precheckSignup({ id: 'evt1', status: 'ended' }, makeViewer(), [], new Date());
    expect(r).toEqual({
      ok: false,
      reason: 'event_ended',
      messageKey: 'event.signup.ended',
    });
  });

  it('status=cancelled → event.signup.ended（A07 line ~1810）', () => {
    const r = precheckSignup({ id: 'evt1', status: 'cancelled' }, makeViewer(), [], new Date());
    expect(r).toEqual({
      ok: false,
      reason: 'event_ended',
      messageKey: 'event.signup.ended',
    });
  });

  it('status=upcoming → event.signup.notOpen（A07 line ~1820）', () => {
    const r = precheckSignup({ id: 'evt1', status: 'upcoming' }, makeViewer(), [], new Date());
    expect(r).toEqual({
      ok: false,
      reason: 'event_not_open',
      messageKey: 'event.signup.notOpen',
    });
  });

  it('teamOnly 且無隊伍交集 → event.signup.teamOnlyRestricted（A07 line ~1823）', () => {
    const event: EventDoc = {
      id: 'evt1',
      status: 'open',
      teamOnly: true,
      creatorTeamId: 'teamA',
    };
    const r = precheckSignup(event, makeViewer(), [], new Date());
    expect(r).toEqual({
      ok: false,
      reason: 'event_team_only_restricted',
      messageKey: 'event.signup.teamOnlyRestricted',
    });
  });

  it('teamOnly 且 viewer.teamIds 有交集 → ok', () => {
    const event: EventDoc = {
      id: 'evt1',
      status: 'open',
      teamOnly: true,
      creatorTeamId: 'teamA',
    };
    const viewer = makeViewer({ teamIds: new Set(['teamA']) });
    expect(precheckSignup(event, viewer, [], new Date())).toEqual({ ok: true });
  });

  it('已有 active self registration → event.signup.alreadyRegistered（A07 line ~1878）', () => {
    const r = precheckSignup(
      { id: 'evt1', status: 'open' },
      makeViewer(),
      [activeSelfReg],
      new Date(),
    );
    expect(r).toEqual({
      ok: false,
      reason: 'already_registered',
      messageKey: 'event.signup.alreadyRegistered',
    });
  });

  it('已取消的 self registration 不擋 → ok', () => {
    const cancelled: RegistrationDoc = {
      userId: 'u1',
      status: 'cancelled',
      participantType: 'self',
    };
    expect(
      precheckSignup({ id: 'evt1', status: 'open' }, makeViewer(), [cancelled], new Date()),
    ).toEqual({ ok: true });
  });
});

// ── registerForEvent / cancelRegistration 行為 ───────

function findCalls(calls: RecordedCall[], name: string): RecordedCall[] {
  return calls.filter((c) => c.name === name);
}

describe('registerForEvent', () => {
  it('只呼叫 Callable：成功 emit registration:created，無任何 Firestore 寫入', async () => {
    registerMock('registerForEvent', async () => ({
      success: true,
      registrations: [],
      confirmed: 1,
      waitlisted: 0,
    }));

    const listener = vi.fn();
    const off = on('registration:created', listener);
    try {
      const input: RegisterForEventInput = {
        eventId: 'evtA',
        user: { uid: 'u1', displayName: 'Alice' },
        now: FIXED_MS,
        randomSuffix: 'abc',
      };
      const res = await registerForEvent(input);
      expect(res.success).toBe(true);

      const calls = stopRecording();
      const registerCalls = findCalls(calls, 'registerForEvent');
      expect(registerCalls).toHaveLength(1);
      expect(registerCalls[0]?.request).toEqual({
        eventId: 'evtA',
        participants: [{ userId: 'u1', userName: 'Alice' }],
        requestId: `u1_evtA_${FIXED_MS}_abc`,
      });

      expect(listener).toHaveBeenCalledWith({ eventId: 'evtA', userId: 'u1' });

      // 直寫 fallback 必須不存在（L-35；p1-data-contract 總則 1）
      expect(firestore.setDoc).not.toHaveBeenCalled();
      expect(firestore.updateDoc).not.toHaveBeenCalled();
      expect(firestore.addDoc).not.toHaveBeenCalled();
      expect(firestore.deleteDoc).not.toHaveBeenCalled();
      expect(firestore.writeBatch).not.toHaveBeenCalled();
      expect(firestore.runTransaction).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it('Callable 失敗時轉成 SignupError，且不做任何 Firestore 寫入', async () => {
    registerMock('registerForEvent', async () => {
      // A07：errCode 從 `err.details || err.message` 取，這裡以 details 帶 `PROFILE_INCOMPLETE`
      throw new CallableError('failed-precondition', 'PROFILE_INCOMPLETE', 'PROFILE_INCOMPLETE');
    });

    await expect(
      registerForEvent({ eventId: 'evtB', user: { uid: 'u1' } }),
    ).rejects.toMatchObject({
      name: 'SignupError',
      code: 'failed-precondition',
      originalCode: 'PROFILE_INCOMPLETE',
      messageKey: 'event.signup.error.profileIncomplete',
    });

    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    expect(firestore.addDoc).not.toHaveBeenCalled();
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('錯誤物件是 SignupError instance', async () => {
    registerMock('registerForEvent', async () => {
      throw new CallableError('not-found', 'EVENT_NOT_FOUND', 'EVENT_NOT_FOUND');
    });
    try {
      await registerForEvent({ eventId: 'evtC', user: { uid: 'u1' } });
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(SignupError);
    }
  });

  it('防連點：同活動併發只發一次 Callable，第二次回傳同一 Promise；完成後可再發', async () => {
    let resolveInner: ((v: RegisterForEventResponse) => void) | null = null;
    const pending = new Promise<RegisterForEventResponse>((resolve) => {
      resolveInner = resolve;
    });
    registerMock('registerForEvent', () => pending);

    const p1 = registerForEvent({ eventId: 'evtD', user: { uid: 'u1' } });
    const p2 = registerForEvent({ eventId: 'evtD', user: { uid: 'u1' } });
    expect(p1).toBe(p2);

    if (!resolveInner) throw new Error('resolveInner 未初始化');
    (resolveInner as (v: RegisterForEventResponse) => void)({ success: true });
    await p1;

    const firstCalls = stopRecording();
    expect(findCalls(firstCalls, 'registerForEvent')).toHaveLength(1);

    // 完成後 Map 應清除（L-08），可再次發起
    startRecording();
    registerMock('registerForEvent', async () => ({ success: true }));
    await registerForEvent({ eventId: 'evtD', user: { uid: 'u1' } });
    const secondCalls = stopRecording();
    expect(findCalls(secondCalls, 'registerForEvent')).toHaveLength(1);
  });

  it('防連點：失敗後 Map 清除，重試能再發（L-08 / L-30）', async () => {
    let attempt = 0;
    registerMock('registerForEvent', async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new CallableError('failed-precondition', 'EVENT_ENDED', 'EVENT_ENDED');
      }
      return { success: true };
    });

    await expect(
      registerForEvent({ eventId: 'evtE', user: { uid: 'u1' } }),
    ).rejects.toBeInstanceOf(SignupError);

    const res = await registerForEvent({ eventId: 'evtE', user: { uid: 'u1' } });
    expect(res.success).toBe(true);
    const calls = stopRecording();
    expect(findCalls(calls, 'registerForEvent')).toHaveLength(2);
  });
});

describe('cancelRegistration', () => {
  it('只呼叫 Callable：成功 emit registration:cancelled，無任何 Firestore 寫入', async () => {
    registerMock('cancelRegistration', async () => ({
      success: true,
      cancelled: ['reg1'],
      alreadyCancelled: [],
      promoted: [],
    }));

    const listener = vi.fn();
    const off = on('registration:cancelled', listener);
    try {
      const input: CancelRegistrationInput = {
        eventId: 'evtF',
        userId: 'u1',
        registrationIds: ['reg1'],
        kind: 'self',
        now: FIXED_MS,
        randomSuffix: 'ab',
      };
      const res = await cancelRegistration(input);
      expect(res.success).toBe(true);

      const calls = stopRecording();
      const cancelCalls = findCalls(calls, 'cancelRegistration');
      expect(cancelCalls).toHaveLength(1);
      expect(cancelCalls[0]?.request).toEqual({
        eventId: 'evtF',
        registrationIds: ['reg1'],
        reason: 'user_cancel',
        requestId: `cancel_u1_evtF_${FIXED_MS}_ab`,
      });

      expect(listener).toHaveBeenCalledWith({ eventId: 'evtF', userId: 'u1' });

      expect(firestore.setDoc).not.toHaveBeenCalled();
      expect(firestore.updateDoc).not.toHaveBeenCalled();
      expect(firestore.addDoc).not.toHaveBeenCalled();
      expect(firestore.deleteDoc).not.toHaveBeenCalled();
      expect(firestore.runTransaction).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it('取消失敗轉 SignupError（A08 cfMsg 對應）', async () => {
    registerMock('cancelRegistration', async () => {
      throw new CallableError('permission-denied', 'PERMISSION_DENIED', 'PERMISSION_DENIED');
    });

    await expect(
      cancelRegistration({
        eventId: 'evtG',
        userId: 'u1',
        registrationIds: ['reg1'],
        kind: 'self',
      }),
    ).rejects.toMatchObject({
      name: 'SignupError',
      originalCode: 'PERMISSION_DENIED',
      messageKey: 'event.cancel.error.permissionDenied',
    });
  });
});
