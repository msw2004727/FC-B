// 營運儀表板 W6 截圖台：換掉 ops-data 的 loadDashboard（只給 dev-harness/vite.ops-w6.config.ts 用，不參與正式 build）。
// 不讀 Firestore，改用真的 parseOpsSummaryLatest／parseOpsSummaryNoShow 解析下面的假文件。?scene=full｜extreme｜zero｜empty（extreme＝1 台 iPhone、其他很多；zero＝全部 0；empty＝沒有 webPush）。
import {
  parseOpsSummaryLatest,
  parseOpsSummaryNoShow,
  type DashboardLoad,
} from '../features/ops-dashboard/data/ops-data';

export * from '../features/ops-dashboard/data/ops-data';

const scene = new URLSearchParams(location.search).get('scene') || 'full';
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const stamp = (ms: number): { toMillis: () => number } => ({ toMillis: () => ms });
const dateKey = (ms: number): string => new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

function kpi(scale: number): Record<string, unknown> {
  return {
    activeUsers: { cur: Math.round(186 * scale), prev: Math.round(171 * scale) },
    newUsers: { cur: Math.round(23 * scale), prev: Math.round(27 * scale) },
    eventsHeld: { cur: Math.round(41 * scale), prev: Math.round(36 * scale) },
    registrations: { cur: Math.round(512 * scale), prev: Math.round(468 * scale) },
    attend: {
      completed: Math.round(402 * scale), counted: Math.round(455 * scale), countedEvents: Math.round(38 * scale),
      prevCompleted: Math.round(371 * scale), prevCounted: Math.round(430 * scale), prevCountedEvents: Math.round(33 * scale),
    },
  };
}

function period(days: number, scale: number): Record<string, unknown> {
  return {
    start: dateKey(now - days * DAY), end: dateKey(now - DAY),
    prevStart: dateKey(now - 2 * days * DAY), prevEnd: dateKey(now - (days + 1) * DAY),
    complete: true, prevComplete: true,
    kpi: kpi(scale),
    topEvents: [
      { docId: 'ev-a', title: '週三晚間羽球 中階場', dateKey: dateKey(now - 3 * DAY), occupied: 24, max: 24 },
      { docId: 'ev-b', title: '週六早場足球 5v5', dateKey: dateKey(now - 5 * DAY), occupied: 19, max: 20 },
      { docId: 'ev-c', title: '河濱慢跑團 10K', dateKey: dateKey(now - 8 * DAY), occupied: 27, max: 30 },
    ],
    topHosts: [
      { uid: 'h-a', name: '阿凱', events: 9, registrations: 186 },
      { uid: 'h-b', name: '小雯', events: 6, registrations: 121 },
      { uid: 'h-c', name: '大偉', events: 4, registrations: 77 },
    ],
  };
}

function daily(): Record<string, unknown>[] {
  return Array.from({ length: 90 }, (_, i) => {
    const d = now - (90 - i) * DAY;
    const wave = Math.sin(i / 5) * 6;
    return {
      d: dateKey(d), active7: Math.round(70 + wave + i * 0.3), active30: Math.round(170 + wave + i * 0.2),
      newUsers: (i * 7) % 3, eventsHeld: 1 + (i % 3), registrations: Math.round(15 + wave + (i % 4) * 2),
      completed: 12 + (i % 4), counted: 14 + (i % 4), countedEvents: 1 + (i % 2),
    };
  });
}

function latestDoc(): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    schemaVersion: 1,
    generatedAt: stamp(now - 5 * 60 * 60 * 1000),
    asOf: dateKey(now - DAY),
    noshowSince: '2026-11-07',
    users: { totalUsers: 642, qaUsers: 4 },
    periods: { d7: period(7, 0.25), d30: period(30, 1), d90: period(90, 2.8), m12: period(365, 9) },
    trend: { daily: daily(), monthly: [] },
    upcomingLowFill: [],
    upcomingLowFillOverflow: 0,
    attention: [],
    cost: { month: dateKey(now).slice(0, 7), currency: 'TWD', monthToDate: 6420, projected: 8150, prevMonthTotal: 8971, sourceDateKey: dateKey(now - DAY) },
    lineQuota: null,
    integrity: { lastReconcileAt: stamp(now - 6 * 60 * 60 * 1000), lastMismatchDays: [] },
  };
  if (scene === 'full') doc['webPush'] = { android: 12, desktop: 8, ios_pwa: 3, other: 1, total: 24 };
  if (scene === 'extreme') doc['webPush'] = { android: 156, desktop: 41, ios_pwa: 1, other: 9, total: 207 };
  if (scene === 'zero') doc['webPush'] = { android: 0, desktop: 0, ios_pwa: 0, other: 0, total: 0 };
  return doc;
}

function noshowDoc(): Record<string, unknown> {
  const p = { noShow: 14, counted: 455, countedEvents: 38, prevNoShow: 19, prevCounted: 430, prevCountedEvents: 33 };
  return {
    schemaVersion: 1, generatedAt: stamp(now - 5 * 60 * 60 * 1000), asOf: dateKey(now - DAY),
    periods: { d7: p, d30: p, d90: p, m12: p },
    trend: { daily: [], monthly: [] },
    attention: [],
  };
}

export async function loadDashboard(): Promise<DashboardLoad> {
  const latest = parseOpsSummaryLatest(latestDoc());
  return {
    summary: { kind: 'ok', value: { generatedAtMs: latest.generatedAtMs, asOf: latest.asOf } },
    latest: { kind: 'ok', value: latest },
    noshow: { kind: 'ok', value: parseOpsSummaryNoShow(noshowDoc()) },
    openEvents: { kind: 'ok', value: 14 },
    lowFillEvents: { kind: 'ok', value: [] },
  };
}
