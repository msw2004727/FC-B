import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStandalonePwa } from '@/features/pwa/pwa-install';
import {
  _resetAutoLoginSuppressForTest,
  cleanLoginParamsFromUrl,
  isAutoLoginSuppressedThisPage,
  isIosStandaloneNow,
  LOGIN_HANDOFF_STORAGE_KEY,
  suppressAutoLoginThisPage,
} from '@/data/login-redirect';

import { bootLoginHandoff } from './boot';
import { _resetClaimForTest } from './claim';
import { _setReplaceForTest } from './nav';
import { sha256Hex } from './pairing';
import { PENDING_DISCARD_MS, writePending } from './pending';
import { _resetRelayForTest } from './relay';
import { renderRelay, renderWait, type RelayView } from './view';

const callFn = vi.hoisted(() => vi.fn());

vi.mock('@/data/callables', () => ({ callFn }));

vi.mock('./view', () => ({
  renderWait: vi.fn(),
  renderRelay: vi.fn(),
}));

const SECRET = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CRIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1';
const EDGIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0.2210.150 Version/17.0 Mobile/15E148 Safari/604.1';
const FXIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15';
const LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.18.0';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.119 Mobile Safari/537.36';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DESKTOP_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91';

function setPlatform(ua: string, touch: number, standalone: boolean): void {
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: ua });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, value: touch });
  Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: standalone });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: standalone && query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function openHandoff(handoffId: string, extra: Record<string, string> = {}): void {
  const params = new URLSearchParams({
    fcbHandoff: handoffId,
    code: 'auth-code',
    liffClientId: '2008123456',
    liffRedirectUri: `${location.origin}/back`,
    tab: '2',
    ...extra,
  });
  history.replaceState(null, '', `/?${params.toString()}`);
}

/** LINE App 路徑的實際回跳形式（站長 11-20 截圖）：fcbHandoff 包在 liff.state，liffRedirectUri 也是包過的。 */
function openWrapped(handoffId: string): string {
  const wrappedRedirect = `${location.origin}/?liff.state=${encodeURIComponent(`?fcbHandoff=${handoffId}`)}`;
  const params = new URLSearchParams({
    'liff.state': `?fcbHandoff=${handoffId}`,
    state: 'xyz',
    liffClientId: '2009084941',
    liffRedirectUri: wrappedRedirect,
    code: 'auth-code',
  });
  history.replaceState(null, '', `/?${params.toString()}`);
  return wrappedRedirect;
}

function lastRelay(): RelayView | null | undefined {
  return vi.mocked(renderRelay).mock.calls.at(-1)?.[0];
}

const replaced: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  _resetClaimForTest();
  _resetRelayForTest();
  _resetAutoLoginSuppressForTest();
  _setReplaceForTest(null);
  callFn.mockReset();
  vi.mocked(renderRelay).mockClear();
  vi.mocked(renderWait).mockClear();
  localStorage.clear();
  replaced.length = 0;
  history.replaceState(null, '', '/');
});

function runBoot(): Promise<void> {
  return bootLoginHandoff({
    isIosStandalone: isIosStandaloneNow,
    isStandalone: isStandalonePwa,
    cleanParams: cleanLoginParamsFromUrl,
    suppressAutoLogin: suppressAutoLoginThisPage,
  });
}

function armReplace(): void {
  replaced.length = 0;
  _setReplaceForTest((url) => { replaced.push(url); });
}

describe('boot 分流', () => {
  it.each([
    ['iOS Safari 分頁', IPHONE, 5, false, 'relay'],
    ['iOS Chrome', CRIOS, 5, false, 'relay'],
    ['iOS Edge', EDGIOS, 5, false, 'relay'],
    ['iOS Firefox', FXIOS, 5, false, 'relay'],
    ['iPadOS 分頁', MAC, 5, false, 'relay'],
    ['iOS 主畫面 App', IPHONE, 5, true, 'clean'],
    ['LINE 內建', LINE, 5, false, 'clean'],
    ['Android Chrome', ANDROID, 5, false, 'clean'],
    ['Android 安裝版 PWA', ANDROID, 5, true, 'clean'],
    ['Samsung Internet', SAMSUNG, 5, false, 'clean'],
    ['桌機 Chrome', DESKTOP_CHROME, 0, false, 'clean'],
    ['桌機 Edge', DESKTOP_EDGE, 0, false, 'clean'],
    ['桌機 Safari', MAC, 0, false, 'clean'],
    ['桌面 PWA', DESKTOP_CHROME, 0, true, 'clean'],
  ] as const)('%s', async (_label, ua, touch, standalone, mode) => {
    armReplace();
    setPlatform(ua, touch, standalone);
    openHandoff('ee'.repeat(32));
    await runBoot();
    expect(location.search).toBe('?tab=2');
    expect(callFn).not.toHaveBeenCalled();
    expect(replaced).toEqual([]);
    if (mode === 'relay') {
      expect(lastRelay()?.kind).toBe('pick');
      expect(isAutoLoginSuppressedThisPage()).toBe(true);
      expect(renderWait).not.toHaveBeenCalled();
    } else {
      expect(renderRelay).not.toHaveBeenCalled();
      expect(renderWait).not.toHaveBeenCalled();
      expect(isAutoLoginSuppressedThisPage()).toBe(false);
    }
  });

  it('發起端雜湊相符：換頁且不顯示轉交頁', async () => {
    armReplace();
    const id = await sha256Hex(SECRET);
    writePending({ secret: SECRET, createdAt: Date.now() });
    setPlatform(IPHONE, 5, true);
    openHandoff(id);
    await runBoot();
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toBeNull();
    expect(renderRelay).not.toHaveBeenCalled();
    expect(renderWait).not.toHaveBeenCalled();
    expect(isAutoLoginSuppressedThisPage()).toBe(false);
    expect(replaced).toHaveLength(1);
    const next = new URL(replaced[0] ?? 'http://invalid.test/');
    expect(next.searchParams.has('fcbHandoff')).toBe(false);
    expect(next.searchParams.get('code')).toBe('auth-code');
    expect(next.searchParams.get('liffClientId')).toBe('2008123456');
    expect(next.searchParams.get('liffRedirectUri')).toBe(`${location.origin}/back`);
    expect(next.searchParams.get('tab')).toBe('2');
  });

  it('pending 雜湊不符的 iOS Safari 仍進轉交頁且保留 pending', async () => {
    armReplace();
    writePending({ secret: OTHER, createdAt: Date.now() });
    setPlatform(IPHONE, 5, false);
    openHandoff(await sha256Hex(SECRET));
    await runBoot();
    expect(lastRelay()?.kind).toBe('pick');
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toContain(OTHER);
    expect(callFn).not.toHaveBeenCalled();
    expect(replaced).toEqual([]);
  });

  it('iOS 主畫面有 pending、網址沒有 fcbHandoff：等待並 claim', async () => {
    armReplace();
    callFn.mockRejectedValue(Object.assign(new Error('nf'), { code: 'not-found' }));
    writePending({ secret: SECRET, createdAt: Date.now() });
    setPlatform(IPHONE, 5, true);
    history.replaceState(null, '', '/');
    await runBoot();
    expect(vi.mocked(renderWait).mock.calls[0]?.[0]).toMatchObject({ kind: 'wait' });
    expect(callFn).toHaveBeenCalledWith('lineLoginHandoff', { op: 'claim', handoffSecret: SECRET });
    expect(renderRelay).not.toHaveBeenCalled();
  });

  it('iPadOS 主畫面有 pending：等待並 claim', async () => {
    armReplace();
    callFn.mockRejectedValue(Object.assign(new Error('nf'), { code: 'not-found' }));
    writePending({ secret: SECRET, createdAt: Date.now() });
    setPlatform(MAC, 5, true);
    history.replaceState(null, '', '/');
    await runBoot();
    expect(vi.mocked(renderWait).mock.calls[0]?.[0]).toMatchObject({ kind: 'wait' });
    expect(callFn).toHaveBeenCalledWith('lineLoginHandoff', expect.objectContaining({ op: 'claim' }));
  });

  it('Android 有 pending、沒有參數：不顯示等待、不刪 pending', async () => {
    armReplace();
    writePending({ secret: SECRET, createdAt: Date.now() });
    setPlatform(ANDROID, 5, false);
    history.replaceState(null, '', '/');
    await runBoot();
    expect(renderWait).not.toHaveBeenCalled();
    expect(renderRelay).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toContain(SECRET);
    expect(callFn).not.toHaveBeenCalled();
  });

  it('iOS 主畫面落到不符的轉交網址：清參數並對既有 pending 開始等待', async () => {
    armReplace();
    callFn.mockRejectedValue(Object.assign(new Error('nf'), { code: 'not-found' }));
    writePending({ secret: OTHER, createdAt: Date.now() });
    setPlatform(IPHONE, 5, true);
    openHandoff('11'.repeat(32));
    await runBoot();
    expect(location.search).toBe('?tab=2');
    expect(renderRelay).not.toHaveBeenCalled();
    expect(vi.mocked(renderWait).mock.calls[0]?.[0]).toMatchObject({ kind: 'wait' });
    expect(callFn).toHaveBeenCalledWith('lineLoginHandoff', { op: 'claim', handoffSecret: OTHER });
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toContain(OTHER);
  });

  it('缺少 code：只清參數', async () => {
    armReplace();
    setPlatform(IPHONE, 5, false);
    history.replaceState(null, '', `/?fcbHandoff=${'aa'.repeat(32)}&tab=2`);
    await runBoot();
    expect(location.search).toBe('?tab=2');
    expect(renderRelay).not.toHaveBeenCalled();
    expect(renderWait).not.toHaveBeenCalled();
    expect(isAutoLoginSuppressedThisPage()).toBe(false);
  });

  it('iOS Safari 缺少 liffRedirectUri：已失效，不呼叫伺服器', async () => {
    armReplace();
    setPlatform(IPHONE, 5, false);
    const params = new URLSearchParams({
      fcbHandoff: 'aa'.repeat(32),
      code: 'auth-code',
      liffClientId: '2008123456',
      tab: '2',
    });
    history.replaceState(null, '', `/?${params.toString()}`);
    await runBoot();
    expect(lastRelay()).toEqual({ kind: 'wrong' });
    expect(callFn).not.toHaveBeenCalled();
    expect(location.search).toBe('?tab=2');
    expect(isAutoLoginSuppressedThisPage()).toBe(true);
  });

  it('超過 6 分鐘的 pending 在 iOS 主畫面刪除、不顯示等待', async () => {
    armReplace();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
    writePending({ secret: SECRET, createdAt: Date.now() - PENDING_DISCARD_MS - 1 });
    setPlatform(IPHONE, 5, true);
    history.replaceState(null, '', '/');
    await runBoot();
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toBeNull();
    expect(renderWait).not.toHaveBeenCalled();
    expect(renderRelay).not.toHaveBeenCalled();
  });
});

describe('liff.state 包裹的回跳（LINE App 路徑，顧問 §3.355 b）', () => {
  it('iOS Safari：進轉交頁、清掉網址（含 liff.state）、relay 帶原樣的包裹 liffRedirectUri', async () => {
    armReplace();
    setPlatform(IPHONE, 5, false);
    const id = await sha256Hex(SECRET);
    const wrapped = openWrapped(id);
    callFn.mockResolvedValue({ ok: true });
    await runBoot();
    expect(lastRelay()?.kind).toBe('pick');
    expect(location.search).toBe('');
    expect(isAutoLoginSuppressedThisPage()).toBe(true);
    const options = (lastRelay() as { options: number[] }).options;
    const handlers = vi.mocked(renderRelay).mock.calls.at(-1)?.[1];
    handlers?.onPick(options[0] ?? 0);
    await vi.waitFor(() => expect(callFn).toHaveBeenCalled());
    expect(callFn.mock.calls[0]?.[1]).toMatchObject({
      op: 'relay', handoffId: id, code: 'auth-code', liffClientId: '2009084941', liffRedirectUri: wrapped,
    });
  });

  it('發起端（主畫面 App 自己收到回跳）：換頁到還原後的網址，不帶 liff.state／fcbHandoff，code 與包裹 liffRedirectUri 保留', async () => {
    armReplace();
    const id = await sha256Hex(SECRET);
    writePending({ secret: SECRET, createdAt: Date.now() });
    setPlatform(IPHONE, 5, true);
    const wrapped = openWrapped(id);
    await runBoot();
    expect(renderRelay).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toBeNull();
    const next = new URL(replaced[0] ?? 'http://invalid.test/');
    expect(next.pathname).toBe('/');
    expect(next.searchParams.has('liff.state')).toBe(false);
    expect(next.searchParams.has('fcbHandoff')).toBe(false);
    expect(next.searchParams.get('code')).toBe('auth-code');
    expect(next.searchParams.get('liffRedirectUri')).toBe(wrapped);
  });

  it('liff.state 裡的 fcbHandoff 格式不對：只清參數，不進轉交頁', async () => {
    setPlatform(IPHONE, 5, false);
    history.replaceState(null, '', `/?liff.state=${encodeURIComponent('?fcbHandoff=zzz')}&code=c&liffClientId=1`);
    await runBoot();
    expect(renderRelay).not.toHaveBeenCalled();
    expect(location.search).toBe('');
  });
});
