import type { JSX } from 'preact';

import type { WebPushCounts } from '../data/ops-summary-types';
import type { OpsStringKey, OpsT } from '../ops-strings';

type PlatformKey = 'android' | 'desktop' | 'ios_pwa' | 'other';

const PLATFORMS: readonly { key: PlatformKey; label: OpsStringKey }[] = [
  { key: 'android', label: 'pushAndroid' },
  { key: 'desktop', label: 'pushDesktop' },
  { key: 'ios_pwa', label: 'pushIosPwa' },
  { key: 'other', label: 'pushOther' },
];

function shown(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('en-US') : '—';
}

/**
 * W6 推播裝置數：總數＋四個平台，數字跟著 `opsSummary/latest` 一起來，不另讀。
 * `webPush` 缺漏或個別數字不合格 → 「—」。卡面只有卡名與「每日更新」，不加說明。
 */
export function OpsPushCard({ counts, t }: { counts: WebPushCounts | null; t: OpsT }): JSX.Element {
  return (
    <section class="od-card od-a-push">
      <div class="od-push-head">
        <div class="od-rank-head">{t('pushTitle')}</div>
        <span class="od-push-daily">{t('pushDaily')}</span>
      </div>
      <div class="od-push">
        <div class="od-push-total">
          <span class="od-cost-label">{t('pushTotal')}</span>
          <span class="od-num" data-push="total">{shown(counts?.total)}</span>
        </div>
        {PLATFORMS.map((item) => (
          <div key={item.key}>
            <span class="od-cost-label">{t(item.label)}</span>
            <span class="od-cost-num" data-push={item.key}>{shown(counts?.[item.key])}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
