import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetReloadSafetyForTest, evaluateReloadSafety, requestSafeReload } from './reload-safety';

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
