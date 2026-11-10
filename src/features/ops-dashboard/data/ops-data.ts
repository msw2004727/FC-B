/**
 * 營運儀表板進頁讀取。只讀、不寫、不開監聽。
 *
 * 指標字典 §5（每次進頁 ≤ 60，合計 ≤ 43）：
 * - `getDoc(opsSummary/latest)`：1 次（頁首、K1～K5、需要注意、過期判斷）
 * - `getDoc(opsSummary/noshow)`：1 次，只有呼叫端傳 `canViewNoShow` 才查（K6、A4）
 * - `getCountFromServer(events where status in ['open','full','upcoming'])`：1 次／每 1,000 筆（K3s）
 * - `getDocs(events where documentId() in [...])`：A1 候選，每批 30、最多 40 筆
 *
 * C1 沒有放鴿子權限、也沒有候選時仍是 2 次。有權限且候選 40 筆時為 43 次。
 *
 * 錯誤分流：文件不存在（C2 尚未產生）＝`absent`，相關區塊不顯示；
 * 權限錯誤或其他讀取錯誤＝`error`，畫面顯示讀取失敗，不可當成沒有資料。
 */
import { collection, doc, documentId, getCountFromServer, getDoc, getDocs, query, where } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';

import type {
  AttendKpi,
  CostBlock,
  CountPair,
  HostNoShow,
  IntegrityBlock,
  LineQuota,
  LowFillCandidate,
  NoShowPeriod,
  NoShowTrendDaily,
  NoShowTrendMonthly,
  OpsPeriod,
  OpsSummaryLatest,
  OpsSummaryNoShow,
  PeriodBlock,
  PeriodKpi,
  SummaryAttention,
  SummaryAttentionKind,
  TopEvent,
  TopHost,
  TrendDaily,
  TrendMonthly,
} from './ops-summary-types';
import { OPS_PERIODS } from './ops-summary-types';

export type { OpsPeriod } from './ops-summary-types';
export { OPS_PERIODS } from './ops-summary-types';
export type {
  HostNoShow,
  LowFillCandidate,
  NoShowPeriod,
  OpsSummaryLatest,
  OpsSummaryNoShow,
  PeriodBlock,
} from './ops-summary-types';

/** K3s 報名中：含即將開放（字典 §2.1 K3s，與自動結束掃描同一組狀態）。 */
export const OPEN_EVENT_STATUSES = ['open', 'full', 'upcoming'] as const;

/** A1 即時重讀：`documentId() in` 每批上限（Firestore in 上限、字典 §5）。 */
export const LOW_FILL_BATCH = 30;
/** A1 讀取預算護欄：超過時按開始時間只讀前 40 筆（字典 §2.2）。 */
export const LOW_FILL_READ_CAP = 40;

export type ReadResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'absent' }
  | { kind: 'error'; code: string };

export type NoShowRead =
  | ReadResult<OpsSummaryNoShow>
  | { kind: 'skipped' };

export interface SummaryHeader {
  /** `opsSummary/latest.generatedAt`（毫秒）；欄位缺漏或格式不對為 null。 */
  generatedAtMs: number | null;
  /** 資料截止日 `YYYY-MM-DD`（台北）；缺漏為 ''。 */
  asOf: string;
}

export interface EventSnap {
  id: string;
  data: Record<string, unknown>;
}

export interface DashboardLoad {
  summary: ReadResult<SummaryHeader>;
  latest: ReadResult<OpsSummaryLatest>;
  /** 未要求放鴿子權限時為 skipped，不發出讀取。 */
  noshow: NoShowRead;
  openEvents: ReadResult<number>;
  /** latest 沒讀到時為 absent（不另發讀取）。候選是空的則 ok 且不發 getDocs。 */
  lowFillEvents: ReadResult<EventSnap[]>;
}

export interface LoadDashboardOptions {
  /** 已同時具備 `activity.view_noshow` 與功能旗標時才傳 true。 */
  canViewNoShow?: boolean;
}

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code ? code : 'unknown';
}

function toMillis(value: unknown): number | null {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function num0(value: unknown): number {
  return num(value) ?? 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function countPair(value: unknown): CountPair {
  const raw = isRecord(value) ? value : {};
  return { cur: num(raw['cur']), prev: num(raw['prev']) };
}

function attendKpi(value: unknown): AttendKpi {
  const raw = isRecord(value) ? value : {};
  return {
    completed: num0(raw['completed']),
    counted: num0(raw['counted']),
    countedEvents: num0(raw['countedEvents']),
    prevCompleted: num0(raw['prevCompleted']),
    prevCounted: num0(raw['prevCounted']),
    prevCountedEvents: num0(raw['prevCountedEvents']),
  };
}

function periodKpi(value: unknown): PeriodKpi {
  const raw = isRecord(value) ? value : {};
  return {
    activeUsers: countPair(raw['activeUsers']),
    newUsers: countPair(raw['newUsers']),
    eventsHeld: countPair(raw['eventsHeld']),
    registrations: countPair(raw['registrations']),
    attend: attendKpi(raw['attend']),
  };
}

function topEvents(value: unknown): TopEvent[] {
  if (!Array.isArray(value)) return [];
  const out: TopEvent[] = [];
  for (const item of value) {
    if (!isRecord(item) || !str(item['docId'])) continue;
    out.push({
      docId: str(item['docId']),
      title: str(item['title']),
      dateKey: str(item['dateKey']),
      occupied: num0(item['occupied']),
      max: num0(item['max']),
    });
  }
  return out;
}

function topHosts(value: unknown): TopHost[] {
  if (!Array.isArray(value)) return [];
  const out: TopHost[] = [];
  for (const item of value) {
    if (!isRecord(item) || !str(item['uid'])) continue;
    out.push({
      uid: str(item['uid']),
      name: str(item['name']),
      events: num0(item['events']),
      registrations: num0(item['registrations']),
    });
  }
  return out;
}

function periodBlock(value: unknown): PeriodBlock {
  const raw = isRecord(value) ? value : {};
  return {
    start: str(raw['start']),
    end: str(raw['end']),
    prevStart: str(raw['prevStart']),
    prevEnd: str(raw['prevEnd']),
    complete: raw['complete'] === true,
    prevComplete: raw['prevComplete'] === true,
    kpi: periodKpi(raw['kpi']),
    topEvents: topEvents(raw['topEvents']),
    topHosts: topHosts(raw['topHosts']),
  };
}

function periodsOf<T>(value: unknown, parse: (raw: unknown) => T): Partial<Record<OpsPeriod, T>> {
  const out: Partial<Record<OpsPeriod, T>> = {};
  if (!isRecord(value)) return out;
  for (const period of OPS_PERIODS) {
    if (isRecord(value[period])) out[period] = parse(value[period]);
  }
  return out;
}

function trendDaily(value: unknown): TrendDaily[] {
  if (!Array.isArray(value)) return [];
  const out: TrendDaily[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    out.push({
      d: str(item['d']),
      active7: num(item['active7']),
      active30: num(item['active30']),
      newUsers: num0(item['newUsers']),
      eventsHeld: num0(item['eventsHeld']),
      registrations: num0(item['registrations']),
      completed: num0(item['completed']),
      counted: num0(item['counted']),
      countedEvents: num0(item['countedEvents']),
    });
  }
  return out;
}

function trendMonthly(value: unknown): TrendMonthly[] {
  if (!Array.isArray(value)) return [];
  const out: TrendMonthly[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    out.push({
      m: str(item['m']),
      active30: num(item['active30']),
      newUsers: num0(item['newUsers']),
      eventsHeld: num0(item['eventsHeld']),
      registrations: num0(item['registrations']),
      completed: num0(item['completed']),
      counted: num0(item['counted']),
      countedEvents: num0(item['countedEvents']),
    });
  }
  return out;
}

function lowFill(value: unknown): LowFillCandidate[] {
  if (!Array.isArray(value)) return [];
  const out: LowFillCandidate[] = [];
  for (const item of value) {
    if (!isRecord(item) || !str(item['docId']) || num(item['startMs']) === null) continue;
    out.push({
      docId: str(item['docId']),
      title: str(item['title']),
      startMs: num(item['startMs']) ?? 0,
      max: num0(item['max']),
      occupiedAtRun: num0(item['occupiedAtRun']),
    });
  }
  return out;
}

const ATTENTION_KINDS = new Set<SummaryAttentionKind>(['stuck_event', 'cost_high', 'line_quota', 'reconcile_mismatch']);

function attentionList(value: unknown): SummaryAttention[] {
  if (!Array.isArray(value)) return [];
  const out: SummaryAttention[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item['kind'] !== 'string' || !ATTENTION_KINDS.has(item['kind'] as SummaryAttentionKind)) continue;
    const row: SummaryAttention = { kind: item['kind'] as SummaryAttentionKind };
    if (typeof item['refId'] === 'string') row.refId = item['refId'];
    if (typeof item['title'] === 'string') row.title = item['title'];
    if (typeof item['dateKey'] === 'string') row.dateKey = item['dateKey'];
    const amount = num(item['value']);
    if (amount !== null) row.value = amount;
    const limit = num(item['limit']);
    if (limit !== null) row.limit = limit;
    out.push(row);
  }
  return out;
}

function costBlock(value: unknown): CostBlock | null {
  if (!isRecord(value)) return null;
  return {
    month: str(value['month']),
    currency: str(value['currency']),
    monthToDate: num(value['monthToDate']),
    projected: num(value['projected']),
    prevMonthTotal: num(value['prevMonthTotal']),
    sourceDateKey: str(value['sourceDateKey']),
  };
}

function lineQuota(value: unknown): LineQuota | null {
  if (!isRecord(value) || num(value['used']) === null || num(value['limit']) === null) return null;
  return { month: str(value['month']), used: num(value['used']) ?? 0, limit: num(value['limit']) ?? 0 };
}

function integrity(value: unknown): IntegrityBlock {
  const raw = isRecord(value) ? value : {};
  const days = Array.isArray(raw['lastMismatchDays'])
    ? raw['lastMismatchDays'].filter((day): day is string => typeof day === 'string' && day !== '')
    : [];
  return { lastReconcileAtMs: toMillis(raw['lastReconcileAt']), lastMismatchDays: days };
}

export function parseOpsSummaryLatest(data: Record<string, unknown>): OpsSummaryLatest {
  const users = isRecord(data['users']) ? data['users'] : {};
  const trend = isRecord(data['trend']) ? data['trend'] : {};
  const overflow = num(data['upcomingLowFillOverflow']);
  return {
    schemaVersion: num(data['schemaVersion']),
    generatedAtMs: toMillis(data['generatedAt']),
    asOf: str(data['asOf']),
    noshowSince: str(data['noshowSince']),
    users: { totalUsers: num(users['totalUsers']), qaUsers: num(users['qaUsers']) },
    periods: periodsOf(data['periods'], periodBlock),
    trend: { daily: trendDaily(trend['daily']), monthly: trendMonthly(trend['monthly']) },
    upcomingLowFill: lowFill(data['upcomingLowFill']),
    upcomingLowFillOverflow: overflow !== null && overflow > 0 ? Math.trunc(overflow) : 0,
    attention: attentionList(data['attention']),
    cost: costBlock(data['cost']),
    lineQuota: lineQuota(data['lineQuota']),
    integrity: integrity(data['integrity']),
  };
}

function noShowPeriod(value: unknown): NoShowPeriod {
  const raw = isRecord(value) ? value : {};
  return {
    noShow: num0(raw['noShow']),
    counted: num0(raw['counted']),
    countedEvents: num0(raw['countedEvents']),
    prevNoShow: num0(raw['prevNoShow']),
    prevCounted: num0(raw['prevCounted']),
    prevCountedEvents: num0(raw['prevCountedEvents']),
  };
}

function noShowDaily(value: unknown): NoShowTrendDaily[] {
  if (!Array.isArray(value)) return [];
  const out: NoShowTrendDaily[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    out.push({
      d: str(item['d']),
      noShow: num0(item['noShow']),
      counted: num0(item['counted']),
      countedEvents: num0(item['countedEvents']),
    });
  }
  return out;
}

function noShowMonthly(value: unknown): NoShowTrendMonthly[] {
  if (!Array.isArray(value)) return [];
  const out: NoShowTrendMonthly[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    out.push({
      m: str(item['m']),
      noShow: num0(item['noShow']),
      counted: num0(item['counted']),
      countedEvents: num0(item['countedEvents']),
    });
  }
  return out;
}

function hostAttention(value: unknown): HostNoShow[] {
  if (!Array.isArray(value)) return [];
  const out: HostNoShow[] = [];
  for (const item of value) {
    if (!isRecord(item) || item['kind'] !== 'host_noshow_high' || !str(item['uid'])) continue;
    out.push({
      uid: str(item['uid']),
      name: str(item['name']),
      noShow: num0(item['noShow']),
      counted: num0(item['counted']),
    });
  }
  return out;
}

export function parseOpsSummaryNoShow(data: Record<string, unknown>): OpsSummaryNoShow {
  const trend = isRecord(data['trend']) ? data['trend'] : {};
  return {
    schemaVersion: num(data['schemaVersion']),
    generatedAtMs: toMillis(data['generatedAt']),
    asOf: str(data['asOf']),
    periods: periodsOf(data['periods'], noShowPeriod),
    trend: { daily: noShowDaily(trend['daily']), monthly: noShowMonthly(trend['monthly']) },
    attention: hostAttention(data['attention']),
  };
}

/** 按開始時間取前 40 個不重複 docId（字典 §2.2 讀取護欄）。 */
export function capLowFillIds(candidates: readonly LowFillCandidate[]): string[] {
  const sorted = [...candidates].sort((a, b) => a.startMs - b.startMs || (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0));
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of sorted) {
    if (!candidate.docId || seen.has(candidate.docId)) continue;
    seen.add(candidate.docId);
    ids.push(candidate.docId);
    if (ids.length >= LOW_FILL_READ_CAP) break;
  }
  return ids;
}

function headerOf(latest: ReadResult<OpsSummaryLatest>): ReadResult<SummaryHeader> {
  if (latest.kind !== 'ok') return latest;
  return { kind: 'ok', value: { generatedAtMs: latest.value.generatedAtMs, asOf: latest.value.asOf } };
}

async function readSummaryDoc(id: 'latest' | 'noshow'): Promise<ReadResult<Record<string, unknown>>> {
  try {
    const { db } = await getFirebase();
    const snap = await getDoc(doc(db, 'opsSummary', id));
    if (!snap.exists()) return { kind: 'absent' };
    return { kind: 'ok', value: (snap.data() ?? {}) as Record<string, unknown> };
  } catch (err: unknown) {
    return { kind: 'error', code: errorCode(err) };
  }
}

export async function fetchSummaryHeader(): Promise<ReadResult<SummaryHeader>> {
  const latest = await fetchLatest();
  return headerOf(latest);
}

export async function fetchLatest(): Promise<ReadResult<OpsSummaryLatest>> {
  const read = await readSummaryDoc('latest');
  if (read.kind !== 'ok') return read;
  return { kind: 'ok', value: parseOpsSummaryLatest(read.value) };
}

export async function fetchNoShow(): Promise<ReadResult<OpsSummaryNoShow>> {
  const read = await readSummaryDoc('noshow');
  if (read.kind !== 'ok') return read;
  return { kind: 'ok', value: parseOpsSummaryNoShow(read.value) };
}

export async function fetchOpenEventCount(): Promise<ReadResult<number>> {
  try {
    const { db } = await getFirebase();
    const q = query(collection(db, 'events'), where('status', 'in', [...OPEN_EVENT_STATUSES]));
    const count = (await getCountFromServer(q)).data().count;
    return { kind: 'ok', value: Number.isFinite(count) ? count : 0 };
  } catch (err: unknown) {
    return { kind: 'error', code: errorCode(err) };
  }
}

export async function fetchLowFillEvents(candidates: readonly LowFillCandidate[]): Promise<ReadResult<EventSnap[]>> {
  const ids = capLowFillIds(candidates);
  if (ids.length === 0) return { kind: 'ok', value: [] };
  try {
    const { db } = await getFirebase();
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += LOW_FILL_BATCH) batches.push(ids.slice(i, i + LOW_FILL_BATCH));
    const snaps = await Promise.all(batches.map(async (batch) => {
      const q = query(collection(db, 'events'), where(documentId(), 'in', batch));
      return getDocs(q);
    }));
    const events: EventSnap[] = [];
    for (const snap of snaps) {
      for (const item of snap.docs) events.push({ id: item.id, data: (item.data() ?? {}) as Record<string, unknown> });
    }
    return { kind: 'ok', value: events };
  } catch (err: unknown) {
    return { kind: 'error', code: errorCode(err) };
  }
}

/** 進頁一次讀完。latest、noshow（有權限才）、報名中平行；A1 重讀等 latest 回來才發。 */
export async function loadDashboard(options: LoadDashboardOptions = {}): Promise<DashboardLoad> {
  const canViewNoShow = options.canViewNoShow === true;
  const [latest, noshow, openEvents] = await Promise.all([
    fetchLatest(),
    canViewNoShow ? fetchNoShow() : Promise.resolve({ kind: 'skipped' as const }),
    fetchOpenEventCount(),
  ]);
  const lowFillEvents = latest.kind === 'ok'
    ? await fetchLowFillEvents(latest.value.upcomingLowFill)
    : { kind: 'absent' as const };
  return { summary: headerOf(latest), latest, noshow, openEvents, lowFillEvents };
}
