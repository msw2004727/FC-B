import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { lt, useT } from '@/i18n/i18n';

/**
 * 活動頁「地區」下拉（2026-11-13 站長選定頂部精簡 C 方案）：篩選列右側固定一顆鈕，鈕上顯示目前地區，
 * 點開是直式選單（全部、中部、北部、南部、東部&外島），最下面是「尋找附近活動」。
 * 取代原本整列的地區頁籤；值仍是 A 的中文地區名，網址同步與篩選邏輯都在 ActivitiesPage，這裡不動。
 * 顯示文字走 events.regionPicker.*（七語系），原本地區頁籤直接寫中文、不跟語系。
 * 鍵盤與讀屏照同站運動下拉（src/ui/TopBar.tsx，U-004）：listbox／option、上下鍵／Home／End／Enter／Space、
 * 打開時焦點進目前地區，選取或 Esc 後焦點回地區鈕（Grok 初審 P2，2026-11-13）。
 */
export const ACTIVITY_REGION_OPTIONS = ['全部', '中部', '北部', '南部', '東部&外島'] as const;

const REGION_KEYS: Readonly<Record<string, string>> = {
  全部: 'all',
  中部: 'central',
  北部: 'north',
  南部: 'south',
  '東部&外島': 'east',
};

interface Props {
  value: string;
  onChange: (region: string) => void;
  onNearby: (e?: MouseEvent) => void;
}

export function ActivityRegionPicker(props: Props): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const label = (region: string): string => {
    const key = REGION_KEYS[region];
    return key ? t(`events.regionPicker.${key}`) : region;
  };

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  // 開著時：點選單外任何地方就收起（不搶焦點）。
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: Event): void => {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // 打開時焦點移到目前選中的地區（同運動下拉）。
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const current = menuRef.current.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
      ?? menuRef.current.querySelector<HTMLButtonElement>('.activity-region-item');
    current?.focus();
  }, [open]);

  const select = (region: string): void => {
    props.onChange(region);
    close(true);
  };

  const nearby = (e?: MouseEvent): void => {
    close(true);
    props.onNearby(e);
  };

  // 上下鍵移動、Home／End、Enter／Space 選取、Esc 收起（焦點回地區鈕）。
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('.activity-region-item') ?? []);
    if (items.length === 0) return;
    const index = items.findIndex((el) => el === document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[index < 0 ? 0 : (index + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[index <= 0 ? items.length - 1 : index - 1]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      const focused = items[index];
      if (!focused) return;
      e.preventDefault();
      const region = focused.getAttribute('data-region');
      if (region) select(region);
      else nearby();
    }
  };

  const current = label(props.value);

  return (
    <div class="activity-region-pick" id="activity-region-tabs" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={buttonRef}
        class={`activity-region-btn${props.value !== '全部' ? ' active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls="activity-region-menu"
        aria-label={`${t('events.regionPicker.label')} ${current}`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
          <circle cx="12" cy="10" r="2.3" />
        </svg>
        <span class="activity-region-label">{current}</span>
        <svg class="activity-region-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div class="activity-region-menu" id="activity-region-menu" ref={menuRef} hidden={!open}>
        <div role="listbox" aria-label={t('events.regionPicker.label')}>
          {ACTIVITY_REGION_OPTIONS.map((region) => {
            const selected = props.value === region;
            return (
              <button
                key={region}
                type="button"
                class={`activity-region-item${selected ? ' active' : ''}`}
                data-region={region}
                role="option"
                aria-selected={selected ? 'true' : 'false'}
                tabIndex={open ? (selected ? 0 : -1) : -1}
                onClick={() => select(region)}
              >
                {label(region)}
              </button>
            );
          })}
        </div>
        {/* M-073：附近活動地圖在 B 一律停用外觀，title/點擊照 A 停用分支 */}
        <button
          type="button"
          class="activity-region-item activity-region-nearby"
          id="region-tab-nearby-activity"
          aria-disabled="true"
          tabIndex={-1}
          title={lt('附近活動地圖尚未開啟', '附近活動地圖尚未開啟')}
          onClick={(e) => nearby(e)}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 7l5-2 5 2 5-2v12l-5 2-5-2-5 2z" opacity="0.55" />
            <line x1="8" y1="5" x2="8" y2="19" opacity="0.55" />
            <line x1="13" y1="7" x2="13" y2="21" opacity="0.55" />
            <path d="M12 8c-1.5 0-2.7 1.2-2.7 2.7 0 1.8 2.7 4 2.7 4s2.7-2.2 2.7-4c0-1.5-1.2-2.7-2.7-2.7z" fill="currentColor" stroke="none" />
          </svg>
          {t('events.regionPicker.nearby')}
        </button>
      </div>
    </div>
  );
}
