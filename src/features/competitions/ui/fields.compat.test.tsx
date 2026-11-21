// 正式環境載了 preact/compat（App.tsx）：<input> 上的 onChange 會被改寫成 input 監聽。
// 這支測試先載 compat，證明時間欄只送 change（iOS 選擇器）也會寫進表單。
import 'preact/compat';
import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { DateField, DateTimeField } from './fields';

describe('preact/compat 下的時間欄', () => {
  it('DateTimeField：只送 change 也呼叫 onValueChange', () => {
    const onValueChange = vi.fn();
    const view = render(<DateTimeField id="t-dt" label="開始" value="" onValueChange={onValueChange} />);
    const input = view.container.querySelector('input')!;
    input.value = '2026-12-01T09:00';
    fireEvent(input, new Event('change', { bubbles: true }));
    expect(onValueChange).toHaveBeenCalledWith('2026-12-01T09:00');
  });

  it('DateField：只送 change 也呼叫；停用時不呼叫', () => {
    const onValueChange = vi.fn();
    const view = render(<DateField id="t-d" label="日期" value="" onValueChange={onValueChange} />);
    const input = view.container.querySelector('input')!;
    input.value = '2026-12-01';
    fireEvent(input, new Event('change', { bubbles: true }));
    expect(onValueChange).toHaveBeenCalledWith('2026-12-01');
    view.unmount();
    const off = vi.fn();
    const disabled = render(<DateField id="t-d2" label="日期" value="" disabled onValueChange={off} />);
    const box = disabled.container.querySelector('input')!;
    box.value = '2026-12-02';
    fireEvent(box, new Event('change', { bubbles: true }));
    expect(off).not.toHaveBeenCalled();
  });
});
