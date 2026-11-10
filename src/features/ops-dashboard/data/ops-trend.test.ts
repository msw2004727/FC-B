import { describe, expect, it } from 'vitest';

import {
  buildTrend,
  countScale,
  formatTrendValue,
  isNiceStep,
  niceStepAtLeast,
  rateScale,
  sampleLabelIndexes,
  trimTrendPoints,
  type BuildTrendInput,
} from './ops-trend';
import type { NoShowTrendDaily, TrendDaily, TrendMonthly } from './ops-summary-types';

const DAY = 86_400_000;

function dates(start: string, end: string): string[] {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  const out: string[] = [];
  for (let cursor = from; cursor <= to; cursor += DAY) out.push(new Date(cursor).toISOString().slice(0, 10));
  return out;
}

function day(d: string, patch: Partial<TrendDaily> = {}): TrendDaily {
  return {
    d,
    active7: 0,
    active30: 0,
    newUsers: 0,
    eventsHeld: 0,
    registrations: 0,
    completed: 0,
    counted: 0,
    countedEvents: 0,
    ...patch,
  };
}

function month(m: string, patch: Partial<TrendMonthly> = {}): TrendMonthly {
  return {
    m,
    active30: 0,
    newUsers: 0,
    eventsHeld: 0,
    registrations: 0,
    completed: 0,
    counted: 0,
    countedEvents: 0,
    ...patch,
  };
}

function noshow(d: string, patch: Partial<NoShowTrendDaily> = {}): NoShowTrendDaily {
  return { d, noShow: 0, counted: 0, countedEvents: 0, ...patch };
}

function trend(patch: Partial<BuildTrendInput> = {}): BuildTrendInput {
  return {
    period: 'd30',
    metric: 'held',
    asOf: '2026-11-08',
    periodBlock: null,
    daily: [],
    monthly: [],
    noshowDaily: [],
    noshowMonthly: [],
    ...patch,
  };
}

function block(start: string, end: string) {
  return {
    start,
    end,
    prevStart: start,
    prevEnd: end,
    complete: true,
    prevComplete: true,
    kpi: {
      activeUsers: { cur: null, prev: null },
      newUsers: { cur: 0, prev: null },
      eventsHeld: { cur: 0, prev: null },
      registrations: { cur: 0, prev: null },
      attend: {
        completed: 0, counted: 0, countedEvents: 0,
        prevCompleted: 0, prevCounted: 0, prevCountedEvents: 0,
      },
    },
    topEvents: [],
    topHosts: [],
  };
}

describe('nice number', () => {
  it('0、1、213、剛好踩在刻度上、很大、很小都用整數步長，上緣高於資料', () => {
    expect(countScale(0).ticks).toEqual([0, 1, 2, 3]);
    expect(countScale(1).ticks).toEqual([0, 1, 2, 3]);
    expect(countScale(213).ticks).toEqual([0, 80, 160, 240]);
    expect(countScale(240).ticks).toEqual([0, 100, 200, 300]);
    expect(countScale(0.001).ticks).toEqual([0, 1, 2, 3]);
    for (const max of [0, 1, 2, 3, 4, 40, 213, 240, 1000, 8.7e6, 1e12]) {
      const scale = countScale(max);
      expect(scale.min).toBe(0);
      expect(scale.ticks).toHaveLength(4);
      expect(scale.max).toBeGreaterThan(max);
      expect(isNiceStep(scale.step, true)).toBe(true);
      expect(Number.isInteger(scale.step)).toBe(true);
    }
  });

  it('小數步長走 1／1.5／2／2.5／3／4／5／6／8 × 10ⁿ', () => {
    expect(niceStepAtLeast(0.001, false)).toBeCloseTo(0.001);
    expect(niceStepAtLeast(0.0011, false)).toBeCloseTo(0.0015);
    expect(niceStepAtLeast(0.0004, false)).toBeCloseTo(0.0004);
    const scale = rateScale(0.4, 1.2);
    expect(scale.ticks.map((tick) => Number(tick.toFixed(4)))).toEqual([0.4, 0.8, 1.2, 1.6]);
    expect(isNiceStep(scale.step)).toBe(true);
  });

  it('比率下界從最小值往下取，不從 0 起，上緣留白', () => {
    expect(rateScale(70, 90).ticks).toEqual([70, 80, 90, 100]);
    const raised = rateScale(50, 80);
    expect(raised.min).toBeGreaterThan(0);
    expect(raised.min).toBeLessThanOrEqual(50);
    expect(raised.max).toBeGreaterThan(80);
    for (const [min, max] of [[0, 1], [1, 1], [72, 85], [99, 100], [0, 100], [3.5, 3.5]] as const) {
      const scale = rateScale(min, max);
      expect(scale.min).toBeLessThanOrEqual(min);
      expect(scale.max).toBeGreaterThan(max);
      expect(scale.ticks).toHaveLength(4);
      expect(isNiceStep(scale.step)).toBe(true);
    }
  });
});

describe('X 軸標籤抽樣', () => {
  it('不超過預算，而且有首尾', () => {
    expect(sampleLabelIndexes(0, 5)).toEqual([]);
    expect(sampleLabelIndexes(1, 5)).toEqual([0]);
    expect(sampleLabelIndexes(7, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(sampleLabelIndexes(30, 5)).toEqual([0, 7, 15, 22, 29]);
    expect(sampleLabelIndexes(13, 5)).toEqual([0, 3, 6, 9, 12]);
    expect(sampleLabelIndexes(12, 6)).toEqual([0, 2, 4, 7, 9, 11]);
  });

  it('7 天全標，30 天只抽 5 個', () => {
    const daily = dates('2026-10-10', '2026-11-08').map((d) => day(d, { eventsHeld: 2 }));
    const week = buildTrend(trend({ period: 'd7', asOf: '2026-11-08', daily }));
    const month = buildTrend(trend({ period: 'd30', asOf: '2026-11-08', daily }));
    expect(week.points).toHaveLength(7);
    expect(week.labelIndexes).toHaveLength(7);
    expect(month.points).toHaveLength(30);
    expect(month.labelIndexes).toEqual([0, 7, 15, 22, 29]);
    expect(month.points[0]!.axis).toBe('10/10');
    expect(month.points[29]!.axis).toBe('11/8');
  });
});

describe('前段全 0、空狀態、null、單點', () => {
  it('前段連續 0 只留第一個非 0 的前一點，後面的 0 保留', () => {
    const daily = dates('2026-11-01', '2026-11-08').map((d) => {
      const eventsHeld = d < '2026-11-06' ? 0 : d === '2026-11-06' ? 4 : d === '2026-11-07' ? 0 : 6;
      return day(d, { eventsHeld });
    });
    const model = buildTrend(trend({
      period: 'd7',
      metric: 'held',
      periodBlock: block('2026-11-01', '2026-11-08'),
      daily,
    }));
    expect(model.status).toBe('ready');
    expect(model.points.map((point) => point.key)).toEqual(['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(model.points.map((point) => point.value)).toEqual([0, 4, 0, 6]);
  });

  it('整段都是 0：空狀態，沒有線', () => {
    const daily = dates('2026-11-01', '2026-11-08').map((d) => day(d, { eventsHeld: 0, active7: 0 }));
    const model = buildTrend(trend({
      period: 'd7',
      periodBlock: block('2026-11-01', '2026-11-08'),
      daily,
    }));
    expect(model.status).toBe('empty');
    expect(model.geom).toBeNull();
    expect(model.points).toEqual([]);
  });

  it('12 個月前段全 0 從第一個非 0 月的前一個月起，窗口外的第 13 個月不畫', () => {
    const months = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
    const monthly = months.map((m) => month(m, { eventsHeld: m === '2025-11' ? 9 : m >= '2026-09' ? 3 : 0 }));
    const model = buildTrend(trend({
      period: 'm12',
      asOf: '2026-11-08',
      monthly,
    }));
    expect(model.points.map((point) => point.key)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(model.points.map((point) => point.value)).toEqual([0, 3, 3, 3]);
    const allZero = buildTrend(trend({
      period: 'm12',
      asOf: '2026-11-08',
      monthly: months.filter((m) => m !== '2025-11').map((m) => month(m, { eventsHeld: 0 })),
    }));
    expect(allZero.status).toBe('empty');
  });

  it('中間缺日是 null，斷成兩段，不當 0', () => {
    const daily = dates('2026-11-01', '2026-11-08')
      .filter((d) => d !== '2026-11-04')
      .map((d) => day(d, { eventsHeld: 2 }));
    const model = buildTrend(trend({
      period: 'd7',
      periodBlock: block('2026-11-01', '2026-11-08'),
      daily,
    }));
    expect(model.points.map((point) => point.value)).toEqual([2, 2, 2, null, 2, 2, 2, 2]);
    expect(model.segments).toEqual([[0, 1, 2], [4, 5, 6, 7]]);
    expect(model.geom!.linePaths).toHaveLength(2);
    expect(model.geom!.dots).toHaveLength(7);
    expect(model.geom!.dots.some((dot) => model.points[dot.index]?.key === '2026-11-04')).toBe(false);
  });

  it('沒有快照（active7 null）斷線，不畫成 0', () => {
    const daily = dates('2026-11-06', '2026-11-08').map((d, index) => day(d, { active7: index === 1 ? null : 8 }));
    const model = buildTrend(trend({
      period: 'd7',
      metric: 'active',
      periodBlock: block('2026-11-06', '2026-11-08'),
      daily,
    }));
    expect(model.points.map((point) => point.value)).toEqual([8, null, 8]);
    expect(model.geom!.linePaths).toHaveLength(0);
    expect(model.geom!.dots).toHaveLength(2);
  });

  it('少於 2 個可畫點時只有單點、沒有線', () => {
    const model = buildTrend(trend({
      period: 'd7',
      periodBlock: block('2026-11-01', '2026-11-08'),
      daily: [day('2026-11-08', { eventsHeld: 6 })],
    }));
    expect(model.points.map((point) => point.value)).toEqual([6]);
    expect(model.geom!.dots).toHaveLength(1);
    expect(model.geom!.linePaths).toEqual([]);
    expect(model.geom!.areaPaths).toEqual([]);
  });

  it('比率樣本不足（計入 < 3 場）不畫點', () => {
    const daily = dates('2026-11-06', '2026-11-08').map((d, index) => day(d, {
      completed: 1,
      counted: 4,
      countedEvents: index === 1 ? 2 : 3,
    }));
    const model = buildTrend(trend({
      period: 'd7',
      metric: 'attend',
      periodBlock: block('2026-11-06', '2026-11-08'),
      daily,
    }));
    expect(model.points.map((point) => point.value)).toEqual([25, null, 25]);
    expect(model.unit).toBe('rate');
  });

  it('trimTrendPoints：全 null、只有 0、以及保留前一個 0', () => {
    expect(trimTrendPoints([{ value: null }, { value: 0 }, { value: null }])).toBeNull();
    expect(trimTrendPoints([{ value: 0 }, { value: 0 }])).toBeNull();
    expect(trimTrendPoints([{ value: 0 }, { value: 0 }, { value: 5 }, { value: null }])?.map((point) => point.value)).toEqual([0, 5]);
  });
});

describe('指標欄位與期間粒度', () => {
  it('d7／d30 用當日 active7，d90 用該週最後一天 active7，m12 用 active30', () => {
    const daily = dates('2026-08-01', '2026-11-08').map((d) => day(d, {
      active7: d === '2026-11-08' ? 42 : 3,
      active30: 9,
      newUsers: 1,
      eventsHeld: 1,
    }));
    const monthly = [month('2026-10', { active30: 11 }), month('2026-11', { active30: 19, newUsers: 4 })];
    const d7 = buildTrend(trend({ period: 'd7', metric: 'active', daily }));
    expect(d7.activeCaliber).toBe('active7');
    expect(d7.points[d7.points.length - 1]!.value).toBe(42);
    const d90 = buildTrend(trend({ period: 'd90', metric: 'active', daily }));
    expect(d90.points).toHaveLength(13);
    expect(d90.points[0]!.key).toBe('2026-08-10');
    expect(d90.points[12]!.key).toBe('2026-11-02');
    expect(d90.points[12]!.value).toBe(42);
    expect(d90.points[12]!.tip).toBe('2026/11/02-11/08');
    const held = buildTrend(trend({ period: 'd90', metric: 'held', daily }));
    expect(held.points.every((point) => point.value === 7)).toBe(true);
    const m12 = buildTrend(trend({ period: 'm12', metric: 'active', monthly, daily: [] }));
    expect(m12.activeCaliber).toBe('active30');
    expect(m12.points[m12.points.length - 1]!.value).toBe(19);
    expect(m12.points[m12.points.length - 1]!.key).toBe('2026-11');
  });

  it('新用戶、舉辦、報名是加總；放鴿子率讀 noshow.trend，不讀 latest 的報名', () => {
    const daily = [day('2026-11-07', { newUsers: 2, eventsHeld: 1, registrations: 99 }), day('2026-11-08', { newUsers: 5, eventsHeld: 4, registrations: 99 })];
    const summed = buildTrend(trend({
      period: 'd7',
      metric: 'new',
      periodBlock: block('2026-11-07', '2026-11-08'),
      daily,
    }));
    expect(summed.points.map((point) => point.value)).toEqual([2, 5]);
    const noShow = buildTrend(trend({
      period: 'd7',
      metric: 'noshow',
      periodBlock: block('2026-11-08', '2026-11-08'),
      daily,
      noshowDaily: [noshow('2026-11-08', { noShow: 1, counted: 4, countedEvents: 3 })],
    }));
    expect(noShow.points.map((point) => point.value)).toEqual([25]);
    expect(formatTrendValue(25, 'rate')).toBe('25%');
    expect(noShow.points[0]!.value).not.toBe(99);
  });

  it('輸入沒排序也照日期排，切期間改變點數', () => {
    const daily = [...dates('2026-10-10', '2026-11-08')].reverse().map((d) => day(d, { eventsHeld: 1 }));
    const d30 = buildTrend(trend({ period: 'd30', daily }));
    const d7 = buildTrend(trend({ period: 'd7', daily }));
    expect(d30.points[0]!.key < d30.points[1]!.key).toBe(true);
    expect(d30.points).toHaveLength(30);
    expect(d7.points).toHaveLength(7);
    expect(d7.points[0]!.key).toBe('2026-11-02');
  });
});
