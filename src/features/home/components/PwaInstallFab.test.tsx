import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { setLocale } from '@/i18n/i18n';
import { WEB_PUSH_STORE_KEY } from '@/features/profile/web-push/store';
import { _setDeferredInstallPromptForTest, type BeforeInstallPromptEvent } from '@/features/pwa/pwa-install';
import {
  PWA_FAB_HINT_DELAY_MS,
  PWA_FAB_HINT_GAP_MS,
  PWA_FAB_PUSH_ROUTE,
  PwaInstallFab,
  WEB_PUSH_RECORD_KEY,
  decidePwaFab,
  isMobileUa,
  readPwaFabEnv,
  showPwaFabHint,
  whenPwaFabShouldShow,
} from './PwaInstallFab';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
const LINE_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.19.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const IPAD_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

const css = (name: string): string => readFileSync(join(process.cwd(), 'src/features/home/components', name), 'utf8');

function stubMatchMedia(matches: Record<string, boolean>): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: Boolean(matches[q]),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function stubUa(ua: string, touch = 0): void {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  // jsdom 沒有 maxTouchPoints，直接定義在 navigator 上（可重設）。
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
}

function fakeInstallEvent(outcome: 'accepted' | 'dismissed' = 'dismissed'): BeforeInstallPromptEvent {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  } as unknown as BeforeInstallPromptEvent;
}

beforeEach(async () => {
  await setLocale('zh-TW');
  localStorage.clear();
  _setDeferredInstallPromptForTest(null);
  stubMatchMedia({});
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('.pwa-install-fab, .pwa-install-fab-hint, .contact-owner-fab-hint').forEach((n) => n.remove());
  document.querySelectorAll('.legacy-ui').forEach((n) => n.remove());
  _setDeferredInstallPromptForTest(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('顯示判斷 decidePwaFab', () => {
  const base = { standalone: false, hasPushRecord: false, mobile: true, hasInstallEvent: false };
  it.each([
    ['手機一般分頁（含 LINE）', base, 'show'],
    ['已從主畫面 App 開啟、還沒開推播：顯示（站長 11-26）', { ...base, standalone: true }, 'show'],
    ['App 開啟且已開推播', { ...base, standalone: true, hasPushRecord: true }, 'hide'],
    ['這個瀏覽器已開推播', { ...base, hasPushRecord: true }, 'hide'],
    ['電腦主畫面 App、沒有安裝事件：顯示', { ...base, standalone: true, mobile: false }, 'show'],
    ['電腦、已攔到安裝事件', { ...base, mobile: false, hasInstallEvent: true }, 'show'],
    ['電腦、沒有安裝事件：等事件', { ...base, mobile: false }, 'wait-install-event'],
    ['電腦、已開推播', { ...base, mobile: false, hasInstallEvent: true, hasPushRecord: true }, 'hide'],
  ] as const)('%s', (_name, env, expected) => {
    expect(decidePwaFab(env)).toBe(expected);
  });
});

describe('isMobileUa', () => {
  it.each([
    [IPHONE, 0, true],
    [LINE_IOS, 0, true],
    [ANDROID, 0, true],
    [IPAD_MAC, 5, true],
    [IPAD_MAC, 0, false],
    [DESKTOP, 0, false],
  ])('%s（觸控 %s）→ %s', (ua, touch, expected) => {
    expect(isMobileUa(ua, touch)).toBe(expected);
  });
});

describe('readPwaFabEnv', () => {
  it('推播紀錄 key 與 web-push 模組相同（字串重複，測試釘住）', () => {
    expect(WEB_PUSH_RECORD_KEY).toBe(WEB_PUSH_STORE_KEY);
  });

  it('讀 standalone、推播紀錄、手機、安裝事件', () => {
    stubUa(IPHONE);
    expect(readPwaFabEnv()).toEqual({ standalone: false, hasPushRecord: false, mobile: true, hasInstallEvent: false });
    localStorage.setItem(WEB_PUSH_STORE_KEY, '{}');
    stubMatchMedia({ '(display-mode: standalone)': true });
    _setDeferredInstallPromptForTest(fakeInstallEvent());
    expect(readPwaFabEnv()).toEqual({ standalone: true, hasPushRecord: true, mobile: true, hasInstallEvent: true });
  });

  it('入口先接住的安裝事件（window.__fcbBip）也算', () => {
    stubUa(DESKTOP);
    (window as { __fcbBip?: unknown }).__fcbBip = fakeInstallEvent();
    expect(readPwaFabEnv().hasInstallEvent).toBe(true);
  });

  it('localStorage 不可用時當作沒開推播', () => {
    stubUa(IPHONE);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readPwaFabEnv().hasPushRecord).toBe(false);
  });
});

describe('whenPwaFabShouldShow', () => {
  it('手機立即顯示', () => {
    stubUa(ANDROID);
    const onShow = vi.fn();
    whenPwaFabShouldShow(onShow);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('已開推播不顯示，之後來安裝事件也不顯示', () => {
    stubUa(DESKTOP);
    localStorage.setItem(WEB_PUSH_STORE_KEY, '{}');
    const onShow = vi.fn();
    whenPwaFabShouldShow(onShow);
    window.dispatchEvent(new Event('beforeinstallprompt'));
    expect(onShow).not.toHaveBeenCalled();
  });

  it('電腦版沒有安裝事件先不顯示，攔到事件才顯示；收尾後不再顯示', () => {
    stubUa(DESKTOP);
    const onShow = vi.fn();
    const stop = whenPwaFabShouldShow(onShow);
    expect(onShow).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('beforeinstallprompt'));
    expect(onShow).toHaveBeenCalledTimes(1);

    // 上一個事件已被攔截器存起來；清掉再驗收尾。
    _setDeferredInstallPromptForTest(null);
    const onShow2 = vi.fn();
    const stop2 = whenPwaFabShouldShow(onShow2);
    stop2();
    window.dispatchEvent(new Event('beforeinstallprompt'));
    expect(onShow2).not.toHaveBeenCalled();
    stop();
  });

  it('電腦版已攔到安裝事件就立即顯示', () => {
    stubUa(DESKTOP);
    _setDeferredInstallPromptForTest(fakeInstallEvent());
    const onShow = vi.fn();
    whenPwaFabShouldShow(onShow);
    expect(onShow).toHaveBeenCalledTimes(1);
  });
});

describe('安裝提示泡泡', () => {
  function mountFabNode(): HTMLButtonElement {
    const fab = document.createElement('button');
    fab.className = 'pwa-install-fab';
    document.body.appendChild(fab);
    return fab;
  }

  it('聯繫站長泡泡還在時跳過這次，兩個泡泡不同時出現', () => {
    const fab = mountFabNode();
    const contactHint = document.createElement('div');
    contactHint.className = 'contact-owner-fab-hint';
    document.body.appendChild(contactHint);
    expect(showPwaFabHint()).toBeUndefined();
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
    fab.remove();
  });

  it('顯示文字、抖動、6 秒後收起；點泡泡＝點浮球', () => {
    vi.useFakeTimers();
    const fab = mountFabNode();
    const onFab = vi.fn();
    fab.addEventListener('click', onFab);
    showPwaFabHint();
    const bubble = document.querySelector('.pwa-install-fab-hint') as HTMLElement;
    expect(bubble.textContent).toBe('安裝 App，活動通知不漏接');
    expect(fab.classList.contains('is-shaking')).toBe(true);
    vi.advanceTimersByTime(4800);
    expect(fab.classList.contains('is-shaking')).toBe(false);
    vi.advanceTimersByTime(1200);
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();

    showPwaFabHint();
    (document.querySelector('.pwa-install-fab-hint') as HTMLElement).click();
    expect(onFab).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
    fab.remove();
  });

  it('減少動態效果時不抖', () => {
    stubMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    const fab = mountFabNode();
    const stop = showPwaFabHint();
    expect(document.querySelector('.pwa-install-fab-hint')).not.toBeNull();
    expect(fab.classList.contains('is-shaking')).toBe(false);
    stop?.();
    fab.remove();
  });

  it('點泡泡以外的地方就關閉', () => {
    const fab = mountFabNode();
    showPwaFabHint();
    fireEvent.pointerDown(document.body);
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
    fab.remove();
  });
});

describe('PwaInstallFab', () => {
  it('掛載後 6 秒出安裝泡泡；卸下時收掉', () => {
    vi.useFakeTimers();
    const { unmount } = render(<PwaInstallFab />);
    expect(document.querySelector('.pwa-install-fab')?.getAttribute('aria-label')).toBe('加到主畫面');
    vi.advanceTimersByTime(PWA_FAB_HINT_DELAY_MS - 1);
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.querySelector('.pwa-install-fab-hint')).not.toBeNull();
    unmount();
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
  });

  // 顧問 §3.752：冷載入時聯繫站長提示 chunk 較晚到，6 秒時它的泡泡還在，原本就跳過這次。
  it('冷載入：6 秒時聯繫站長泡泡還在，等它關掉後隔一下補出安裝泡泡（只出一次）', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<PwaInstallFab />);
    const contactHint = document.createElement('div');
    contactHint.className = 'contact-owner-fab-hint';
    await vi.advanceTimersByTimeAsync(PWA_FAB_HINT_DELAY_MS - 500);
    document.body.appendChild(contactHint);
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
    contactHint.remove();
    await vi.advanceTimersByTimeAsync(PWA_FAB_HINT_GAP_MS - 1);
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(document.querySelectorAll('.pwa-install-fab-hint')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
    await vi.advanceTimersByTimeAsync(20000);
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
    unmount();
  });

  it('安裝泡泡顯示中聯繫站長泡泡才出現：先收起，等聯繫站長關掉再補出', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<PwaInstallFab />);
    await vi.advanceTimersByTimeAsync(PWA_FAB_HINT_DELAY_MS);
    expect(document.querySelector('.pwa-install-fab-hint')).not.toBeNull();
    const contactHint = document.createElement('div');
    contactHint.className = 'contact-owner-fab-hint';
    document.body.appendChild(contactHint);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
    contactHint.remove();
    await vi.advanceTimersByTimeAsync(PWA_FAB_HINT_GAP_MS);
    expect(document.querySelectorAll('.pwa-install-fab-hint')).toHaveLength(1);
    unmount();
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
  });

  it('等聯繫站長泡泡期間卸下：之後不再補出', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<PwaInstallFab />);
    const contactHint = document.createElement('div');
    contactHint.className = 'contact-owner-fab-hint';
    document.body.appendChild(contactHint);
    await vi.advanceTimersByTimeAsync(PWA_FAB_HINT_DELAY_MS);
    unmount();
    contactHint.remove();
    await vi.advanceTimersByTimeAsync(PWA_FAB_HINT_GAP_MS + 10000);
    expect(document.querySelector('.pwa-install-fab-hint')).toBeNull();
  });

  it('有安裝事件：點了跳原生安裝、事件清掉；接受安裝後浮球仍保留（站長 11-26：開推播才隱藏）', async () => {
    const ev = fakeInstallEvent('accepted');
    _setDeferredInstallPromptForTest(ev);
    render(<PwaInstallFab />);
    await act(async () => {
      fireEvent.click(document.querySelector('.pwa-install-fab')!);
      await Promise.resolve();
    });
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(readPwaFabEnv().hasInstallEvent).toBe(false);
    expect(document.querySelector('.pwa-install-fab')).not.toBeNull();
    expect(document.getElementById('pwa-system-picker')).toBeNull();
  });

  it('沒有安裝事件：手機點了打開安裝教學（選系統）', async () => {
    stubUa('Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    render(<PwaInstallFab />);
    await act(async () => {
      fireEvent.click(document.querySelector('.pwa-install-fab')!);
      await new Promise((r) => setTimeout(r, 50));
    });
    await vi.waitFor(() => expect(document.getElementById('pwa-system-picker')).not.toBeNull());
  });

  it('電腦：原生安裝視窗用掉後浮球保留，再點開系統選擇教學', async () => {
    stubUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36');
    const ev = fakeInstallEvent('dismissed');
    _setDeferredInstallPromptForTest(ev);
    render(<PwaInstallFab />);
    await act(async () => {
      fireEvent.click(document.querySelector('.pwa-install-fab')!);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.pwa-install-fab')).not.toBeNull();
    expect(document.getElementById('pwa-system-picker')).toBeNull();
    await act(async () => {
      fireEvent.click(document.querySelector('.pwa-install-fab')!);
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.getElementById('pwa-system-picker')).not.toBeNull());
  });

  it('手機：原生安裝視窗被關掉後浮球保留', async () => {
    stubUa('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/142.0.0.0 Mobile Safari/537.36');
    _setDeferredInstallPromptForTest(fakeInstallEvent('dismissed'));
    render(<PwaInstallFab />);
    await act(async () => {
      fireEvent.click(document.querySelector('.pwa-install-fab')!);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('.pwa-install-fab')).not.toBeNull();
  });

  it('切換語系後浮球標籤跟著換', async () => {
    render(<PwaInstallFab />);
    await act(async () => {
      await setLocale('en');
    });
    expect(document.querySelector('.pwa-install-fab')?.getAttribute('aria-label')).not.toBe('加到主畫面');
  });

  it('收到 appinstalled 後浮球仍保留', async () => {
    render(<PwaInstallFab />);
    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(document.querySelector('.pwa-install-fab')).not.toBeNull();
  });

  it('主畫面 App（還沒開推播）：標籤與泡泡改成開通知，點了帶去「我的」展開通知', async () => {
    vi.useFakeTimers();
    stubMatchMedia({ '(display-mode: standalone)': true });
    history.replaceState(null, '', '/');
    render(
      <LocationProvider>
        <PwaInstallFab />
      </LocationProvider>,
    );
    const fab = document.querySelector('.pwa-install-fab')!;
    expect(fab.getAttribute('aria-label')).toBe('開啟通知');
    act(() => {
      vi.advanceTimersByTime(PWA_FAB_HINT_DELAY_MS);
    });
    expect(document.querySelector('.pwa-install-fab-hint')?.textContent).toBe('開啟通知，活動消息不漏接');
    act(() => {
      fireEvent.click(fab);
    });
    expect(location.pathname + location.search).toBe(PWA_FAB_PUSH_ROUTE);
    expect(document.getElementById('pwa-system-picker')).toBeNull();
    history.replaceState(null, '', '/');
  });
});

describe('樣式守則', () => {
  it.each(['pwa-install-fab.css', 'contact-owner-fab.css'])('%s：常駐光澤動畫只動 transform，不動 left', (name) => {
    const s = css(name);
    const keyframes = s.match(/@keyframes [\w-]*sheen \{[\s\S]*?\n\}/g) ?? [];
    expect(keyframes.length).toBe(1);
    expect(keyframes[0]).toContain('transform');
    expect(keyframes[0]).not.toMatch(/\bleft\s*:/);
  });

  it.each(['pwa-install-fab.css', 'contact-owner-fab.css'])('%s：減少動態效果時關掉光芒與光澤動畫', (name) => {
    const blocks = css(name).match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) ?? [];
    const joined = blocks.join('\n');
    expect(joined).toMatch(/::before/);
    expect(joined).toMatch(/::after/);
    expect(joined).toMatch(/\.fab-gloss::after/);
    expect(joined).toMatch(/animation: none/);
  });

  it('安裝浮球在左下角、與聯繫站長同高；更新提示框出現時上移', () => {
    const s = css('pwa-install-fab.css');
    expect(s).toMatch(/\.pwa-install-fab \{[^}]*left: \.9rem;[^}]*bottom: calc\(var\(--bottombar-h, 64px\) \+ env\(safe-area-inset-bottom, 0px\) \+ 20px\);/);
    expect(s).toMatch(/body\.fcb-update-open \.pwa-install-fab \{/);
    expect(css('contact-owner-fab.css')).toMatch(/body\.fcb-update-open \.contact-owner-fab \{/);
  });
});
