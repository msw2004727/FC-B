// 營運儀表板 W6 截圖台：推播裝置卡「方案 B：四條各自的橫條」（只給站長比較預覽，不參與正式 build）。
// 每列名稱＋一條橫條，條長＝該平台占四平台加總的比例，數字寫在條內；條太短時數字放在條尾外側。
// 共用正式卡的卡名列、比例計算與「—」規則（OpsPushCard.tsx）；顏色與段內文字色規則同方案 A。
import './ops-w6-push-bars.css';
import type { JSX } from 'preact';

import type { WebPushCounts } from '@/features/ops-dashboard/data/ops-summary-types';
import type { OpsT } from '@/features/ops-dashboard/ops-strings';
import { PushHead, pushNumFits, pushShares, shownCount } from '@/features/ops-dashboard/components/OpsPushCard';

/** 360 寬時條的最短長度估計：卡內 316 − 最長名稱（約 140）− 間距。 */
const TRACK_MIN_PX = 160;

export function OpsPushCard({ counts, t }: { counts: WebPushCounts | null; t: OpsT }): JSX.Element {
  const { rows, drawable } = pushShares(counts);
  return (
    <section class="od-card od-a-push" data-push-variant="bars">
      <PushHead counts={counts} t={t} />
      <div class="od-pushb">
        {rows.map((r) => {
          const fill = drawable && r.share > 0;
          const inside = fill && r.value !== null && pushNumFits(r.share, r.value, TRACK_MIN_PX);
          const num = <span class={inside ? 'od-pushb-num' : 'od-pushb-out'} data-push={r.key}>{shownCount(r.value)}</span>;
          return (
            <div class="od-pushb-row" key={r.key}>
              <span class="od-push-name">{t(r.label)}</span>
              <span class={drawable ? 'od-pushb-track' : 'od-pushb-track empty'}>
                {fill && <span class="od-pushb-fill" data-seg={r.key} style={{ width: `${(r.share * 100).toFixed(2)}%` }}>{inside && num}</span>}
                {!inside && num}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
