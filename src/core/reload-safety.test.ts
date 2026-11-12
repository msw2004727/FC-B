import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/ui/Toast';
import { _resetReloadSafetyForTest, dismissForcedUpdatePrompt, evaluateReloadSafety, requestSafeReload, showSwReloadPrompt } from './reload-safety';
import { _resetSubmitGuardForTest, beginSubmitting } from './submit-guard';

describe('reload-safety（M-052 新版本安全重載）', () => {
  afterEach(() => {
    _resetReloadSafetyForTest();
    document.body.innerHTML = '';
  });

  it('首頁、無彈窗、無編輯時可直接重載', () => {
    expect(evaluateReloadSafety({ currentPath: '/' })).toEqual({ safe: true });
    const reload = vi.fn();
    expect(requestSafeReload(reload, { currentPath: '/activities' })).toEqual({ reloaded: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('只有 data-submitting、沒有 aria-busy，也算寫入中；data-form-dirty 仍算', () => {
    document.body.innerHTML = '<div data-submitting="true"></div>';
    expect(evaluateReloadSafety({ currentPath: '/' })).toEqual({ safe: false, reason: 'write-pending' });
    document.body.innerHTML = '<form data-form-dirty="true"></form>';
    expect(evaluateReloadSafety({ currentPath: '/' }).reason).toBe('write-pending');
  });

  it('彈窗開著或非安全頁時不重載，改顯示「有新版本可用」', () => {
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    expect(evaluateReloadSafety({ currentPath: '/' }).reason).toBe('modal-open');
    document.body.innerHTML = '';
    const reload = vi.fn();
    const result = requestSafeReload(reload, { currentPath: '/events/e1' });
    expect(result).toEqual({ reloaded: false, reason: 'unsafe-page' });
    expect(reload).not.toHaveBeenCalled();
    const prompt = document.getElementById('sw-reload-deferred-prompt');
    expect(prompt?.textContent).toContain('有新版本可用');
    (prompt?.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

function promptEl(): HTMLElement {
  const el = document.getElementById('sw-reload-deferred-prompt');
  if (!el) throw new Error('缺少更新提示框');
  return el;
}

async function shownPrompt(
  reload: () => void,
  reason = 'unsafe-page',
  opts?: { forced?: boolean },
): Promise<HTMLElement> {
  showSwReloadPrompt(reload, reason, opts);
  const prompt = promptEl();
  Object.defineProperty(prompt, 'offsetWidth', { configurable: true, value: 360 });
  Object.defineProperty(prompt, 'offsetHeight', { configurable: true, value: 140 });
  await vi.waitFor(() => {
    expect(prompt.querySelectorAll('svg.orbit rect')).toHaveLength(4);
    expect(prompt.style.opacity).toBe('1');
  });
  return prompt;
}

describe('showSwReloadPrompt 銅金光軌', () => {
  afterEach(() => {
    _resetReloadSafetyForTest();
    _resetSubmitGuardForTest();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-submitting');
  });

  it('import 完成後有光軌、星芒與靜態樣式，文案與屬性不變', async () => {
    const prompt = await shownPrompt(vi.fn(), 'unsafe-page');
    expect(prompt.getAttribute('role')).toBe('status');
    expect(prompt.getAttribute('aria-live')).toBe('polite');
    expect(prompt.dataset.reason).toBe('unsafe-page');
    expect(prompt.textContent).toContain('有新版本可用');
    expect(prompt.textContent).toContain('完成目前操作後會自動更新。');
    expect(prompt.querySelector('[data-sw-reload-now]')?.textContent).toBe('現在更新');
    expect(prompt.querySelector('[data-sw-reload-later]')?.textContent).toBe('稍後');

    const rects = [...prompt.querySelectorAll('svg.orbit rect')];
    expect(rects.map((rect) => rect.getAttribute('class'))).toEqual(['base', 'tail', 'mid', 'head']);
    expect(rects.every((rect) => rect.getAttribute('pathLength') === '100')).toBe(true);
    expect(prompt.querySelector('.burst svg')).toBeTruthy();
    expect(prompt.querySelector('.ico svg')).toBeTruthy();

    const staticStyle = document.getElementById('sw-reload-prompt-fx-style');
    expect(staticStyle?.textContent).toContain('prefers-reduced-motion');
    expect(staticStyle?.textContent).toContain('-webkit-backdrop-filter');
    expect(staticStyle?.textContent).toContain('@supports not');
    expect(document.querySelectorAll('#sw-reload-prompt-fx-style')).toHaveLength(1);
    expect(document.querySelector('style[data-sw-reload-fx-instance]')).toBeTruthy();
    expect(rects[0]?.getAttribute('width')).toBe(String(360 - 1));
  });

  it('點「稍後」移除提示框與該實例的 style，靜態樣式留著', async () => {
    const prompt = await shownPrompt(vi.fn());
    (prompt.querySelector('[data-sw-reload-later]') as HTMLButtonElement).click();
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
    expect(document.querySelector('svg.orbit')).toBeNull();
    expect(document.querySelector('style[data-sw-reload-fx-instance]')).toBeNull();
    expect(document.getElementById('sw-reload-prompt-fx-style')).toBeTruthy();
  });

  it('點「現在更新」呼叫重載，並清掉實例 style 與 DOM', async () => {
    const reload = vi.fn();
    const prompt = await shownPrompt(reload);
    (prompt.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
    expect(document.querySelector('style[data-sw-reload-fx-instance]')).toBeNull();
  });

  it('重複呼叫不產生第二個提示框，但改掛最新的重載函式', () => {
    const first = vi.fn();
    const second = vi.fn();
    showSwReloadPrompt(first, 'unsafe-page');
    showSwReloadPrompt(second, 'modal-open');
    expect(document.querySelectorAll('#sw-reload-deferred-prompt')).toHaveLength(1);
    expect(promptEl().dataset.reason).toBe('unsafe-page');
    (promptEl().querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('寫入尚未完成時點「現在更新」只跳 toast，不重載、不關閉', () => {
    document.body.innerHTML = '<form data-submitting="true"></form>';
    const reload = vi.fn();
    const spy = vi.spyOn(toast, 'show');
    showSwReloadPrompt(reload, 'write-pending');
    (promptEl().querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(reload).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ message: '目前操作尚未完成，稍後再更新', duration: 3000 });
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeTruthy();
    spy.mockRestore();
  });

  it('T12 先一般再強制：稍後被移除，改掛新的重載函式', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const prompt = await shownPrompt(first, 'sw-waiting');
    expect(prompt.querySelector('[data-sw-reload-later]')).toBeTruthy();
    showSwReloadPrompt(second, 'min-build', { forced: true });
    expect(prompt.dataset.mode).toBe('forced');
    expect(prompt.querySelector('[data-sw-reload-later]')).toBeNull();
    expect(prompt.querySelector('[data-sw-reload-now]')).toBeTruthy();
    expect(prompt.textContent).toContain('有新版本可用');
    expect(prompt.textContent).toContain('完成目前操作後會自動更新。');
    (prompt.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('T12 先強制再一般：光軌載入後仍沒有稍後', async () => {
    const prompt = await shownPrompt(vi.fn(), 'min-build', { forced: true });
    expect(prompt.dataset.mode).toBe('forced');
    expect(prompt.querySelector('[data-sw-reload-later]')).toBeNull();
    expect(prompt.querySelector('svg.orbit')).toBeTruthy();
    showSwReloadPrompt(vi.fn(), 'sw-waiting');
    expect(prompt.dataset.mode).toBe('forced');
    expect(prompt.querySelector('[data-sw-reload-later]')).toBeNull();
    expect(prompt.querySelector('[data-sw-reload-now]')?.textContent).toBe('現在更新');
  });

  it('isSubmitting 為真時點現在更新不重載，即使沒有 data-submitting 標記', () => {
    const release = beginSubmitting('event-save');
    document.documentElement.removeAttribute('data-submitting');
    const reload = vi.fn();
    const spy = vi.spyOn(toast, 'show');
    showSwReloadPrompt(reload, 'write-pending');
    (promptEl().querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(reload).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ message: '目前操作尚未完成，稍後再更新', duration: 3000 });
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeTruthy();
    release();
    spy.mockRestore();
  });

  it('靜態樣式只注入一次', async () => {
    const first = await shownPrompt(vi.fn());
    const style = document.getElementById('sw-reload-prompt-fx-style');
    (first.querySelector('[data-sw-reload-later]') as HTMLButtonElement).click();
    const second = await shownPrompt(vi.fn(), 'modal-open');
    expect(second).toBeTruthy();
    expect(document.querySelectorAll('#sw-reload-prompt-fx-style')).toHaveLength(1);
    expect(document.getElementById('sw-reload-prompt-fx-style')).toBe(style);
  });

  it('強制提示框已顯示時，SW 等待中的一般呼叫不得換掉強制路徑的重載函式', () => {
    const forcedFn = vi.fn();
    const swFn = vi.fn();
    showSwReloadPrompt(forcedFn, 'min-build', { forced: true });
    showSwReloadPrompt(swFn, 'sw-waiting');
    (promptEl().querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(forcedFn).toHaveBeenCalledTimes(1);
    expect(swFn).not.toHaveBeenCalled();
  });

  it('minBuild 改回 0 收掉強制框時，等待中的 SW 一般提示還原（有「稍後」、用 SW 函式）', () => {
    const forcedFn = vi.fn();
    const swFn = vi.fn();
    showSwReloadPrompt(forcedFn, 'min-build', { forced: true });
    showSwReloadPrompt(swFn, 'sw-waiting');
    dismissForcedUpdatePrompt();
    const prompt = promptEl();
    expect(prompt.dataset.mode).toBeUndefined();
    expect(prompt.querySelector('[data-sw-reload-later]')).toBeTruthy();
    (prompt.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(swFn).toHaveBeenCalledTimes(1);
    expect(forcedFn).not.toHaveBeenCalled();
  });

  it('沒有等待中的 SW 提示時，收掉強制框後不留任何提示', () => {
    showSwReloadPrompt(vi.fn(), 'min-build', { forced: true });
    dismissForcedUpdatePrompt();
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
  });

  it('一般提示先出再升強制，收掉強制框時還原一般提示（有「稍後」、用 SW 函式）', () => {
    const swFn = vi.fn();
    const forcedFn = vi.fn();
    showSwReloadPrompt(swFn, 'sw-waiting');
    showSwReloadPrompt(forcedFn, 'min-build', { forced: true });
    expect(promptEl().dataset.mode).toBe('forced');
    dismissForcedUpdatePrompt();
    const prompt = promptEl();
    expect(prompt.dataset.mode).toBeUndefined();
    expect(prompt.querySelector('[data-sw-reload-later]')).toBeTruthy();
    (prompt.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(swFn).toHaveBeenCalledTimes(1);
    expect(forcedFn).not.toHaveBeenCalled();
  });

  it('強制框按現在更新後真的重載：不留任何提示框', () => {
    const swFn = vi.fn();
    const forcedFn = vi.fn();
    showSwReloadPrompt(forcedFn, 'min-build', { forced: true });
    showSwReloadPrompt(swFn, 'sw-waiting');
    (promptEl().querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(forcedFn).toHaveBeenCalledTimes(1);
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
  });

  it('強制框按現在更新但沒進入重載而重顯強制框：之後收掉強制框仍還原 SW 一般提示', () => {
    const swFn = vi.fn();
    const retryFn = vi.fn();
    showSwReloadPrompt(swFn, 'sw-waiting');
    showSwReloadPrompt(() => {
      showSwReloadPrompt(retryFn, 'min-build', { forced: true });
    }, 'min-build', { forced: true });
    (promptEl().querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(promptEl().dataset.mode).toBe('forced');
    dismissForcedUpdatePrompt();
    const prompt = promptEl();
    expect(prompt.dataset.mode).toBeUndefined();
    expect(prompt.querySelector('[data-sw-reload-later]')).toBeTruthy();
    (prompt.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(swFn).toHaveBeenCalledTimes(1);
    expect(retryFn).not.toHaveBeenCalled();
  });

  it('強制框按現在更新但沒進入重載而改延後收框：立即還原 SW 一般提示', () => {
    const swFn = vi.fn();
    showSwReloadPrompt(swFn, 'sw-waiting');
    showSwReloadPrompt(() => {
      dismissForcedUpdatePrompt();
    }, 'min-build', { forced: true });
    (promptEl().querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    const prompt = promptEl();
    expect(prompt.dataset.mode).toBeUndefined();
    expect(prompt.querySelector('[data-sw-reload-later]')).toBeTruthy();
    (prompt.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(swFn).toHaveBeenCalledTimes(1);
  });
});
