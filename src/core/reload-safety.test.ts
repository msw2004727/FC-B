import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getByRole, queryByRole } from '@testing-library/preact';
import { setLocale } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import {
  UPDATE_PROMPT_OPEN_CLASS,
  _resetReloadSafetyForTest,
  dismissForcedUpdatePrompt,
  evaluateReloadSafety,
  requestSafeReload,
  showSwReloadPrompt,
} from './reload-safety';
import { _resetSubmitGuardForTest, beginSubmitting } from './submit-guard';

// UPD-3P：提示框文字改走 t()，測試先載入 zh-TW 字典（測試同步更新）。
beforeAll(async () => {
  await setLocale('zh-TW');
});

afterAll(() => {
  localStorage.removeItem('toosterx:locale');
});

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
    // UPD-3P：說明行拿掉（測試同步更新）
    expect(prompt.textContent).not.toContain('完成目前操作後會自動更新');
    expect(prompt.querySelector('.t2')).toBeNull();
    expect(prompt.querySelector('.t1')?.textContent).toBe('有新版本可用');
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
    // UPD-3P：升級成強制時標題改成強制版（測試同步更新）
    expect(prompt.querySelector('.t1')?.textContent).toBe('請更新到新版');
    expect(prompt.textContent).not.toContain('有新版本可用');
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

describe('UPD-3P 單行提示框（方案乙）', () => {
  afterEach(() => {
    _resetReloadSafetyForTest();
    _resetSubmitGuardForTest();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  const bodyOpen = (): boolean => document.body.classList.contains(UPDATE_PROMPT_OPEN_CLASS);

  it('一般版：標題、現在更新、稍後，沒有說明行；按鈕有可讀名稱', async () => {
    const prompt = await shownPrompt(vi.fn(), 'sw-waiting');
    expect(prompt.querySelector('[data-sw-reload-title]')?.textContent).toBe('有新版本可用');
    expect(prompt.textContent).not.toContain('完成目前操作後會自動更新');
    expect(prompt.querySelectorAll('.t2, .acts, .txt')).toHaveLength(0);
    expect(getByRole(prompt, 'button', { name: '現在更新' })).toBe(prompt.querySelector('[data-sw-reload-now]'));
    expect(getByRole(prompt, 'button', { name: '稍後' })).toBe(prompt.querySelector('[data-sw-reload-later]'));
    // 單行：圖示、標題、按鈕都在同一列
    const row = prompt.querySelector('.row');
    expect([...(row?.children ?? [])].map((el) => el.className.split(' ')[0])).toEqual(['ico', 't1', 'go', 'later']);
  });

  it('強制版：標題「請更新到新版」，只有現在更新、沒有稍後', async () => {
    const prompt = await shownPrompt(vi.fn(), 'min-build', { forced: true });
    expect(prompt.querySelector('[data-sw-reload-title]')?.textContent).toBe('請更新到新版');
    expect(getByRole(prompt, 'button', { name: '現在更新' })).toBeTruthy();
    expect(queryByRole(prompt, 'button', { name: '稍後' })).toBeNull();
    expect(prompt.querySelectorAll('button')).toHaveLength(1);
  });

  it('強制優先：強制顯示中再來一般呼叫，標題與按鈕維持強制版', async () => {
    const prompt = await shownPrompt(vi.fn(), 'min-build', { forced: true });
    showSwReloadPrompt(vi.fn(), 'sw-waiting');
    expect(prompt.dataset.mode).toBe('forced');
    expect(prompt.querySelector('[data-sw-reload-title]')?.textContent).toBe('請更新到新版');
    expect(prompt.querySelector('[data-sw-reload-later]')).toBeNull();
  });

  it('特效載入前就升級成強制：套特效後仍是強制標題、沒有稍後', async () => {
    showSwReloadPrompt(vi.fn(), 'sw-waiting');
    showSwReloadPrompt(vi.fn(), 'min-build', { forced: true });
    const prompt = promptEl();
    await vi.waitFor(() => {
      expect(prompt.classList.contains('sw-reload-fx')).toBe(true);
    });
    expect(prompt.querySelector('.t1')?.textContent).toBe('請更新到新版');
    expect(prompt.querySelector('[data-sw-reload-later]')).toBeNull();
  });

  it('一般升強制、收掉強制後還原一般：標題換回、稍後回來，body class 一直在', () => {
    const swFn = vi.fn();
    showSwReloadPrompt(swFn, 'sw-waiting');
    expect(bodyOpen()).toBe(true);
    showSwReloadPrompt(vi.fn(), 'min-build', { forced: true });
    expect(promptEl().querySelector('[data-sw-reload-title]')?.textContent).toBe('請更新到新版');
    dismissForcedUpdatePrompt();
    const prompt = promptEl();
    expect(prompt.dataset.mode).toBeUndefined();
    expect(prompt.querySelector('[data-sw-reload-title]')?.textContent).toBe('有新版本可用');
    expect(prompt.querySelector('[data-sw-reload-later]')).toBeTruthy();
    expect(bodyOpen()).toBe(true);
    (prompt.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(swFn).toHaveBeenCalledTimes(1);
  });

  it('body class：顯示時加上，按稍後、按現在更新、收掉強制框都移除', () => {
    expect(bodyOpen()).toBe(false);
    showSwReloadPrompt(vi.fn(), 'sw-waiting');
    expect(bodyOpen()).toBe(true);
    (promptEl().querySelector('[data-sw-reload-later]') as HTMLButtonElement).click();
    expect(bodyOpen()).toBe(false);

    showSwReloadPrompt(vi.fn(), 'sw-waiting');
    (promptEl().querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(bodyOpen()).toBe(false);

    showSwReloadPrompt(vi.fn(), 'min-build', { forced: true });
    expect(bodyOpen()).toBe(true);
    dismissForcedUpdatePrompt();
    expect(bodyOpen()).toBe(false);
  });

  it('寫入中按現在更新：提示框與 body class 都留著', () => {
    const release = beginSubmitting('event-save');
    showSwReloadPrompt(vi.fn(), 'write-pending');
    (promptEl().querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(bodyOpen()).toBe(true);
    release();
  });

  it('有底部導覽時停在導覽列上方；沒有 #bottom-tabs 時標 data-dock=bare', () => {
    document.body.innerHTML = '<nav id="bottom-tabs"></nav>';
    showSwReloadPrompt(vi.fn(), 'sw-waiting');
    expect(promptEl().dataset.dock).toBeUndefined();
    _resetReloadSafetyForTest();
    document.body.innerHTML = '';
    showSwReloadPrompt(vi.fn(), 'sw-waiting');
    expect(promptEl().dataset.dock).toBe('bare');
  });

  it('提示框本身不會讓 evaluateReloadSafety 判定彈窗開著（備用外觀與特效都一樣）', async () => {
    showSwReloadPrompt(vi.fn(), 'sw-waiting');
    expect(evaluateReloadSafety({ currentPath: '/' })).toEqual({ safe: true });
    await vi.waitFor(() => {
      expect(promptEl().classList.contains('sw-reload-fx')).toBe(true);
    });
    expect(evaluateReloadSafety({ currentPath: '/' })).toEqual({ safe: true });
    showSwReloadPrompt(vi.fn(), 'min-build', { forced: true });
    expect(evaluateReloadSafety({ currentPath: '/' })).toEqual({ safe: true });
    expect(promptEl().getAttribute('role')).toBe('status');
    expect(promptEl().getAttribute('aria-modal')).toBeNull();
  });

  it('不搶焦點：顯示後焦點留在原處；按鈕是原生 button，可用 Tab 到達', async () => {
    document.body.innerHTML = '<a href="#x" id="anchor">x</a>';
    const anchor = document.getElementById('anchor') as HTMLAnchorElement;
    anchor.focus();
    const prompt = await shownPrompt(vi.fn(), 'sw-waiting');
    expect(document.activeElement).toBe(anchor);
    for (const button of prompt.querySelectorAll('button')) {
      expect(button.tabIndex).toBe(0);
      expect(button.disabled).toBe(false);
    }
  });

  it('prefers-reduced-motion：淡入不用動畫，靜態樣式停掉所有動畫', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const prompt = await shownPrompt(vi.fn(), 'sw-waiting');
    expect(prompt.style.transition).toBe('');
    expect(prompt.style.opacity).toBe('1');
    const css = document.getElementById('sw-reload-prompt-fx-style')?.textContent ?? '';
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const sel of ['.orbit .tail', '.orbit .mid', '.orbit .head', '.burst', '.ico svg', '.go::after']) {
      expect(reduce).toContain(`#sw-reload-deferred-prompt.sw-reload-fx ${sel}`);
    }
    expect(reduce).toContain('animation: none !important');
  });

  it('語系切換後新開的提示框用該語系文字', async () => {
    await setLocale('en');
    try {
      showSwReloadPrompt(vi.fn(), 'sw-waiting');
      const prompt = promptEl();
      expect(prompt.querySelector('[data-sw-reload-title]')?.textContent).toBe('New version');
      expect(getByRole(prompt, 'button', { name: 'Update now' })).toBeTruthy();
      expect(getByRole(prompt, 'button', { name: 'Later' })).toBeTruthy();
      showSwReloadPrompt(vi.fn(), 'min-build', { forced: true });
      expect(prompt.querySelector('[data-sw-reload-title]')?.textContent).toBe('Please update');
    } finally {
      await setLocale('zh-TW');
    }
  });
});
