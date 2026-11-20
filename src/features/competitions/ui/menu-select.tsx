// 站內自己的下拉選單（新外觀清-2；取代賽事清單的原生 <select>）。
// 收合是小顆玻璃次要鈕加向下箭頭：借 ui-button 三個 class（ui/Button 拿不到 ref、也沒有 aria-haspopup），長相來自第 0 批按鈕規則。
// 展開是 role="listbox" 的浮層，每列 <button role="option">。鍵盤與讀屏照 src/ui/TopBar.tsx 運動下拉與
// ActivityRegionPicker：↑↓ 繞回、Home／End、Enter／空白鍵選取、Esc 收起且焦點回按鈕、點外面收起不搶焦點；
// 另加一條：Tab 把焦點移出元件就收起。關著時清單用 hidden 屬性，樣式不對清單本身設 display。
// 通用元件：收 label、value、options、onChange；這一批只被 InAppCardList 匯入（跟著站內區塊的延遲載入檔）。

import type { JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';

export interface MenuSelectOption<V extends string> {
  value: V;
  label: string;
}

export function MenuSelect<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** 選單名稱（例：「狀態」）。按鈕的讀屏名稱是「名稱 目前選項」。 */
  label: string;
  value: V;
  options: readonly MenuSelectOption<V>[];
  onChange: (value: V) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  // 開著時點元件以外的任何地方就收起（擷取階段，不搶焦點）。
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: Event): void => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // 打開的那一刻焦點移到目前選中的那一列。
  useEffect(() => {
    if (!open || !listRef.current) return;
    const target = listRef.current.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
      ?? listRef.current.querySelector<HTMLButtonElement>('[role="option"]');
    target?.focus();
  }, [open]);

  const choose = (next: V): void => {
    if (next !== value) onChange(next);
    close(true);
  };

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      if (!open) return;
      event.preventDefault();
      close(true);
      return;
    }
    const onButton = event.target === buttonRef.current;
    if (onButton) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      setOpen(true);
      return;
    }
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const index = items.findIndex((item) => item === event.target);
    if (index < 0) return;
    let target: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') target = items[(index + 1) % items.length];
    else if (event.key === 'ArrowUp') target = items[index === 0 ? items.length - 1 : index - 1];
    else if (event.key === 'Home') target = items[0];
    else if (event.key === 'End') target = items[items.length - 1];
    else if (event.key === 'Enter' || event.key === ' ') {
      const picked = options[index];
      if (!picked) return;
      event.preventDefault();
      choose(picked.value);
      return;
    } else return;
    event.preventDefault();
    target?.focus();
  };

  // 焦點移到元件外面（Tab／Shift+Tab）就收起。relatedTarget 是 null 時不收：
  // Safari 點按鈕不給焦點，點選單列時會先收到沒有去處的 focusout；點外面由上面的 pointerdown 處理。
  const onFocusOut = (event: JSX.TargetedFocusEvent<HTMLDivElement>): void => {
    if (!open) return;
    const next = event.relatedTarget;
    if (next instanceof Node && rootRef.current && !rootRef.current.contains(next)) setOpen(false);
  };

  return (
    <div class="d2-dd" ref={rootRef} onKeyDown={onKeyDown} onFocusOut={onFocusOut}>
      <button
        type="button"
        ref={buttonRef}
        class="ui-button ui-button--secondary ui-button--sm d2-dd__btn"
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={listId}
        aria-label={`${label} ${current?.label ?? ''}`.trim()}
        onClick={() => setOpen((was) => !was)}
      >
        <span class="ui-button__label">{current?.label ?? ''}</span>
        <svg class="d2-dd__caret" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <div class="d2-menu" id={listId} role="listbox" aria-label={label} ref={listRef} hidden={!open}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              class="d2-menu__opt"
              role="option"
              aria-selected={selected ? 'true' : 'false'}
              tabIndex={open && selected ? 0 : -1}
              onClick={() => choose(option.value)}
            >
              <span>{option.label}</span>
              <svg class="d2-menu__chk" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
