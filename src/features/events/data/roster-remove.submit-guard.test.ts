/**
 * T6c：管理員移除報名進行中要擋住強制更新，成功與 Callable 失敗都要釋放。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCallFn, mockWriteOpLog } = vi.hoisted(() => ({
  mockCallFn: vi.fn(),
  mockWriteOpLog: vi.fn(),
}));

vi.mock('@/data/callables', async () => {
  const actual = await vi.importActual<typeof import('@/data/callables')>('@/data/callables');
  return { ...actual, callFn: mockCallFn };
});

vi.mock('@/data/op-log', () => ({
  writeOpLog: mockWriteOpLog,
}));

import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';
import { managerRemoveRegistration } from './roster-remove';
import type { OperateContext } from './operate-permissions';
import type { RosterRegistrationInput } from './attendance-roster-model';

const adminContext: OperateContext = {
  uid: 'u_admin',
  role: 'admin',
  rolePermissions: ['event.edit_all'],
  userGrants: null,
  capabilities: [],
  customRoles: [],
};

const sampleEvent = {
  id: 'ce_100',
  title: '週日友誼賽',
  creatorUid: 'u_owner',
  delegateUids: ['u_delegate'],
  privateEvent: false,
};

const sampleRegistrations: RosterRegistrationInput[] = [
  {
    _docId: 'reg_self_1',
    userId: 'u_player',
    userName: '王大明',
    status: 'confirmed',
    participantType: 'self',
  },
];

function input() {
  return {
    eventId: 'ce_100',
    event: sampleEvent,
    registration: { uid: 'u_player', name: '王大明', isCompanion: false },
    registrations: sampleRegistrations,
    operatorUid: 'u_admin',
    operatorName: '總管A',
    context: adminContext,
    now: 1700000000123,
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

function expectHold(held: boolean): void {
  expect(isSubmitting()).toBe(held);
  if (held) expect(document.documentElement.getAttribute('data-submitting')).toBe('true');
  else expect(document.documentElement.hasAttribute('data-submitting')).toBe(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteOpLog.mockResolvedValue(undefined);
  _resetSubmitGuardForTest();
  document.documentElement.removeAttribute('data-submitting');
});

afterEach(() => {
  _resetSubmitGuardForTest();
  document.documentElement.removeAttribute('data-submitting');
});

describe('T6c managerRemoveRegistration 送出中', () => {
  it('cancelRegistration 尚未完成時為 true，成功後釋放', async () => {
    const pending = deferred<{ success: true }>();
    mockCallFn.mockReturnValue(pending.promise);
    const operation = managerRemoveRegistration(input());
    expect(mockCallFn).toHaveBeenCalledWith('cancelRegistration', expect.objectContaining({
      eventId: 'ce_100',
      reason: 'manager_remove',
    }));
    expectHold(true);
    pending.resolve({ success: true });
    await expect(operation).resolves.toMatchObject({ ok: true, regDocId: 'reg_self_1' });
    expectHold(false);
  });

  it('Callable 丟錯後仍釋放（回 ok:false，不把錯誤丟出）', async () => {
    mockCallFn.mockRejectedValue(new Error('callable 失敗'));
    await expect(managerRemoveRegistration(input())).resolves.toMatchObject({
      ok: false,
      reason: 'callable_failed',
    });
    expectHold(false);
  });
});
