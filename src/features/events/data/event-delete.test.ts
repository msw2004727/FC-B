import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventDoc } from './types';

const mocks = vi.hoisted(() => ({ callFn: vi.fn() }));
vi.mock('@/data/callables', () => ({ callFn: mocks.callFn }));

import {
  DELETE_EVENT_MESSAGES as M,
  deleteEventRequestId,
  deleteEventViaCallable,
  getDeleteEventErrorMessage,
} from './event-delete';

function ev(over: Record<string, unknown>): EventDoc {
  return over as unknown as EventDoc;
}

describe('deleteEventViaCallable', () => {
  beforeEach(() => mocks.callFn.mockReset());

  it('傳公開 event.id（不是文件 ID）', async () => {
    mocks.callFn.mockResolvedValue({ ok: true, alreadyDeleted: false });
    expect(await deleteEventViaCallable(ev({ id: 'ce_pub', _docId: 'rand_doc' })))
      .toEqual({ alreadyDeleted: false });
    expect(mocks.callFn).toHaveBeenCalledWith('deleteEvent', { eventId: 'ce_pub' });
  });

  it('alreadyDeleted 照樣回成功', async () => {
    mocks.callFn.mockResolvedValue({ ok: true, alreadyDeleted: true });
    expect(await deleteEventViaCallable(ev({ id: 'e1' }))).toEqual({ alreadyDeleted: true });
  });

  it('沒有 id 時退回文件 ID；兩者皆無不呼叫', async () => {
    expect(deleteEventRequestId(ev({ _docId: 'd1' }))).toBe('d1');
    await expect(deleteEventViaCallable(ev({}))).rejects.toThrow('EVENT_ID_INVALID');
    expect(mocks.callFn).not.toHaveBeenCalled();
  });
});

describe('getDeleteEventErrorMessage：伺服器每個 reason 都有對應文案', () => {
  const cases: Array<[unknown, string]> = [
    [{ code: 'functions/unauthenticated', message: 'AUTH_REQUIRED' }, M.auth],
    [{ code: 'functions/invalid-argument', message: 'EVENT_ID_INVALID' }, M.failRefresh],
    [{ code: 'functions/failed-precondition', message: 'EVENT_ID_AMBIGUOUS' }, M.legacyId],
    [{ code: 'functions/failed-precondition', message: 'EVENT_ID_MISMATCH' }, M.legacyId],
    [{ code: 'functions/permission-denied', message: 'EVENT_DELETE_DENIED' }, M.denied],
    [{ code: 'functions/failed-precondition', message: 'COURSE_LINKED_EVENT_MANAGED_BY_COURSE' }, M.courseLinked],
    [{ code: 'functions/failed-precondition', message: 'x', details: { code: 'COURSE_LINKED_EVENT_MANAGED_BY_COURSE' } }, M.courseLinked],
    [{ code: 'functions/aborted', message: 'EVENT_DELETE_RETRY' }, M.failRetry],
    [{ code: 'functions/internal', message: 'EVENT_DELETE_FAILED' }, M.failRetry],
    [{ code: 'functions/not-found', message: 'NOT_FOUND' }, M.failRetry],
    [new Error('network down: 10.0.0.1'), M.failRetry],
    [null, M.failRetry],
  ];
  for (const [error, expected] of cases) {
    it(`${JSON.stringify(error)} → ${expected}`, () => {
      expect(getDeleteEventErrorMessage(error)).toBe(expected);
    });
  }

  it('文案不含原始錯誤碼', () => {
    for (const text of Object.values(M)) expect(text).not.toMatch(/[A-Z_]{5,}/);
  });
});
