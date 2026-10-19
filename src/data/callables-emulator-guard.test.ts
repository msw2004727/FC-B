import { describe, expect, it, vi } from 'vitest';

// 資料庫與登入指向 emulator 時，正式模式的 Callable 一律拒絕（開發不得打到正式環境的 Functions）。
vi.mock('./firebase', () => ({
  getFirebase: vi.fn(async () => ({ app: {}, db: {}, auth: {} })),
  shouldUseEmulator: () => true,
}));
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(() => vi.fn(async () => ({ data: {} }))),
}));

import { httpsCallable } from 'firebase/functions';
import { callFn } from './callables';

describe('callFn：emulator 模式的防護', () => {
  it('不呼叫正式 Functions，直接丟出可辨識的錯誤', async () => {
    await expect(callFn('syncGroupActionStatus', { groupId: 'g', newStatus: 'approved', reviewerName: 'r' }))
      .rejects.toThrow(/emulator 模式下禁止呼叫正式環境的 Functions：syncGroupActionStatus/);
    expect(httpsCallable).not.toHaveBeenCalled();
  });
});
