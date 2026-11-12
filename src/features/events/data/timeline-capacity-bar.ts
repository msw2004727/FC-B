/**
 * 活動列表卡計量條（2026-11-13 站長選定風格 A：柔和漸層＋淺玻璃軌道）。
 *
 * 每張卡同長、條旁不寫人數；分段語意同詳情頁方案 C（reg-capacity-bar）：
 *   一般已報綠（--accent）→ 團隊已報藍（--info）→ 團隊未報淺藍（藍 38%）→ 空名額露出軌道；
 *   段與段之間以漸層銜接，不留硬邊；候補以紫色光暈（--color-waitlist）疊在條尾，不壓縮名額比例。
 * 額滿（正取＋團隊未報 ≥ 上限）時最後一段畫到 100%，配合既有「已額滿」膠囊。
 * 只用活動文件既有欄位，不新增讀取。
 */
import type { RegBarModel, RegBarSegmentKey } from './reg-capacity-bar';

/** 相鄰兩段之間的漸層寬度（占整條 %）；不超過任一段的一半，避免小段被吃掉。 */
export const TIMELINE_BAR_BLEND = 12;
/** 候補光暈最少占條尾 10%，人數少時也看得到；上限沿用詳情頁候補膠囊比例（30%）。 */
export const TIMELINE_BAR_MIN_WAIT_GLOW = 10;

/**
 * 團隊未報＝藍色 38%（同詳情頁 .evd-regbar-seg.is-team-open 的 opacity .38）。
 * color-mix 需 Chrome 111+／Safari 16.2+；不支援時整條宣告失效，所以 style 先寫一份
 * 用同色藍的版本（舊瀏覽器團隊未報與團隊已報同色，可接受；PM 2026-11-13 裁定）。
 */
export const TEAM_OPEN_COLOR = 'color-mix(in srgb, var(--info) 38%, transparent)';
const TEAM_OPEN_FALLBACK = 'var(--info)';

function segmentColor(key: RegBarSegmentKey, modern: boolean): string {
  if (key === 'general') return 'var(--accent)';
  if (key === 'team') return 'var(--info)';
  return modern ? TEAM_OPEN_COLOR : TEAM_OPEN_FALLBACK;
}

function pct(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}

/** 計量條的 background-image（光澤由 CSS ::after 疊上）。 */
export function timelineBarBackground(model: RegBarModel, modern = true): string {
  const stops: string[] = [];
  let pos = 0;
  const segs = model.segments.map((seg) => {
    const start = pos;
    pos += seg.pct;
    return { start, end: pos, color: segmentColor(seg.key, modern) };
  });
  segs.forEach((seg, i) => {
    const half = Math.min(TIMELINE_BAR_BLEND / 2, (seg.end - seg.start) / 2);
    const prev = segs[i - 1];
    const prevHalf = prev ? Math.min(TIMELINE_BAR_BLEND / 2, (prev.end - prev.start) / 2) : 0;
    const inStart = i === 0 ? seg.start : seg.start + Math.min(half, prevHalf);
    stops.push(`${seg.color} ${pct(inStart)}`, `${seg.color} ${pct(seg.end - half)}`);
  });
  const last = segs[segs.length - 1];
  if (!last) {
    stops.push('transparent 0%');
  } else if (last.end >= 99.5) {
    // 額滿：最後一段畫到底，條是滿的。
    stops[stops.length - 1] = `${last.color} 100%`;
  } else {
    // 已報到空名額：短漸層收尾。
    stops.push(`transparent ${pct(Math.min(last.end + TIMELINE_BAR_BLEND / 2, 100))}`);
  }
  stops.push('transparent 100%');
  const layers: string[] = [];
  if (model.waitlist > 0) {
    const glow = Math.max(model.waitBasis, TIMELINE_BAR_MIN_WAIT_GLOW);
    layers.push(`linear-gradient(90deg, transparent ${pct(100 - glow)}, var(--color-waitlist) 100%)`);
  }
  layers.push(`linear-gradient(90deg, ${stops.join(', ')})`);
  return layers.join(', ');
}

/** 行內 style：先寫舊瀏覽器版本，再寫 color-mix 版本（不支援時後一條被丟棄、保留前一條）。 */
export function timelineBarStyle(model: RegBarModel | null): string | undefined {
  if (!model) return undefined;
  const fallback = timelineBarBackground(model, false);
  const modern = timelineBarBackground(model, true);
  return fallback === modern
    ? `background-image:${modern}`
    : `background-image:${fallback};background-image:${modern}`;
}
