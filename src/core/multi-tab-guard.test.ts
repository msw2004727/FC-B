import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMultiTabFx, MULTI_TAB_FX_STYLE_ID } from './multi-tab-fx';
import {
  _resetMultiTabGuardForTest,
  initMultiTabGuard,
  showMultiTabWarning,
} from './multi-tab-guard';

type Handler = (ev: MessageEvent) => void;

class FakeBroadcastChannel {
  static all: FakeBroadcastChannel[] = [];
  onmessage: Handler | null = null;
  constructor(readonly name: string) {
    FakeBroadcastChannel.all.push(this);
  }
  postMessage(data: unknown): void {
    const evt = { data } as MessageEvent;
    for (const peer of [...FakeBroadcastChannel.all]) {
      if (peer !== this && peer.name === this.name) peer.onmessage?.(evt);
    }
  }
  close(): void {
    const i = FakeBroadcastChannel.all.indexOf(this);
    if (i >= 0) FakeBroadcastChannel.all.splice(i, 1);
  }
}

type Callback = () => void;
const observers: Array<{ cb: Callback; disconnect: ReturnType<typeof vi.fn> }> = [];

class FakeResizeObserver {
  disconnect = vi.fn();
  constructor(readonly cb: Callback) {
    observers.push({ cb, disconnect: this.disconnect });
  }
  observe(): void {}
}

function setSize(el: HTMLElement, w: number, h: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: w });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h });
}

function overlayEl(): HTMLElement {
  const el = document.getElementById('multi-tab-warning');
  if (!el) throw new Error('缺少多分頁提示');
  return el;
}

async function shownWarning(): Promise<HTMLElement> {
  showMultiTabWarning();
  const overlay = overlayEl();
  const modal = overlay.querySelector('.multi-tab-modal');
  if (modal instanceof HTMLElement) setSize(modal, 340, 280);
  await vi.waitFor(() => {
    expect(overlay.querySelectorAll('svg.orbit rect')).toHaveLength(4);
    expect(overlay.style.opacity).toBe('1');
  });
  return overlay;
}

afterEach(() => {
  _resetMultiTabGuardForTest();
  document.body.innerHTML = '';
  document.getElementById(MULTI_TAB_FX_STYLE_ID)?.remove();
  document.querySelectorAll('style[data-multi-tab-fx-instance]').forEach((node) => node.remove());
  vi.unstubAllGlobals();
  observers.length = 0;
  FakeBroadcastChannel.all = [];
});

describe('showMultiTabWarning 銅金光軌', () => {
  it('套用後有四段光軌、星芒、分頁圖示與靜態樣式，文案與 id 不變', async () => {
    const overlay = await shownWarning();
    expect(overlay.classList.contains('multi-tab-overlay')).toBe(true);
    expect(overlay.querySelector('.multi-tab-title')?.textContent).toBe('偵測到多個分頁開啟');
    expect(overlay.textContent).toContain('為了穩定的登入與資料同步體驗，');
    expect(overlay.textContent).toContain('建議只保留一個分頁。');
    expect(overlay.textContent).toContain('點下方按鈕可請其他舊分頁自動關閉');
    expect(overlay.textContent).toContain('（手動開的分頁可能要自行關閉）');

    const dismiss = overlay.querySelector('#multi-tab-dismiss');
    const close = overlay.querySelector('#multi-tab-close');
    expect(dismiss?.textContent).toBe('我知道了');
    expect(close?.textContent).toBe('關閉其他分頁');
    expect(dismiss?.classList.contains('outline-btn')).toBe(true);
    expect(close?.classList.contains('primary-btn')).toBe(true);
    expect(dismiss?.classList.contains('later')).toBe(true);
    expect(close?.classList.contains('go')).toBe(true);

    const rects = [...overlay.querySelectorAll('svg.orbit rect')];
    expect(rects.map((rect) => rect.getAttribute('class'))).toEqual(['base', 'tail', 'mid', 'head']);
    expect(rects.every((rect) => rect.getAttribute('pathLength') === '100')).toBe(true);
    expect(rects[0]?.getAttribute('rx')).toBe('18');
    expect((overlay.querySelector('svg.orbit') as SVGSVGElement).getAttribute('viewBox')).toBe('0 0 340 280');
    expect(overlay.querySelector('.burst svg')).toBeTruthy();
    expect(overlay.querySelector('.ico svg')).toBeTruthy();

    const staticStyle = document.getElementById(MULTI_TAB_FX_STYLE_ID);
    expect(staticStyle?.textContent).toContain('站長 2026-11-10 選定 B 銅金；R-UI-005 例外');
    expect(staticStyle?.textContent).toContain('--c1: #f3c876');
    expect(staticStyle?.textContent).toContain('--c2: #c58a33');
    expect(staticStyle?.textContent).toContain('backdrop-filter: blur(16px) saturate(160%)');
    expect(staticStyle?.textContent).toContain('-webkit-backdrop-filter: blur(16px) saturate(160%)');
    expect(staticStyle?.textContent).toContain('max-width: 340px');
    expect(staticStyle?.textContent).toContain('border-radius: 18px');
    expect(staticStyle?.textContent).toContain('flex: 1.25');
    expect(staticStyle?.textContent).toContain('prefers-reduced-motion');
    expect(staticStyle?.textContent).toContain('animation: none !important');
    expect(staticStyle?.textContent).toContain('opacity: 0 !important');
    expect(staticStyle?.textContent).toContain('rgba(17,24,39,.94)');
    expect(staticStyle?.textContent).toContain('rgba(0, 0, 0, 0.72)');
    expect(document.querySelectorAll(`#${MULTI_TAB_FX_STYLE_ID}`)).toHaveLength(1);

    const instance = document.querySelector('style[data-multi-tab-fx-instance]');
    expect(instance?.textContent).toContain('4.2s linear infinite');
    expect(instance?.textContent).toContain('.multi-tab-modal[data-fx-id=');
    expect(instance?.textContent).not.toContain('3.6s');
  });

  it('點「我知道了」關掉提示與該實例樣式，靜態樣式留著，不發關閉訊息', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const stop = initMultiTabGuard();
    const other = new FakeBroadcastChannel('toosterx-tab-guard');
    const messages: unknown[] = [];
    other.onmessage = (ev) => {
      messages.push(ev.data);
    };
    other.postMessage({ type: 'ping', tabId: 'other-1' });
    const overlay = await shownWarning();
    messages.length = 0;
    (overlay.querySelector('#multi-tab-dismiss') as HTMLButtonElement).click();
    expect(document.getElementById('multi-tab-warning')).toBeNull();
    expect(document.querySelector('.legacy-ui')).toBeNull();
    expect(document.querySelector('svg.orbit')).toBeNull();
    expect(document.querySelector('style[data-multi-tab-fx-instance]')).toBeNull();
    expect(document.getElementById(MULTI_TAB_FX_STYLE_ID)).toBeTruthy();
    expect(messages.some((m) => (m as { type?: string }).type === 'close-others')).toBe(false);
    stop();
  });

  it('點「關閉其他分頁」請其他舊分頁關閉，並清掉實例樣式與 DOM', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const stop = initMultiTabGuard();
    const other = new FakeBroadcastChannel('toosterx-tab-guard');
    const messages: unknown[] = [];
    other.onmessage = (ev) => {
      messages.push(ev.data);
    };
    other.postMessage({ type: 'ping', tabId: 'other-1' });
    const overlay = await shownWarning();
    (overlay.querySelector('#multi-tab-close') as HTMLButtonElement).click();
    const closeMsg = messages.find((m) => (m as { type?: string }).type === 'close-others') as {
      type?: string;
      tabId?: string;
    };
    expect(closeMsg?.tabId).toEqual(expect.any(String));
    expect(closeMsg?.tabId?.length).toBeGreaterThan(0);
    expect(document.getElementById('multi-tab-warning')).toBeNull();
    expect(document.querySelector('style[data-multi-tab-fx-instance]')).toBeNull();
    expect(document.querySelector('svg.orbit')).toBeNull();
    stop();
  });

  it('重複偵測不重複彈窗', () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    showMultiTabWarning();
    showMultiTabWarning();
    expect(document.querySelectorAll('#multi-tab-warning')).toHaveLength(1);

    const stop = initMultiTabGuard();
    const other = new FakeBroadcastChannel('toosterx-tab-guard');
    other.postMessage({ type: 'ping', tabId: 'other-1' });
    other.postMessage({ type: 'ping', tabId: 'other-1' });
    other.postMessage({ type: 'pong', tabId: 'other-2' });
    expect(document.querySelectorAll('#multi-tab-warning')).toHaveLength(1);
    stop();
  });

  it('收到關閉其他分頁時清掉提示與實例樣式', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const stop = initMultiTabGuard();
    const other = new FakeBroadcastChannel('toosterx-tab-guard');
    other.postMessage({ type: 'ping', tabId: 'other-1' });
    await shownWarning();
    other.postMessage({ type: 'close-others', tabId: 'other-1' });
    expect(closeSpy).toHaveBeenCalled();
    expect(document.getElementById('multi-tab-warning')).toBeNull();
    expect(document.querySelector('style[data-multi-tab-fx-instance]')).toBeNull();
    stop();
    closeSpy.mockRestore();
  });

  it('靜態樣式只注入一次', async () => {
    const first = await shownWarning();
    const style = document.getElementById(MULTI_TAB_FX_STYLE_ID);
    (first.querySelector('#multi-tab-dismiss') as HTMLButtonElement).click();
    _resetMultiTabGuardForTest();
    const second = await shownWarning();
    expect(second).toBeTruthy();
    expect(document.querySelectorAll(`#${MULTI_TAB_FX_STYLE_ID}`)).toHaveLength(1);
    expect(document.getElementById(MULTI_TAB_FX_STYLE_ID)).toBe(style);
  });
});

describe('applyMultiTabFx 尺寸改變重算', () => {
  it('掛載時依實際尺寸建立光軌；尺寸改變後 viewBox 跟著更新', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const wrapper = document.createElement('div');
    const overlay = document.createElement('div');
    overlay.id = 'multi-tab-warning';
    overlay.className = 'multi-tab-overlay';
    overlay.innerHTML =
      '<div class="multi-tab-modal">' +
        '<div class="multi-tab-title">偵測到多個分頁開啟</div>' +
        '<button type="button" id="multi-tab-dismiss">我知道了</button>' +
        '<button type="button" id="multi-tab-close">關閉其他分頁</button>' +
      '</div>';
    wrapper.appendChild(overlay);
    document.body.appendChild(wrapper);
    const modal = overlay.querySelector('.multi-tab-modal') as HTMLElement;
    setSize(modal, 340, 220);
    const cleanup = applyMultiTabFx(overlay);
    const orbit = modal.querySelector('svg.orbit') as SVGSVGElement;
    const style = document.querySelector('style[data-multi-tab-fx-instance]') as HTMLStyleElement;
    expect(orbit.getAttribute('viewBox')).toBe('0 0 340 220');
    expect(orbit.querySelectorAll('rect')).toHaveLength(4);
    expect(orbit.querySelector('rect')?.getAttribute('rx')).toBe('18');
    const before = style.textContent;
    expect(before).toContain('4.2s linear infinite');

    setSize(modal, 280, 190);
    observers[0]?.cb();
    expect(orbit.getAttribute('viewBox')).toBe('0 0 280 190');
    expect(orbit.querySelectorAll('rect')).toHaveLength(4);
    expect(style.textContent).not.toBe(before);

    const rect = modal.querySelector('svg.orbit rect');
    observers[0]?.cb();
    expect(modal.querySelector('svg.orbit rect')).toBe(rect);

    cleanup();
    expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(style.isConnected).toBe(false);
    expect(modal.querySelector('svg.orbit')).toBeNull();
    expect(modal.querySelector('.burst')).toBeNull();
    expect(document.getElementById(MULTI_TAB_FX_STYLE_ID)).toBeTruthy();
  });

  it('沒有 ResizeObserver 的環境仍可套用（量一次）', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const wrapper = document.createElement('div');
    const overlay = document.createElement('div');
    overlay.id = 'multi-tab-warning';
    overlay.innerHTML = '<div class="multi-tab-modal"></div>';
    wrapper.appendChild(overlay);
    document.body.appendChild(wrapper);
    const modal = overlay.querySelector('.multi-tab-modal') as HTMLElement;
    setSize(modal, 300, 200);
    const cleanup = applyMultiTabFx(overlay);
    expect((modal.querySelector('svg.orbit') as SVGSVGElement).getAttribute('viewBox')).toBe('0 0 300 200');
    cleanup();
  });
});
