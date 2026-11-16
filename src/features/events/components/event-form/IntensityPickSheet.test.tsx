import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntensityPickSheet } from './IntensityPickSheet';

const mocks = vi.hoisted(() => ({
  back: null as null | (() => boolean),
  release: vi.fn(),
}));

vi.mock('@/core/overlay-back', () => ({
  pushOverlay: (callback: () => boolean) => {
    mocks.back = callback;
    return mocks.release;
  },
}));

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  mocks.back = null;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('IntensityPickSheet', () => {
  it('三個選項順序是一般、新手友善、高強度，且是 dialog', () => {
    render(<IntensityPickSheet open onClose={vi.fn()} onPick={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.id).toBe('create-event-intensity-sheet');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.parentElement?.className).toBe('legacy-ui');
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect([...dialog.querySelectorAll('.cets-option b')].map((el) => el.textContent))
      .toEqual(['一般', '新手友善', '高強度']);
    expect([...dialog.querySelectorAll('.cets-option')].map((el) => el.getAttribute('data-intensity')))
      .toEqual(['normal', 'beginner', 'high-intensity']);
  });

  it('點選先 onClose 再 onPick', () => {
    const calls: string[] = [];
    render(
      <IntensityPickSheet
        open
        onClose={() => calls.push('close')}
        onPick={(level) => calls.push(`pick:${level || 'normal'}`)}
      />,
    );
    fireEvent.click(screen.getByText('一般'));
    fireEvent.click(screen.getByText('新手友善'));
    fireEvent.click(screen.getByText('高強度'));
    expect(calls).toEqual([
      'close', 'pick:normal',
      'close', 'pick:beginner',
      'close', 'pick:high-intensity',
    ]);
  });

  it('取消只關閉；返回鍵走 overlay', () => {
    const close = vi.fn();
    const pick = vi.fn();
    const view = render(<IntensityPickSheet open onClose={close} onPick={pick} />);
    fireEvent.click(screen.getByText('選擇活動分類'));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('取消'));
    expect(close).toHaveBeenCalledTimes(1);
    expect(pick).not.toHaveBeenCalled();
    expect(mocks.back?.()).toBe(true);
    expect(close).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('關閉時不留 dialog', () => {
    render(<IntensityPickSheet open={false} onClose={vi.fn()} onPick={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
