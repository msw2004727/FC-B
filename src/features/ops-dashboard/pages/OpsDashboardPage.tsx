import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { formatTaipei, taipeiStartOfDay } from '@/core/taipei-time';
import { NO_SHOW_FEATURE_ENABLED } from '@/features/events/data/noshow-roster';
import { useViewer } from '@/features/profile/data/viewer';
import { t as appT } from '@/i18n/i18n';

import { OpsAttention } from '../components/OpsAttention';
import { OpsCostCard } from '../components/OpsCostCard';
import { OpsKpiGrid } from '../components/OpsKpiGrid';
import { OpsRankCard } from '../components/OpsRankCard';
import { OpsTrendChart } from '../components/OpsTrendChart';
import { OpsShell, ReadFailed, StatusNote, useOpsGate } from '../components/OpsShell';
import { loadDashboard, OPS_PERIODS, type DashboardLoad, type OpsPeriod } from '../data/ops-data';
import { buildAttention, buildKpis, costFigures } from '../data/ops-metrics';
import { rankEvents, rankHosts } from '../data/ops-rank';
import { useOpsT, type OpsT } from '../ops-strings';

export { OPS_PERIODS };
export type { OpsPeriod };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 字典 §2.2 A6：彙總早於現在 26 小時＝過期，頁首時間改警示色，不另加列。 */
export const SUMMARY_STALE_MS = 26 * HOUR_MS;

/** 頁首「資料更新於 今天 03:00」：台北日界判斷今天／昨天，其他日期顯示 MM/DD HH:mm。 */
export function formatUpdatedAt(ms: number, nowMs: number, t: OpsT): string {
  const days = Math.round((taipeiStartOfDay(nowMs) - taipeiStartOfDay(ms)) / DAY_MS);
  const time = formatTaipei(ms, 'HH:mm');
  if (days === 0) return t('today', { time });
  if (days === 1) return t('yesterday', { time });
  return formatTaipei(ms, 'YYYY/MM/DD HH:mm').slice(5);
}

const SEARCH_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

const CHEVRON = (
  <svg class="od-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

/**
 * 營運儀表板（路由 `/admin/ops`）。
 * C3a：六個關鍵數字、需要注意、彙總過期（頁首警示色）。
 * C3b：趨勢圖只用這次已讀的 `trend`，切期間、切指標不再讀。
 * C3c：排行跟同一個期間鈕（`topEvents`／`topHosts`）；費用卡讀 `cost`。兩者缺資料就整塊不顯示，不當成錯誤。
 * 沒有放鴿子權限不讀 `opsSummary/noshow`，版面 5 格、趨勢鈕也少一顆。
 * `opsSummary` 不存在或 `trend` 為空時，相關區塊不顯示；讀取失敗（含權限錯誤）顯示「讀取失敗」。
 */
export default function OpsDashboardPage(): JSX.Element {
  const t = useOpsT();
  const gate = useOpsGate();
  const viewer = useViewer();
  const { route } = useLocation();
  const canViewNoShow = viewer.hasPermission('activity.view_noshow') && NO_SHOW_FEATURE_ENABLED;
  const [load, setLoad] = useState<DashboardLoad | null>(null);
  const [period, setPeriod] = useState<OpsPeriod>('d30');
  const seqRef = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++seqRef.current;
    setLoad(null);
    const result = await loadDashboard({ canViewNoShow });
    if (seq === seqRef.current) setLoad(result);
  }, [canViewNoShow]);

  useEffect(() => {
    if (gate === 'allowed') void reload();
    return () => {
      seqRef.current += 1;
    };
  }, [gate, reload]);

  let content: JSX.Element;
  if (!load) {
    content = <StatusNote role="status" text={t('loading')} />;
  } else {
    const { summary, openEvents, noshow, lowFillEvents } = load;
    const failed = summary.kind === 'error'
      || openEvents.kind === 'error'
      || noshow.kind === 'error'
      || lowFillEvents.kind === 'error';
    const nowMs = Date.now();
    const generatedAtMs = summary.kind === 'ok' ? summary.value.generatedAtMs : null;
    const latest = load.latest.kind === 'ok' ? load.latest.value : null;
    const periodBlock = latest ? (latest.periods[period] ?? null) : null;
    const hasAnyPeriod = latest ? OPS_PERIODS.some((key) => latest.periods[key] !== undefined) : false;
    const cards = latest && (periodBlock !== null || hasAnyPeriod)
      ? buildKpis({
        period: periodBlock,
        totalUsers: latest.users.totalUsers,
        openEvents: openEvents.kind === 'ok' ? openEvents.value : null,
        noshow: noshow.kind === 'ok' ? (noshow.value.periods[period] ?? null) : null,
        showNoShow: noshow.kind === 'ok',
      })
      : null;
    const rows = latest
      ? buildAttention({
        nowMs,
        candidates: latest.upcomingLowFill,
        events: lowFillEvents.kind === 'ok' ? lowFillEvents.value : [],
        overflow: latest.upcomingLowFillOverflow,
        attention: latest.attention,
        cost: latest.cost,
        lineQuota: latest.lineQuota,
        mismatchDays: latest.integrity.lastMismatchDays,
        hosts: noshow.kind === 'ok' ? noshow.value.attention : [],
        showHosts: noshow.kind === 'ok',
      })
      : [];
    const noshowDoc = noshow.kind === 'ok' ? noshow.value : null;
    const showTrend = latest !== null && (latest.trend.daily.length > 0 || latest.trend.monthly.length > 0);
    const eventRanks = periodBlock ? rankEvents(periodBlock.topEvents) : [];
    const hostRanks = periodBlock ? rankHosts(periodBlock.topHosts) : [];
    const costView = latest ? costFigures(latest.cost) : null;
    const stale = generatedAtMs !== null && nowMs - generatedAtMs > SUMMARY_STALE_MS;
    content = (
      <>
        {summary.kind === 'ok' && (
          <div class="od-top">
            {generatedAtMs !== null && (
              <div class="od-head">
                <span class={stale ? 'od-updated stale' : 'od-updated'}>
                  {t('updatedAt', { when: formatUpdatedAt(generatedAtMs, nowMs, t) })}
                </span>
              </div>
            )}
            <div class="od-seg" role="group" aria-label={t('period')}>
              {OPS_PERIODS.map((p) => (
                <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
                  {t(`period.${p}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        {failed && <ReadFailed onRetry={() => void reload()} />}
        {/* 顧問 §3.83②：opsSummary 還沒產生（每日 03:00 首跑前）時要有說明，不是空白頁。 */}
        {!failed && load.latest.kind === 'absent' && <StatusNote text={t('summaryAbsent')} />}
        <div class="od-grid">
          {cards && <OpsKpiGrid cards={cards} t={t} />}
          <OpsAttention rows={rows} t={t} onOpen={(href) => route(href)} />
          {showTrend && latest && (
            <OpsTrendChart
              period={period}
              asOf={latest.asOf}
              periodBlock={periodBlock}
              daily={latest.trend.daily}
              monthly={latest.trend.monthly}
              noshowDaily={noshowDoc ? noshowDoc.trend.daily : []}
              noshowMonthly={noshowDoc ? noshowDoc.trend.monthly : []}
              showNoShow={noshowDoc !== null}
              t={t}
            />
          )}
          {eventRanks.length > 0 && (
            <OpsRankCard kind="events" rows={eventRanks} t={t} onOpen={(href) => route(href)} />
          )}
          {hostRanks.length > 0 && (
            <OpsRankCard kind="hosts" rows={hostRanks} t={t} onOpen={(href) => route(href)} />
          )}
          {costView && <OpsCostCard figures={costView} t={t} />}
          {!cards && openEvents.kind === 'ok' && (
            <section class="od-a-kpi">
              <div class="od-summary">
                <div class="od-kpi" data-kpi="open-events">
                  <div class="od-kpi-label">{t('openEvents')}</div>
                  <div class="od-kpi-row">
                    <span class="od-num">
                      {openEvents.value.toLocaleString('en-US')}
                      <small>{t('unitEvents')}</small>
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}
          <section class="od-a-query od-card">
            <button type="button" class="od-entry" onClick={() => route('/admin/ops/participants')}>
              <span class="od-entry-icon">{SEARCH_ICON}</span>
              <span class="od-entry-text">{t('queryTitle')}</span>
              {CHEVRON}
            </button>
          </section>
        </div>
      </>
    );
  }

  return (
    <OpsShell id="page-admin-dashboard" title={appT('ops-dashboard.title')} backTo="/" gate={gate}>
      {content}
    </OpsShell>
  );
}
