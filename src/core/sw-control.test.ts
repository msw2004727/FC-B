import { describe, expect, it, vi } from 'vitest';
import { parseRuntimeConfig, runSwControl, type SwControlDeps } from './sw-control';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
  };
}

function deps(overrides: Partial<SwControlDeps> = {}): SwControlDeps & {
  unregister: ReturnType<typeof vi.fn>;
} {
  const unregister = vi.fn(async () => true);
  return {
    fetchConfig: async () => ({ swEnabled: true, minBuild: 0 }),
    serviceWorker: {
      getRegistrations: async () => [{ unregister } as unknown as ServiceWorkerRegistration],
    },
    cacheStorage: {
      keys: async () => ['workbox-precache-v2', 'other'],
      delete: vi.fn(async () => true),
    },
    register: vi.fn(async () => {}),
    reload: vi.fn(),
    storage: memoryStorage(),
    buildId: 202610201200,
    unregister,
    ...overrides,
  };
}

describe('parseRuntimeConfig', () => {
  it('欄位缺少或型別不對時：SW 開啟、不強制重載', () => {
    expect(parseRuntimeConfig(null)).toEqual({ swEnabled: true, minBuild: 0 });
    expect(parseRuntimeConfig({ swEnabled: 'no', minBuild: 'x' })).toEqual({ swEnabled: true, minBuild: 0 });
  });
  it('只有明確 false 才關閉', () => {
    expect(parseRuntimeConfig({ swEnabled: false, minBuild: 5 })).toEqual({ swEnabled: false, minBuild: 5 });
  });
});

describe('runSwControl', () => {
  it('正常：註冊 SW', async () => {
    const d = deps();
    expect(await runSwControl(d)).toBe('registered');
    expect(d.register).toHaveBeenCalledTimes(1);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it('swEnabled=false：解除所有註冊並清快取，不註冊', async () => {
    const d = deps({ fetchConfig: async () => ({ swEnabled: false }) });
    expect(await runSwControl(d)).toBe('disabled');
    expect(d.unregister).toHaveBeenCalledTimes(1);
    expect(d.cacheStorage!.delete).toHaveBeenCalledTimes(2);
    expect(d.register).not.toHaveBeenCalled();
  });

  it('minBuild 高於目前建置：重載一次；同一個 minBuild 第二次不再重載', async () => {
    const storage = memoryStorage();
    const first = deps({ storage, fetchConfig: async () => ({ minBuild: 202610209999 }) });
    expect(await runSwControl(first)).toBe('reload');
    expect(first.reload).toHaveBeenCalledTimes(1);

    const second = deps({ storage, fetchConfig: async () => ({ minBuild: 202610209999 }) });
    expect(await runSwControl(second)).toBe('registered');
    expect(second.reload).not.toHaveBeenCalled();
  });

  it('minBuild 不高於目前建置：不重載', async () => {
    const d = deps({ fetchConfig: async () => ({ minBuild: 202610201200 }) });
    expect(await runSwControl(d)).toBe('registered');
    expect(d.reload).not.toHaveBeenCalled();
  });

  it('無法記錄重載標記時不重載（避免無限重載）', async () => {
    const d = deps({ storage: null, fetchConfig: async () => ({ minBuild: 202610209999 }) });
    expect(await runSwControl(d)).toBe('registered');
    expect(d.reload).not.toHaveBeenCalled();
  });

  it('讀不到設定（離線）：照常註冊', async () => {
    const d = deps({ fetchConfig: async () => { throw new Error('offline'); } });
    expect(await runSwControl(d)).toBe('registered');
  });

  it('註冊失敗只記錄不丟錯', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps({ register: async () => { throw new Error('denied'); } });
    expect(await runSwControl(d)).toBe('register-failed');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
