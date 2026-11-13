// 側邊抽屜底部的圖示（站長 2026-11-13 選方案一「單片收納」）：主題三段、語言地球、重設。
import type { ThemeMode } from '@/core/theme';

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
  focusable: 'false',
} as const;

/** 淺色＝太陽、深色＝月亮、跟隨系統＝半黑半白圓。 */
export function ThemeIcon({ mode }: { mode: ThemeMode }): preact.JSX.Element {
  if (mode === 'light') {
    return (
      <svg {...svgProps}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
      </svg>
    );
  }
  if (mode === 'dark') {
    return (
      <svg {...svgProps}>
        <path d="M20.5 13.2A8.5 8.5 0 1110.8 3.5a6.6 6.6 0 009.7 9.7z" />
      </svg>
    );
  }
  return (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function GlobeIcon(): preact.JSX.Element {
  return (
    <svg {...svgProps} class="drawer-lang-globe">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5z" />
    </svg>
  );
}

export function CaretIcon(): preact.JSX.Element {
  return (
    <svg {...svgProps} class="drawer-lang-caret">
      <path d="M7 10l5 5 5-5" />
    </svg>
  );
}

export function ResetIcon({ cls }: { cls: string }): preact.JSX.Element {
  return (
    <svg {...svgProps} class={cls}>
      <path d="M3.5 12a8.5 8.5 0 108.5-8.5 9 9 0 00-6.3 2.6L3.5 8.3" />
      <path d="M3.5 3.5v4.8h4.8" />
    </svg>
  );
}
