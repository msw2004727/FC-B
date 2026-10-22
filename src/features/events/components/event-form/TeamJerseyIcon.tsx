/**
 * A `event-team-split.js` `_tsJerseySvg` 的 Preact 移植（T-013 卡 2A）。
 * 色票常數照 A `_tsDefaultColors`，下一張卡送出時會用 `TEAM_SPLIT_COLORS`。
 */
import type { JSX } from 'preact';

export interface TeamSplitColor {
  hex: string;
  stroke: string;
  name: string;
}

export const TEAM_SPLIT_COLORS: readonly TeamSplitColor[] = [
  { hex: '#EF4444', stroke: '#DC2626', name: '紅隊' },
  { hex: '#3B82F6', stroke: '#2563EB', name: '藍隊' },
  { hex: '#10B981', stroke: '#059669', name: '綠隊' },
  { hex: '#FBBF24', stroke: '#D97706', name: '黃隊' },
  { hex: '#FFFFFF', stroke: '#D1D5DB', name: '白隊' },
  { hex: '#1F2937', stroke: '#9CA3AF', name: '黑隊' },
  { hex: '#F97316', stroke: '#EA580C', name: '橙隊' },
  { hex: '#8B5CF6', stroke: '#7C3AED', name: '紫隊' },
];

// 照 A `event-team-split.js` `_TEAM_SPLIT_JERSEY_PATH`（PM 從 A 補上原值）。
const TEAM_SPLIT_JERSEY_PATH =
  'M10 1L1 6.5L4.5 9L5 25C5 26.1 5.9 27 7 27H25C26.1 27 27 26.1 27 25V9L30.5 6.5L22 1C22 1 20 5 16 5C12 5 10 1 10 1Z';

// 照 A `_tsSanitizeHex`。
function sanitizeHex(value: string): string {
  return (value || '').replace(/[^#0-9a-fA-F]/g, '');
}

// 照 A `_tsParseHex`：只接受 6 位 hex。
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const c = (hex || '').replace(/[^0-9a-fA-F]/g, '');
  if (c.length !== 6) return null;
  return { r: parseInt(c.slice(0, 2), 16), g: parseInt(c.slice(2, 4), 16), b: parseInt(c.slice(4, 6), 16) };
}

// 照 A `_tsDarkenHex`（含白、黑的特殊色）。
function darkenHex(hex: string, factor: number): string {
  if (hex === '#FFFFFF' || hex === '#ffffff') return '#D1D5DB';
  if (hex === '#1F2937' || hex === '#000000') return '#9CA3AF';
  const rgb = parseHex(hex);
  if (!rgb) return '#999999';
  const d = (v: number): number => Math.round(Math.min(255, Math.max(0, v * (factor || 0.85))));
  return '#' + [d(rgb.r), d(rgb.g), d(rgb.b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// 照 A `_tsIsLightColor`：亮度 > 0.5。
function isLightColor(hex: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 > 0.5;
}

export interface TeamJerseyIconProps {
  color: string;
  stroke: string;
  letter: string;
  width?: number;
}

/** 照 A `_tsJerseySvg(color, stroke, letter, { width, inline })`。 */
export function TeamJerseyIcon(props: TeamJerseyIconProps): JSX.Element {
  const width = props.width ?? 20;
  const height = Math.round(width * 0.875);
  const empty = !props.color || props.color === 'transparent';
  const safeColor = empty ? 'transparent' : sanitizeHex(props.color);
  const safeStroke = empty
    ? '#9CA3AF'
    : sanitizeHex(props.stroke || darkenHex(props.color, 0.85));
  const strokeWidth = empty ? 1.5 : 1;
  const letterKey = props.letter || '?';
  const light = empty ? true : isLightColor(safeColor);
  const letterFill = light ? '#1F2937' : '#fff';
  const showCircle = !empty && !light;
  const ariaLabel = props.letter ? `${props.letter} 隊` : '未分配';
  const style = `position:relative;top:0;right:0;width:${width}px;height:${height}px`;

  return (
    <svg
      class="uc-team-jersey"
      style={style}
      viewBox="0 0 32 28"
      fill="none"
      role="img"
      aria-label={ariaLabel}
    >
      <title>{ariaLabel}</title>
      <path
        d={TEAM_SPLIT_JERSEY_PATH}
        fill={safeColor}
        stroke={safeStroke}
        stroke-width={strokeWidth}
        stroke-dasharray={empty ? '2 1.5' : undefined}
      />
      {showCircle ? <circle cx="16" cy="17" r="7" fill="rgba(0,0,0,0.35)" /> : null}
      <text
        x="16"
        y="21"
        text-anchor="middle"
        font-size="12"
        font-weight="700"
        fill={empty ? '#9CA3AF' : letterFill}
      >
        {letterKey}
      </text>
    </svg>
  );
}
