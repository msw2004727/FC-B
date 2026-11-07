import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  liff: {
    init: vi.fn(async () => undefined),
    isLoggedIn: vi.fn(() => false),
    isInClient: vi.fn(() => true),
    isApiAvailable: vi.fn(() => false),
    openWindow: vi.fn(),
    shareTargetPicker: vi.fn(async () => ({ status: 'success' as const })),
    login: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn(() => 'token'),
    getProfile: vi.fn(async () => ({ displayName: 'n', pictureUrl: null })),
  },
}));

vi.mock('@line/liff', () => ({ default: h.liff }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_LIFF_ID', 'test-liff-id');
  h.liff.init.mockReset().mockResolvedValue(undefined);
  h.liff.isLoggedIn.mockReset().mockReturnValue(false);
  h.liff.isInClient.mockReset().mockReturnValue(true);
  h.liff.isApiAvailable.mockReset().mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('ensureLiffInit', () => {
  it('成功只 init 一次，同一支 Promise；失敗不留著，下次可再 init', async () => {
    const mod = await import('./liff-init');
    const first = mod.ensureLiffInit();
    const second = mod.ensureLiffInit();
    expect(second).toBe(first);
    await first;
    await mod.ensureLiffInit();
    expect(h.liff.init).toHaveBeenCalledTimes(1);
    expect(h.liff.init).toHaveBeenCalledWith({ liffId: 'test-liff-id' });

    mod._resetLiffInitForTest();
    h.liff.init.mockRejectedValueOnce(new Error('invalid code'));
    await expect(mod.ensureLiffInit()).rejects.toThrow('invalid code');
    h.liff.init.mockResolvedValue(undefined);
    await mod.ensureLiffInit();
    expect(h.liff.init).toHaveBeenCalledTimes(3);
  });

  it('初始化成功後，既有 canUseShareTargetPicker 對同一支 singleton 成立', async () => {
    h.liff.isLoggedIn.mockReturnValue(true);
    h.liff.isApiAvailable.mockImplementation((api?: string) => api === 'shareTargetPicker');
    const mod = await import('./liff-init');
    const sdk = await mod.ensureLiffInit();
    const share = await import('@/features/events/data/event-share');
    expect(await share.loadShareLiff()).toBe(sdk);
    expect(share.canUseShareTargetPicker(sdk)).toBe(true);
    expect(h.liff.init).toHaveBeenCalledTimes(1);
  });
});

describe('Mini App 預先初始化', () => {
  it('一般瀏覽器與 LINE 內建瀏覽器不排程、不 init', async () => {
    vi.useFakeTimers();
    const { startMiniAppLiffPreinit } = await import('./liff-preinit');
    const chrome = startMiniAppLiffPreinit('Mozilla/5.0 Chrome/130.0');
    const iab = startMiniAppLiffPreinit('Mozilla/5.0 Mobile Safari Line/14.18.0');
    await vi.runAllTimersAsync();
    expect(h.liff.init).not.toHaveBeenCalled();
    chrome();
    iab();
  });

  it('Mini App 用 requestIdleCallback；取消後不 init', async () => {
    const ric = vi.fn((_cb: () => void) => 7);
    const cic = vi.fn();
    vi.stubGlobal('requestIdleCallback', ric);
    vi.stubGlobal('cancelIdleCallback', cic);
    const { startMiniAppLiffPreinit } = await import('./liff-preinit');
    const cancel = startMiniAppLiffPreinit('Mozilla/5.0 Line/14.18.0 LIFF');
    expect(ric).toHaveBeenCalledOnce();
    cancel();
    expect(cic).toHaveBeenCalledWith(7);
    expect(h.liff.init).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('沒有 requestIdleCallback 時 setTimeout 後 init；失敗吞掉', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    h.liff.init.mockRejectedValueOnce(new Error('boom'));
    const { startMiniAppLiffPreinit } = await import('./liff-preinit');
    const cancel = startMiniAppLiffPreinit('Mozilla/5.0 Line/14.18.0 LIFF');
    await vi.runAllTimersAsync();
    expect(h.liff.init).toHaveBeenCalledTimes(1);
    cancel();
    vi.unstubAllGlobals();
  });
});

describe('LIFF 不進首頁靜態鏈', () => {
  it('liff-init 只動態載入 @line/liff；liff-preinit 改靜態 import liff-init', () => {
    const initSrc = readFileSync(join(process.cwd(), 'src/data/liff-init.ts'), 'utf8');
    const preSrc = readFileSync(join(process.cwd(), 'src/data/liff-preinit.ts'), 'utf8');
    expect(initSrc).toContain("await import('@line/liff')");
    expect(initSrc).not.toMatch(/from\s+['"]@line\/liff['"]/);
    expect(preSrc).toMatch(/import\s*\{[^}]*ensureLiffInit[^}]*\}\s*from\s*['"]\.\/liff-init['"]/);
    expect(preSrc).not.toContain("import('./liff-init')");
    expect(preSrc).not.toContain('import("./liff-init")');
  });
});
