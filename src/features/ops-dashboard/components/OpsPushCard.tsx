import type { JSX } from 'preact';

import type { WebPushCounts } from '../data/ops-summary-types';
import type { OpsStringKey, OpsT } from '../ops-strings';

export type PushPlatform = 'android' | 'desktop' | 'ios_pwa' | 'other';

export const PUSH_PLATFORMS: readonly { key: PushPlatform; label: OpsStringKey }[] = [
  { key: 'android', label: 'pushAndroid' },
  { key: 'desktop', label: 'pushDesktop' },
  { key: 'ios_pwa', label: 'pushIosPwa' },
  { key: 'other', label: 'pushOther' },
];

/** 條的最窄寬度（360 寬：內容 344 − 卡片左右內距，再扣段間縫）。依這個寬度判斷數字放不放得進色段。 */
export const PUSH_BAR_MIN_PX = 310;

export function shownCount(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('en-US') : '—';
}

/** 數字（.78rem 粗體、等寬數字）放進色段需要的寬度：左右內距合計 14px＋每字 8px。 */
function pushNumFits(share: number, value: number, barPx: number): boolean {
  return share * barPx >= 14 + value.toLocaleString('en-US').length * 8;
}

interface PushShare {
  key: PushPlatform;
  label: OpsStringKey;
  value: number | null;
  /** 0～1；不能算比例時為 0。 */
  share: number;
}

/**
 * 四個平台的比例。四個數字都合格且加總 > 0 才算比例（`drawable`）；
 * 任一個是 null 或全部 0 → 條畫成空的灰條，數字照「—」／0 顯示。比例以四平台加總為底，不用 total。
 */
function pushShares(counts: WebPushCounts | null): { rows: PushShare[]; drawable: boolean } {
  const values = PUSH_PLATFORMS.map((p) => (counts ? counts[p.key] : null));
  const sum = values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const drawable = values.every((v) => v !== null) && sum > 0;
  const rows = PUSH_PLATFORMS.map((p, i) => ({
    key: p.key,
    label: p.label,
    value: values[i] ?? null,
    share: drawable ? (values[i] ?? 0) / sum : 0,
  }));
  return { rows, drawable };
}

/** 卡名＋總數（卡名旁）＋右上「每日更新」。兩個方案共用。 */
function PushHead({ counts, t }: { counts: WebPushCounts | null; t: OpsT }): JSX.Element {
  return (
    <div class="od-push-head">
      <div class="od-push-title">
        <span class="od-rank-head">{t('pushTitle')}</span>
        <span class="od-push-total" data-push="total">{shownCount(counts?.total)}</span>
      </div>
      <span class="od-push-daily">{t('pushDaily')}</span>
    </div>
  );
}

/**
 * W6 推播裝置數（方案 A：一條堆疊條）。數字跟著 `opsSummary/latest` 一起來，不另讀。
 * 色段寬度照四平台比例，數字寫在段內；段太窄放不下時數字改寫在下方圖例的名稱旁，不截斷、不重疊。
 * `webPush` 缺漏或數字不合格 → 「—」，條畫成空的灰條。卡面只有卡名、總數與「每日更新」。
 */
export function OpsPushCard({ counts, t }: { counts: WebPushCounts | null; t: OpsT }): JSX.Element {
  const { rows, drawable } = pushShares(counts);
  const inside = new Set(
    rows
      .filter((r) => drawable && r.value !== null && r.value > 0 && pushNumFits(r.share, r.value, PUSH_BAR_MIN_PX))
      .map((r) => r.key),
  );
  return (
    <section class="od-card od-a-push" data-push-variant="stack">
      <PushHead counts={counts} t={t} />
      <div class={drawable ? 'od-push-bar' : 'od-push-bar empty'} aria-hidden="true">
        {drawable && rows.filter((r) => r.share > 0).map((r) => (
          <span key={r.key} class="od-push-seg" data-seg={r.key} style={{ flexGrow: r.share }}>
            {inside.has(r.key) && <span class="od-push-seg-num" data-push={r.key}>{shownCount(r.value)}</span>}
          </span>
        ))}
      </div>
      <ul class="od-push-legend">
        {rows.map((r) => (
          <li key={r.key}>
            <span class="od-push-dot" data-seg={r.key} aria-hidden="true" />
            <span class="od-push-name">{t(r.label)}</span>
            {inside.has(r.key)
              ? <span class="od-push-sr">{shownCount(r.value)}</span>
              : <span class="od-push-legend-num" data-push={r.key}>{shownCount(r.value)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
