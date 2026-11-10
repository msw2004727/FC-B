import type { JSX } from 'preact';

import { formatInt } from '../data/ops-metrics';
import type { RankEventRow, RankHostRow } from '../data/ops-rank';
import type { OpsT } from '../ops-strings';

interface Line {
  key: string;
  title: string;
  value: string;
  href: string;
}

/**
 * 一個排行卡。0 筆由呼叫端不渲染（R-UI-026，不加排序說明）。
 * 標題與名稱單行省略；右側數字不換行。姓名／標題不進網址。
 */
type RankProps = {
  t: OpsT;
  onOpen: (href: string) => void;
} & (
  | { kind: 'events'; rows: readonly RankEventRow[] }
  | { kind: 'hosts'; rows: readonly RankHostRow[] }
);

export function OpsRankCard(props: RankProps): JSX.Element {
  const lines: Line[] = props.kind === 'events'
    ? props.rows.map((row) => ({
      key: row.docId,
      title: row.title,
      value: `${formatInt(row.occupied)}/${formatInt(row.max)}`,
      href: row.href,
    }))
    : props.rows.map((row) => ({
      key: row.uid,
      title: row.name.trim() || props.t('hostFallback'),
      value: props.t('rankHostVal', { events: formatInt(row.events), regs: formatInt(row.registrations) }),
      href: row.href,
    }));
  const heading = props.kind === 'events' ? props.t('rankEvents') : props.t('rankHosts');
  return (
    <section class="od-card od-a-rank" data-rank={props.kind}>
      <div class="od-rank-head">{heading}</div>
      <ol class="od-rank">
        {lines.map((line, index) => (
          <li key={line.key}>
            <button type="button" class="od-rank-row" onClick={() => props.onOpen(line.href)}>
              <span class="od-rank-no">{index + 1}</span>
              <span class="od-avatar" aria-hidden="true">{line.title.charAt(0)}</span>
              <span class="od-rank-title">{line.title}</span>
              <span class="od-rank-val">{line.value}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
