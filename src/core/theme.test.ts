import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { h } from 'preact';
import { getTheme, initTheme, setTheme, useTheme } from '@/core/theme';

function Probe(): preact.JSX.Element {
  const theme = useTheme();
  return h('span', { 'data-testid': 'theme' }, theme);
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  initTheme();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  // 測試同步更新（R-QA-005）：改照 A——屬性一律為 dark／light，偏好存在 sporthub_theme。
  it('setTheme dark 設定 data-theme 並存 sporthub_theme；system 依系統偏好設屬性並刪除偏好', () => {
    setTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('sporthub_theme')).toBe('dark');

    window.matchMedia = vi.fn().mockReturnValue({ matches: false } as MediaQueryList);
    setTheme('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('sporthub_theme')).toBeNull();
  });

  it('沒有偏好時跟隨系統深色（A bindTheme）', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true } as MediaQueryList);
    initTheme();
    expect(getTheme()).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('舊的 toosterx:theme 偏好會搬到 sporthub_theme', () => {
    localStorage.setItem('toosterx:theme', 'dark');
    initTheme();
    expect(getTheme()).toBe('dark');
    expect(localStorage.getItem('sporthub_theme')).toBe('dark');
    expect(localStorage.getItem('toosterx:theme')).toBeNull();
  });

  it('useTheme 在 render 後切換主題會更新', () => {
    const { getByTestId } = render(h(Probe, null));

    expect(getByTestId('theme').textContent).toBe('system');

    act(() => {
      setTheme('dark');
    });

    expect(getByTestId('theme').textContent).toBe('dark');
  });

  it('localStorage getItem 丟錯時 initTheme／getTheme 不拋錯', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('getItem failed');
    });

    expect(() => initTheme()).not.toThrow();
    expect(() => getTheme()).not.toThrow();
  });

  it('localStorage setItem 丟錯時 setTheme 不拋錯', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('setItem failed');
    });

    expect(() => setTheme('dark')).not.toThrow();
    expect(getTheme()).toBe('dark');
  });
});
