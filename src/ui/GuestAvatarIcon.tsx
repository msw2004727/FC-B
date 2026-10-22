import type { JSX } from 'preact';

/**
 * M-168：未登入頭像的灰色人形 SVG（站長對 A 的改良，取代 A 原本的 `?`）。
 * 顏色交給外層容器：`color: var(--text-muted); background: var(--bg-elevated);`。
 */
export function GuestAvatarIcon(props: { size?: number }): JSX.Element {
  const size = props.size ?? 28;
  return (
    <svg
      class="guest-avatar-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      {/* 頭 */}
      <circle cx="12" cy="8" r="4" />
      {/* 肩膀（半橢圓剪影） */}
      <path d="M4 20c0-4.42 3.58-8 8-8s8 3.58 8 8v1H4z" />
    </svg>
  );
}
