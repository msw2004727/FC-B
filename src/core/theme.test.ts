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
  it('setTheme dark 會設定 data-theme，system 會移除屬性', () => {
    setTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    setTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
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
