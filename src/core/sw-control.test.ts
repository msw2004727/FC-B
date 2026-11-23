import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportClientError } from './error-report';
import {
  _resetRuntimeConfigReportForTest,
  bootSwAndForceUpdate,
  fetchRuntimeConfig,
  parseRuntimeConfig,
  runSwControl,
  type SwControlDeps,
} from './sw-control';

vi.mock('./error-report', () => ({
  reportClientError: vi.fn(),
}));

function deps(overrides: Partial<SwControlDeps> = {}): SwControlDeps & {
  unregister: ReturnType<typeof vi.fn>;
} {
  const unregister = vi.fn(async () => true);
  return {
    serviceWorker: {
      getRegistrations: async () => [{ unregister } as unknown as ServiceWorkerRegistration],
    },
    cacheStorage: {
      keys: async () => ['workbox-precache-v2', 'other'],
      delete: vi.fn(async () => true),
    },
    register: vi.fn(async () => {}),
    unregister,
    ...overrides,
  };
}

describe('parseRuntimeConfig', () => {
  afterEach(() => {
    _resetRuntimeConfigReportForTest();
    vi.mocked(reportClientError).mockClear();
  });

  it('欄位缺少時：SW 開啟、不強制重載、不回報', () => {
    expect(parseRuntimeConfig(null)).toEqual({ swEnabled: true, minBuild: 0 });
    expect(parseRuntimeConfig({})).toEqual({ swEnabled: true, minBuild: 0 });
    expect(parseRuntimeConfig({ minBuild: 0 })).toEqual({ swEnabled: true, minBuild: 0 });
    expect(reportClientError).not.toHaveBeenCalled();
  });

  it('只有明確 false 才關閉，12 位整數 minBuild 保留', () => {
    expect(parseRuntimeConfig({ swEnabled: false, minBuild: 202611111200 })).toEqual({
      swEnabled: false,
      minBuild: 202611111200,
    });
    expect(parseRuntimeConfig({ swEnabled: 'false', minBuild: 202611111200 }).swEnabled).toBe(true);
    expect(parseRuntimeConfig({ swEnabled: 'no', minBuild: 0 }).swEnabled).toBe(true);
  });

  it('上下界 12 位接受，11 位、13 位、小數、負數、字串、null 當 0 且每分頁只回報一次', () => {
    expect(parseRuntimeConfig({ minBuild: 100_000_000_000 }).minBuild).toBe(100_000_000_000);
    expect(parseRuntimeConfig({ minBuild: 999_999_999_999 }).minBuild).toBe(999_999_999_999);
    _resetRuntimeConfigReportForTest();
    vi.mocked(reportClientError).mockClear();
    const bad = [
      '202611111200',
      2026111112000,
      202611111200.5,
      -1,
      5,
      null,
      true,
    ];
    for (const minBuild of bad) {
      expect(parseRuntimeConfig({ swEnabled: true, minBuild }).minBuild).toBe(0);
    }
    expect(reportClientError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportClientError).mock.calls[0]?.[0]).toBe('runtime-config');
  });
});

describe('fetchRuntimeConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    _resetRuntimeConfigReportForTest();
    vi.mocked(reportClientError).mockClear();
  });

  it('200 且格式正確就回設定，並用 no-store', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.cache).toBe('no-store');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return {
        ok: true,
        json: async () => ({ swEnabled: false, minBuild: 202611111200 }),
      };
    }));
    await expect(fetchRuntimeConfig()).resolves.toEqual({ swEnabled: false, minBuild: 202611111200 });
  });

  it('非 200 或 JSON 壞回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(fetchRuntimeConfig()).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => { throw new SyntaxError('bad'); },
    })));
    await expect(fetchRuntimeConfig()).resolves.toBeNull();
  });

  it('8 秒逾時回 null', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    })));
    const pending = fetchRuntimeConfig();
    await vi.advanceTimersByTimeAsync(7_999);
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
  });

  it('minBuild 是字串時回 minBuild 0 並回報，不是 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ swEnabled: true, minBuild: '202611111200' }),
    })));
    await expect(fetchRuntimeConfig()).resolves.toEqual({ swEnabled: true, minBuild: 0 });
    expect(reportClientError).toHaveBeenCalledTimes(1);
  });
});

describe('runSwControl', () => {
  it('正常：註冊 SW', async () => {
    const d = deps();
    expect(await runSwControl({ swEnabled: true, minBuild: 0 }, d)).toBe('registered');
    expect(d.register).toHaveBeenCalledTimes(1);
  });

  it('swEnabled=false：先解除註冊再清快取，不註冊', async () => {
    const order: string[] = [];
    const unregister = vi.fn(async () => {
      order.push('unregister');
      return true;
    });
    const d = deps({
      serviceWorker: {
        getRegistrations: async () => [{ unregister } as unknown as ServiceWorkerRegistration],
      },
      cacheStorage: {
        keys: async () => ['workbox-precache-v2', 'other'],
        delete: vi.fn(async () => {
          order.push('cache');
          return true;
        }),
      },
    });
    expect(await runSwControl({ swEnabled: false, minBuild: 202611111200 }, d)).toBe('disabled');
    expect(order).toEqual(['unregister', 'cache', 'cache']);
    expect(d.register).not.toHaveBeenCalled();
  });

  it('讀不到設定（用空設定）：照常註冊', async () => {
    const d = deps();
    expect(await runSwControl(parseRuntimeConfig(null), d)).toBe('registered');
    expect(d.register).toHaveBeenCalledTimes(1);
  });

  it('註冊失敗只記錄不丟錯', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps({ register: async () => { throw new Error('denied'); } });
    expect(await runSwControl({ swEnabled: true, minBuild: 0 }, d)).toBe('register-failed');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('沒有 serviceWorker 回 unsupported，不註冊也不清快取', async () => {
    const d = deps({ serviceWorker: null });
    expect(await runSwControl({ swEnabled: false, minBuild: 202611111200 }, d)).toBe('unsupported');
    expect(d.register).not.toHaveBeenCalled();
    expect(d.cacheStorage!.delete).not.toHaveBeenCalled();
  });

  it('高 minBuild 不再由 runSwControl 重載，仍註冊', async () => {
    const d = deps();
    expect(await runSwControl({ swEnabled: true, minBuild: 202611111200 }, d)).toBe('registered');
    expect(d.register).toHaveBeenCalledTimes(1);
  });
});

describe('bootSwAndForceUpdate', () => {
  it('沒有 SW 仍呼叫強制更新；chunk 丟錯不往外拋', async () => {
    const startForce = vi.fn(async () => {});
    await bootSwAndForceUpdate({
      config: { swEnabled: true, minBuild: 202611111200 },
      swSupported: false,
      swDeps: deps({ serviceWorker: null }),
      startForce,
    });
    expect(startForce).toHaveBeenCalledWith({ swEnabled: true, minBuild: 202611111200 });

    await expect(bootSwAndForceUpdate({
      config: null,
      swSupported: true,
      swDeps: deps(),
      startForce: async () => { throw new Error('chunk 404'); },
    })).resolves.toBeUndefined();
  });

  it('離線快取流程丟錯或一直沒結束，minBuild 檢查照樣啟動', async () => {
    const startForce = vi.fn(async () => {});
    const throwing = deps({
      serviceWorker: {
        getRegistrations: async () => { throw new Error('boom'); },
      },
    });
    await bootSwAndForceUpdate({
      config: { swEnabled: false, minBuild: 202611111200 },
      swSupported: true,
      swDeps: throwing,
      startForce,
    });
    expect(startForce).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    try {
      const hanging = vi.fn(async () => {});
      const stuck = deps({
        serviceWorker: { getRegistrations: () => new Promise<ServiceWorkerRegistration[]>(() => {}) },
      });
      const p = bootSwAndForceUpdate({
        config: { swEnabled: false, minBuild: 202611111200 },
        swSupported: true,
        swDeps: stuck,
        startForce: hanging,
      });
      await vi.advanceTimersByTimeAsync(8_001);
      await p;
      expect(hanging).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('swEnabled false 時先停用，然後才把同一份設定交給強制更新', async () => {
    const order: string[] = [];
    const unregister = vi.fn(async () => {
      order.push('unregister');
      return true;
    });
    const d = deps({
      serviceWorker: {
        getRegistrations: async () => [{ unregister } as unknown as ServiceWorkerRegistration],
      },
      cacheStorage: {
        keys: async () => ['only'],
        delete: vi.fn(async () => {
          order.push('cache');
          return true;
        }),
      },
    });
    await bootSwAndForceUpdate({
      config: { swEnabled: false, minBuild: 202611111200 },
      swSupported: true,
      swDeps: d,
      startForce: () => { order.push('force'); },
    });
    expect(order).toEqual(['unregister', 'cache', 'force']);
    expect(d.register).not.toHaveBeenCalled();
  });

  it('設定為 null 時有 SW 仍註冊，並把 null 交給強制更新', async () => {
    const d = deps();
    const startForce = vi.fn();
    await bootSwAndForceUpdate({
      config: null,
      swSupported: true,
      swDeps: d,
      startForce,
    });
    expect(d.register).toHaveBeenCalledTimes(1);
    expect(startForce).toHaveBeenCalledWith(null);
  });
});
