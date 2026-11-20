// 站內下拉選單（新外觀清-2）：施工規格第 1a 批 3.6 行為表每一列、報讀角色、焦點去向。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuSelect, type MenuSelectOption } from './menu-select';

type V = 'open' | 'live' | 'done';
const OPTIONS: MenuSelectOption<V>[] = [
  { value: 'open', label: '未結束' },
  { value: 'live', label: '進行中' },
  { value: 'done', label: '已結束' },
];

afterEach(() => cleanup());

function Harness({ onChange, initial = 'live' }: { onChange?: (v: V) => void; initial?: V }) {
  const [value, setValue] = useState<V>(initial);
  return (
    <div>
      <MenuSelect<V>
        label="狀態"
        value={value}
        options={OPTIONS}
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
      />
      <button type="button">外面</button>
    </div>
  );
}

// @testing-library/preact 的 fireEvent.focusOut 不會送出 focusout（實測），這裡直接派發原生事件。
function focusOut(from: Element, relatedTarget: Element | null): void {
  act(() => {
    from.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget }));
  });
}

function parts() {
  const button = screen.getByRole('button', { name: /^狀態 / });
  const list = document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
  const options = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="option"]'));
  return { button, list, options };
}

describe('MenuSelect 站內下拉選單', () => {
  it('報讀角色：按鈕名稱是「狀態 目前選項」、aria-controls 指到清單、清單與每列的角色；關著時 hidden、每列 tabIndex -1', () => {
    render(<Harness />);
    const { button, list, options } = parts();
    expect(button.getAttribute('aria-label')).toBe('狀態 進行中');
    expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toBe('進行中');
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.getAttribute('aria-label')).toBe('狀態');
    expect(list.hidden).toBe(true);
    expect(options.map((o) => o.textContent)).toEqual(['未結束', '進行中', '已結束']);
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(options.every((o) => o.tabIndex === -1)).toBe(true);
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(options.every((o) => o.querySelector('svg')?.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('點按鈕開、焦點到選中那一列且只有它 tabIndex 0；再點一次關', () => {
    render(<Harness />);
    const { button, list, options } = parts();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(list.hidden).toBe(false);
    expect(document.activeElement).toBe(options[1]);
    expect(options.map((o) => o.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(list.hidden).toBe(true);
  });

  it('在按鈕上按 ↓ 或 ↑ 都會開', () => {
    render(<Harness />);
    const { button, list } = parts();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(list.hidden).toBe(false);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(list.hidden).toBe(true);
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    expect(list.hidden).toBe(false);
  });

  it('↓／↑ 在列之間移動、到底繞回頭；Home／End 到第一列／最後一列', () => {
    render(<Harness initial="done" />);
    const { button, options } = parts();
    fireEvent.click(button);
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(options[2]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(options[2]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1]!, { key: 'Home' });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0]!, { key: 'End' });
    expect(document.activeElement).toBe(options[2]);
  });

  it('Enter 與空白鍵選那一列、關、焦點回按鈕；按鈕名稱跟著換', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const { button, list, options } = parts();
    fireEvent.click(button);
    fireEvent.keyDown(options[1]!, { key: 'ArrowDown' });
    fireEvent.keyDown(options[2]!, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('done');
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-label')).toBe('狀態 已結束');
    fireEvent.click(button);
    fireEvent.keyDown(options[2]!, { key: 'Home' });
    fireEvent.keyDown(options[0]!, { key: ' ' });
    expect(onChange).toHaveBeenLastCalledWith('open');
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('點某一列：選、關、焦點回按鈕', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const { button, list, options } = parts();
    fireEvent.click(button);
    fireEvent.click(options[0]!);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('open');
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('Esc 關、焦點回按鈕、不改選項', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const { button, list, options } = parts();
    fireEvent.click(button);
    fireEvent.keyDown(options[1]!, { key: 'ArrowDown' });
    fireEvent.keyDown(options[2]!, { key: 'Escape' });
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(onChange).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-label')).toBe('狀態 進行中');
  });

  it('點元件以外的地方（擷取階段 pointerdown）就關、不搶焦點；點元件裡面不關', () => {
    render(<Harness />);
    const { button, list, options } = parts();
    const outside = screen.getByRole('button', { name: '外面' });
    fireEvent.click(button);
    fireEvent.pointerDown(options[0]!);
    expect(list.hidden).toBe(false);
    fireEvent.pointerDown(outside);
    expect(list.hidden).toBe(true);
    expect(document.activeElement).not.toBe(button);
  });

  it('Tab 把焦點移出元件就關；焦點去處是 null（Safari 點列）或還在元件裡就不關', () => {
    render(<Harness />);
    const { button, list, options } = parts();
    const outside = screen.getByRole('button', { name: '外面' });
    fireEvent.click(button);
    focusOut(options[1]!, null);
    expect(list.hidden).toBe(false);
    focusOut(options[1]!, button);
    expect(list.hidden).toBe(false);
    focusOut(options[1]!, outside);
    expect(list.hidden).toBe(true);
  });

  it('選到目前已選的那一列：照樣關，不呼叫 onChange', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const { button, list, options } = parts();
    fireEvent.click(button);
    fireEvent.keyDown(options[1]!, { key: 'Enter' });
    expect(list.hidden).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(button);
    fireEvent.click(options[1]!);
    expect(list.hidden).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('兩個選單同頁時清單 id 不同', () => {
    render(
      <div>
        <MenuSelect<V> label="甲" value="open" options={OPTIONS} onChange={() => {}} />
        <MenuSelect<V> label="乙" value="open" options={OPTIONS} onChange={() => {}} />
      </div>,
    );
    const ids = screen.getAllByRole('button', { name: /未結束$/ }).map((b) => b.getAttribute('aria-controls'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });
});
