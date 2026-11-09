import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { t as appT } from '@/i18n/i18n';

import { OpsShell, ReadFailed, StatusNote, useOpsGate } from '../components/OpsShell';
import { loadDashboard, type DashboardLoad } from '../data/ops-data';
import { useOpsT, type OpsT } from '../ops-strings';
// 放最後：chunk 相依清單的順序跟著 import 順序，與其他後台頁一致時首頁主程式的檔名清單壓縮較好。
import { formatTaipei, taipeiStartOfDay } from '@/core/taipei-time';

export const OPS_PERIODS = ['d7', 'd30', 'd90', 'm12'] as const;
export type OpsPeriod = (typeof OPS_PERIODS)[number];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 字典 §2.2 A6：彙總早於現在 26 小時＝過期，頁首時間改警示色。 */
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
 * 營運儀表板（路由 `/admin/ops`，C1）。
 * C1 只有：頁首更新時間、期間切換、報名中場數（即時）、活動參與查詢入口。
 * 關鍵數字、需要注意、趨勢、排行、費用屬 C3（依 `opsSummary`），C2 部署前讀不到 `opsSummary/latest` 時，
 * 頁首時間與期間切換都不顯示；讀取失敗（含權限錯誤）顯示「讀取失敗」。
 */
export default function OpsDashboardPage(): JSX.Element {
  const t = useOpsT();
  const gate = useOpsGate();
  const { route } = useLocation();
  const [load, setLoad] = useState<DashboardLoad | null>(null);
  const [period, setPeriod] = useState<OpsPeriod>('d30');
  const seqRef = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++seqRef.current;
    setLoad(null);
    const result = await loadDashboard();
    if (seq === seqRef.current) setLoad(result);
  }, []);

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
    const { summary, openEvents } = load;
    const failed = summary.kind === 'error' || openEvents.kind === 'error';
    const nowMs = Date.now();
    const generatedAtMs = summary.kind === 'ok' ? summary.value.generatedAtMs : null;
    content = (
      <>
        {summary.kind === 'ok' && (
          <div class="od-top">
            {generatedAtMs !== null && (
              <div class="od-head">
                <span class={nowMs - generatedAtMs > SUMMARY_STALE_MS ? 'od-updated stale' : 'od-updated'}>
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
        <div class="od-grid">
          {openEvents.kind === 'ok' && (
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
