import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { ActionRingButton, useActionRingControl, type ActionRingControl } from './action-ring';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stubFrames() {
  let id = 0;
  const request = vi.fn((_callback: FrameRequestCallback) => ++id);
  const cancel = vi.fn((_handle: number) => {});
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return { request, cancel };
}

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** 只渲染按鈕；busy 由測試直接控制，模擬各元件原本的忙碌狀態。 */
function harness(height = 40) {
  let control!: ActionRingControl;
  let busy = false;
  function Host({ busyNow }: { busyNow: boolean }) {
    control = useActionRingControl();
    return (
      <ActionRingButton control={control} busyLabel="儲存中..." type="button" class="primary-btn"
        style="padding:.5rem" disabled={busyNow}>
        {busyNow ? '儲存中...' : '儲存'}
      </ActionRingButton>
    );
  }
  const spy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(height);
  const view = render(<Host busyNow={busy} />);
  return {
    view,
    get control() { return control; },
    setBusy(next: boolean): void {
      busy = next;
      view.rerender(<Host busyNow={busy} />);
    },
    button: (): HTMLButtonElement => view.container.querySelector('button') as HTMLButtonElement,
    restore: () => spy.mockRestore(),
  };
}

describe('useActionRingControl＋ActionRingButton', () => {
  it('成功：0ms 後縮成圓畫環，補滿＋✓ 停留後才放行，最後展開回原文字', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubFrames();
    const h = harness();
    h.setBusy(true);
    act(() => { h.control.start(); });
    expect(h.button().classList.contains('action-ring-btn')).toBe(false);
    act(() => { vi.advanceTimersByTime(0); });
    const button = h.button();
    expect(button.classList.contains('is-collapsed')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('儲存中...');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('style')).toMatch(/--action-ring-d:\s*40px/);
    expect(button.querySelector('.action-ring-mark .signup-ring-arc')).not.toBeNull();
    // 原內容留在 DOM 撐住寬度（CSS 隱藏），不換成別的文字。
    expect(button.querySelector('.action-ring-label')?.textContent).toBe('儲存中...');

    let released = false;
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = (async () => {
        await h.control.succeed();
        released = true;
      })();
    });
    expect(button.querySelector('.signup-ring-arc.is-fill')).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(180); });
    expect(button.querySelector('.signup-ring-check')?.textContent).toBe('✓');
    expect(released).toBe(false);
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(released).toBe(false);
    await act(async () => { vi.advanceTimersByTime(1); });
    await done;
    expect(released).toBe(true);
    expect(button.classList.contains('is-expanding')).toBe(true);
    h.setBusy(false);
    act(() => { vi.advanceTimersByTime(260); });
    expect(button.classList.contains('action-ring-btn')).toBe(false);
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.getAttribute('aria-label')).toBeNull();
    expect(button.querySelector('.action-ring-mark')).toBeNull();
    expect(button.textContent).toBe('儲存');
    expect(button.disabled).toBe(false);
    h.restore();
  });

  it('失敗：不打勾，直接展開回原狀', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubFrames();
    const h = harness();
    h.setBusy(true);
    act(() => { h.control.start(); vi.advanceTimersByTime(0); });
    act(() => { h.control.fail(); });
    expect(h.button().classList.contains('is-expanding')).toBe(true);
    expect(h.button().querySelector('.signup-ring-check')).toBeNull();
    h.setBusy(false);
    act(() => { vi.advanceTimersByTime(260); });
    expect(h.button().classList.contains('action-ring-btn')).toBe(false);
    expect(h.button().textContent).toBe('儲存');
    h.restore();
  });

  it('本地驗證失敗（同一輪就結束）：完全不縮圓、不留計時器', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const frames = stubFrames();
    const h = harness();
    act(() => {
      h.control.start();
      h.control.fail();
    });
    act(() => { vi.advanceTimersByTime(0); });
    expect(h.button().classList.contains('action-ring-btn')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.request).not.toHaveBeenCalled();
    // 同一輪就成功（例如寫入佇列已空）也不轉環，立即放行。
    let released = false;
    await act(async () => {
      h.control.start();
      await h.control.succeed();
      released = true;
    });
    expect(released).toBe(true);
    expect(h.button().classList.contains('action-ring-btn')).toBe(false);
    h.restore();
  });

  it('減少動態：不變形不畫環，維持原本忙碌文字，成功立即放行且不排計時器', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const frames = stubFrames();
    stubReducedMotion(true);
    const h = harness();
    h.setBusy(true);
    act(() => { h.control.start(); vi.advanceTimersByTime(0); });
    expect(h.button().classList.contains('action-ring-btn')).toBe(false);
    expect(h.button().querySelector('svg')).toBeNull();
    expect(h.button().textContent).toBe('儲存中...');
    expect(h.button().disabled).toBe(true);
    let released = false;
    await act(async () => {
      await h.control.succeed();
      released = true;
    });
    expect(released).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.request).not.toHaveBeenCalled();
    h.restore();
  });

  it('小按鈕：圓直徑取按鈕高度，不撐高版面', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubFrames();
    const h = harness(28);
    act(() => { h.control.start(); vi.advanceTimersByTime(0); });
    expect(h.button().getAttribute('style')).toMatch(/--action-ring-d:\s*28px/);
    h.restore();
  });

  it('卸載時清掉計時器與 rAF，等待中的 ✓ 也放行', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const frames = stubFrames();
    const h = harness();
    act(() => { h.control.start(); vi.advanceTimersByTime(0); });
    const lastFrame = frames.request.mock.results.at(-1)?.value;
    let released = false;
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = (async () => {
        await h.control.succeed();
        released = true;
      })();
    });
    expect(vi.getTimerCount()).toBe(1);
    h.view.unmount();
    await done;
    expect(released).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.cancel).toHaveBeenCalledWith(lastFrame);
    h.restore();
  });
});
