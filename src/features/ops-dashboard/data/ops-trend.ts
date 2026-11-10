/**
 * 營運儀表板趨勢圖的純計算（不讀 Firestore）。
 * 口徑：指標字典 §2.3。圖只吃 C3a 已讀的 `trend`，這裡不發讀取。
 *
 * Y 軸 nice number 用 §2.3 的步長集合（1、1.5、2、2.5、3、4、5、6、8 × 10ⁿ），
 * 3 格；人數與場數只取整數步長，且從 0 起。上緣留白：最高刻度嚴格大於資料最大值。
 * 比率的下界從資料最小值往下對齊步長，不強制從 0 起。
 *
 * 前段全 0：所選期間開頭連續的 0（早於第一個非 0 點）不畫，只留第一個非 0 點的前一點
 * （那個點的值必須是 0）。整段都是 0、或沒有任何可畫的點 → 空狀態，不畫貼底線。
 * null（缺日、沒有快照、比率樣本不足）維持斷線，不當 0。
 */
import { formatInt, RATE_MIN_EVENTS, type KpiId } from './ops-metrics';
import type {
  NoShowTrendDaily,
  NoShowTrendMonthly,
  OpsPeriod,
  PeriodBlock,
  TrendDaily,
  TrendMonthly,
} from './ops-summary-types';

export type TrendMetric = KpiId;

export const TREND_METRICS: readonly TrendMetric[] = ['active', 'new', 'held', 'regs', 'attend', 'noshow'];

/** 手機寬度下標籤不擠在一起：7 天全標，其餘抽樣。 */
export const LABEL_BUDGET: Record<OpsPeriod, number> = {
  d7: 7,
  d30: 5,
  d90: 5,
  m12: 6,
};

const NICE_MANTISSA = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8] as const;
const DAY_MS = 86_400_000;
const D90_WEEKS = 13;
const M12_MONTHS = 12;
const MAX_DAILY_POINTS = 120;

export const CHART_W = 360;
export const CHART_H = 168;

export type TrendUnit = 'count' | 'rate';

export interface AxisScale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

export interface TrendPoint {
  key: string;
  axis: string;
  tip: string;
  value: number | null;
}

export interface TrendDot {
  index: number;
  x: number;
  y: number;
}

export interface TrendTickLabel {
  x: number;
  y: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
}

export interface TrendGeom {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  yTicks: { x: number; y: number; text: string }[];
  xLabels: TrendTickLabel[];
  linePaths: string[];
  areaPaths: string[];
  dots: TrendDot[];
}

export interface TrendModel {
  status: 'empty' | 'ready';
  points: TrendPoint[];
  unit: TrendUnit;
  scale: AxisScale | null;
  labelIndexes: number[];
  segments: number[][];
  /** 只有活躍用戶要標口徑；d7／d30／d90 為 7 日，m12 為 30 日。 */
  activeCaliber: 'active7' | 'active30' | null;
  geom: TrendGeom | null;
}

export interface BuildTrendInput {
  period: OpsPeriod;
  metric: TrendMetric;
  asOf: string;
  periodBlock: PeriodBlock | null;
  daily: readonly TrendDaily[];
  monthly: readonly TrendMonthly[];
  noshowDaily: readonly NoShowTrendDaily[];
  noshowMonthly: readonly NoShowTrendMonthly[];
}

interface DayRow {
  active7: number | null;
  active30: number | null;
  newUsers: number;
  eventsHeld: number;
  registrations: number;
  completed: number;
  counted: number;
  countedEvents: number;
  noShow: number;
}

interface MonthRow extends DayRow {
  key: string;
}

/** 去掉二進位浮點尾巴。整數步長再交給 Math.round，避免 90 變成 90.00000000000001。 */
function quantize(n: number): number {
  if (!Number.isFinite(n) || n === 0) return 0;
  return Number(n.toPrecision(12));
}

function isNearlyZero(value: number): boolean {
  return Math.abs(value) < 1e-9;
}

/** 大於等於 raw 的第一個 nice step。人數與場數傳 integerOnly，步長必須是整數。 */
export function niceStepAtLeast(raw: number, integerOnly: boolean): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  let best = Infinity;
  for (let e = exp - 1; e <= exp + 3; e += 1) {
    const base = 10 ** e;
    for (const mantissa of NICE_MANTISSA) {
      const step = quantize(mantissa * base);
      if (!(step > 0) || step < raw - Math.max(1e-12, raw * 1e-9)) continue;
      if (integerOnly && Math.abs(step - Math.round(step)) > 1e-6) continue;
      if (step < best) best = step;
    }
  }
  if (!Number.isFinite(best)) return integerOnly ? Math.max(1, Math.ceil(raw)) : quantize(raw);
  return integerOnly ? Math.round(best) : best;
}

export function nextNiceStep(step: number, integerOnly: boolean): number {
  const bumped = niceStepAtLeast(step * 1.001, integerOnly);
  if (bumped > step + Math.max(1e-12, step * 1e-9)) return bumped;
  return niceStepAtLeast(step * 1.5, integerOnly);
}

export function isNiceStep(step: number, integerOnly = false): boolean {
  if (!(step > 0) || !Number.isFinite(step)) return false;
  if (integerOnly && Math.abs(step - Math.round(step)) > 1e-6) return false;
  const exp = Math.floor(Math.log10(step));
  const mantissa = step / 10 ** exp;
  return NICE_MANTISSA.some((item) => Math.abs(mantissa - item) < 1e-4);
}

function scaleOf(min: number, step: number, integerOnly: boolean): AxisScale {
  const cleanStep = integerOnly ? Math.round(step) : quantize(step);
  const origin = integerOnly ? Math.round(min) : quantize(min);
  const ticks = [0, 1, 2, 3].map((k) => {
    const value = origin + cleanStep * k;
    return integerOnly ? Math.round(value) : quantize(value);
  });
  return { min: ticks[0] ?? 0, max: ticks[3] ?? cleanStep * 3, step: cleanStep, ticks };
}

/** 人數與場數：從 0 起、3 格、整數 nice step、最高刻度高於資料。 */
export function countScale(maxValue: number): AxisScale {
  const max = Number.isFinite(maxValue) ? Math.max(0, maxValue) : 0;
  if (max <= 0) return scaleOf(0, 1, true);
  let step = niceStepAtLeast(max / 3, true);
  for (let guard = 0; guard < 12 && step * 3 <= max * (1 + 1e-9); guard += 1) {
    const next = nextNiceStep(step, true);
    if (!(next > step)) break;
    step = next;
  }
  return scaleOf(0, step, true);
}

function snapDown(value: number, step: number): number {
  if (!(step > 0)) return value;
  let q = Math.floor((value + step * 1e-8) / step);
  let snapped = quantize(q * step);
  if (snapped > value + step * 1e-6) {
    q -= 1;
    snapped = quantize(q * step);
  }
  return snapped;
}

/**
 * 比率（百分點）：下界從最小值往下對齊步長，3 格，最高刻度高於資料。
 * 資料都 ≥ 0 時，下界不落到負數。
 */
export function rateScale(minValue: number, maxValue: number): AxisScale {
  const minV = Number.isFinite(minValue) && Number.isFinite(maxValue) ? Math.min(minValue, maxValue) : 0;
  const maxV = Number.isFinite(minValue) && Number.isFinite(maxValue) ? Math.max(minValue, maxValue) : 1;
  const span = Math.max(maxV - minV, Math.max(Math.abs(maxV) * 0.08, 1e-6));
  let step = niceStepAtLeast(span / 3, false);
  const align = (current: number): number => {
    let lower = snapDown(minV, current);
    if (minV >= 0 && lower < 0) lower = 0;
    if (lower > minV + current * 1e-6) lower = quantize(lower - current);
    if (minV >= 0 && lower < 0) lower = 0;
    return lower;
  };
  let lower = align(step);
  let upper = quantize(lower + step * 3);
  for (let guard = 0; guard < 12 && (upper <= maxV + step * 1e-6 || lower > minV + step * 1e-6); guard += 1) {
    const next = nextNiceStep(step, false);
    if (!(next > step)) break;
    step = next;
    lower = align(step);
    upper = quantize(lower + step * 3);
  }
  return scaleOf(lower, step, false);
}

/** 含首尾、盡量均勻。點數不超過 budget 時全標。 */
export function sampleLabelIndexes(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  const budget = Math.max(1, Math.trunc(maxLabels));
  if (count <= budget) return Array.from({ length: count }, (_, index) => index);
  const indexes: number[] = [];
  for (let i = 0; i < budget; i += 1) {
    indexes.push(Math.round((i * (count - 1)) / (budget - 1)));
  }
  return [...new Set(indexes)].sort((a, b) => a - b);
}

export function formatTrendValue(value: number, unit: TrendUnit): string {
  if (unit === 'count') return formatInt(value);
  const rounded = Math.round(value * 10) / 10;
  const text = Math.abs(rounded - Math.round(rounded)) < 1e-9 ? String(Math.round(rounded)) : rounded.toFixed(1);
  return `${text}%`;
}

/**
 * 去掉開頭連續的 0，但留下第一個非 0 點的前一點（若該點是 0）。
 * 沒有非 0 點（整段是 0，或只剩 null）回 null，呼叫端顯示空狀態。
 * 結尾的 null 不佔 X 軸；中間的 null 保留，用來斷線。
 */
export function trimTrendPoints<T extends { value: number | null }>(points: readonly T[]): T[] | null {
  const first = points.findIndex((point) => point.value !== null && !isNearlyZero(point.value));
  if (first === -1) return null;
  const prev = first > 0 ? points[first - 1] : undefined;
  const start = prev && prev.value !== null && isNearlyZero(prev.value) ? first - 1 : first;
  let end = points.length;
  while (end > start && points[end - 1]?.value === null) end -= 1;
  const sliced = points.slice(start, end);
  return sliced.some((point) => point.value !== null) ? sliced : null;
}

/** 連續非 null 的索引段。長度 < 2 的段只畫點，不連線。 */
export function valueSegments(values: readonly (number | null)[]): number[][] {
  const out: number[][] = [];
  let current: number[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) out.push(current);
      current = [];
      return;
    }
    current.push(index);
  });
  if (current.length > 0) out.push(current);
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseDateKey(raw: string): number | null {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return utc;
}

export function formatDateKey(utc: number): string {
  const date = new Date(utc);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseMonthKey(raw: string): { year: number; month: number } | null {
  const match = /^(\d{4})[-/]?(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function monthKeyOf(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  const normalized = ((index % 12) + 12) % 12;
  return { year: Math.floor(index / 12), month: normalized + 1 };
}

function addDays(utc: number, days: number): number {
  return utc + days * DAY_MS;
}

function mondayOf(utc: number): number {
  const day = new Date(utc).getUTCDay();
  return addDays(utc, day === 0 ? -6 : 1 - day);
}

function shortDay(key: string): string {
  const utc = parseDateKey(key);
  if (utc === null) return key;
  const date = new Date(utc);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function fullDay(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return key;
  return `${match[1]}/${match[2]}/${match[3]}`;
}

function shortMonth(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  return `${match[1]!.slice(2)}/${Number(match[2])}`;
}

function fullMonth(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  return `${match[1]}/${match[2]}`;
}

function weekTip(startKey: string, endKey: string): string {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (start === null || end === null) return fullDay(startKey);
  const a = new Date(start);
  const b = new Date(end);
  const left = `${a.getUTCFullYear()}/${pad2(a.getUTCMonth() + 1)}/${pad2(a.getUTCDate())}`;
  const right = a.getUTCFullYear() === b.getUTCFullYear()
    ? `${pad2(b.getUTCMonth() + 1)}/${pad2(b.getUTCDate())}`
    : `${b.getUTCFullYear()}/${pad2(b.getUTCMonth() + 1)}/${pad2(b.getUTCDate())}`;
  return `${left}-${right}`;
}

function emptyDay(): DayRow {
  return {
    active7: null,
    active30: null,
    newUsers: 0,
    eventsHeld: 0,
    registrations: 0,
    completed: 0,
    counted: 0,
    countedEvents: 0,
    noShow: 0,
  };
}

function fromDaily(row: TrendDaily): DayRow {
  return {
    active7: row.active7,
    active30: row.active30,
    newUsers: row.newUsers,
    eventsHeld: row.eventsHeld,
    registrations: row.registrations,
    completed: row.completed,
    counted: row.counted,
    countedEvents: row.countedEvents,
    noShow: 0,
  };
}

function fromNoShowDay(row: NoShowTrendDaily): DayRow {
  const base = emptyDay();
  base.noShow = row.noShow;
  base.counted = row.counted;
  base.countedEvents = row.countedEvents;
  return base;
}

function fromMonthly(row: TrendMonthly, key: string): MonthRow {
  return {
    key,
    active7: null,
    active30: row.active30,
    newUsers: row.newUsers,
    eventsHeld: row.eventsHeld,
    registrations: row.registrations,
    completed: row.completed,
    counted: row.counted,
    countedEvents: row.countedEvents,
    noShow: 0,
  };
}

function fromNoShowMonth(row: NoShowTrendMonthly, key: string): MonthRow {
  const base = emptyDay();
  base.noShow = row.noShow;
  base.counted = row.counted;
  base.countedEvents = row.countedEvents;
  return { ...base, key };
}

function ratePct(numerator: number, denominator: number, events: number): number | null {
  if (events < RATE_MIN_EVENTS || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

function normalizeDate(raw: string): string | null {
  const utc = parseDateKey(raw);
  return utc === null ? null : formatDateKey(utc);
}

function indexDays(input: BuildTrendInput): Map<string, DayRow> {
  const map = new Map<string, DayRow>();
  if (input.metric === 'noshow') {
    for (const row of input.noshowDaily) {
      const key = normalizeDate(row.d);
      if (key) map.set(key, fromNoShowDay(row));
    }
    return map;
  }
  for (const row of input.daily) {
    const key = normalizeDate(row.d);
    if (key) map.set(key, fromDaily(row));
  }
  return map;
}

function indexMonths(input: BuildTrendInput): Map<string, MonthRow> {
  const map = new Map<string, MonthRow>();
  if (input.metric === 'noshow') {
    for (const row of input.noshowMonthly) {
      const parsed = parseMonthKey(row.m);
      if (!parsed) continue;
      const key = monthKeyOf(parsed.year, parsed.month);
      map.set(key, fromNoShowMonth(row, key));
    }
    return map;
  }
  for (const row of input.monthly) {
    const parsed = parseMonthKey(row.m);
    if (!parsed) continue;
    const key = monthKeyOf(parsed.year, parsed.month);
    map.set(key, fromMonthly(row, key));
  }
  return map;
}

function latestUtc(input: BuildTrendInput): number | null {
  let best: number | null = null;
  const consider = (utc: number | null): void => {
    if (utc !== null && (best === null || utc > best)) best = utc;
  };
  const days = input.metric === 'noshow' ? input.noshowDaily : input.daily;
  for (const row of days) consider(parseDateKey(row.d));
  const months = input.metric === 'noshow' ? input.noshowMonthly : input.monthly;
  for (const row of months) {
    const parsed = parseMonthKey(row.m);
    if (parsed) consider(Date.UTC(parsed.year, parsed.month - 1, 1));
  }
  return best;
}

function resolveEnd(input: BuildTrendInput): number | null {
  const blockEnd = input.periodBlock ? parseDateKey(input.periodBlock.end) : null;
  if (blockEnd !== null) return blockEnd;
  const asOf = parseDateKey(input.asOf);
  if (asOf !== null) return asOf;
  return latestUtc(input);
}

function eachUtc(start: number, end: number): number[] {
  const out: number[] = [];
  for (let cursor = start; cursor <= end; cursor += DAY_MS) out.push(cursor);
  return out;
}

function dayPointValue(row: DayRow | undefined, metric: TrendMetric, activeField: 'active7' | 'active30'): number | null {
  if (!row) return null;
  switch (metric) {
    case 'active':
      return row[activeField];
    case 'new':
      return row.newUsers;
    case 'held':
      return row.eventsHeld;
    case 'regs':
      return row.registrations;
    case 'attend':
      return ratePct(row.completed, row.counted, row.countedEvents);
    case 'noshow':
      return ratePct(row.noShow, row.counted, row.countedEvents);
    default:
      return null;
  }
}

function sumWeek(rows: Map<string, DayRow>, start: number, end: number, metric: TrendMetric): number | null {
  if (metric === 'active') {
    const row = rows.get(formatDateKey(end));
    return row ? row.active7 : null;
  }
  let seen = false;
  let newUsers = 0;
  let eventsHeld = 0;
  let registrations = 0;
  let completed = 0;
  let counted = 0;
  let countedEvents = 0;
  let noShow = 0;
  for (const utc of eachUtc(start, end)) {
    const row = rows.get(formatDateKey(utc));
    if (!row) continue;
    seen = true;
    newUsers += row.newUsers;
    eventsHeld += row.eventsHeld;
    registrations += row.registrations;
    completed += row.completed;
    counted += row.counted;
    countedEvents += row.countedEvents;
    noShow += row.noShow;
  }
  if (!seen) return null;
  switch (metric) {
    case 'new':
      return newUsers;
    case 'held':
      return eventsHeld;
    case 'regs':
      return registrations;
    case 'attend':
      return ratePct(completed, counted, countedEvents);
    case 'noshow':
      return ratePct(noShow, counted, countedEvents);
    default:
      return null;
  }
}

function buildDaily(input: BuildTrendInput, end: number): TrendPoint[] {
  let start = addDays(end, input.period === 'd7' ? -6 : -29);
  const blockStart = input.periodBlock ? parseDateKey(input.periodBlock.start) : null;
  if (blockStart !== null && blockStart <= end) start = blockStart;
  const days = Math.round((end - start) / DAY_MS) + 1;
  if (days > MAX_DAILY_POINTS) start = addDays(end, -(MAX_DAILY_POINTS - 1));
  const rows = indexDays(input);
  return eachUtc(start, end).map((utc) => {
    const key = formatDateKey(utc);
    return {
      key,
      axis: shortDay(key),
      tip: fullDay(key),
      value: dayPointValue(rows.get(key), input.metric, 'active7'),
    };
  });
}

function buildWeekly(input: BuildTrendInput, end: number): TrendPoint[] {
  const lastMonday = mondayOf(end);
  const rows = indexDays(input);
  const points: TrendPoint[] = [];
  for (let index = D90_WEEKS - 1; index >= 0; index -= 1) {
    const start = addDays(lastMonday, -7 * index);
    const weekEnd = Math.min(addDays(start, 6), end);
    const key = formatDateKey(start);
    points.push({
      key,
      axis: shortDay(key),
      tip: weekTip(key, formatDateKey(weekEnd)),
      value: sumWeek(rows, start, weekEnd, input.metric),
    });
  }
  return points;
}

function buildMonthly(input: BuildTrendInput, end: number): TrendPoint[] {
  const endDate = new Date(end);
  const endMonth = { year: endDate.getUTCFullYear(), month: endDate.getUTCMonth() + 1 };
  const rows = indexMonths(input);
  const points: TrendPoint[] = [];
  for (let delta = -(M12_MONTHS - 1); delta <= 0; delta += 1) {
    const shifted = shiftMonth(endMonth.year, endMonth.month, delta);
    const key = monthKeyOf(shifted.year, shifted.month);
    const row = rows.get(key);
    points.push({
      key,
      axis: shortMonth(key),
      tip: fullMonth(key),
      value: dayPointValue(row, input.metric, 'active30'),
    });
  }
  return points;
}

function buildPoints(input: BuildTrendInput): TrendPoint[] {
  const end = resolveEnd(input);
  if (end === null) return [];
  if (input.period === 'm12') return buildMonthly(input, end);
  if (input.period === 'd90') return buildWeekly(input, end);
  return buildDaily(input, end);
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function layout(points: readonly TrendPoint[], scale: AxisScale, unit: TrendUnit, labelIndexes: number[]): TrendGeom {
  const longest = Math.max(...scale.ticks.map((tick) => formatTrendValue(tick, unit).length), 1);
  const gutter = Math.min(108, Math.max(36, 14 + longest * 6.3));
  const plotLeft = gutter + 4;
  const plotRight = CHART_W - 14;
  const plotTop = 12;
  const plotBottom = CHART_H - 24;
  const span = scale.max - scale.min;
  const yOf = (value: number): number => {
    if (!(span > 0)) return (plotTop + plotBottom) / 2;
    const t = (value - scale.min) / span;
    return plotBottom - t * (plotBottom - plotTop);
  };
  const xOf = (index: number): number => {
    if (points.length <= 1) return (plotLeft + plotRight) / 2;
    return plotLeft + (index / (points.length - 1)) * (plotRight - plotLeft);
  };
  const xs = points.map((_, index) => xOf(index));
  const ys = points.map((point) => (point.value === null ? null : yOf(point.value)));
  const segments = valueSegments(points.map((point) => point.value));
  const linePaths: string[] = [];
  const areaPaths: string[] = [];
  const baseline = r1(yOf(scale.min));
  for (const segment of segments) {
    if (segment.length < 2) continue;
    let line = '';
    for (const index of segment) {
      const y = ys[index];
      if (y == null) continue;
      line += `${line ? 'L' : 'M'}${r1(xs[index] ?? 0)} ${r1(y)}`;
    }
    if (!line) continue;
    linePaths.push(line);
    const first = segment[0] ?? 0;
    const last = segment[segment.length - 1] ?? first;
    areaPaths.push(`${line}L${r1(xs[last] ?? 0)} ${baseline}L${r1(xs[first] ?? 0)} ${baseline}Z`);
  }
  const dots: TrendDot[] = [];
  points.forEach((point, index) => {
    const y = ys[index];
    if (point.value === null || y == null) return;
    dots.push({ index, x: r1(xs[index] ?? 0), y: r1(y) });
  });
  const yTicks = scale.ticks.map((tick) => ({
    x: r1(plotLeft - 6),
    y: r1(yOf(tick)),
    text: formatTrendValue(tick, unit),
  }));
  const xLabels: TrendTickLabel[] = labelIndexes.map((index) => {
    const point = points[index];
    let anchor: TrendTickLabel['anchor'] = 'middle';
    if (points.length > 1 && index === 0) anchor = 'start';
    else if (points.length > 1 && index === points.length - 1) anchor = 'end';
    return { x: r1(xs[index] ?? 0), y: CHART_H - 8, text: point?.axis ?? '', anchor };
  });
  return { width: CHART_W, height: CHART_H, plotLeft, plotRight, yTicks, xLabels, linePaths, areaPaths, dots };
}

export function trendUnit(metric: TrendMetric): TrendUnit {
  return metric === 'attend' || metric === 'noshow' ? 'rate' : 'count';
}

export function buildTrend(input: BuildTrendInput): TrendModel {
  const unit = trendUnit(input.metric);
  const activeCaliber = input.metric === 'active' ? (input.period === 'm12' ? 'active30' : 'active7') : null;
  const trimmed = trimTrendPoints(buildPoints(input));
  if (!trimmed) {
    return {
      status: 'empty',
      points: [],
      unit,
      scale: null,
      labelIndexes: [],
      segments: [],
      activeCaliber,
      geom: null,
    };
  }
  const values = trimmed.map((point) => point.value).filter((value): value is number => value !== null);
  const scale = unit === 'count'
    ? countScale(Math.max(...values))
    : rateScale(Math.min(...values), Math.max(...values));
  const labelIndexes = sampleLabelIndexes(trimmed.length, LABEL_BUDGET[input.period]);
  const segments = valueSegments(trimmed.map((point) => point.value));
  return {
    status: 'ready',
    points: trimmed,
    unit,
    scale,
    labelIndexes,
    segments,
    activeCaliber,
    geom: layout(trimmed, scale, unit, labelIndexes),
  };
}

export function trendHasRows(daily: readonly unknown[], monthly: readonly unknown[]): boolean {
  return daily.length > 0 || monthly.length > 0;
}
