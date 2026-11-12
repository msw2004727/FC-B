/** 刪除活動呼叫進行中要擋住強制更新，成功與失敗都釋放。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventDoc } from './types';

const mocks = vi.hoisted(() => ({ callFn: vi.fn() }));
vi.mock('@/data/callables', () => ({ callFn: mocks.callFn }));

import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';
import { deleteEventViaCallable } from './event-delete';

const event = { id: 'ce_pub', docId: 'doc_1' } as unknown as EventDoc;

beforeEach(() => {
  mocks.callFn.mockReset();
  _resetSubmitGuardForTest();
});

describe('deleteEventViaCallable 送出中', () => {
  it('呼叫進行中為 true，成功後釋放', async () => {
    let resolve!: (value: unknown) => void;
    mocks.callFn.mockReturnValue(new Promise((r) => { resolve = r; }));
    const operation = deleteEventViaCallable(event);
    await vi.waitFor(() => expect(mocks.callFn).toHaveBeenCalledTimes(1));
    expect(isSubmitting()).toBe(true);
    resolve({ ok: true, alreadyDeleted: false });
    await expect(operation).resolves.toEqual({ alreadyDeleted: false });
    expect(isSubmitting()).toBe(false);
  });

  it('呼叫丟錯後也釋放', async () => {
    mocks.callFn.mockRejectedValue(new Error('boom'));
    await expect(deleteEventViaCallable(event)).rejects.toThrow('boom');
    expect(isSubmitting()).toBe(false);
  });
});
