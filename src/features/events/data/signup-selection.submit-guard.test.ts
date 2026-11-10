/**
 * T6a 補：只幫同行者報名（不含本人）走 registerSelection 自己的 callFn 路徑，也要算送出中。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCallFn } = vi.hoisted(() => ({ mockCallFn: vi.fn() }));

vi.mock('@/data/callables', async () => {
  const actual = await vi.importActual<typeof import('@/data/callables')>('@/data/callables');
  return { ...actual, callFn: mockCallFn };
});

import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';
import { registerSelection } from './signup-selection';
import type { RegisterForEventInput } from './signup';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function input(eventId: string): RegisterForEventInput {
  return {
    eventId,
    user: { uid: 'u_1', displayName: '王小明' },
    participants: [{ type: 'companion', companionId: 'c_1', companionName: '小華' }],
  } as unknown as RegisterForEventInput;
}

beforeEach(() => {
  mockCallFn.mockReset();
  _resetSubmitGuardForTest();
});

afterEach(() => {
  _resetSubmitGuardForTest();
});

describe('registerSelection（不含本人）送出中', () => {
  it('呼叫期間為 true，成功與失敗後都釋放；去重命中不多取', async () => {
    const ok = deferred<{ deduplicated: boolean }>();
    mockCallFn.mockReturnValueOnce(ok.promise);
    const first = registerSelection(input('ev_sel_1'), false);
    const dup = registerSelection(input('ev_sel_1'), false);
    expect(dup).toBe(first);
    expect(isSubmitting()).toBe(true);
    ok.resolve({ deduplicated: true });
    await first;
    expect(isSubmitting()).toBe(false);

    mockCallFn.mockRejectedValueOnce(new Error('boom'));
    await expect(registerSelection(input('ev_sel_2'), false)).rejects.toBeTruthy();
    expect(isSubmitting()).toBe(false);
  });

  it('沒選到同行者而丟錯時也釋放', async () => {
    const bad = { ...input('ev_sel_3'), participants: [{ type: 'self' }] } as unknown as RegisterForEventInput;
    await expect(registerSelection(bad, false)).rejects.toBeTruthy();
    expect(isSubmitting()).toBe(false);
  });
});
