import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('firebase/firestore');
  vi.resetModules();
});

describe('loadFirestoreSdk', () => {
  it('多次呼叫共用同一個動態 import（只載入一次）', async () => {
    vi.resetModules();
    let loads = 0;
    vi.doMock('firebase/firestore', () => {
      loads += 1;
      return { getDocs: () => 'fake' };
    });
    const { loadFirestoreSdk } = await import('./firestore-sdk');

    const [a, b] = await Promise.all([loadFirestoreSdk(), loadFirestoreSdk()]);
    expect(a).toBe(b);
    await loadFirestoreSdk();
    expect(loads).toBe(1);
  });

  it('載入失敗後清掉快取，下一次呼叫重新載入（L-08）', async () => {
    vi.resetModules();
    let attempts = 0;
    vi.doMock('firebase/firestore', () => {
      attempts += 1;
      if (attempts === 1) throw new Error('chunk load failed');
      return { getDocs: () => 'fake' };
    });
    const { loadFirestoreSdk } = await import('./firestore-sdk');

    await expect(loadFirestoreSdk()).rejects.toThrow();
    await expect(loadFirestoreSdk()).resolves.toMatchObject({ getDocs: expect.any(Function) });
    expect(attempts).toBe(2);
  });
});
