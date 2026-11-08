import { afterEach, describe, expect, it, vi } from 'vitest';

const modal = vi.hoisted(() => ({ imports: 0, failNext: false }));

vi.mock('../components/ContactOwnerModal', () => {
  modal.imports += 1;
  if (modal.failNext) {
    modal.failNext = false;
    throw new Error('chunk load failed');
  }
  return { ContactOwnerModal: () => null };
});

afterEach(() => {
  vi.resetModules();
  modal.imports = 0;
  modal.failNext = false;
});

describe('loadContactOwnerModal', () => {
  it('同一次載入共用同一個 Promise', async () => {
    const { loadContactOwnerModal, _resetContactOwnerLoaderForTest } = await import('./contact-owner-loader');
    _resetContactOwnerLoaderForTest();
    const first = loadContactOwnerModal();
    expect(loadContactOwnerModal()).toBe(first);
    await expect(first).resolves.toBeTypeOf('function');
  });

  it('載入失敗後清掉快取，下一次重新 import 並成功', async () => {
    const { loadContactOwnerModal, _resetContactOwnerLoaderForTest } = await import('./contact-owner-loader');
    _resetContactOwnerLoaderForTest();
    modal.failNext = true;
    await expect(loadContactOwnerModal()).rejects.toBeTruthy();
    vi.resetModules();
    await expect(loadContactOwnerModal()).resolves.toBeTypeOf('function');
    expect(modal.imports).toBe(2);
  });
});
