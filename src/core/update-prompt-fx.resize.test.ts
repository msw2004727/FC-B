import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUpdatePromptFx } from './update-prompt-fx';

// 尺寸改變（字型載入、旋轉螢幕、視窗縮放）時要重新量測並重算光軌；取代原本只在掛載時量一次。

type Callback = () => void;
const observers: Array<{ cb: Callback; disconnect: ReturnType<typeof vi.fn> }> = [];

class FakeResizeObserver {
  disconnect = vi.fn();
  constructor(readonly cb: Callback) {
    observers.push({ cb, disconnect: this.disconnect });
  }
  observe(): void {}
}

// UPD-3P：提示框改單行、沒有說明行，標題節點帶 data-sw-reload-title（測試同步更新）。
function buildPrompt(): HTMLElement {
  const prompt = document.createElement('div');
  prompt.id = 'sw-reload-deferred-prompt';
  prompt.innerHTML =
    '<div data-sw-reload-title>有新版本可用</div>' +
    '<button type="button" data-sw-reload-now>現在更新</button>' +
    '<button type="button" data-sw-reload-later>稍後</button>';
  document.body.appendChild(prompt);
  return prompt;
}

function setSize(el: HTMLElement, w: number, h: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: w });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h });
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.head.querySelectorAll('style[data-sw-reload-fx-instance]').forEach((n) => n.remove());
});

describe('update-prompt-fx 尺寸改變重算', () => {
  it('掛載時依實際尺寸建立光軌；尺寸改變後 viewBox 與 keyframes 跟著更新', () => {
    const prompt = buildPrompt();
    setSize(prompt, 340, 150);
    const cleanup = applyUpdatePromptFx(prompt);
    const orbit = prompt.querySelector('svg.orbit') as SVGSVGElement;
    const style = document.head.querySelector('style[data-sw-reload-fx-instance]') as HTMLStyleElement;
    expect(orbit.getAttribute('viewBox')).toBe('0 0 340 150');
    const before = style.textContent;
    expect(orbit.querySelectorAll('rect')).toHaveLength(4);

    setSize(prompt, 280, 190);
    observers[0]?.cb();
    expect(orbit.getAttribute('viewBox')).toBe('0 0 280 190');
    expect(orbit.querySelectorAll('rect')).toHaveLength(4);
    expect(style.textContent).not.toBe(before);
    cleanup();
  });

  it('尺寸沒變時不重算；清理時中斷觀察並移除 keyframes', () => {
    const prompt = buildPrompt();
    setSize(prompt, 340, 150);
    const cleanup = applyUpdatePromptFx(prompt);
    const style = document.head.querySelector('style[data-sw-reload-fx-instance]') as HTMLStyleElement;
    const rects = prompt.querySelectorAll('svg.orbit rect');
    observers[0]?.cb();
    expect(prompt.querySelectorAll('svg.orbit rect')[0]).toBe(rects[0]);

    cleanup();
    expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(style.isConnected).toBe(false);
  });

  it('沒有 ResizeObserver 的環境仍可套用（量一次）', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('ResizeObserver', undefined);
    const prompt = buildPrompt();
    setSize(prompt, 340, 150);
    const cleanup = applyUpdatePromptFx(prompt);
    expect((prompt.querySelector('svg.orbit') as SVGSVGElement).getAttribute('viewBox')).toBe('0 0 340 150');
    cleanup();
  });
});
