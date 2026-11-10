import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import { visibleAttention, type AttentionRow } from '../data/ops-metrics';
import type { OpsT } from '../ops-strings';

const CHEVRON = (
  <svg class="od-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

function RowBody({ row, t }: { row: AttentionRow; t: OpsT }): JSX.Element {
  switch (row.kind) {
    case 'stuck':
      return (
        <>
          <span class="od-attn-label">{t('attnStuck')}</span>
          <span class="od-attn-title">{row.title}</span>
          {row.href && CHEVRON}
        </>
      );
    case 'low_fill':
      return (
        <>
          <span class="od-attn-label">{t('attnLow')}</span>
          <span class="od-attn-title">{row.title}</span>
          {CHEVRON}
        </>
      );
    case 'more_events':
      return (
        <>
          <span class="od-attn-label">{t('moreEvents', { count: row.count })}</span>
          {CHEVRON}
        </>
      );
    case 'host':
      return (
        <>
          <span class="od-attn-title">{row.name || t('hostFallback')}</span>
          <span class="od-attn-label">{t('attnHost', { noShow: row.noShow, counted: row.counted })}</span>
          {row.pct !== null && <span class="od-attn-val">{row.pct}%</span>}
          {CHEVRON}
        </>
      );
    case 'cost':
      return (
        <>
          <span class="od-attn-label">{t('attnCost')}</span>
          {row.amount !== null && <span class="od-attn-val">{row.amount}</span>}
        </>
      );
    case 'line':
      return (
        <>
          <span class="od-attn-label">{t('attnLine')}</span>
          <span class="od-attn-val">{row.pct}%</span>
        </>
      );
    case 'reconcile':
      return (
        <>
          <span class="od-attn-label">{t('attnReconcile')}</span>
          {row.days !== null && <span class="od-attn-val">{t('attnDays', { count: row.days })}</span>}
        </>
      );
  }
}

function Row({ row, t, onOpen }: { row: AttentionRow; t: OpsT; onOpen: (href: string) => void }): JSX.Element {
  const href = 'href' in row ? row.href : null;
  if (href) {
    return (
      <button type="button" class="od-attn-row" onClick={() => onOpen(href)}>
        <RowBody row={row} t={t} />
      </button>
    );
  }
  return (
    <div class="od-attn-row">
      <RowBody row={row} t={t} />
    </div>
  );
}

/**
 * 需要注意。沒有任何項目時不渲染（R-UI-026）。
 * 超過 8 列時最後一列展開，不再讀取。
 */
export function OpsAttention({ rows, t, onOpen }: { rows: readonly AttentionRow[]; t: OpsT; onOpen: (href: string) => void }): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const { visible, hidden } = visibleAttention(rows, expanded);
  return (
    <section class="od-card od-a-attn">
      <ul class="od-attn">
        {visible.map((row) => (
          <li key={row.key}>
            <Row row={row} t={t} onOpen={onOpen} />
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <button type="button" class="od-attn-row" aria-expanded="false" onClick={() => setExpanded(true)}>
              <span class="od-attn-label">{t('moreItems', { count: hidden })}</span>
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
