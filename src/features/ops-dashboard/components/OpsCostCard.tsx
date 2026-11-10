import type { JSX } from 'preact';

import type { CostFigures } from '../data/ops-metrics';
import type { OpsStringKey, OpsT } from '../ops-strings';

type MoneyKey = 'monthToDate' | 'projected' | 'prevMonthTotal';

const LABELS: readonly { key: MoneyKey; label: OpsStringKey }[] = [
  { key: 'monthToDate', label: 'costMtd' },
  { key: 'projected', label: 'costProjected' },
  { key: 'prevMonthTotal', label: 'costPrev' },
];

/**
 * 本月雲端費用（字典 §2.5）：一張卡三個數字，沒有副標。
 * `high` 只標資料屬性，門檻與 A3 的 `isCostHigh` 相同，畫面不多寫一句。
 */
export function OpsCostCard({ figures, t }: { figures: CostFigures; t: OpsT }): JSX.Element {
  return (
    <section class="od-card od-a-cost" data-cost-high={figures.high ? '1' : '0'}>
      <div class="od-cost">
        {LABELS.map((item) => (
          <div key={item.key}>
            <span class="od-cost-label">{t(item.label)}</span>
            <span class="od-cost-num" data-cost={item.key}>{figures[item.key]}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
