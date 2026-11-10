import { describe, expect, it } from 'vitest';

import type { NoShowPeriod, PeriodBlock } from './ops-summary-types';
import {
  ATTENTION_MAX_ROWS,
  buildAttention,
  buildKpis,
  costFigures,
  countDelta,
  formatMoney,
  isCostHigh,
  QA_UID_RE,
  rateDelta,
  selectLowFill,
  visibleAttention,
  type AttentionRow,
} from './ops-metrics';

const NOW = Date.parse('2026-11-10T02:00:00Z'); // 台北 11-10 10:00
const HOUR = 60 * 60 * 1000;

function period(patch: Partial<PeriodBlock['kpi']> & { prevComplete?: boolean } = {}): PeriodBlock {
  const { prevComplete = true, ...kpi } = patch;
  return {
    start: '2026-10-12',
    end: '2026-11-08',
    prevStart: '2026-09-12',
    prevEnd: '2026-10-11',
    complete: true,
    prevComplete,
    kpi: {
      activeUsers: { cur: 120, prev: 100 },
      newUsers: { cur: 10, prev: 8 },
      eventsHeld: { cur: 8, prev: 8 },
      registrations: { cur: 80, prev: 100 },
      attend: {
        completed: 50, counted: 100, countedEvents: 5,
        prevCompleted: 40, prevCounted: 100, prevCountedEvents: 4,
      },
      ...kpi,
    },
    topEvents: [],
    topHosts: [],
  };
}

function noshow(patch: Partial<NoShowPeriod> = {}): NoShowPeriod {
  return {
    noShow: 6, counted: 35, countedEvents: 5,
    prevNoShow: 10, prevCounted: 40, prevCountedEvents: 5,
    ...patch,
  };
}

function card(id: string, input = buildKpis({
  period: period(),
  totalUsers: 200,
  openEvents: 15,
  noshow: noshow(),
  showNoShow: true,
})) {
  const found = input.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe('數量箭頭（§1）', () => {
  it('上升、下降、持平', () => {
    expect(countDelta(120, 100, true, true)).toEqual({ kind: 'up', unit: 'pct', absText: '20', good: true });
    expect(countDelta(80, 100, true, true)).toEqual({ kind: 'down', unit: 'pct', absText: '20', good: false });
    expect(countDelta(8, 8, true, true)).toEqual({ kind: 'flat' });
    expect(countDelta(100.4, 100, true, true)).toEqual({ kind: 'flat' });
  });

  it('上一期為 0、沒有上一期、上一期不完整：不顯示百分比', () => {
    expect(countDelta(10, 0, true, true)).toEqual({ kind: 'na' });
    expect(countDelta(10, null, true, true)).toEqual({ kind: 'na' });
    expect(countDelta(null, 10, true, true)).toEqual({ kind: 'na' });
    expect(countDelta(10, 5, false, true)).toEqual({ kind: 'na' });
  });

  it('放鴿子率上升是壞的', () => {
    expect(countDelta(12, 10, true, false).kind === 'up' && countDelta(12, 10, true, false)).toMatchObject({ good: false });
  });
});

describe('比率箭頭（K5／K6）', () => {
  it('百分點差到小數 1 位；|Δ| < 0.5 持平', () => {
    expect(rateDelta(50, 100, 5, 40, 100, 4, true, true)).toEqual({ kind: 'up', unit: 'pt', absText: '10.0', good: true });
    expect(rateDelta(6, 35, 5, 10, 40, 5, true, false)).toEqual({ kind: 'down', unit: 'pt', absText: '7.9', good: true });
    expect(rateDelta(50, 100, 5, 499, 1000, 5, true, true)).toEqual({ kind: 'flat' });
  });

  it('樣本不足、上一期分母 0、上一期不完整：—', () => {
    expect(rateDelta(1, 2, 2, 1, 2, 1, true, true)).toEqual({ kind: 'na' });
    expect(rateDelta(5, 10, 3, 1, 2, 2, true, true)).toEqual({ kind: 'na' });
    expect(rateDelta(5, 10, 3, 0, 0, 3, true, true)).toEqual({ kind: 'na' });
    expect(rateDelta(5, 10, 3, 1, 10, 3, false, true)).toEqual({ kind: 'na' });
  });
});

describe('六個關鍵數字', () => {
  it('K1～K6 的數字、小字、箭頭', () => {
    expect(card('active')).toMatchObject({ value: '120', delta: { kind: 'up', absText: '20' }, sub: { kind: 'share', pct: 60 } });
    expect(card('new')).toMatchObject({ value: '10', sub: { kind: 'total', count: 200 } });
    expect(card('held')).toMatchObject({ value: '8', delta: { kind: 'flat' }, sub: { kind: 'open', count: 15 } });
    expect(card('regs')).toMatchObject({ value: '80', delta: { kind: 'down', absText: '20', good: false }, sub: { kind: 'perEvent', count: '10.0' } });
    expect(card('attend')).toMatchObject({ value: '50%', delta: { kind: 'up', absText: '10.0', good: true }, sub: { kind: 'counted', count: 5 } });
    expect(card('noshow')).toMatchObject({ value: '17%', delta: { kind: 'down', absText: '7.9', good: true }, sub: { kind: 'noshowN', count: 6 } });
  });

  it('總用戶 0 不顯示佔比；舉辦 0 場不顯示每場人數；報名中讀取失敗不顯示小字', () => {
    const hidden = buildKpis({
      period: period({ eventsHeld: { cur: 0, prev: 2 } }),
      totalUsers: 0,
      openEvents: null,
      noshow: null,
      showNoShow: false,
    });
    expect(hidden.find((item) => item.id === 'active')?.sub).toBeNull();
    expect(hidden.find((item) => item.id === 'regs')?.sub).toBeNull();
    expect(hidden.find((item) => item.id === 'held')?.sub).toBeNull();
    expect(hidden.map((item) => item.id)).toEqual(['active', 'new', 'held', 'regs', 'attend']);
  });

  it('上一期為 0 的新用戶不顯示百分比；活躍沒有快照是 —', () => {
    const cards = buildKpis({
      period: period({
        activeUsers: { cur: null, prev: null },
        newUsers: { cur: 4, prev: 0 },
      }),
      totalUsers: 200,
      openEvents: 1,
      noshow: null,
      showNoShow: false,
    });
    expect(cards.find((item) => item.id === 'active')).toMatchObject({ value: '—', delta: { kind: 'na' }, sub: null });
    expect(cards.find((item) => item.id === 'new')?.delta).toEqual({ kind: 'na' });
  });

  it('計入不滿 3 場：比率是 —，小字仍顯示場數與人次', () => {
    const cards = buildKpis({
      period: period({
        attend: {
          completed: 1, counted: 2, countedEvents: 2,
          prevCompleted: 1, prevCounted: 2, prevCountedEvents: 1,
        },
      }),
      totalUsers: 200,
      openEvents: 1,
      noshow: noshow({ noShow: 1, counted: 2, countedEvents: 1, prevNoShow: 0, prevCounted: 0, prevCountedEvents: 0 }),
      showNoShow: true,
    });
    expect(cards.find((item) => item.id === 'attend')).toMatchObject({ value: '—', delta: { kind: 'na' }, sub: { kind: 'counted', count: 2 } });
    expect(cards.find((item) => item.id === 'noshow')).toMatchObject({ value: '—', sub: { kind: 'noshowN', count: 1 } });
  });

  it('沒有放鴿子權限不產出第 6 格', () => {
    const cards = buildKpis({ period: period(), totalUsers: 200, openEvents: 1, noshow: noshow(), showNoShow: false });
    expect(cards).toHaveLength(5);
    expect(cards.some((item) => item.id === 'noshow')).toBe(false);
  });
});

describe('A1 即時填滿率', () => {
  const qa = `U${'0'.repeat(28)}0001`;

  function event(id: string, data: Record<string, unknown>) {
    return { id, data };
  }

  const candidates = [
    { docId: 'ev_low', title: '舊標題', startMs: NOW + 2 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_full', title: '已滿', startMs: NOW + 3 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_far', title: '太遠', startMs: NOW + 80 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_past', title: '已過', startMs: NOW - 2 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_qa', title: 'QA場', startMs: NOW + 2 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_ext', title: '外部', startMs: NOW + 2 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_end', title: '已結束', startMs: NOW + 2 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_soon', title: '更早', startMs: NOW + HOUR, max: 10, occupiedAtRun: 9 },
  ];

  it('只留 72 小時內、open／upcoming、非外部、非 QA、即時填滿率 < 30% 的場，依開始時間排序', () => {
    expect(QA_UID_RE.test(qa)).toBe(true);
    const hits = selectLowFill(candidates, [
      event('ev_low', { status: 'open', type: 'pickup', date: '2026/11/10 12:00', max: 20, realCurrent: 4, creatorUid: 'U-host', title: '夜足' }),
      event('ev_full', { status: 'open', date: '2026/11/10 13:00', max: 20, realCurrent: 10, creatorUid: 'U-host', title: '已滿夜足' }),
      event('ev_far', { status: 'open', date: '2026/11/13 18:00', max: 20, realCurrent: 1, creatorUid: 'U-host', title: '太遠' }),
      event('ev_past', { status: 'open', date: '2026/11/10 08:00', max: 20, realCurrent: 1, creatorUid: 'U-host', title: '已過' }),
      event('ev_qa', { status: 'open', date: '2026/11/10 12:00', max: 20, realCurrent: 1, creatorUid: qa, title: 'QA場' }),
      event('ev_ext', { status: 'open', type: 'external', date: '2026/11/10 12:00', max: 20, realCurrent: 1, creatorUid: 'U-host', title: '外部' }),
      event('ev_end', { status: 'ended', date: '2026/11/10 12:00', max: 20, realCurrent: 1, creatorUid: 'U-host', title: '已結束' }),
      event('ev_soon', { status: 'upcoming', date: '2026/11/10 11:00', max: 10, realCurrent: 2, creatorUid: 'U-host', title: '更早' }),
    ], NOW);
    expect(hits.map((hit) => hit.docId)).toEqual(['ev_soon', 'ev_low']);
    expect(hits[1]).toMatchObject({ title: '夜足', occupied: 4, max: 20 });
  });

  it('活動文件沒有 date 時用候選的 startMs', () => {
    const hits = selectLowFill(
      [{ docId: 'ev_low', title: '候補', startMs: NOW + HOUR, max: 10, occupiedAtRun: 0 }],
      [event('ev_low', { status: 'open', max: 10, realCurrent: 1, creatorUid: 'U-host' })],
      NOW,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe('候補');
  });
});

describe('需要注意的排序與溢出', () => {
  function kinds(rows: AttentionRow[]): string[] {
    return rows.map((row) => row.kind);
  }

  const source = {
    nowMs: NOW,
    candidates: [{ docId: 'ev_low', title: '夜足', startMs: NOW + HOUR, max: 20, occupiedAtRun: 1 }],
    events: [{ id: 'ev_low', data: { status: 'open', date: '2026/11/10 11:00', max: 20, realCurrent: 2, creatorUid: 'U-host', title: '夜足' } }],
    overflow: 3,
    attention: [
      { kind: 'reconcile_mismatch' as const, value: 2 },
      { kind: 'stuck_event' as const, refId: 'ev_stuck', title: '卡住球局' },
      { kind: 'cost_high' as const },
      { kind: 'line_quota' as const },
    ],
    cost: { month: '2026-11', currency: 'TWD', monthToDate: 800, projected: 1500, prevMonthTotal: 1000, sourceDateKey: '2026-11-08' },
    lineQuota: { month: '2026-11', used: 80, limit: 100 },
    mismatchDays: ['2026-11-01', '2026-11-02'],
    hosts: [{ uid: 'U-host', name: '阿明', noShow: 6, counted: 35 }],
    showHosts: true,
  };

  it('A2 → A1 → 還有 N 場 → A4 → A3 → A5 → A7', () => {
    const rows = buildAttention(source);
    expect(kinds(rows)).toEqual(['stuck', 'low_fill', 'more_events', 'host', 'cost', 'line', 'reconcile']);
    expect(rows[2]).toMatchObject({ kind: 'more_events', count: 3, href: '/activities' });
    expect(rows[3]).toMatchObject({ kind: 'host', name: '阿明', noShow: 6, counted: 35, pct: 17, href: '/profile/U-host' });
    expect(rows[4]).toMatchObject({ kind: 'cost', amount: 'TWD 1,500' });
    expect(rows[5]).toMatchObject({ kind: 'line', pct: 80 });
    expect(rows[6]).toMatchObject({ kind: 'reconcile', days: 2 });
    expect(rows[0]).toMatchObject({ href: '/events/ev_stuck' });
    expect(rows[1]).toMatchObject({ href: '/events/ev_low' });
  });

  it('沒有放鴿子權限不列 A4；額度未到 80%、費用未過門檻、C4 沒有 lineQuota 都不列', () => {
    const rows = buildAttention({
      ...source,
      showHosts: false,
      overflow: 0,
      candidates: [],
      events: [],
      attention: [{ kind: 'stuck_event', refId: 'ev_stuck', title: '卡住球局' }],
      cost: { ...source.cost, projected: 1000, prevMonthTotal: 1000 },
      lineQuota: { month: '2026-11', used: 79, limit: 100 },
      mismatchDays: [],
    });
    expect(kinds(rows)).toEqual(['stuck']);
  });

  it('lineQuota 是 null（C4 未做）即使 attention 有 line_quota 也不出現', () => {
    const rows = buildAttention({
      ...source,
      showHosts: false,
      overflow: 0,
      candidates: [],
      events: [],
      attention: [{ kind: 'line_quota' }],
      cost: null,
      lineQuota: null,
      mismatchDays: [],
    });
    expect(rows).toEqual([]);
  });

  it('超過 8 列時最後一列留給「還有 N 項」', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ kind: 'stuck' as const, key: `s${i}`, title: `場${i}`, href: `/events/${i}` }));
    expect(visibleAttention(rows, false)).toEqual({ visible: rows.slice(0, ATTENTION_MAX_ROWS - 1), hidden: 2 });
    expect(visibleAttention(rows, true).hidden).toBe(0);
    expect(visibleAttention(rows.slice(0, 8), false).hidden).toBe(0);
  });
});

describe('費用卡與 A3 同一份 cost', () => {
  const cost = { month: '2026-11', currency: 'TWD', monthToDate: 800, projected: 1500, prevMonthTotal: 1000, sourceDateKey: '2026-11-08' };

  it('三個數字用 A3 的金額格式；預估超過上月 1.2 倍時 high 與 A3 金額相同', () => {
    const figures = costFigures(cost);
    expect(figures).toEqual({
      monthToDate: 'TWD 800',
      projected: 'TWD 1,500',
      prevMonthTotal: 'TWD 1,000',
      high: true,
    });
    expect(figures?.projected).toBe(formatMoney(1500, 'TWD'));
    expect(isCostHigh(cost)).toBe(true);
    const row = buildAttention({
      nowMs: NOW,
      candidates: [],
      events: [],
      overflow: 0,
      attention: [],
      cost,
      lineQuota: null,
      mismatchDays: [],
      hosts: [],
      showHosts: false,
    }).find((item) => item.kind === 'cost');
    expect(row).toMatchObject({ kind: 'cost', amount: figures?.projected });
  });

  it('未過門檻仍顯示三個數字，A3 不出現', () => {
    const calm = { ...cost, projected: 1000, prevMonthTotal: 1000 };
    expect(costFigures(calm)?.high).toBe(false);
    expect(isCostHigh(calm)).toBe(false);
    const rows = buildAttention({
      nowMs: NOW,
      candidates: [],
      events: [],
      overflow: 0,
      attention: [],
      cost: calm,
      lineQuota: null,
      mismatchDays: [],
      hosts: [],
      showHosts: false,
    });
    expect(rows.some((item) => item.kind === 'cost')).toBe(false);
  });

  it('月初不估：預估是「—」，不當成費用偏高；cost 缺漏整張不顯示', () => {
    const early = { ...cost, projected: null };
    expect(costFigures(early)?.projected).toBe('—');
    expect(costFigures(early)?.high).toBe(false);
    expect(isCostHigh(early)).toBe(false);
    expect(costFigures(null)).toBeNull();
    expect(isCostHigh(null)).toBe(false);
  });
});
