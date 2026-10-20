import type { JSX } from 'preact';
import { getSportKeySafe, getSportOption, sportSymbol } from '@/features/events/data/sports';

export interface SportIconProps {
  sportKey: string;
  className?: string;
}

/**
 * 照 A `js/config.js#getSportIconSvg` 輸出 `<span class="sport-emoji..." aria-hidden="true">...</span>`。
 * A 有自製圖片／SVG 的運動（football、pickleball、escape_room、esports、other）優先使用，
 * 其餘使用 emoji 字元。
 * // ASSUMPTION: 子路徑如 `/teams/xxx` 下相對路徑 `./img/...` 會解析失敗，故圖片統一以絕對路徑 `/img/...` 載入（與 TopBar `/img/chat.png` 一致）。
 */
export function SportIcon({ sportKey, className = '' }: SportIconProps): JSX.Element {
  const safeKey = getSportKeySafe(sportKey) || 'football';
  const option = getSportOption(safeKey);
  const klass = className ? `sport-emoji ${className}` : 'sport-emoji';

  if (option?.customIconType === 'pickleball-svg') {
    return (
      <span class={klass} aria-hidden="true">
        <svg
          viewBox="0 0 100 100"
          width="1em"
          height="1em"
          style="vertical-align:-0.1em"
          xmlns="http://www.w3.org/2000/svg"
        >
          <g transform="rotate(-30 50 50)">
            <rect x="32" y="62" width="14" height="30" rx="3" fill="#0f172a" />
            <rect x="34" y="64" width="10" height="26" rx="2" fill="#334155" />
            <rect
              x="14"
              y="6"
              width="52"
              height="58"
              rx="13"
              fill="#dc2626"
              stroke="#7f1d1d"
              stroke-width="2.5"
            />
          </g>
          <circle cx="78" cy="22" r="11" fill="#fde047" stroke="#713f12" stroke-width="2" />
          <g fill="#713f12">
            <circle cx="74" cy="18" r="1.3" />
            <circle cx="82" cy="18" r="1.3" />
            <circle cx="78" cy="22" r="1.3" />
            <circle cx="74" cy="26" r="1.3" />
            <circle cx="82" cy="26" r="1.3" />
          </g>
          <path
            d="M 60 24 L 67 22 M 58 30 L 65 30 M 60 36 L 67 36"
            stroke="#94a3b8"
            stroke-width="2.5"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
      </span>
    );
  }

  if (option?.customIconType === 'img' && option.customIconSrc) {
    return (
      <span class={klass} aria-hidden="true">
        <img
          src={option.customIconSrc}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          decoding="async"
        />
      </span>
    );
  }

  const emoji = option?.symbol ?? sportSymbol(safeKey);
  return (
    <span class={klass} aria-hidden="true">
      {emoji}
    </span>
  );
}
