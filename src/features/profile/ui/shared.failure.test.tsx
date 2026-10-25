import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../data/profile-writes', () => ({
  normalizeLineContactUrl: (value: unknown) => String(value ?? ''),
}));

import { Failure, Missing } from './shared';

describe('Failure（個人頁載入失敗）', () => {
  afterEach(() => {
    cleanup();
  });

  it('重試鈕用 A 的 primary-btn small（個人頁在 .legacy-ui 內，無 class 的 button 會被 A 的重設洗成純文字）', () => {
    const retry = vi.fn();
    render(<Failure retry={retry} />);
    const button = screen.getByRole('button');
    expect(button.classList.contains('primary-btn')).toBe(true);
    expect(button.classList.contains('small')).toBe(true);
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('Missing 帶 retry：同一個區塊內有重試鈕，沒有 role="alert"；不帶 retry 時沒有按鈕', () => {
    const retry = vi.fn();
    const { container, rerender } = render(<Missing retry={retry} />);
    expect(container.querySelectorAll('.profile-state')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const button = screen.getByRole('button');
    expect(button.classList.contains('primary-btn')).toBe(true);
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);

    rerender(<Missing />);
    expect(container.querySelector('button')).toBeNull();
  });
});
