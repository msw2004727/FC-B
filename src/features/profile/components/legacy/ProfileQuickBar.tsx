import type { ComponentChildren, JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';

/**
 * 11-06 個人頁改版（站長選定預覽「① 極簡線條、7 個圖示」）：
 * 原本一張張收折標題卡，改成「細線圖示列＋單一展開區」。
 * - 一次只開一個；點另一個直接換、再點同一個收合、Esc 收合並把焦點還給按鈕。
 * - 展開區只在展開時渲染內容（沿用 M-170「展開才渲染」，不因收合多讀資料）。
 * - 各區塊內容元件沿用原卡片（embedded 模式），本元件只負責外殼。
 */

export type QuickIconName = 'reg' | 'info' | 'id2' | 'bell' | 'host' | 'mate' | 'apply';

export interface QuickItem {
  key: string;
  icon: QuickIconName;
  /** 兩字標籤（只給視覺；讀屏用 ariaLabel）。 */
  label: string;
  /** 全名＋狀態，例如「我的報名，2 筆」「LINE 推播，已綁定」。 */
  ariaLabel: string;
  /** 筆數徽章；0 或未提供不顯示。 */
  badge?: number | null;
  /** 狀態綠點（LINE 推播已綁定）。 */
  dot?: boolean;
  render: () => ComponentChildren;
}

// 24×24 自繪線條圖示（設計預覽 docs/previews/profile-redesign-2026-11-06 的 symbol 原樣搬入）。
const ICONS: Record<QuickIconName, JSX.Element> = {
  reg: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <path d="M8.5 12.5l2.3 2.3 4.7-4.8" />
    </>
  ),
  info: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="11" r="2" />
      <path d="M5.5 16c.6-1.5 1.7-2.2 3-2.2s2.4.7 3 2.2" />
      <path d="M14 10h4M14 14h4" />
    </>
  ),
  id2: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c.7-3.2 2.8-5 5.5-5s4.8 1.8 5.5 5" />
      <path d="M15 5.5l1.5 1.6L18.5 4l2 3.1 1-1.6" />
      <path d="M15.2 9.5h6" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 004 0" />
    </>
  ),
  host: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 3.5L16 11H5" />
      <path d="M3 21h6" />
    </>
  ),
  mate: (
    <>
      <circle cx="8" cy="8.5" r="2.8" />
      <circle cx="16.5" cy="9.5" r="2.3" />
      <path d="M2.8 19c.6-3 2.6-4.6 5.2-4.6s4.6 1.6 5.2 4.6" />
      <path d="M14.5 14.6c.6-.2 1.3-.3 2-.3 2.2 0 3.9 1.4 4.5 4.2" />
    </>
  ),
  apply: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
      <path d="M12 8.5V12l2.3 1.6" />
    </>
  ),
};

// Esc 在這些元素內有自己的用途（地區清單收起、彈窗關閉），不收合展開區。
const ESC_IGNORE_SELECTOR =
  'input, select, textarea, [contenteditable="true"], dialog, [role="dialog"], [aria-modal="true"]';

export const QUICK_PANEL_ID = 'profile-quick-panel';

export function ProfileQuickBar({
  items,
  groupLabel,
}: {
  items: readonly QuickItem[];
  groupLabel: string;
}): JSX.Element {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const buttonsRef = useRef<Record<string, HTMLButtonElement | null>>({});

  // 項目消失（例如權限被收回）時，展開區一併收合。
  const active = items.find((item) => item.key === openKey) ?? null;

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !active || e.defaultPrevented) return;
    const target = e.target as Element | null;
    if (target && typeof target.closest === 'function' && target.closest(ESC_IGNORE_SELECTOR)) return;
    const key = active.key;
    setOpenKey(null);
    buttonsRef.current[key]?.focus();
  }

  return (
    <div class="profile-quick" onKeyDown={handleKeyDown}>
      <div class="profile-quick-sep" role="separator" />
      <div class="profile-quick-bar" role="group" aria-label={groupLabel}>
        <div class="profile-quick-bar-in">
          {items.map((item) => {
            const expanded = active?.key === item.key;
            const badge = typeof item.badge === 'number' && item.badge > 0 ? item.badge : 0;
            return (
              <button
                key={item.key}
                ref={(el) => {
                  buttonsRef.current[item.key] = el;
                }}
                type="button"
                class="profile-quick-btn"
                id={`profile-quick-btn-${item.key}`}
                data-key={item.key}
                aria-expanded={expanded ? 'true' : 'false'}
                aria-controls={QUICK_PANEL_ID}
                aria-label={item.ariaLabel}
                onClick={() => setOpenKey((prev) => (prev === item.key ? null : item.key))}
              >
                <span class="profile-quick-ic">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    {ICONS[item.icon]}
                  </svg>
                  {badge > 0 && (
                    <span class="profile-quick-badge" aria-hidden="true">
                      {badge > 99 ? '99+' : String(badge)}
                    </span>
                  )}
                  {item.dot && <span class="profile-quick-dot" aria-hidden="true" />}
                </span>
                <span class="profile-quick-lb" aria-hidden="true">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div
        class="profile-quick-panel"
        id={QUICK_PANEL_ID}
        role="region"
        aria-labelledby={active ? `profile-quick-btn-${active.key}` : undefined}
        hidden={!active}
      >
        {active && <div key={active.key}>{active.render()}</div>}
      </div>
    </div>
  );
}
