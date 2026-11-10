import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { KpiId } from '../data/ops-metrics';
import {
  buildTrend,
  formatTrendValue,
  TREND_METRICS,
  type TrendMetric,
} from '../data/ops-trend';
import type {
  NoShowTrendDaily,
  NoShowTrendMonthly,
  OpsPeriod,
  PeriodBlock,
  TrendDaily,
  TrendMonthly,
} from '../data/ops-summary-types';
import type { OpsStringKey, OpsT } from '../ops-strings';

const LABEL: Record<KpiId, OpsStringKey> = {
  active: 'kpi.active',
  new: 'kpi.new',
  held: 'kpi.held',
  regs: 'kpi.regs',
  attend: 'kpi.attend',
  noshow: 'kpi.noshow',
};

export interface OpsTrendChartProps {
  period: OpsPeriod;
  asOf: string;
  periodBlock: PeriodBlock | null;
  daily: readonly TrendDaily[];
  monthly: readonly TrendMonthly[];
  noshowDaily: readonly NoShowTrendDaily[];
  noshowMonthly: readonly NoShowTrendMonthly[];
  showNoShow: boolean;
  t: OpsT;
}

/**
 * 一張可切指標的內嵌 SVG 折線／面積圖。
 * 手機（< 760px）指標鈕 3×2，桌機一列 6 個。點擊某一點顯示日期與數值（滑過也會顯示，不靠它才能用）。
 * 活躍用戶只加口徑小字，不加其他副標（R-UI-026）。
 * `trend` 陣列是空的時整塊不渲染；有陣列但沒有可畫的點時顯示空狀態。
 */
export function OpsTrendChart({
  period,
  asOf,
  periodBlock,
  daily,
  monthly,
  noshowDaily,
  noshowMonthly,
  showNoShow,
  t,
}: OpsTrendChartProps): JSX.Element | null {
  const [metric, setMetric] = useState<TrendMetric>('active');
  const [picked, setPicked] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const metrics = showNoShow ? TREND_METRICS : TREND_METRICS.filter((item) => item !== 'noshow');
  const selected = metrics.includes(metric) ? metric : 'active';

  const model = buildTrend({
    period,
    metric: selected,
    asOf,
    periodBlock,
    daily,
    monthly,
    noshowDaily,
    noshowMonthly,
  });
  const pointKey = model.points.map((point) => `${point.key}:${point.value ?? 'x'}`).join('|');
  const selectionKey = `${selected}|${period}|${pointKey}`;
  const selectionRef = useRef(selectionKey);

  useEffect(() => {
    if (!showNoShow && metric === 'noshow') setMetric('active');
  }, [showNoShow, metric]);

  useEffect(() => {
    if (selectionRef.current === selectionKey) return;
    selectionRef.current = selectionKey;
    setPicked(null);
    setHover(null);
  }, [selectionKey]);

  if (daily.length === 0 && monthly.length === 0) return null;

  const shown = picked !== null ? picked : hover;
  const shownPoint = shown !== null ? model.points[shown] : undefined;
  const shownValue = shownPoint && shownPoint.value !== null ? shownPoint.value : null;
  const caliber = model.activeCaliber ? t(model.activeCaliber) : '';
  const geom = model.geom;

  const activate = (index: number): void => {
    setPicked((current) => (current === index ? null : index));
  };

  return (
    <section class="od-card od-trend" data-trend="1" data-trend-status={model.status} data-metric={selected} data-period={period}>
      <div class="od-trend-metrics" data-count={metrics.length} role="group">
        {metrics.map((item) => (
          <button
            key={item}
            type="button"
            data-metric={item}
            aria-pressed={selected === item}
            onClick={() => setMetric(item)}
          >
            {t(LABEL[item])}
          </button>
        ))}
      </div>
      <div class="od-trend-readout" data-trend-readout aria-live="polite">
        {shownValue !== null && shownPoint ? (
          <span class="od-trend-value">{shownPoint.tip} {formatTrendValue(shownValue, model.unit)}</span>
        ) : null}
        {caliber ? <span class="od-trend-caliber">{caliber}</span> : null}
      </div>
      {model.status === 'empty' || !geom ? (
        <div class="od-note od-trend-empty">{t('noData')}</div>
      ) : (
        <div class="od-trend-plot">
          <svg
            class="od-trend-svg"
            viewBox={`0 0 ${geom.width} ${geom.height}`}
            role="group"
            data-points={model.points.length}
            data-lines={geom.linePaths.length}
            data-dots={geom.dots.length}
            data-single={geom.dots.length < 2 ? '1' : '0'}
          >
            <g aria-hidden="true">
              {geom.yTicks.map((tick) => (
                <line
                  key={`g-${tick.text}`}
                  class="od-trend-grid"
                  x1={geom.plotLeft}
                  x2={geom.plotRight}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="var(--border)"
                  stroke-width="1"
                />
              ))}
              {geom.yTicks.map((tick) => (
                <text key={`y-${tick.text}`} class="od-trend-axis" x={tick.x} y={tick.y + 3} fill="var(--text-muted)" text-anchor="end">
                  {tick.text}
                </text>
              ))}
              {geom.areaPaths.map((d, index) => (
                <path key={`a-${index}`} class="od-trend-area" d={d} fill="var(--accent)" stroke="none" />
              ))}
              {geom.linePaths.map((d, index) => (
                <path key={`l-${index}`} class="od-trend-line" d={d} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
              ))}
              {geom.xLabels.map((label) => (
                <text key={`x-${label.x}-${label.text}`} class="od-trend-axis" x={label.x} y={label.y} fill="var(--text-muted)" text-anchor={label.anchor}>
                  {label.text}
                </text>
              ))}
            </g>
            {geom.dots.map((dot) => {
              const point = model.points[dot.index];
              if (!point || point.value === null) return null;
              const label = `${point.tip} ${formatTrendValue(point.value, model.unit)}`;
              const on = picked === dot.index;
              return (
                <g key={point.key}>
                  <circle
                    class="od-trend-hit"
                    data-point={point.key}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    aria-pressed={on}
                    cx={dot.x}
                    cy={dot.y}
                    r={16}
                    fill="transparent"
                    pointer-events="all"
                    onClick={() => activate(dot.index)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      activate(dot.index);
                    }}
                    onPointerEnter={() => setHover(dot.index)}
                    onPointerLeave={() => setHover((current) => (current === dot.index ? null : current))}
                  />
                  <circle
                    class="od-trend-dot"
                    data-selected={on ? 'true' : 'false'}
                    cx={dot.x}
                    cy={dot.y}
                    r={geom.dots.length < 2 ? 4.5 : 3.2}
                    fill={on ? 'var(--accent)' : 'var(--bg-card)'}
                    stroke="var(--accent)"
                    stroke-width="2"
                    pointer-events="none"
                  />
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}
