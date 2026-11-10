import type { JSX } from 'preact';

import type { Delta, KpiCard, KpiId, KpiSub } from '../data/ops-metrics';
import type { OpsStringKey, OpsT } from '../ops-strings';

const LABEL: Record<KpiId, OpsStringKey> = {
  active: 'kpi.active',
  new: 'kpi.new',
  held: 'kpi.held',
  regs: 'kpi.regs',
  attend: 'kpi.attend',
  noshow: 'kpi.noshow',
};

function subText(sub: KpiSub, t: OpsT): string {
  switch (sub.kind) {
    case 'share': return t('shareOf', { pct: sub.pct });
    case 'total': return t('totalUsers', { count: sub.count.toLocaleString('en-US') });
    case 'open': return t('openNow', { count: sub.count.toLocaleString('en-US') });
    case 'perEvent': return t('perEvent', { count: sub.count });
    case 'counted': return t('countedN', { count: sub.count.toLocaleString('en-US') });
    case 'noshowN': return t('noshowN', { count: sub.count.toLocaleString('en-US') });
  }
}

function DeltaMark({ delta, t }: { delta: Delta; t: OpsT }): JSX.Element {
  if (delta.kind === 'na') return <span class="od-delta na">—</span>;
  if (delta.kind === 'flat') return <span class="od-delta flat">{t('flat')}</span>;
  const body = delta.unit === 'pct' ? `${delta.absText}%` : t('deltaPoints', { value: delta.absText });
  const arrow = delta.kind === 'up' ? '▲' : '▼';
  return <span class={delta.good ? 'od-delta good' : 'od-delta bad'}>{arrow}{body}</span>;
}

/** 六個關鍵數字。沒有放鴿子權限時 5 格，手機最後一格滿寬（data-kpi-count）。 */
export function OpsKpiGrid({ cards, t }: { cards: readonly KpiCard[]; t: OpsT }): JSX.Element {
  return (
    <section class="od-a-kpi">
      <div class="od-summary" data-kpi-count={cards.length}>
        {cards.map((card) => {
          const hideDelta = card.value === '—' && card.delta.kind === 'na';
          return (
            <div key={card.id} class="od-kpi" data-kpi={card.id}>
              <div class="od-kpi-label">{t(LABEL[card.id])}</div>
              <div class="od-kpi-row">
                <span class="od-num">{card.value}</span>
                {hideDelta ? null : <DeltaMark delta={card.delta} t={t} />}
              </div>
              {card.sub && <div class="od-kpi-sub">{subText(card.sub, t)}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
