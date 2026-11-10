/**
 * 營運儀表板 C3a 的純計算（不讀 Firestore）。
 * 口徑：指標字典 §1 比較箭頭、§2.1 K1～K6、§2.2 需要注意。
 * 出席率樣本門檻沿用 `ATTEND_RATE_MIN_COUNTED`（字典 §1）。
 * 本卡不顯示同行者數。排行在 ops-rank.ts；費用卡的三個數字用下面的 `costFigures`（與 A3 同一份 `cost`）。趨勢圖在 ops-trend.ts。
 */
import { parseEventStartMs } from '@/core/event-time';
import { getEventParticipantStats } from '@/features/events/data/participant-stats';
import type { EventDoc } from '@/features/events/data/types';
import { ATTEND_RATE_MIN_COUNTED } from '@/features/profile/data/attendance-summary';

import type {
  CostBlock,
  HostNoShow,
  LineQuota,
  LowFillCandidate,
  NoShowPeriod,
  PeriodBlock,
  SummaryAttention,
} from './ops-summary-types';

export { ATTEND_RATE_MIN_COUNTED };

/** 字典 §1：比率計入場次小於此數 → 顯示「—」。 */
export const RATE_MIN_EVENTS = ATTEND_RATE_MIN_COUNTED;

/** 字典 §2.2 A1：開始時間在 [現在, 現在+72 小時]、填滿率 < 30%。 */
export const LOW_FILL_WINDOW_MS = 72 * 60 * 60 * 1000;
export const LOW_FILL_RATE = 0.3;

/** 字典 §1：主辦 UID 符合此式的活動整場排除。 */
export const QA_UID_RE = /^U0{28}[0-9]{4}$/;

/** 字典 §2.2 A3：預估月底 > 上月實際 × 1.2（顧問裁定 §12）。 */
export const COST_HIGH_RATIO = 1.2;

/** 字典 §2.2 A5：已用 ÷ 上限 ≥ 80%。C4 未寫入 lineQuota 時不出現。 */
export const LINE_QUOTA_MIN_RATIO = 0.8;

/** 字典 §2.2：最多 8 列，超過時最後一列是「還有 N 項」。 */
export const ATTENTION_MAX_ROWS = 8;

export type Delta =
  | { kind: 'na' }
  | { kind: 'flat' }
  | { kind: 'up' | 'down'; unit: 'pct' | 'pt'; absText: string; good: boolean };

export type KpiId = 'active' | 'new' | 'held' | 'regs' | 'attend' | 'noshow';

export type KpiSub =
  | { kind: 'share'; pct: number }
  | { kind: 'total'; count: number }
  | { kind: 'open'; count: number }
  | { kind: 'perEvent'; count: string }
  | { kind: 'counted'; count: number }
  | { kind: 'noshowN'; count: number };

export interface KpiCard {
  id: KpiId;
  value: string;
  delta: Delta;
  sub: KpiSub | null;
}

export interface LowFillEventDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface LowFillHit {
  docId: string;
  title: string;
  startMs: number;
  occupied: number;
  max: number;
}

export type AttentionRow =
  | { kind: 'stuck'; key: string; title: string; href: string | null }
  | { kind: 'low_fill'; key: string; title: string; href: string }
  | { kind: 'more_events'; key: string; count: number; href: string }
  | { kind: 'host'; key: string; name: string; noShow: number; counted: number; pct: number | null; href: string }
  | { kind: 'cost'; key: string; amount: string | null }
  | { kind: 'line'; key: string; pct: number }
  | { kind: 'reconcile'; key: string; days: number | null };

export function formatInt(n: number): string {
  return Math.trunc(n).toLocaleString('en-US');
}

function oneDecimal(n: number): string {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 10) / 10).toFixed(1);
}

function roundIntHalfAway(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/**
 * 數量類：Δ% = round((本期 − 上一期) ÷ 上一期 × 100)。
 * 上一期為 0、上一期為 null、prevComplete 不是 true → 「—」（不顯示百分比）。
 * 四捨五入後為 0（|Δ| < 0.5）→ 持平。
 */
export function countDelta(
  cur: number | null,
  prev: number | null,
  prevComplete: boolean,
  higherIsBetter: boolean,
): Delta {
  if (cur === null || prev === null || !prevComplete || prev === 0) return { kind: 'na' };
  const rounded = roundIntHalfAway(((cur - prev) / prev) * 100);
  if (rounded === 0) return { kind: 'flat' };
  const up = rounded > 0;
  return {
    kind: up ? 'up' : 'down',
    unit: 'pct',
    absText: String(Math.abs(rounded)),
    good: higherIsBetter ? up : !up,
  };
}

/**
 * 比率類：Δ = 本期率 − 上一期率（百分點），顯示到小數 1 位。
 * 任一方計入場次 < 3、上一期分母為 0、或 prevComplete 不是 true → 「—」。
 * |Δ| < 0.5 → 持平。
 */
export function rateDelta(
  curNum: number,
  curDen: number,
  curEvents: number,
  prevNum: number,
  prevDen: number,
  prevEvents: number,
  prevComplete: boolean,
  higherIsBetter: boolean,
): Delta {
  if (curEvents < RATE_MIN_EVENTS || prevEvents < RATE_MIN_EVENTS) return { kind: 'na' };
  if (!prevComplete || curDen <= 0 || prevDen <= 0) return { kind: 'na' };
  const diff = (curNum / curDen) * 100 - (prevNum / prevDen) * 100;
  if (Math.abs(diff) < 0.5) return { kind: 'flat' };
  const up = diff > 0;
  return {
    kind: up ? 'up' : 'down',
    unit: 'pt',
    absText: oneDecimal(Math.abs(diff)),
    good: higherIsBetter ? up : !up,
  };
}

function rateText(num: number, den: number, events: number): string | null {
  if (events < RATE_MIN_EVENTS || den <= 0) return null;
  return `${Math.round((num / den) * 100)}%`;
}

export interface BuildKpisInput {
  /** 選到的期間；文件沒有這一期時為 null（數字顯示「—」）。 */
  period: PeriodBlock | null;
  totalUsers: number | null;
  /** 即時報名中場數；讀取失敗為 null，小字不顯示（不當成 0）。 */
  openEvents: number | null;
  /** 有放鴿子文件時的該期；該期缺欄為 null。無權限／沒文件時不要叫這張卡。 */
  noshow: NoShowPeriod | null;
  showNoShow: boolean;
}

export function buildKpis(input: BuildKpisInput): KpiCard[] {
  const period = input.period;
  const prevOk = period?.prevComplete === true;
  const kpi = period?.kpi ?? null;
  const activeCur = kpi ? kpi.activeUsers.cur : null;
  const newCur = kpi ? kpi.newUsers.cur : null;
  const heldCur = kpi ? kpi.eventsHeld.cur : null;
  const regsCur = kpi ? kpi.registrations.cur : null;
  const attend = kpi?.attend ?? null;

  const share = activeCur !== null && input.totalUsers !== null && input.totalUsers > 0
    ? { kind: 'share' as const, pct: Math.round((activeCur / input.totalUsers) * 100) }
    : null;
  const perEvent = heldCur !== null && regsCur !== null && heldCur > 0
    ? { kind: 'perEvent' as const, count: oneDecimal(regsCur / heldCur) }
    : null;
  const attendValue = attend ? rateText(attend.completed, attend.counted, attend.countedEvents) : null;
  const noshowValue = input.noshow
    ? rateText(input.noshow.noShow, input.noshow.counted, input.noshow.countedEvents)
    : null;

  const cards: KpiCard[] = [
    {
      id: 'active',
      value: activeCur === null ? '—' : formatInt(activeCur),
      delta: countDelta(activeCur, kpi ? kpi.activeUsers.prev : null, prevOk, true),
      sub: share,
    },
    {
      id: 'new',
      value: newCur === null ? '—' : formatInt(newCur),
      delta: countDelta(newCur, kpi ? kpi.newUsers.prev : null, prevOk, true),
      sub: input.totalUsers === null ? null : { kind: 'total', count: input.totalUsers },
    },
    {
      id: 'held',
      value: heldCur === null ? '—' : formatInt(heldCur),
      delta: countDelta(heldCur, kpi ? kpi.eventsHeld.prev : null, prevOk, true),
      sub: input.openEvents === null ? null : { kind: 'open', count: input.openEvents },
    },
    {
      id: 'regs',
      value: regsCur === null ? '—' : formatInt(regsCur),
      delta: countDelta(regsCur, kpi ? kpi.registrations.prev : null, prevOk, true),
      sub: perEvent,
    },
    {
      id: 'attend',
      value: attendValue ?? '—',
      delta: attend
        ? rateDelta(
          attend.completed, attend.counted, attend.countedEvents,
          attend.prevCompleted, attend.prevCounted, attend.prevCountedEvents,
          prevOk, true,
        )
        : { kind: 'na' },
      sub: attend ? { kind: 'counted', count: attend.countedEvents } : null,
    },
  ];

  if (input.showNoShow) {
    cards.push({
      id: 'noshow',
      value: noshowValue ?? '—',
      delta: input.noshow
        ? rateDelta(
          input.noshow.noShow, input.noshow.counted, input.noshow.countedEvents,
          input.noshow.prevNoShow, input.noshow.prevCounted, input.noshow.prevCountedEvents,
          prevOk, false,
        )
        : { kind: 'na' },
      sub: input.noshow ? { kind: 'noshowN', count: input.noshow.noShow } : null,
    });
  }
  return cards;
}

function asEvent(data: Record<string, unknown>): EventDoc {
  return data as unknown as EventDoc;
}

/** A1：用即時活動文件重算填滿率，再套 72 小時與 < 30%。依開始時間排序。 */
export function selectLowFill(
  candidates: readonly LowFillCandidate[],
  events: readonly LowFillEventDoc[],
  nowMs: number,
): LowFillHit[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const end = nowMs + LOW_FILL_WINDOW_MS;
  const hits: LowFillHit[] = [];
  for (const candidate of candidates) {
    const event = byId.get(candidate.docId);
    if (!event) continue;
    const data = event.data;
    const status = typeof data['status'] === 'string' ? data['status'] : '';
    if (status !== 'open' && status !== 'upcoming') continue;
    if (data['type'] === 'external') continue;
    const host = typeof data['creatorUid'] === 'string' ? data['creatorUid'] : '';
    if (QA_UID_RE.test(host)) continue;
    const liveStart = parseEventStartMs(data['date']);
    const startMs = liveStart ?? candidate.startMs;
    if (startMs < nowMs || startMs > end) continue;
    const stats = getEventParticipantStats(asEvent(data), []);
    if (stats.maxCount <= 0) continue;
    if (stats.occupiedCount / stats.maxCount >= LOW_FILL_RATE) continue;
    const liveTitle = typeof data['title'] === 'string' ? data['title'].trim() : '';
    hits.push({
      docId: candidate.docId,
      title: liveTitle || candidate.title,
      startMs,
      occupied: stats.occupiedCount,
      max: stats.maxCount,
    });
  }
  hits.sort((a, b) => a.startMs - b.startMs || (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0));
  return hits;
}

export function isCostHigh(cost: CostBlock | null): boolean {
  if (!cost || cost.projected === null || cost.prevMonthTotal === null) return false;
  return cost.projected > cost.prevMonthTotal * COST_HIGH_RATIO;
}

/** A3 列上的金額與費用卡三個數字共用這一個格式（幣別＋en-US，最多兩位小數）。 */
export function formatMoney(amount: number, currency: string): string {
  const text = amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return currency ? `${currency} ${text}` : text;
}

export interface CostFigures {
  monthToDate: string;
  projected: string;
  prevMonthTotal: string;
  /** 與 `isCostHigh` 同一判斷，費用卡不另寫門檻。 */
  high: boolean;
}

/**
 * 字典 §2.5。`cost` 缺漏（null，C2 該步驟失敗）→ null，整張卡不顯示。
 * 個別數字是 null（月初前 3 天不估）→「—」，不另算。
 */
export function costFigures(cost: CostBlock | null): CostFigures | null {
  if (!cost) return null;
  const money = (amount: number | null): string => (amount === null ? '—' : formatMoney(amount, cost.currency));
  return {
    monthToDate: money(cost.monthToDate),
    projected: money(cost.projected),
    prevMonthTotal: money(cost.prevMonthTotal),
    high: isCostHigh(cost),
  };
}

export function lineQuotaPercent(quota: LineQuota | null): number | null {
  if (!quota || quota.limit <= 0) return null;
  if (quota.used / quota.limit < LINE_QUOTA_MIN_RATIO) return null;
  return Math.round((quota.used / quota.limit) * 100);
}

function eventHref(id: string): string {
  return `/events/${encodeURIComponent(id)}`;
}

export interface AttentionSource {
  nowMs: number;
  candidates: readonly LowFillCandidate[];
  events: readonly LowFillEventDoc[];
  overflow: number;
  attention: readonly SummaryAttention[];
  cost: CostBlock | null;
  lineQuota: LineQuota | null;
  mismatchDays: readonly string[];
  hosts: readonly HostNoShow[];
  /** 只有放鴿子文件讀成功才列 A4。無權限、沒文件、讀取失敗都不列。 */
  showHosts: boolean;
}

/** 排序：A2 → A1（開始時間）→ 還有 N 場 → A4 → A3 → A5 → A7。A6 不列（只改頁首顏色）。 */
export function buildAttention(source: AttentionSource): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const item of source.attention) {
    if (item.kind !== 'stuck_event') continue;
    rows.push({
      kind: 'stuck',
      key: `stuck:${rows.length}:${item.refId ?? ''}`,
      title: item.title ?? '',
      href: item.refId ? eventHref(item.refId) : null,
    });
  }
  for (const hit of selectLowFill(source.candidates, source.events, source.nowMs)) {
    rows.push({
      kind: 'low_fill',
      key: `low:${hit.docId}`,
      title: hit.title,
      href: eventHref(hit.docId),
    });
  }
  if (source.overflow > 0) {
    rows.push({ kind: 'more_events', key: 'more-events', count: source.overflow, href: '/activities' });
  }
  if (source.showHosts) {
    for (const host of source.hosts) {
      if (!host.uid) continue;
      const pct = host.counted > 0 ? Math.round((host.noShow / host.counted) * 100) : null;
      rows.push({
        kind: 'host',
        key: `host:${host.uid}`,
        name: host.name,
        noShow: host.noShow,
        counted: host.counted,
        pct,
        href: `/profile/${encodeURIComponent(host.uid)}`,
      });
    }
  }
  const costFlag = source.attention.some((item) => item.kind === 'cost_high');
  if (isCostHigh(source.cost) || costFlag) {
    const projected = source.cost?.projected;
    const amount = source.cost && projected !== null && projected !== undefined
      ? formatMoney(projected, source.cost.currency)
      : null;
    rows.push({ kind: 'cost', key: 'cost', amount });
  }
  const linePct = lineQuotaPercent(source.lineQuota);
  if (linePct !== null) rows.push({ kind: 'line', key: 'line', pct: linePct });
  const flagged = source.attention.find((item) => item.kind === 'reconcile_mismatch');
  if (source.mismatchDays.length > 0 || flagged) {
    const fromValue = flagged && typeof flagged.value === 'number' && flagged.value > 0 ? flagged.value : null;
    const days = source.mismatchDays.length > 0 ? source.mismatchDays.length : fromValue;
    rows.push({ kind: 'reconcile', key: 'reconcile', days });
  }
  return rows;
}

export function visibleAttention(rows: readonly AttentionRow[], expanded: boolean): { visible: AttentionRow[]; hidden: number } {
  if (expanded || rows.length <= ATTENTION_MAX_ROWS) return { visible: [...rows], hidden: 0 };
  const keep = ATTENTION_MAX_ROWS - 1;
  return { visible: rows.slice(0, keep), hidden: rows.length - keep };
}
