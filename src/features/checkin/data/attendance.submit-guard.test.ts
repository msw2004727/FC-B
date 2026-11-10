/**
 * T6f：掃碼批次寫入與軟刪除進行中要擋住強制更新，成功與丟錯都要釋放。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const set = vi.fn();
  const commit = vi.fn(() => Promise.resolve());
  const updateDoc = vi.fn(() => Promise.resolve());
  const state = { seq: 0 };
  return {
    set,
    commit,
    updateDoc,
    state,
    writeBatch: vi.fn(() => ({ set, commit })),
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    doc: vi.fn((first: unknown, ...rest: unknown[]) => {
      state.seq += 1;
      if (rest.length > 0) return { id: String(rest[rest.length - 1]), path: rest.join('/') };
      const coll = first as { path: string };
      return { id: `auto_${state.seq}`, path: `${coll.path}/auto_${state.seq}` };
    }),
    serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  };
});

vi.mock('firebase/firestore', () => ({
  writeBatch: mocks.writeBatch,
  collection: mocks.collection,
  doc: mocks.doc,
  updateDoc: mocks.updateDoc,
  serverTimestamp: mocks.serverTimestamp,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { __mockDb: true } })),
}));

import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';
import { commitAttendanceBatch, removeAttendance, type AttendanceWritePayload } from './attendance';

function record(): AttendanceWritePayload {
  return {
    id: 'att_in',
    eventId: 'evtA',
    uid: 'uidA',
    userName: 'targetA',
    type: 'checkin',
    time: '2026/10/31 10:00',
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
  mocks.state.seq = 0;
  vi.clearAllMocks();
  mocks.commit.mockReset();
  mocks.commit.mockResolvedValue(undefined);
  mocks.updateDoc.mockReset();
  mocks.updateDoc.mockResolvedValue(undefined);
  _resetSubmitGuardForTest();
  document.documentElement.removeAttribute('data-submitting');
});

afterEach(() => {
  _resetSubmitGuardForTest();
  document.documentElement.removeAttribute('data-submitting');
});

describe('T6f commitAttendanceBatch／removeAttendance 送出中', () => {
  it('batch.commit 尚未完成時為 true，成功後釋放', async () => {
    const pending = deferred<void>();
    mocks.commit.mockReturnValue(pending.promise);
    const operation = commitAttendanceBatch('evtDoc', [record()]);
    expectHold(true);
    await vi.waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    expectHold(true);
    pending.resolve();
    await expect(operation).resolves.toEqual(['auto_1']);
    expectHold(false);
  });

  it('batch.commit 丟錯後釋放', async () => {
    mocks.commit.mockRejectedValue(new Error('batch 失敗'));
    await expect(commitAttendanceBatch('evtDoc', [record()])).rejects.toThrow(/batch 失敗/);
    expectHold(false);
  });

  it('updateDoc 尚未完成時為 true，成功與丟錯後都釋放', async () => {
    const pending = deferred<void>();
    mocks.updateDoc.mockReturnValue(pending.promise);
    const operation = removeAttendance('evtDoc', 'rec_1', 'op_1');
    expectHold(true);
    await vi.waitFor(() => expect(mocks.updateDoc).toHaveBeenCalledTimes(1));
    expectHold(true);
    pending.resolve();
    await expect(operation).resolves.toBeUndefined();
    expectHold(false);

    mocks.updateDoc.mockRejectedValueOnce(new Error('刪除失敗'));
    await expect(removeAttendance('evtDoc', 'rec_1', 'op_1')).rejects.toThrow(/刪除失敗/);
    expectHold(false);
  });
});
