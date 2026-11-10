/**
 * `opsSummary/latest` 與 `opsSummary/noshow` 的讀取型別。
 * 形狀照指標字典 §3.3、§3.4。C3a 畫 K1～K6 與需要注意；
 * C3b 用這裡的 `trend` 畫趨勢圖。C3c 用 `topEvents`／`topHosts`／`cost` 畫排行與費用卡。
 */

export const OPS_PERIODS = ['d7', 'd30', 'd90', 'm12'] as const;
export type OpsPeriod = (typeof OPS_PERIODS)[number];

export interface CountPair {
  cur: number | null;
  prev: number | null;
}

export interface AttendKpi {
  completed: number;
  counted: number;
  countedEvents: number;
  prevCompleted: number;
  prevCounted: number;
  prevCountedEvents: number;
}

export interface PeriodKpi {
  activeUsers: CountPair;
  newUsers: CountPair;
  eventsHeld: CountPair;
  registrations: CountPair;
  attend: AttendKpi;
}

export interface TopEvent {
  docId: string;
  title: string;
  dateKey: string;
  occupied: number;
  max: number;
}

export interface TopHost {
  uid: string;
  name: string;
  events: number;
  registrations: number;
}

export interface PeriodBlock {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  complete: boolean;
  prevComplete: boolean;
  kpi: PeriodKpi;
  topEvents: TopEvent[];
  topHosts: TopHost[];
}

export interface TrendDaily {
  d: string;
  active7: number | null;
  active30: number | null;
  newUsers: number;
  eventsHeld: number;
  registrations: number;
  completed: number;
  counted: number;
  countedEvents: number;
}

export interface TrendMonthly {
  m: string;
  active30: number | null;
  newUsers: number;
  eventsHeld: number;
  registrations: number;
  completed: number;
  counted: number;
  countedEvents: number;
}

export interface LowFillCandidate {
  docId: string;
  title: string;
  startMs: number;
  max: number;
  occupiedAtRun: number;
}

export type SummaryAttentionKind = 'stuck_event' | 'cost_high' | 'line_quota' | 'reconcile_mismatch';

export interface SummaryAttention {
  kind: SummaryAttentionKind;
  refId?: string;
  title?: string;
  dateKey?: string;
  value?: number;
  limit?: number;
}

export interface CostBlock {
  month: string;
  currency: string;
  monthToDate: number | null;
  projected: number | null;
  prevMonthTotal: number | null;
  sourceDateKey: string;
}

export interface LineQuota {
  month: string;
  used: number;
  limit: number;
}

export interface IntegrityBlock {
  lastReconcileAtMs: number | null;
  lastMismatchDays: string[];
}

export interface OpsSummaryLatest {
  schemaVersion: number | null;
  generatedAtMs: number | null;
  asOf: string;
  noshowSince: string;
  users: { totalUsers: number | null; qaUsers: number | null };
  periods: Partial<Record<OpsPeriod, PeriodBlock>>;
  trend: { daily: TrendDaily[]; monthly: TrendMonthly[] };
  upcomingLowFill: LowFillCandidate[];
  upcomingLowFillOverflow: number;
  attention: SummaryAttention[];
  cost: CostBlock | null;
  lineQuota: LineQuota | null;
  integrity: IntegrityBlock;
}

export interface NoShowPeriod {
  noShow: number;
  counted: number;
  countedEvents: number;
  prevNoShow: number;
  prevCounted: number;
  prevCountedEvents: number;
}

export interface NoShowTrendDaily {
  d: string;
  noShow: number;
  counted: number;
  countedEvents: number;
}

export interface NoShowTrendMonthly {
  m: string;
  noShow: number;
  counted: number;
  countedEvents: number;
}

export interface HostNoShow {
  uid: string;
  name: string;
  noShow: number;
  counted: number;
}

export interface OpsSummaryNoShow {
  schemaVersion: number | null;
  generatedAtMs: number | null;
  asOf: string;
  periods: Partial<Record<OpsPeriod, NoShowPeriod>>;
  trend: { daily: NoShowTrendDaily[]; monthly: NoShowTrendMonthly[] };
  attention: HostNoShow[];
}
