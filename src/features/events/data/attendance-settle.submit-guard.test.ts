/**
 * T6e：出席結算進行中要擋住強制更新，成功與 Callable 失敗都要釋放。
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

vi.mock('@/data/op-log', () => ({ writeOpLog: mockWriteOpLog }));

vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
}));

import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';
import type { ConfirmedRosterPerson } from './attendance-roster-model';
import { settleAttendance, type SettleAttendanceInput } from './attendance-settle';

function person(uid: string): ConfirmedRosterPerson {
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
  };
}

function input(): SettleAttendanceInput {
  return {
    event: { id: 'ce_100', title: '週日友誼賽', date: '2026/10/25 09:00~11:00' },
    people: [person('U123')],
    getSelection: () => ({ checkin: true, checkout: false, note: '' }),
    operatorUid: 'admin_uid',
    operatorName: '管理員小明',
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

describe('T6e settleAttendance 送出中', () => {
  it('confirmEventAttendance 尚未完成時為 true，成功後釋放', async () => {
    const pending = deferred<{ success: true; added: number; removed: number; expTargets: string[] }>();
    mockCallFn.mockReturnValue(pending.promise);
    const operation = settleAttendance(input());
    expect(mockCallFn).toHaveBeenCalledWith('confirmEventAttendance', expect.objectContaining({
      eventId: 'ce_100',
    }));
    expectHold(true);
    pending.resolve({ success: true, added: 1, removed: 0, expTargets: [] });
    await expect(operation).resolves.toMatchObject({ ok: true, added: 1, removed: 0 });
    expectHold(false);
  });

  it('Callable 丟錯後釋放（結算回 ok:false）', async () => {
    mockCallFn.mockRejectedValue(new Error('callable 失敗'));
    await expect(settleAttendance(input())).resolves.toMatchObject({ ok: false, stage: 'confirm' });
    expectHold(false);
  });
});
