import { h, type FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMultiDate } from './use-multi-date';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: showToast } }));

type Result = ReturnType<typeof useMultiDate>;

let current: Result | undefined;
let inputValue = '';

function Harness({ mode = 'create' }: { mode?: 'create' | 'edit' }) {
  const [dateVal, setDateVal] = useState('');
  inputValue = dateVal;
  current = useMultiDate({ mode, dateVal, onDateValChange: setDateVal });
  return null;
}
// PM 修正：h() 對選填 props 元件的型別推斷（weak type），改用明確型別。
const HarnessFC = Harness as FunctionComponent<{ mode?: 'create' | 'edit' }>;

function result(): Result {
  if (!current) throw new Error('Hook 尚未掛載');
  return current;
}

function select(value: string): void {
  act(() => {
    result().dateInputHandlers.onFocus();
    result().dateInputHandlers.onChange(value);
    result().dateInputHandlers.onBlur();
  });
  act(() => { vi.advanceTimersByTime(150); });
}

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  vi.useFakeTimers();
  showToast.mockReset();
  current = undefined;
  inputValue = '';
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('照 A 多日期 picker session', () => {
  it('blur 後 150ms 才加入，session 只取最後一次 change', () => {
    render(h(HarnessFC, {}));
    act(() => {
      result().dateInputHandlers.onFocus();
      result().dateInputHandlers.onChange('2030-05-01');
      result().dateInputHandlers.onChange('2030-05-03');
      result().dateInputHandlers.onBlur();
    });
    expect(result().dates).toEqual([]);
    act(() => { vi.advanceTimersByTime(149); });
    expect(result().dates).toEqual([]);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result().dates).toEqual(['2030-05-03']);
    expect(inputValue).toBe('2030-05-03');
    expect(result().view.isMultiDate).toBe(false);
    expect(result().view.countText).toBe('');
  });

  it('排序、多日清空日期欄、刪到一日恢復該日', () => {
    render(h(HarnessFC, {}));
    select('2030-05-03');
    select('2030-05-01');
    expect(result().dates).toEqual(['2030-05-01', '2030-05-03']);
    expect(inputValue).toBe('');
    expect(result().view.isMultiDate).toBe(true);
    expect(result().view.countText).toBe('已選 2 個日期（上限 30）');
    act(() => result().view.onRemove('2030-05-01'));
    expect(result().dates).toEqual(['2030-05-03']);
    expect(inputValue).toBe('2030-05-03');
    expect(result().view.isMultiDate).toBe(false);
    act(() => result().view.onRemove('2030-05-03'));
    expect(result().dates).toEqual([]);
    expect(inputValue).toBe('');
  });

  it('重複日期不加入並提示 A 原文', () => {
    render(h(HarnessFC, {}));
    select('2030-05-01');
    select('2030-05-01');
    expect(result().dates).toEqual(['2030-05-01']);
    expect(showToast).toHaveBeenCalledWith('此日期已加入');
  });

  it('允許 30 日，第 31 日拒絕並提示 A 原文', () => {
    render(h(HarnessFC, {}));
    for (let day = 1; day <= 30; day++) {
      select(`2030-05-${String(day).padStart(2, '0')}`);
    }
    expect(result().dates).toHaveLength(30);
    select('2030-05-31');
    expect(result().dates).toHaveLength(30);
    expect(showToast).toHaveBeenCalledWith('最多選擇 30 個日期');
  });

  it('blur 後再 focus 取消前一個提交', () => {
    render(h(HarnessFC, {}));
    act(() => {
      result().dateInputHandlers.onChange('2030-05-01');
      result().dateInputHandlers.onBlur();
    });
    act(() => { vi.advanceTimersByTime(100); });
    act(() => result().dateInputHandlers.onFocus());
    act(() => { vi.advanceTimersByTime(150); });
    expect(result().dates).toEqual([]);
  });

  it('空 change 取消 pending', () => {
    render(h(HarnessFC, {}));
    act(() => {
      result().dateInputHandlers.onFocus();
      result().dateInputHandlers.onChange('2030-05-01');
      result().dateInputHandlers.onChange('');
      result().dateInputHandlers.onBlur();
    });
    act(() => { vi.advanceTimersByTime(150); });
    expect(result().dates).toEqual([]);
  });

  it('編輯模式更新欄位但不加入多日期', () => {
    render(h(HarnessFC, { mode: 'edit' }));
    select('2030-05-01');
    expect(inputValue).toBe('2030-05-01');
    expect(result().dates).toEqual([]);
    expect(result().view.isMultiDate).toBe(false);
  });

  it('計時期間切至編輯模式不提交', () => {
    const rendered = render(h(HarnessFC, {}));
    act(() => {
      result().dateInputHandlers.onChange('2030-05-01');
      result().dateInputHandlers.onBlur();
    });
    rendered.rerender(h(HarnessFC, { mode: 'edit' }));
    act(() => { vi.advanceTimersByTime(150); });
    expect(result().dates).toEqual([]);
  });

  it('reset 清空日期與 pending，之後可以重新選取', () => {
    render(h(HarnessFC, {}));
    select('2030-05-01');
    act(() => {
      result().dateInputHandlers.onChange('2030-05-02');
      result().dateInputHandlers.onBlur();
      result().reset();
    });
    act(() => { vi.advanceTimersByTime(150); });
    expect(result().dates).toEqual([]);
    expect(inputValue).toBe('');
    select('2030-05-03');
    expect(result().dates).toEqual(['2030-05-03']);
  });

  it('卸載清掉計時器，不送提示或更新', () => {
    const rendered = render(h(HarnessFC, {}));
    act(() => {
      result().dateInputHandlers.onChange('2030-05-01');
      result().dateInputHandlers.onBlur();
    });
    expect(vi.getTimerCount()).toBe(1);
    rendered.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(150); });
    expect(showToast).not.toHaveBeenCalled();
  });
});
