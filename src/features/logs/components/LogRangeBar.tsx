/**
 * 日誌中心共用：時間區間（日／週／月＋前後切換）與每頁筆數（10／20／30／無限）。
 * 一列排完：[日|週|月] ‹ 區間 › [每頁]；窄螢幕也一列（字短、按鈕固定寬）。
 */
import type { JSX } from 'preact';

import { useT } from '@/i18n/i18n';

import {
  PAGE_SIZE_OPTIONS,
  formatRangeLabel,
  isLatestRange,
  rangeContaining,
  shiftRange,
  type LogRange,
  type PageSizeOption,
  type RangeUnit,
} from '../data/log-range';

export interface LogRangeBarProps {
  range: LogRange;
  pageSize: PageSizeOption;
  nowMs: number;
  onRange: (next: LogRange) => void;
  onPageSize: (next: PageSizeOption) => void;
}

const UNITS: readonly RangeUnit[] = ['day', 'week', 'month'];

export function LogRangeBar(props: LogRangeBarProps): JSX.Element {
  const t = useT();
  const latest = isLatestRange(props.range, props.nowMs);
  return (
    <div class="lc-range">
      <div class="lc-seg" role="group" aria-label={t('logs.range.unit')}>
        {UNITS.map((unit) => (
          <button
            key={unit}
            type="button"
            class={`lc-seg-btn${props.range.unit === unit ? ' is-on' : ''}`}
            aria-pressed={props.range.unit === unit}
            onClick={() => props.onRange(rangeContaining(unit, Math.min(props.range.startMs, props.nowMs)))}
          >
            {t(`logs.range.${unit}`)}
          </button>
        ))}
      </div>
      <div class="lc-step">
        <button type="button" class="lc-step-btn" aria-label={t('logs.range.prev')} onClick={() => props.onRange(shiftRange(props.range, -1))}>‹</button>
        <span class="lc-range-label" data-no-translate>{formatRangeLabel(props.range)}</span>
        <button type="button" class="lc-step-btn" aria-label={t('logs.range.next')} disabled={latest} onClick={() => props.onRange(shiftRange(props.range, 1))}>›</button>
      </div>
      <select
        class="lc-size"
        aria-label={t('logs.range.pageSize')}
        value={String(props.pageSize)}
        onChange={(e) => {
          const v = e.currentTarget.value;
          props.onPageSize(v === 'infinite' ? 'infinite' : (Number(v) as PageSizeOption));
        }}
      >
        {PAGE_SIZE_OPTIONS.map((opt) => (
          <option key={String(opt)} value={String(opt)}>
            {opt === 'infinite' ? t('logs.range.infinite') : t('logs.range.perPage', { n: opt })}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface LogPagerProps {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  busy: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/** 10／20／30 筆時的上一頁／下一頁。 */
export function LogPager(props: LogPagerProps): JSX.Element | null {
  const t = useT();
  if (!props.hasPrev && !props.hasNext) return null;
  return (
    <div class="lc-pager">
      <button type="button" class="lc-pager-btn" disabled={!props.hasPrev || props.busy} onClick={props.onPrev}>{t('logs.range.prevPage')}</button>
      <span class="lc-pager-num">{t('logs.range.pageNum', { n: props.page })}</span>
      <button type="button" class="lc-pager-btn" disabled={!props.hasNext || props.busy} onClick={props.onNext}>{t('logs.range.nextPage')}</button>
    </div>
  );
}
