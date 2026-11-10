/**
 * T6a／T6b：報名與取消進行中要擋住強制更新，結束（成功、丟錯、去重）都要釋放。
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
  isEventVisibleToUser: vi.fn(() => true),
}));

import { clearMocks, registerMock } from '@/data/callables';
import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';
import {
  cancelRegistration,
  registerForEvent,
  SignupError,
  type CancelOperationContext,
  type OperationAuth,
  type SignupOperationContext,
  type SignupParticipant,
  type SignupSnapshot,
} from './signup';
import type { ViewerContext } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeViewer(uid = 'u1'): ViewerContext {
  return {
    uid,
    teamIds: new Set<string>(),
    hasPermission: () => false,
    roleLevel: 0,
  };
}

function makeSnapshot(eventId: string, uid = 'u1'): SignupSnapshot {
  return {
    event: { id: eventId, status: 'open' },
    viewer: makeViewer(uid),
    registrations: [],
    profileComplete: true,
    participantCheck: { ok: true },
    earlyBirdWindow: false,
    teamSignupAllowed: true,
    requiresTeamSelection: false,
  };
}

function signupContext() {
  const auth: OperationAuth = { uid: 'u1', generation: 1 };
  const load = vi.fn(async (eventId: string, _participants: readonly SignupParticipant[]) => (
    makeSnapshot(eventId)
  ));
  const context: SignupOperationContext = {
    getAuth: () => ({ ...auth }),
    load,
  };
  return { context };
}

function cancelContext() {
  const auth: OperationAuth = { uid: 'u1', generation: 1 };
  const load = vi.fn(async (eventId: string) => ({
    event: { id: eventId, status: 'open', date: '2030/05/09 15:00~17:00' },
  }));
  const context: CancelOperationContext = {
    getAuth: () => ({ ...auth }),
    load,
  };
  return { context };
}

function expectHold(held: boolean): void {
  expect(isSubmitting()).toBe(held);
  if (held) {
    expect(document.documentElement.getAttribute('data-submitting')).toBe('true');
  } else {
    expect(document.documentElement.hasAttribute('data-submitting')).toBe(false);
  }
}

beforeEach(() => {
  vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
  vi.clearAllMocks();
  clearMocks();
  _resetSubmitGuardForTest();
  document.documentElement.removeAttribute('data-submitting');
});

afterEach(() => {
  _resetSubmitGuardForTest();
  clearMocks();
  vi.unstubAllEnvs();
  document.documentElement.removeAttribute('data-submitting');
});

describe('T6a registerForEvent 送出中', () => {
  it('Callable 尚未完成時 isSubmitting 為 true，成功後釋放', async () => {
    const pending = deferred<{ success: true }>();
    registerMock('registerForEvent', () => pending.promise);
    const { context } = signupContext();
    const operation = registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      context,
    });
    expectHold(true);
    pending.resolve({ success: true });
    await expect(operation).resolves.toMatchObject({ success: true });
    expectHold(false);
  });

  it('Callable 丟錯後釋放', async () => {
    registerMock('registerForEvent', async () => {
      throw new Error('callable 失敗');
    });
    const { context } = signupContext();
    await expect(registerForEvent({
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      context,
    })).rejects.toBeInstanceOf(SignupError);
    expectHold(false);
  });

  it('同 key 去重第二次不另取，結束後計數歸零', async () => {
    const pending = deferred<{ success: true }>();
    registerMock('registerForEvent', () => pending.promise);
    const { context } = signupContext();
    const input = {
      eventId: 'evt1',
      user: { uid: 'u1', displayName: 'Alice' },
      context,
    };
    const first = registerForEvent(input);
    const second = registerForEvent(input);
    expect(second).toBe(first);
    expectHold(true);
    pending.resolve({ success: true });
    await first;
    await second;
    expectHold(false);
  });

  it('缺 context 的同步拒絕不取得標記', async () => {
    const operation = registerForEvent({ eventId: 'evt1', user: { uid: 'u1' } });
    expectHold(false);
    await expect(operation).rejects.toMatchObject({ originalCode: 'CONTEXT_REQUIRED' });
    expectHold(false);
  });
});

describe('T6b cancelRegistration 送出中', () => {
  it('Callable 尚未完成時 isSubmitting 為 true，成功後釋放', async () => {
    const pending = deferred<{ success: true }>();
    registerMock('cancelRegistration', () => pending.promise);
    const { context } = cancelContext();
    const operation = cancelRegistration({
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind: 'self',
      now: Date.parse('2030-05-09T14:00:00+08:00'),
      context,
    });
    expectHold(true);
    pending.resolve({ success: true });
    await expect(operation).resolves.toMatchObject({ success: true });
    expectHold(false);
  });

  it('Callable 丟錯後釋放', async () => {
    registerMock('cancelRegistration', async () => {
      throw new Error('callable 失敗');
    });
    const { context } = cancelContext();
    await expect(cancelRegistration({
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind: 'companion',
      context,
    })).rejects.toBeInstanceOf(SignupError);
    expectHold(false);
  });

  it('同 key 去重第二次不另取，結束後計數歸零', async () => {
    const pending = deferred<{ success: true }>();
    registerMock('cancelRegistration', () => pending.promise);
    const { context } = cancelContext();
    const input = {
      eventId: 'evt1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind: 'companion' as const,
      context,
    };
    const first = cancelRegistration(input);
    const second = cancelRegistration(input);
    expect(second).toBe(first);
    expectHold(true);
    pending.resolve({ success: true });
    await first;
    await second;
    expectHold(false);
  });
});
