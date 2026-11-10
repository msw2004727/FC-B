/**
 * T6d：出席勾選 300ms、備註 1000ms、寫入中都算送出中；flush 完成與卸載後釋放。
 */

import { act, cleanup, renderHook } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWriteAttendanceOps } = vi.hoisted(() => ({
  mockWriteAttendanceOps: vi.fn(),
}));

vi.mock('../data/attendance-edit', async () => {
  const actual = await vi.importActual<typeof import('../data/attendance-edit')>(
    '../data/attendance-edit',
  );
  return { ...actual, writeAttendanceOps: mockWriteAttendanceOps };
});

import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';
import { buildConfirmedRoster, type RosterRegistrationInput } from '../data/attendance-roster-model';
import {
  CHECKBOX_DEBOUNCE_MS,
  NOTE_DEBOUNCE_MS,
  useAttendanceInstantSave,
} from './useAttendanceInstantSave';

const event = { id: 'ce_test_1', max: 10, current: 1 };
const regs: RosterRegistrationInput[] = [
  {
    _docId: 'reg_1',
    userId: 'u_1',
    userName: '王小明',
    status: 'confirmed',
    participantType: 'self',
  },
];

function person() {
  const found = buildConfirmedRoster(event, regs).people.find((item) => item.uid === 'u_1');
  if (!found) throw new Error('roster 缺少 u_1');
  return found;
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

function renderSave() {
  return renderHook(() => useAttendanceInstantSave({
    event,
    eventDocId: 'event_doc_1',
    publicEventId: 'ce_test_1',
    operatorUid: 'u_admin',
    registrations: regs,
    attendanceRecords: [],
    onReloadAttendance: vi.fn(async () => []),
    onSaveFailed: vi.fn(),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  mockWriteAttendanceOps.mockReset();
  mockWriteAttendanceOps.mockResolvedValue({ addedDocIds: ['d1'], removedDocIds: [] });
  _resetSubmitGuardForTest();
  document.documentElement.removeAttribute('data-submitting');
});

afterEach(() => {
  cleanup();
  _resetSubmitGuardForTest();
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-submitting');
});

describe('T6d useAttendanceLeaveGuard 送出中', () => {
  it('勾選後 300ms 等待期間為 true，尚未寫入', async () => {
    const view = renderSave();
    act(() => {
      view.result.current.onToggleCheckbox(person(), 'checkin', true);
    });
    expectHold(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS - 1);
    });
    expect(mockWriteAttendanceOps).not.toHaveBeenCalled();
    expectHold(true);
  });

  it('備註 1000ms 等待期間為 true，尚未寫入', async () => {
    const view = renderSave();
    act(() => {
      view.result.current.onChangeNote(person(), '晚到');
    });
    expectHold(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTE_DEBOUNCE_MS - 1);
    });
    expect(mockWriteAttendanceOps).not.toHaveBeenCalled();
    expectHold(true);
  });

  it('寫入中為 true，成功後與丟錯後都釋放', async () => {
    const pending = deferred<{ addedDocIds: string[]; removedDocIds: string[] }>();
    mockWriteAttendanceOps.mockReturnValue(pending.promise);
    const view = renderSave();
    act(() => {
      view.result.current.onToggleCheckbox(person(), 'checkin', true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    expectHold(true);
    pending.resolve({ addedDocIds: ['d1'], removedDocIds: [] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expectHold(false);

    const failed = deferred<never>();
    mockWriteAttendanceOps.mockReturnValue(failed.promise);
    act(() => {
      view.result.current.onToggleCheckbox(person(), 'checkin', false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expectHold(true);
    failed.reject(new Error('寫入失敗'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expectHold(false);
  });

  it('flush 完成後為 false', async () => {
    const pending = deferred<{ addedDocIds: string[]; removedDocIds: string[] }>();
    mockWriteAttendanceOps.mockReturnValue(pending.promise);
    const view = renderSave();
    act(() => {
      view.result.current.onToggleCheckbox(person(), 'checkin', true);
    });
    expectHold(true);
    let flush: Promise<void> = Promise.resolve();
    act(() => {
      flush = view.result.current.flushInstantSaves();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    expectHold(true);
    pending.resolve({ addedDocIds: ['d1'], removedDocIds: [] });
    await act(async () => {
      await flush;
    });
    expectHold(false);
  });

  it('元件卸載後釋放', () => {
    const view = renderSave();
    act(() => {
      view.result.current.onToggleCheckbox(person(), 'checkin', true);
    });
    expectHold(true);
    view.unmount();
    expectHold(false);
  });
});
