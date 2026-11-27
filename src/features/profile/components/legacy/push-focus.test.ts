import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusPushRow, hasPushFocus, PUSH_FOCUS_WAIT_MS } from './push-focus';

const scrollIntoView = vi.fn();

function panel(inner = ''): HTMLElement {
  const el = document.createElement('div');
  el.id = 'profile-quick-panel';
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  scrollIntoView.mockClear();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true });
  history.replaceState({ sentinel: true }, '', '/profile?open=line&focus=push');
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('push-focus', () => {
  it('hasPushFocus：只認 focus=push', () => {
    expect(hasPushFocus('?open=line&focus=push')).toBe(true);
    expect(hasPushFocus('?open=line')).toBe(false);
    expect(hasPushFocus('?focus=other')).toBe(false);
  });

  it('推播列已在：立刻捲到它，清掉 focus、保留 open 與 history.state', () => {
    const p = panel('<div class="wp-block wp-c"></div>');
    focusPushRow();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(p.querySelector('.wp-block'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(location.search).toBe('?open=line');
    expect(history.state).toEqual({ sentinel: true });
  });

  it('延後載入：先捲到等高空白，列換上後再捲到列', async () => {
    const p = panel('<div class="wp-placeholder"></div>');
    focusPushRow();
    expect(scrollIntoView.mock.contexts[0]).toBe(p.querySelector('.wp-placeholder'));
    expect(location.search).toBe('?open=line&focus=push');
    p.innerHTML = '<div class="wp-block wp-c is-banner"></div>';
    await flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.contexts[1]).toBe(p.querySelector('.wp-block'));
    expect(location.search).toBe('?open=line');
  });

  it('面板晚出現也等得到', async () => {
    focusPushRow();
    expect(scrollIntoView).not.toHaveBeenCalled();
    const p = panel('<div class="wp-block"></div>');
    await flush();
    expect(scrollIntoView.mock.contexts[0]).toBe(p.querySelector('.wp-block'));
  });

  it('等不到推播列（不支援的環境）：逾時捲到通知面板並清參數，不報錯', () => {
    vi.useFakeTimers();
    const p = panel('<div class="line-card"></div>');
    focusPushRow();
    expect(scrollIntoView).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PUSH_FOCUS_WAIT_MS);
    expect(scrollIntoView.mock.contexts[0]).toBe(p);
    expect(location.search).toBe('?open=line');
  });

  it('頁面先卸載：取消後不再捲動、不動網址', async () => {
    const cancel = focusPushRow();
    cancel();
    panel('<div class="wp-block"></div>');
    await flush();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(location.search).toBe('?open=line&focus=push');
  });

  it('scrollIntoView 丟錯也不往外丟', () => {
    scrollIntoView.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    panel('<div class="wp-block"></div>');
    expect(() => focusPushRow()).not.toThrow();
    expect(location.search).toBe('?open=line');
  });
});
