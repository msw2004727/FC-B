import { afterEach, describe, expect, it, vi } from 'vitest';

const MODAL_PATH = '../components/ContactOwnerModal';

afterEach(() => {
  vi.doUnmock(MODAL_PATH);
  vi.resetModules();
});

describe('loadContactOwnerModal', () => {
  it('同一次載入共用同一個 Promise', async () => {
    vi.resetModules();
    vi.doMock(MODAL_PATH, () => ({ ContactOwnerModal: () => null }));
    const { loadContactOwnerModal } = await import('./contact-owner-loader');
    const first = loadContactOwnerModal();
    expect(loadContactOwnerModal()).toBe(first);
    await expect(first).resolves.toBeTypeOf('function');
  });

  it('載入失敗後清掉快取，下一次重新 import 並成功', async () => {
    vi.resetModules();
    const calls = { failed: 0, ok: 0 };
    vi.doMock(MODAL_PATH, () => {
      calls.failed += 1;
      throw new Error('chunk load failed');
    });
    const { loadContactOwnerModal, _resetContactOwnerLoaderForTest } = await import('./contact-owner-loader');
    _resetContactOwnerLoaderForTest();
    const failed = loadContactOwnerModal();
    await expect(failed).rejects.toBeTruthy();

    // 換成可載入的模組（模擬重新部署後 chunk 可用）；同一個 loader 實例必須重新 import，而不是回傳舊的失敗 Promise。
    vi.doMock(MODAL_PATH, () => {
      calls.ok += 1;
      return { ContactOwnerModal: () => null };
    });
    const retried = loadContactOwnerModal();
    expect(retried).not.toBe(failed);
    await expect(retried).resolves.toBeTypeOf('function');
    expect(calls).toEqual({ failed: 1, ok: 1 });
  });
});
