import type { JSX } from 'preact';

// 社群平台圖示：俱樂部表單（社群連結預覽）與詳情頁「社群」共用（C1 自 TeamFormModal 搬出，內容不變）。
const PLATFORM_GLYPH: Record<string, string> = {
  line: 'LINE',
  facebook: 'f',
  instagram: 'IG',
  threads: '@',
  x: 'X',
  youtube: '▶',
  tiktok: '♪',
  discord: 'D',
  telegram: '✈',
  linktree: 'LT',
  link: '↗',
};

const PLATFORM_IMAGE: Record<string, string> = {
  instagram: '/img/Instagram-Logo--Streamline-Plump-Gradient.png',
  threads: '/img/Thread-Block-Logo--Streamline-Ultimate.png',
};

export function PlatformGlyph({ platform }: { platform: string }): JSX.Element {
  const key = Object.prototype.hasOwnProperty.call(PLATFORM_GLYPH, platform)
    ? platform
    : 'link';
  const image = PLATFORM_IMAGE[key];
  return (
    <span class={`event-social-link-icon event-social-link-icon-${key}`} aria-hidden="true">
      {image ? <img src={image} alt="" /> : PLATFORM_GLYPH[key]}
    </span>
  );
}
