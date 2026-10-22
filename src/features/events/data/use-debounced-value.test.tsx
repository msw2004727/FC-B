import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act } from '@testing-library/preact';
import { useDebouncedValue } from './use-debounced-value';

function TestComp({ input, delay }: { input: string; delay: number }) {
  const { value, setImmediate } = useDebouncedValue(input, delay);
  return (
    <div>
      <span data-testid="value">{value}</span>
      <button data-testid="flush" onClick={() => setImmediate('')}>flush</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDebouncedValue', () => {
  it('延遲後才更新 value', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TestComp input="a" delay={150} />);
    expect(screen.getByTestId('value').textContent).toBe('a');
    rerender(<TestComp input="ab" delay={150} />);
    expect(screen.getByTestId('value').textContent).toBe('a');
    act(() => { vi.advanceTimersByTime(149); });
    expect(screen.getByTestId('value').textContent).toBe('a');
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByTestId('value').textContent).toBe('ab');
  });

  it('setImmediate 立即更新並取消延遲', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TestComp input="a" delay={150} />);
    rerender(<TestComp input="ab" delay={150} />);
    act(() => { screen.getByTestId('flush').click(); });
    expect(screen.getByTestId('value').textContent).toBe('');
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('value').textContent).toBe('');
  });

  it('卸載時清掉計時器', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { rerender, unmount } = render(<TestComp input="a" delay={150} />);
    rerender(<TestComp input="ab" delay={150} />);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
