import type { JSX } from 'preact';

/**
 * M-168：未登入頭像的灰色人形 SVG（站長對 A 的改良，取代 A 原本的 `?`）。
 * 顏色交給外層容器：`color: var(--text-muted); background: var(--bg-elevated);`。
 */
/** `size` 可給數字（px）或百分比字串（例如 '62%'，隨外層頭像圓大小縮放）。 */
/** `fill`：貼邊放大版（頭＋肩膀幾乎填滿外層圓，肩膀被圓邊裁切），給球員卡與右上角頭像用。 */
export function GuestAvatarIcon(props: { size?: number | string; fill?: boolean }): JSX.Element {
  const size = props.size ?? 28;
  return (
    <svg
      class="guest-avatar-icon"
      viewBox={props.fill ? '3 2 18 19.5' : '0 0 24 24'}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      {/* 頭 */}
      <circle cx="12" cy="8" r="4" />
      {/* 肩膀（半橢圓剪影） */}
      {/* fill 版肩膀往下多畫兩格，超出 viewBox 的部分被裁掉，圓底邊不會露出底色縫隙 */}
      <path d={props.fill ? 'M4 20c0-4.42 3.58-8 8-8s8 3.58 8 8v4H4z' : 'M4 20c0-4.42 3.58-8 8-8s8 3.58 8 8v1H4z'} />
    </svg>
  );
}
