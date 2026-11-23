/**
 * 活動管理「統計」彈窗：區間（週／月／年／自訂）＋狀態勾選＋人次／人數＋圓餅圖。
 * 2026-11-23 站長核可預覽（docs/specs/lite-convergence/manage-events-range-stats-preview.html），
 * 取代原本只算狀態場數的 MyActivityStatsModal。口徑見 range-stats-model.ts。
 */
import './range-stats.css';
import '@/styles/legacy/edu-info-btn.css';
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatTaipei } from '@/core/taipei-time';
import type { ViewerView } from '@/features/profile/data/viewer';
import { loadRangeEvents, loadRangeRosters } from '../../data/range-stats';
import {
  RANGE_CONFIRM_DAYS,
  RANGE_STATUS_KEYS,
  computeRangeStats,
  customRange,
  periodRange,
  toPieSlices,
  type DateRangeKeys,
  type EventRoster,
  type RangePeriod,
  type RangeStatusKey,
  type StatMetric,
} from '../../data/range-stats-model';
import { effectiveEventStatus } from '../../data/my-activities-model';
import type { EventDoc } from '../../data/types';

export interface RangeStatsModalProps {
  open: boolean;
  viewer: ViewerView;
  manageAll: boolean;
  canViewNoShow: boolean;
  onClose: () => void;
  /** 測試注入時鐘 */
  nowMs?: number;
}

const PERIODS: readonly { id: RangePeriod; label: string }[] = [
  { id: 'week', label: '週' },
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
  { id: 'custom', label: '自訂' },
];

const STATUS_LABEL: Record<RangeStatusKey, string> = {
  upcoming: '即將開放',
  open: '報名中',
  full: '已額滿',
  ended: '已結束',
  cancelled: '已取消',
};

const STATUS_COLOR: Record<RangeStatusKey, string> = {
  upcoming: 'var(--primary)',
  open: 'var(--success)',
  full: 'var(--warning)',
  ended: 'var(--text-muted)',
  cancelled: 'var(--danger)',
};

const METRIC_ROWS: readonly { key: StatMetric; label: string; color: string }[] = [
  { key: 'registered', label: '已報名', color: 'var(--accent)' },
  { key: 'confirmed', label: '正取', color: 'var(--success)' },
  { key: 'waitlisted', label: '候補', color: 'var(--warning)' },
  { key: 'checkedPair', label: '簽到簽退', color: 'var(--info)' },
  { key: 'noShow', label: '放鴿子', color: 'var(--danger)' },
  { key: 'cancelled', label: '取消', color: 'var(--text-muted)' },
];

interface LoadedRange {
  events: EventDoc[];
  rosters: EventRoster[] | null;
  failed: EventDoc[];
}

// 除了 idle，每個階段都記住自己屬於哪個區間（key）；區間一變就不再顯示該階段（顧問 §3.607 P2：
// 原本「將讀取 N 場／繼續」與讀取失敗沒記區間，改選別的區間後按繼續，會把舊區間的數字記在新區間底下）。
type Phase =
  | { kind: 'idle' }
  | { kind: 'loading-events'; key: string }
  | { kind: 'confirm-rosters'; key: string; events: EventDoc[] }
  | { kind: 'loading-rosters'; key: string; done: number; total: number }
  | { kind: 'ready'; key: string }
  | { kind: 'error'; key: string };

function rangeLabel(period: RangePeriod, range: DateRangeKeys | null): string {
  if (!range) return '';
  const [y, m] = range.startKey.split('/');
  if (period === 'month') return `${y} 年 ${Number(m)} 月`;
  if (period === 'year') return `${y} 年`;
  const end = new Date(Date.UTC(
    Number(range.endKey.slice(0, 4)),
    Number(range.endKey.slice(5, 7)) - 1,
    Number(range.endKey.slice(8, 10)) - 1,
  ));
  const s = range.startKey.slice(5).replace(/^0/, '').replace('/0', '/');
  const e = `${end.getUTCMonth() + 1}/${end.getUTCDate()}`;
  return `${s} ～ ${e}`;
}

function fmt(n: number): string {
  return n.toLocaleString('zh-TW');
}

function Donut({ slices }: { slices: { key: string; value: number; color: string; percent: number }[] }): JSX.Element {
  const total = slices.reduce((s, p) => s + p.value, 0);
  const cx = 95;
  const cy = 95;
  const r = 88;
  const ri = 50;
  if (total <= 0) {
    return (
      <svg class="mrs-pie" width="190" height="190" viewBox="0 0 190 190" role="img" aria-label="沒有資料">
        <circle cx={cx} cy={cy} r={r} fill="var(--border)" />
        <circle cx={cx} cy={cy} r={ri} fill="var(--bg-card)" />
        <text x={cx} y={cy + 5} text-anchor="middle" class="mrs-pie-empty">0</text>
      </svg>
    );
  }
  let a0 = -Math.PI / 2;
  const shapes: JSX.Element[] = [];
  const labels: JSX.Element[] = [];
  for (const p of slices) {
    if (p.value <= 0) continue;
    const f = p.value / total;
    const a1 = a0 + f * 2 * Math.PI;
    if (f >= 0.9999) {
      shapes.push(<circle key={p.key} cx={cx} cy={cy} r={r} fill={p.color} />);
    } else {
      const large = f > 0.5 ? 1 : 0;
      const d = `M${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} L${cx} ${cy}Z`;
      shapes.push(<path key={p.key} d={d} fill={p.color} stroke="var(--bg-card)" stroke-width="2" />);
    }
    if (f >= 0.07) {
      const am = (a0 + a1) / 2;
      const tr = (r + ri) / 2;
      labels.push(
        <text key={`${p.key}-t`} x={cx + tr * Math.cos(am)} y={cy + tr * Math.sin(am) + 4} text-anchor="middle" class="mrs-pie-pct">
          {`${Math.round(p.percent)}%`}
        </text>,
      );
    }
    a0 = a1;
  }
  return (
    <svg class="mrs-pie" width="190" height="190" viewBox="0 0 190 190" role="img" aria-label="圓餅圖">
      {shapes}
      {labels}
      <circle cx={cx} cy={cy} r={ri} fill="var(--bg-card)" />
      <text x={cx} y={cy - 2} text-anchor="middle" class="mrs-pie-total">{fmt(total)}</text>
      <text x={cx} y={cy + 16} text-anchor="middle" class="mrs-pie-sub">合計</text>
    </svg>
  );
}

export function RangeStatsModal({
  open,
  viewer,
  manageAll,
  canViewNoShow,
  onClose,
  nowMs: nowOverride,
}: RangeStatsModalProps): JSX.Element | null {
  const nowMs = nowOverride ?? Date.now();
  const [period, setPeriod] = useState<RangePeriod>('month');
  const [offset, setOffset] = useState(0);
  const [from, setFrom] = useState(() => formatTaipei(nowMs, 'YYYY-MM-DD').slice(0, 8) + '01');
  const [to, setTo] = useState(() => formatTaipei(nowMs, 'YYYY-MM-DD'));
  const [statusOn, setStatusOn] = useState<Record<RangeStatusKey, boolean>>({
    upcoming: true, open: true, full: true, ended: true, cancelled: true,
  });
  const [basis, setBasis] = useState<'times' | 'people'>('times');
  const [pieMode, setPieMode] = useState<'att' | 'status'>('att');
  // 2026-11-23 站長：開啟不自動撈取，選好條件按「確認」才讀；顯示最後更新時間。
  // （取代原本「開啟即讀、換區間自動重讀、同區間用快取」：每按一次確認都重新讀取，結果才對得上更新時間。）
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [loaded, setLoaded] = useState<LoadedRange | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const confirmedRef = useRef(new Set<string>());
  const seqRef = useRef(0);

  const range = useMemo<DateRangeKeys | null>(
    () => (period === 'custom' ? customRange(from, to) : periodRange(period, nowMs, offset)),
    // nowMs 只在開啟時決定區間錨點；每次 render 的新時間不該讓區間重算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, offset, from, to],
  );
  const rangeKey = range ? `${range.startKey}-${range.endKey}` : '';

  // 關閉後再開回到未讀取狀態（不沿用上次結果，避免看到過期數字）。
  useEffect(() => {
    if (open) return;
    seqRef.current += 1;
    setPhase({ kind: 'idle' });
    setLoaded(null);
    setLoadedKey('');
    setUpdatedAt(null);
  }, [open]);

  async function loadRosters(seq: number, key: string, events: EventDoc[]): Promise<void> {
    setPhase({ kind: 'loading-rosters', key, done: 0, total: events.length });
    const result = await loadRangeRosters(events, (done, total) => {
      if (seq === seqRef.current) setPhase({ kind: 'loading-rosters', key, done, total });
    });
    if (seq !== seqRef.current) return;
    setLoaded({ events, rosters: result.rosters, failed: result.failed });
    setLoadedKey(key);
    setUpdatedAt(Date.now());
    setPhase({ kind: 'ready', key });
  }

  async function runConfirm(): Promise<void> {
    if (!range) return;
    const seq = ++seqRef.current;
    const key = rangeKey;
    try {
      setPhase({ kind: 'loading-events', key });
      const events = await loadRangeEvents(range, viewer, manageAll);
      if (seq !== seqRef.current) return;
      if (range.days > RANGE_CONFIRM_DAYS && events.length > 0 && !confirmedRef.current.has(key)) {
        setPhase({ kind: 'confirm-rosters', key, events });
        return;
      }
      await loadRosters(seq, key, events);
    } catch {
      if (seq !== seqRef.current) return;
      setPhase({ kind: 'error', key });
    }
  }

  async function continueRosters(events: EventDoc[], key: string): Promise<void> {
    // 用提示當時的區間，不用畫面上目前的區間。
    if (key !== rangeKey) return;
    const seq = ++seqRef.current;
    confirmedRef.current.add(key);
    try {
      await loadRosters(seq, key, events);
    } catch {
      if (seq !== seqRef.current) return;
      setPhase({ kind: 'error', key });
    }
  }

  // 區間改了：進行中的讀取作廢、提示與錯誤收起，回到未讀取，等再按確認。
  useEffect(() => {
    if (phase.kind === 'idle' || phase.key === rangeKey) return;
    seqRef.current += 1;
    setPhase({ kind: 'idle' });
    // 只在區間改變時檢查。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);
  // 同一次 render 內也不顯示別的區間的階段（effect 生效前不閃出舊提示）。
  const view: Phase = phase.kind !== 'idle' && phase.key !== rangeKey ? { kind: 'idle' } : phase;

  const busy = view.kind === 'loading-events' || view.kind === 'loading-rosters';
  const showResults = view.kind === 'ready' && loaded !== null && loadedKey === rangeKey;

  const stats = useMemo(() => {
    if (!loaded?.rosters) return null;
    const picked = loaded.rosters.filter((r) => {
      const st = effectiveEventStatus(r.event, nowMs) as RangeStatusKey;
      return statusOn[st] !== false;
    });
    return computeRangeStats(picked, nowMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, statusOn]);
  const visibleStats = showResults ? stats : null;

  if (!open) return null;

  const idx = basis === 'times' ? 'times' : 'people';
  const rows = METRIC_ROWS.filter((row) => row.key !== 'noShow' || canViewNoShow);

  let pie: { key: string; label: string; value: number; color: string; percent: number }[] = [];
  if (visibleStats) {
    const stats = visibleStats;
    if (pieMode === 'att') {
      const m = stats.metrics;
      const other = stats.confirmedOther[idx] + (canViewNoShow ? 0 : m.noShow[idx]);
      const parts = [
        { key: 'att', label: '已出席', value: m.checkedPair[idx], color: 'var(--info)' },
        { key: 'other', label: '正取未簽退', value: other, color: 'var(--success)' },
        ...(canViewNoShow ? [{ key: 'noshow', label: '放鴿子', value: m.noShow[idx], color: 'var(--danger)' }] : []),
        { key: 'wait', label: '候補', value: m.waitlisted[idx], color: 'var(--warning)' },
        { key: 'cancel', label: '取消', value: m.cancelled[idx], color: 'var(--text-muted)' },
      ];
      const slices = toPieSlices(parts);
      pie = parts.map((p, i) => ({ ...p, percent: slices[i]!.percent }));
    } else {
      const parts = RANGE_STATUS_KEYS.filter((k) => statusOn[k]).map((k) => ({
        key: k, label: STATUS_LABEL[k], value: stats.eventCountByStatus[k], color: STATUS_COLOR[k],
      }));
      const slices = toPieSlices(parts);
      pie = parts.map((p, i) => ({ ...p, percent: slices[i]!.percent }));
    }
  }

  const overlay = (
    <div
      class="edu-info-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="活動統計"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div class="edu-info-dialog mrs-dialog">
        <div class="mrs-head">
          <div class="edu-info-dialog-title mrs-title">活動統計</div>
          <button type="button" class="mrs-close" aria-label="關閉" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div class="mrs-body">
          <section class="mrs-card">
            <div class="mrs-seg mrs-seg-4" role="tablist" aria-label="區間">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={period === p.id}
                  class={period === p.id ? 'on' : ''}
                  onClick={() => {
                    setPeriod(p.id);
                    setOffset(0);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {period === 'custom' ? (
              <div class="mrs-custom">
                <input type="date" aria-label="開始日期" value={from} max={to} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />
                <span>～</span>
                <input type="date" aria-label="結束日期" value={to} min={from} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
              </div>
            ) : (
              <div class="mrs-nav">
                <button type="button" class="mrs-step" aria-label="上一段" onClick={() => setOffset((o) => o - 1)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                </button>
                <div class="mrs-range-label">{rangeLabel(period, range)}</div>
                <button type="button" class="mrs-step" aria-label="下一段" disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                </button>
              </div>
            )}
            {/* 2026-11-23 站長：狀態勾選重新設計——每個狀態帶自己的顏色圓點，選取時圓點填色並打勾、外框換成該色；
                原生核取方塊保留給鍵盤與讀屏，只是視覺隱藏。 */}
            <div class="mrs-chips" role="group" aria-label="活動狀態">
              {RANGE_STATUS_KEYS.map((k) => (
                <label key={k} class={`mrs-chip${statusOn[k] ? ' on' : ''}`} style={`--mrs-chip-c:${STATUS_COLOR[k]}`}>
                  <input
                    type="checkbox"
                    class="mrs-chip-input"
                    checked={statusOn[k]}
                    onChange={(e) => {
                      const checked = (e.target as HTMLInputElement).checked;
                      setStatusOn((prev) => ({ ...prev, [k]: checked }));
                    }}
                  />
                  <span class="mrs-chip-dot" aria-hidden="true">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  </span>
                  <span class="mrs-chip-text">{STATUS_LABEL[k]}</span>
                </label>
              ))}
            </div>
            <div class="mrs-confirm-row">
              <span class="mrs-updated">
                {showResults && updatedAt !== null ? `最後更新 ${formatTaipei(updatedAt, 'YYYY/MM/DD HH:mm')}` : ''}
              </span>
              <button
                type="button"
                class="primary-btn mrs-confirm-btn"
                disabled={!range || busy}
                onClick={() => { void runConfirm(); }}
              >
                確認
              </button>
            </div>
          </section>

          {!range ? (
            <div class="mrs-note mrs-warn">開始日期不能晚於結束日期</div>
          ) : view.kind === 'error' ? (
            <div class="mrs-note mrs-warn">
              讀取失敗
              <button type="button" class="outline-btn mrs-inline-btn" onClick={() => { void runConfirm(); }}>重試</button>
            </div>
          ) : view.kind === 'loading-events' || view.kind === 'loading-rosters' ? (
            <div class="mrs-loading" role="status">
              <span class="mrs-spin" aria-hidden="true" />
              {view.kind === 'loading-rosters' && view.total > 0 ? `讀取中 ${view.done} / ${view.total}` : '讀取中'}
            </div>
          ) : view.kind === 'confirm-rosters' ? (
            <div class="mrs-note">
              {`將讀取 ${view.events.length} 場活動的名單`}
              <button
                type="button"
                class="primary-btn mrs-inline-btn"
                onClick={() => { void continueRosters(view.events, view.key); }}
              >
                繼續
              </button>
            </div>
          ) : visibleStats ? (
            <>
              {loaded!.failed.length > 0 && (
                <div class="mrs-note mrs-warn">
                  {`${loaded!.failed.length} 場名單讀取失敗，未列入統計`}
                  <button type="button" class="outline-btn mrs-inline-btn" onClick={() => { void runConfirm(); }}>重試</button>
                </div>
              )}
              <section class="mrs-card mrs-kpis">
                <div class="mrs-kpi"><b>{fmt(visibleStats.eventCount)}</b><span>活動場數</span></div>
                <div class="mrs-kpi"><b>{fmt(visibleStats.metrics.registered.times)}</b><span>報名人次</span></div>
                <div class="mrs-kpi"><b>{fmt(visibleStats.metrics.registered.people)}</b><span>不重複人數</span></div>
              </section>

              <section class="mrs-card">
                <div class="mrs-h2">人數統計</div>
                <table class="mrs-table">
                  <thead>
                    <tr>
                      <th scope="col">項目</th>
                      <th scope="col">人次<div class="mrs-sub">重複</div></th>
                      <th scope="col">人數<div class="mrs-sub">不重複</div></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} data-metric={row.key}>
                        <td><span class="mrs-dot" style={{ background: row.color }} />{row.label}</td>
                        <td>{fmt(visibleStats.metrics[row.key].times)}</td>
                        <td>{fmt(visibleStats.metrics[row.key].people)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section class="mrs-card">
                <div class="mrs-pie-head">
                  <div class="mrs-h2">圓餅圖</div>
                  {pieMode === 'att' && (
                    <div class="mrs-seg mrs-seg-2 mrs-seg-sm" role="tablist" aria-label="計算方式">
                      <button type="button" role="tab" aria-selected={basis === 'times'} class={basis === 'times' ? 'on' : ''} onClick={() => setBasis('times')}>人次</button>
                      <button type="button" role="tab" aria-selected={basis === 'people'} class={basis === 'people' ? 'on' : ''} onClick={() => setBasis('people')}>人數</button>
                    </div>
                  )}
                </div>
                <div class="mrs-seg mrs-seg-2 mrs-seg-full" role="tablist" aria-label="圓餅圖內容">
                  <button type="button" role="tab" aria-selected={pieMode === 'att'} class={pieMode === 'att' ? 'on' : ''} onClick={() => setPieMode('att')}>出席分布</button>
                  <button type="button" role="tab" aria-selected={pieMode === 'status'} class={pieMode === 'status' ? 'on' : ''} onClick={() => setPieMode('status')}>活動狀態</button>
                </div>
                <div class="mrs-pie-box">
                  <Donut slices={pie} />
                  <div class="mrs-legend">
                    {pie.map((p) => (
                      <div key={p.key} class="mrs-legend-row">
                        <span class="mrs-dot" style={{ background: p.color }} />
                        <span class="mrs-legend-label">{pieMode === 'status' ? `${p.label}（場）` : p.label}</span>
                        <b>{fmt(p.value)}</b>
                        <em>{`${p.percent.toFixed(1)}%`}</em>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );

  // createPortal 到 body 會離開頁面的 .legacy-ui；A 的按鈕與 .edu-info-* 樣式（含本檔 CSS）打包時都限定在 .legacy-ui 內，
  // 所以照原統計彈窗外包一層 .legacy-ui。
  return createPortal(<div class="legacy-ui">{overlay}</div>, document.body);
}
