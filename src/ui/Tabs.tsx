import './tabs.css';
import type { ComponentChildren, JSX } from 'preact';
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { getCurrentLocale, useT } from '@/i18n/i18n';

export interface TabsItem {
  /** 同一組內必須唯一；更新標籤時保留穩定 id。 */
  id: string;
  label: string;
  panel: ComponentChildren;
  disabled?: boolean;
}

export interface TabsProps {
  id?: string;
  label: string;
  items: readonly TabsItem[];
  value: string;
  onValueChange: (id: string) => void;
  variant?: 'underline' | 'pill' | 'segmented';
  disabled?: boolean;
  loading?: boolean;
  dir?: 'ltr' | 'rtl';
  class?: string;
}

export function Tabs({
  id,
  label,
  items,
  value,
  onValueChange,
  variant = 'underline',
  disabled = false,
  loading = false,
  dir = 'ltr',
  class: className = '',
}: TabsProps) {
  const generatedId = useId();
  const tabsId = id ?? `tabs-${generatedId}`;
  const listRef = useRef<HTMLDivElement>(null);
  const [wideLabels, setWideLabels] = useState<ReadonlySet<string>>(new Set());
  const t = useT();
  const locale = getCurrentLocale();
  const blocked = disabled || loading;
  const selected = items.find((item) => item.id === value && !item.disabled)
    ?? items.find((item) => !item.disabled);
  const labelsSignature = JSON.stringify(items.map((item) => [item.id, item.label]));

  useLayoutEffect(() => {
    setWideLabels(new Set());
  }, [labelsSignature, locale]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let disposed = false;

    const measure = () => {
      if (disposed) return;
      const overflowing: string[] = [];
      for (const button of list.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
        const content = button.querySelector<HTMLElement>('.ui-tabs__label');
        const itemId = button.dataset.itemId;
        if (!content || !itemId) continue;
        const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight);
        if (Number.isFinite(lineHeight) && content.scrollHeight > lineHeight * 2 + 1) {
          overflowing.push(itemId);
        }
      }
      if (overflowing.length === 0) return;
      setWideLabels((previous) => {
        if (overflowing.every((itemId) => previous.has(itemId))) return previous;
        return new Set([...previous, ...overflowing]);
      });
    };

    measure();
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(measure)
      : undefined;
    observer?.observe(list);
    for (const button of list.children) observer?.observe(button);

    // 字型載入後重測；只讀取字型狀態，不新增全域監聽器。
    const fonts = list.ownerDocument.fonts;
    if (fonts) void fonts.ready.then(measure);

    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [labelsSignature, locale, wideLabels]);

  function reveal(button: HTMLButtonElement) {
    const list = listRef.current;
    if (!list) return;
    const outer = list.getBoundingClientRect();
    const inner = button.getBoundingClientRect();
    if (inner.left < outer.left) list.scrollLeft += inner.left - outer.left;
    else if (inner.right > outer.right) list.scrollLeft += inner.right - outer.right;
  }

  function handleKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDivElement>) {
    if (blocked || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [],
    );
    const index = buttons.findIndex((button) => button === event.target);
    if (index < 0 || buttons.length === 0) return;
    event.preventDefault();

    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else {
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const delta = dir === 'rtl' ? -direction : direction;
      next = (index + delta + buttons.length) % buttons.length;
    }
    const button = buttons[next];
    const nextId = button?.dataset.itemId;
    if (!button || nextId === undefined) return;
    button.focus();
    reveal(button);
    if (nextId !== selected?.id) onValueChange(nextId);
  }

  return (
    <div class={`ui-tabs ui-tabs--${variant} ${className}`} dir={dir}>
      <div
        ref={listRef}
        class="ui-tabs__list"
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        aria-disabled={blocked}
        aria-busy={loading || undefined}
        aria-describedby={loading ? `${tabsId}-loading` : undefined}
        onKeyDown={handleKeyDown}
      >
        {items.map((item) => {
          const suffix = encodeURIComponent(item.id);
          const active = item.id === selected?.id;
          return (
            <button
              key={item.id}
              id={`${tabsId}-tab-${suffix}`}
              type="button"
              role="tab"
              data-item-id={item.id}
              class={`ui-tabs__tab${wideLabels.has(item.id) ? ' ui-tabs__tab--wide' : ''}`}
              aria-selected={active}
              aria-controls={`${tabsId}-panel-${suffix}`}
              tabIndex={active && !blocked ? 0 : -1}
              disabled={blocked || item.disabled}
              onFocus={(event) => reveal(event.currentTarget)}
              onClick={() => {
                if (!blocked && !item.disabled && item.id !== selected?.id) {
                  onValueChange(item.id);
                }
              }}
            >
              <Text class="ui-tabs__label">{item.label}</Text>
            </button>
          );
        })}
      </div>
      {loading && <div id={`${tabsId}-loading`} role="status"><Text>{t('ui.tabs.loading')}</Text></div>}
      {items.map((item) => {
        const suffix = encodeURIComponent(item.id);
        return (
          <div
            key={item.id}
            id={`${tabsId}-panel-${suffix}`}
            class="ui-tabs__panel"
            role="tabpanel"
            aria-labelledby={`${tabsId}-tab-${suffix}`}
            hidden={item.id !== selected?.id}
            tabIndex={0}
          >
            {item.panel}
          </div>
        );
      })}
    </div>
  );
}
