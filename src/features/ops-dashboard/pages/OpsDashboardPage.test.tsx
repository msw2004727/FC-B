// 營運儀表板 C1：四身分權限、權限載完前不讀、進頁讀取預算、切期間 0 讀、opsSummary 不存在／讀取失敗的顯示。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => (await import('../ops-test-utils')).sdk);
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: {} }) }));
const state = vi.hoisted(() => ({ viewer: null as unknown, lastUid: null as string | null, route: null as unknown }));
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => state.lastUid }));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('preact-iso', () => ({ useLocation: () => ({ route: state.route, query: {} }) }));
vi.mock('@/features/profile/data/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  return { createMinimalViewer: actual.createMinimalViewer, useViewer: () => state.viewer };
});

import { formatTaipei } from '@/core/taipei-time';
import { setLocale } from '@/i18n/i18n';
import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import { createPermissionChecker } from '@/features/profile/data/permissions';
import { calls, failures, FORBIDDEN_APIS, resetStore, sdk, totalReads, ts } from '../ops-test-utils';
import OpsDashboardPage, { formatUpdatedAt } from './OpsDashboardPage';
import { opsT } from '../ops-strings';

const HOUR = 60 * 60 * 1000;

function viewer(role: string, rolePermissions?: Record<string, readonly string[]>): ViewerView {
  return {
    uid: `U-${role}`,
    displayName: role,
    pictureUrl: null,
    role,
    roleLevel: 0,
    teamIds: new Set<string>(),
    capabilities: [],
    hasPermission: createPermissionChecker({ role, rolePermissions: rolePermissions ?? null }),
  } as ViewerView;
}

function seed(summary: boolean, generatedAtMs = Date.now() - 3 * HOUR): void {
  resetStore({
    opsSummary: summary ? [{ id: 'latest', data: { generatedAt: ts(generatedAtMs), asOf: '2026-11-08' } }] : [],
    events: Array.from({ length: 50 }, (_, i) => ({ id: `ce_${i}`, data: { status: i < 38 ? 'open' : 'ended' } })),
  });
}

beforeAll(async () => {
  await setLocale('zh-TW');
});

beforeEach(() => {
  vi.clearAllMocks();
  seed(true);
  state.lastUid = null;
  state.route = vi.fn();
});

afterEach(() => cleanup());

async function openAs(v: ViewerView): Promise<void> {
  state.viewer = v;
  render(<OpsDashboardPage />);
  await waitFor(() => expect(document.querySelector('[role="status"]')).toBeNull());
}

function expectReadOnly(): void {
  for (const name of FORBIDDEN_APIS) expect(sdk[name]).not.toHaveBeenCalled();
}

describe('權限（admin.dashboard.entry；四身分）', () => {
  it('super_admin：可進、讀 3 次（latest＋noshow＋報名中，≤ 60）', async () => {
    await openAs(viewer('super_admin'));
    expect(await screen.findByText('報名中')).toBeTruthy();
    expect(screen.getByText('38')).toBeTruthy();
    expect(screen.getByText('活動參與查詢')).toBeTruthy();
    expect(calls.some((c) => c.id === 'noshow')).toBe(true);
    expect(totalReads()).toBe(3);
    expect(totalReads()).toBeLessThanOrEqual(60);
    expectReadOnly();
  });

  it('admin 被授予 admin.dashboard.entry：可進（同一判斷）', async () => {
    await openAs(viewer('admin', { admin: ['admin.dashboard.entry'] }));
    expect(await screen.findByText('報名中')).toBeTruthy();
    expect(totalReads()).toBe(2);
  });

  it.each([
    ['admin（預設沒有入口碼）', viewer('admin')],
    ['user', viewer('user')],
    ['只有 activity.view_noshow 沒有入口碼', viewer('admin', { admin: ['activity.view_noshow'] })],
  ])('%s：權限不足、0 讀', async (_label, v) => {
    await openAs(v);
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(screen.queryByText('活動參與查詢')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('沒登入：權限不足、0 讀', async () => {
    state.viewer = { ...viewer('user'), uid: null, hasPermission: () => false };
    render(<OpsDashboardPage />);
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('權限還沒載完（最小 viewer）：顯示載入中、不判沒權限、不讀任何資料', async () => {
    state.viewer = createMinimalViewer('U-admin');
    render(<OpsDashboardPage />);
    expect(screen.getByRole('status').textContent).toBe('載入中...');
    expect(screen.queryByText('權限不足')).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });
});

describe('內容（C1）', () => {
  it('opsSummary 有資料：頁首更新時間＋期間切換；切期間 0 次讀取', async () => {
    await openAs(viewer('super_admin'));
    await screen.findByText('報名中');
    expect(screen.getByText(/^資料更新於 /)).toBeTruthy();
    const seg = screen.getByRole('group', { name: '期間' });
    const buttons = Array.from(seg.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['7 天', '30 天', '90 天', '12 個月']);
    expect(document.querySelector('[data-trend]')).toBeNull();
    expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true');
    const before = totalReads();
    fireEvent.click(buttons[3]!);
    expect(buttons[3]!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(buttons[0]!);
    expect(totalReads()).toBe(before);
  });

  it('opsSummary/latest 不存在（C2 未部署）：頁首時間與期間切換不顯示，沒有讀取失敗，報名中與查詢入口照常', async () => {
    seed(false);
    await openAs(viewer('super_admin'));
    await screen.findByText('報名中');
    expect(screen.queryByText(/^資料更新於 /)).toBeNull();
    expect(screen.queryByRole('group', { name: '期間' })).toBeNull();
    expect(screen.queryByText('讀取失敗')).toBeNull();
    expect(screen.getByText('活動參與查詢')).toBeTruthy();
    expect(document.querySelector('[data-trend]')).toBeNull();
    // 顧問 §3.83②：彙總還沒產生要有說明，不是空白頁。
    expect(screen.getByText('彙總資料還沒有產生（每天凌晨 3 點更新），明天再來看看')).toBeTruthy();
  });

  it('opsSummary 有資料時不顯示「彙總還沒有」說明', async () => {
    seed(true);
    await openAs(viewer('super_admin'));
    await screen.findByText(/^資料更新於 /);
    expect(screen.queryByText(/彙總資料還沒有產生/)).toBeNull();
  });

  it('opsSummary 權限錯誤：顯示讀取失敗（不當成沒有資料），重試會重讀', async () => {
    failures['opsSummary'] = 'permission-denied';
    await openAs(viewer('super_admin'));
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    expect(screen.queryByRole('group', { name: '期間' })).toBeNull();
    delete failures['opsSummary'];
    const before = calls.length;
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await screen.findByRole('group', { name: '期間' });
    expect(calls.length).toBe(before + 3);
    expect(screen.queryByText('讀取失敗')).toBeNull();
  });

  it('報名中 count 失敗：顯示讀取失敗、不顯示報名中卡（不顯示 0）', async () => {
    failures['events'] = 'permission-denied';
    await openAs(viewer('super_admin'));
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    expect(screen.queryByText('報名中')).toBeNull();
  });

  it('彙總超過 26 小時：頁首時間改警示色', async () => {
    seed(true, Date.now() - 27 * HOUR);
    await openAs(viewer('super_admin'));
    const el = await screen.findByText(/^資料更新於 /);
    expect(el.className).toContain('stale');
  });

  it('點查詢入口前往 /admin/ops/participants', async () => {
    await openAs(viewer('super_admin'));
    fireEvent.click(await screen.findByText('活動參與查詢'));
    expect(state.route).toHaveBeenCalledWith('/admin/ops/participants');
  });
});

function kpiOf(id: string): HTMLElement {
  const el = document.querySelector(`[data-kpi="${id}"]`);
  if (!el) throw new Error(`missing kpi ${id}`);
  return el as HTMLElement;
}

function richSeed(opts: { noshow?: boolean; overflow?: number; stuck?: number; companions?: number; bare?: boolean } = {}): void {
  const now = Date.now();
  const at = (plusMs: number) => formatTaipei(now + plusMs, 'YYYY/MM/DD HH:mm');
  const qa = `U${'0'.repeat(28)}0001`;
  const candidates = [
    { docId: 'ev_low', title: '舊標題', startMs: now + 2 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_full', title: '已滿', startMs: now + 3 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_far', title: '太遠', startMs: now + 80 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_qa', title: 'QA場', startMs: now + 2 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_ext', title: '外部', startMs: now + 2 * HOUR, max: 20, occupiedAtRun: 1 },
    { docId: 'ev_end', title: '已結束', startMs: now + 2 * HOUR, max: 20, occupiedAtRun: 1 },
  ];
  const stuck = Array.from({ length: opts.stuck ?? 1 }, (_, i) => ({
    kind: 'stuck_event', refId: `ev_stuck_${i}`, title: `卡住${i}`,
  }));
  const period = (kpi: Record<string, unknown>, prevComplete = true) => ({
    start: '2026-10-12', end: '2026-11-08', prevStart: '2026-09-12', prevEnd: '2026-10-11',
    complete: true, prevComplete, kpi, topEvents: [], topHosts: [],
  });
  resetStore({
    opsSummary: [
      {
        id: 'latest',
        data: {
          generatedAt: ts(now - 3 * HOUR),
          asOf: '2026-11-08',
          users: { totalUsers: 200, qaUsers: 4, companions: opts.companions ?? 99 },
          periods: {
            d30: period({
              activeUsers: { cur: 120, prev: 100 },
              newUsers: { cur: 10, prev: 0 },
              eventsHeld: { cur: 8, prev: 8 },
              registrations: { cur: 80, prev: 100 },
              attend: { completed: 50, counted: 100, countedEvents: 5, prevCompleted: 40, prevCounted: 100, prevCountedEvents: 4 },
            }),
            d7: period({
              activeUsers: { cur: 40, prev: null },
              newUsers: { cur: 3, prev: 3 },
              eventsHeld: { cur: 2, prev: 4 },
              registrations: { cur: 5, prev: 1 },
              attend: { completed: 1, counted: 2, countedEvents: 2, prevCompleted: 1, prevCounted: 2, prevCountedEvents: 1 },
            }),
            d90: period({
              activeUsers: { cur: 90, prev: 80 },
              newUsers: { cur: 1, prev: 1 },
              eventsHeld: { cur: 1, prev: 1 },
              registrations: { cur: 1, prev: 1 },
              attend: { completed: 3, counted: 10, countedEvents: 3, prevCompleted: 1, prevCounted: 10, prevCountedEvents: 3 },
            }, false),
          },
          upcomingLowFill: opts.bare ? [] : candidates,
          upcomingLowFillOverflow: opts.bare ? 0 : (opts.overflow ?? 3),
          attention: opts.bare ? stuck : [
            ...stuck,
            { kind: 'cost_high' },
            { kind: 'line_quota' },
            { kind: 'reconcile_mismatch' },
          ],
          cost: opts.bare ? null : { month: '2026-11', currency: 'TWD', monthToDate: 800, projected: 1500, prevMonthTotal: 1000, sourceDateKey: '2026-11-08' },
          lineQuota: opts.bare ? null : { month: '2026-11', used: 80, limit: 100 },
          integrity: { lastMismatchDays: opts.bare ? [] : ['2026-11-01', '2026-11-02'] },
        },
      },
      ...(opts.noshow === false ? [] : [{
        id: 'noshow',
        data: {
          generatedAt: ts(now - 3 * HOUR),
          asOf: '2026-11-08',
          periods: {
            d30: { noShow: 6, counted: 35, countedEvents: 5, prevNoShow: 10, prevCounted: 40, prevCountedEvents: 5 },
            d7: { noShow: 1, counted: 2, countedEvents: 1, prevNoShow: 0, prevCounted: 0, prevCountedEvents: 0 },
          },
          attention: opts.bare ? [] : [{ kind: 'host_noshow_high', uid: 'U-host', name: '阿明', noShow: 6, counted: 35 }],
        },
      }]),
    ],
    events: [
      { id: 'ev_low', data: { status: 'open', type: 'pickup', date: at(2 * HOUR), max: 20, realCurrent: 4, creatorUid: 'U-host', title: '夜足' } },
      { id: 'ev_full', data: { status: 'open', date: at(3 * HOUR), max: 20, realCurrent: 10, creatorUid: 'U-host', title: '已滿夜足' } },
      { id: 'ev_far', data: { status: 'open', date: at(80 * HOUR), max: 20, realCurrent: 1, creatorUid: 'U-host', title: '太遠' } },
      { id: 'ev_qa', data: { status: 'open', date: at(2 * HOUR), max: 20, realCurrent: 1, creatorUid: qa, title: 'QA場' } },
      { id: 'ev_ext', data: { status: 'open', type: 'external', date: at(2 * HOUR), max: 20, realCurrent: 1, creatorUid: 'U-host', title: '外部' } },
      { id: 'ev_end', data: { status: 'ended', date: at(2 * HOUR), max: 20, realCurrent: 1, creatorUid: 'U-host', title: '已結束' } },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `op_${i}`, data: { status: 'open' } })),
    ],
  });
}

describe('六個關鍵數字（固定假 opsSummary）', () => {
  it('super_admin：K1～K6 的數字與箭頭，切期間 0 次讀取', async () => {
    richSeed();
    await openAs(viewer('super_admin'));
    await screen.findByText('活躍用戶');
    expect(kpiOf('active').textContent).toContain('120');
    expect(kpiOf('active').textContent).toContain('▲20%');
    expect(kpiOf('active').textContent).toContain('佔全部 60%');
    expect(kpiOf('new').textContent).toContain('10');
    expect(kpiOf('new').querySelector('.od-delta')?.textContent).toBe('—');
    expect(kpiOf('new').textContent).not.toContain('%');
    expect(kpiOf('new').textContent).toContain('共 200 位');
    expect(kpiOf('held').textContent).toContain('持平');
    expect(kpiOf('held').textContent).toContain('報名中 15 場');
    expect(kpiOf('regs').textContent).toContain('80');
    expect(kpiOf('regs').textContent).toContain('▼20%');
    expect(kpiOf('regs').querySelector('.od-delta')?.className).toContain('bad');
    expect(kpiOf('regs').textContent).toContain('每場 10.0 人');
    expect(kpiOf('attend').textContent).toContain('50%');
    expect(kpiOf('attend').textContent).toContain('▲10.0點');
    expect(kpiOf('attend').querySelector('.od-delta')?.className).toContain('good');
    expect(kpiOf('attend').textContent).toContain('計入 5 場');
    expect(kpiOf('noshow').textContent).toContain('17%');
    expect(kpiOf('noshow').textContent).toContain('▼7.9點');
    expect(kpiOf('noshow').querySelector('.od-delta')?.className).toContain('good');
    expect(kpiOf('noshow').textContent).toContain('6 人次');
    expect(document.querySelector('.od-summary')?.getAttribute('data-kpi-count')).toBe('6');
    expect(document.body.textContent).not.toContain('同行者');
    expect(document.body.textContent).not.toContain('99');
    expect(document.querySelector('[data-cost="monthToDate"]')?.textContent).toBe('TWD 800');
    expect(document.querySelector('[data-cost="projected"]')?.textContent).toBe('TWD 1,500');
    expect(document.querySelector('[data-cost="prevMonthTotal"]')?.textContent).toBe('TWD 1,000');
    expect(document.querySelector('.od-a-cost')?.getAttribute('data-cost-high')).toBe('1');
    expect(document.querySelector('[data-rank]')).toBeNull();

    const before = totalReads();
    fireEvent.click(screen.getByRole('button', { name: '7 天' }));
    expect(kpiOf('active').textContent).toContain('40');
    expect(kpiOf('active').querySelector('.od-delta')?.textContent).toBe('—');
    expect(kpiOf('attend').textContent).toContain('—');
    expect(kpiOf('attend').textContent).not.toContain('%');
    expect(totalReads()).toBe(before);
    expect(document.querySelector('[data-cost="projected"]')?.textContent).toBe('TWD 1,500');
  });

  it('上一期不完整：有數字、沒有百分比', async () => {
    richSeed();
    await openAs(viewer('super_admin'));
    await screen.findByText('活躍用戶');
    fireEvent.click(screen.getByRole('button', { name: '90 天' }));
    expect(kpiOf('active').textContent).toContain('90');
    expect(kpiOf('active').querySelector('.od-delta')?.textContent).toBe('—');
    expect(kpiOf('attend').textContent).toContain('30%');
    expect(kpiOf('attend').querySelector('.od-delta')?.textContent).toBe('—');
  });

  it('沒有放鴿子權限：5 格、不讀 noshow', async () => {
    richSeed();
    await openAs(viewer('admin', { admin: ['admin.dashboard.entry'] }));
    await screen.findByText('活躍用戶');
    expect(document.querySelectorAll('[data-kpi]')).toHaveLength(5);
    expect(document.querySelector('.od-summary')?.getAttribute('data-kpi-count')).toBe('5');
    expect(screen.queryByText('放鴿子率')).toBeNull();
    expect(screen.queryByText('阿明')).toBeNull();
    expect(calls.some((c) => c.id === 'noshow')).toBe(false);
    expect(totalReads()).toBeLessThanOrEqual(60);
  });

  it('admin 同時有入口與放鴿子權限：6 格', async () => {
    richSeed();
    await openAs(viewer('admin', { admin: ['admin.dashboard.entry', 'activity.view_noshow'] }));
    await screen.findByText('放鴿子率');
    expect(document.querySelectorAll('[data-kpi]')).toHaveLength(6);
    expect(calls.some((c) => c.id === 'noshow')).toBe(true);
  });

  it('noshow 文件不存在：5 格、沒有讀取失敗', async () => {
    richSeed({ noshow: false });
    await openAs(viewer('super_admin'));
    await screen.findByText('活躍用戶');
    expect(screen.queryByText('放鴿子率')).toBeNull();
    expect(screen.queryByText('讀取失敗')).toBeNull();
    expect(calls.some((c) => c.id === 'noshow')).toBe(true);
  });

  it('noshow 權限錯誤：顯示讀取失敗，不當成沒有第 6 格而不提示', async () => {
    richSeed();
    failures['opsSummary/noshow'] = 'permission-denied';
    await openAs(viewer('super_admin'));
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    expect(screen.getByText('活躍用戶')).toBeTruthy();
    expect(screen.queryByText('放鴿子率')).toBeNull();
  });
});

describe('需要注意', () => {
  it('排序、即時過濾、溢出、點擊去向；費用與對帳不可點', async () => {
    richSeed();
    await openAs(viewer('super_admin'));
    await screen.findByText('夜足');
    const rows = [...document.querySelectorAll('.od-attn-row')].map((el) => el.textContent ?? '');
    expect(rows[0]).toContain('狀態未結束');
    expect(rows[0]).toContain('卡住0');
    expect(rows[1]).toContain('報名偏低');
    expect(rows[1]).toContain('夜足');
    expect(rows[2]).toContain('還有 3 場');
    expect(rows[3]).toContain('阿明');
    expect(rows[3]).toContain('放鴿子 6/35 人次');
    expect(rows[3]).toContain('17%');
    expect(rows[4]).toContain('費用偏高');
    expect(rows[4]).toContain('TWD 1,500');
    expect(rows[5]).toContain('推播額度');
    expect(rows[5]).toContain('80%');
    expect(rows[6]).toContain('對帳不一致');
    expect(rows[6]).toContain('2 天');
    expect(screen.queryByText('已滿夜足')).toBeNull();
    expect(screen.queryByText('太遠')).toBeNull();
    expect(screen.queryByText('QA場')).toBeNull();
    expect(screen.queryByText('外部')).toBeNull();
    expect(screen.queryByText('已結束')).toBeNull();
    expect(screen.getByText('費用偏高').closest('button')).toBeNull();
    expect(screen.getByText('推播額度').closest('button')).toBeNull();
    expect(screen.getByText('對帳不一致').closest('button')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /夜足/ }));
    fireEvent.click(screen.getByRole('button', { name: /還有 3 場/ }));
    fireEvent.click(screen.getByRole('button', { name: /阿明/ }));
    fireEvent.click(screen.getByRole('button', { name: /卡住0/ }));
    expect(state.route).toHaveBeenNthCalledWith(1, '/events/ev_low');
    expect(state.route).toHaveBeenNthCalledWith(2, '/activities');
    expect(state.route).toHaveBeenNthCalledWith(3, '/profile/U-host');
    expect(state.route).toHaveBeenNthCalledWith(4, '/events/ev_stuck_0');
  });

  it('超過 8 列可展開，展開不再讀取', async () => {
    richSeed({ stuck: 9, bare: true });
    await openAs(viewer('super_admin'));
    expect(await screen.findByRole('button', { name: '還有 2 項' })).toBeTruthy();
    expect(screen.queryByText('卡住8')).toBeNull();
    const before = totalReads();
    fireEvent.click(screen.getByRole('button', { name: '還有 2 項' }));
    expect(screen.getByText('卡住8')).toBeTruthy();
    expect(screen.queryByText('還有 2 項')).toBeNull();
    expect(totalReads()).toBe(before);
  });

  it('A1 重讀失敗：讀取失敗，不把候選當成沒有；其他注意項目仍在', async () => {
    richSeed();
    failures['events:docs'] = 'unavailable';
    await openAs(viewer('super_admin'));
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    expect(screen.queryByText('夜足')).toBeNull();
    expect(screen.getByText('卡住0')).toBeTruthy();
    expect(screen.getByText('活躍用戶')).toBeTruthy();
  });

  it('沒有任何注意項目時不顯示那張卡', async () => {
    richSeed({ overflow: 0, stuck: 0, noshow: false });
    resetStore({
      opsSummary: [{
        id: 'latest',
        data: {
          generatedAt: ts(Date.now() - HOUR),
          asOf: '2026-11-08',
          users: { totalUsers: 10 },
          periods: {
            d30: {
              complete: true, prevComplete: true,
              kpi: {
                activeUsers: { cur: 1, prev: 1 },
                newUsers: { cur: 1, prev: 1 },
                eventsHeld: { cur: 1, prev: 1 },
                registrations: { cur: 1, prev: 1 },
                attend: { completed: 0, counted: 0, countedEvents: 0, prevCompleted: 0, prevCounted: 0, prevCountedEvents: 0 },
              },
            },
          },
          upcomingLowFill: [],
          upcomingLowFillOverflow: 0,
          attention: [],
          cost: { projected: 10, prevMonthTotal: 100, currency: 'TWD' },
          lineQuota: null,
          integrity: { lastMismatchDays: [] },
        },
      }],
      events: [],
    });
    await openAs(viewer('admin', { admin: ['admin.dashboard.entry'] }));
    await screen.findByText('活躍用戶');
    expect(document.querySelector('.od-a-attn')).toBeNull();
  });
});

describe('趨勢圖（固定假 trend，不另讀）', () => {
  it('latest 沒有 trend 時不顯示；有 trend 時可切指標與期間，讀取次數不變', async () => {
    const daily = [
      { d: '2026-11-07', active7: 10, active30: 20, newUsers: 1, eventsHeld: 2, registrations: 3, completed: 3, counted: 4, countedEvents: 3 },
      { d: '2026-11-08', active7: 14, active30: 22, newUsers: 4, eventsHeld: 5, registrations: 6, completed: 4, counted: 4, countedEvents: 3 },
    ];
    const period = {
      start: '2026-11-07', end: '2026-11-08', prevStart: '2026-11-05', prevEnd: '2026-11-06',
      complete: true, prevComplete: false, kpi: {}, topEvents: [], topHosts: [],
    };
    resetStore({
      opsSummary: [
        {
          id: 'latest',
          data: {
            generatedAt: ts(Date.now() - 3 * HOUR),
            asOf: '2026-11-08',
            periods: { d30: period, d7: { ...period, start: '2026-11-08', end: '2026-11-08' }, m12: period },
            trend: { daily, monthly: [{ m: '2026-11', active30: 32, newUsers: 4, eventsHeld: 5, registrations: 6, completed: 4, counted: 4, countedEvents: 3 }] },
          },
        },
        {
          id: 'noshow',
          data: {
            asOf: '2026-11-08',
            trend: { daily: [{ d: '2026-11-08', noShow: 1, counted: 4, countedEvents: 3 }], monthly: [] },
            periods: {},
            attention: [],
          },
        },
      ],
      events: [],
    });
    await openAs(viewer('super_admin'));
    const trend = document.querySelector('[data-trend]') as HTMLElement;
    expect(trend).toBeTruthy();
    expect(trend.querySelectorAll('.od-trend-metrics button')).toHaveLength(6);
    expect(trend.querySelector('[data-trend-readout]')?.textContent).toContain('7 日活躍');
    fireEvent.click(trend.querySelector('[data-point="2026-11-08"]') as Element);
    expect(trend.querySelector('[data-trend-readout]')?.textContent).toContain('14');
    const before = totalReads();
    fireEvent.click(screen.getByRole('button', { name: '12 個月' }));
    expect(trend.getAttribute('data-period')).toBe('m12');
    expect(trend.querySelector('[data-trend-readout]')?.textContent).toContain('30 日活躍');
    fireEvent.click(trend.querySelector('[data-metric="new"]') as Element);
    expect(trend.getAttribute('data-metric')).toBe('new');
    fireEvent.click(trend.querySelector('[data-point="2026-11"]') as Element);
    expect(trend.querySelector('[data-trend-readout]')?.textContent).toContain('4');
    fireEvent.click(screen.getByRole('button', { name: '7 天' }));
    expect(totalReads()).toBe(before);
    expect(document.body.textContent).not.toContain('同行者');
  });
});

describe('四身分（假 opsSummary）', () => {
  it.each([
    ['admin（沒有入口碼）', viewer('admin')],
    ['user', viewer('user')],
  ])('%s：權限不足、0 讀', async (_label, v) => {
    richSeed();
    await openAs(v);
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe('排行與費用卡', () => {
  function rankDoc(extra: Record<string, unknown> = {}): void {
    const kpi = {
      activeUsers: { cur: 1, prev: 1 },
      newUsers: { cur: 1, prev: 1 },
      eventsHeld: { cur: 1, prev: 1 },
      registrations: { cur: 1, prev: 1 },
      attend: { completed: 0, counted: 0, countedEvents: 0, prevCompleted: 0, prevCounted: 0, prevCountedEvents: 0 },
    };
    const topEvents = [
      { docId: 'ev-low', title: '低', dateKey: '2026-11-01', occupied: 1, max: 10 },
      { docId: 'ev-hi', title: '高', dateKey: '2026-11-02', occupied: 9, max: 10 },
      { docId: 'ev-mid', title: '中', dateKey: '2026-11-03', occupied: 5, max: 10 },
      { docId: 'ev-tie-old', title: '舊', dateKey: '2026-11-01', occupied: 4, max: 8 },
      { docId: 'ev-tie-new', title: '新', dateKey: '2026-11-08', occupied: 4, max: 8 },
      { docId: 'ev-zero', title: '無上限', dateKey: '2026-11-08', occupied: 9, max: 0 },
      ...Array.from({ length: 8 }, (_, i) => ({ docId: `f${i}`, title: `尾${i}`, dateKey: '', occupied: 0, max: 10 })),
    ];
    const topHosts = [
      { uid: 'U-b', name: '阿花', events: 2, registrations: 50 },
      { uid: 'U-a', name: '阿明', events: 5, registrations: 10 },
      { uid: 'U-c', name: '阿強', events: 5, registrations: 40 },
      { uid: '', name: '空', events: 99, registrations: 99 },
      ...Array.from({ length: 9 }, (_, i) => ({ uid: `h${i}`, name: `人${i}`, events: 1, registrations: i })),
    ];
    resetStore({
      opsSummary: [{
        id: 'latest',
        data: {
          generatedAt: ts(Date.now() - 3 * HOUR),
          asOf: '2026-11-08',
          users: { totalUsers: 10 },
          periods: {
            d30: { complete: true, prevComplete: true, kpi, topEvents, topHosts },
            d7: {
              complete: true, prevComplete: true, kpi,
              topEvents: [{ docId: 'ev-d7', title: '七日場', dateKey: '2026-11-08', occupied: 2, max: 4 }],
              topHosts: [{ uid: 'U-d7', name: '小七', events: 1, registrations: 3 }],
            },
            d90: { complete: true, prevComplete: true, kpi: {} },
          },
          attention: [{ kind: 'cost_high' }],
          cost: { month: '2026-11', currency: 'TWD', monthToDate: 800, projected: 1500, prevMonthTotal: 1000, sourceDateKey: '2026-11-08' },
          ...extra,
        },
      }],
      events: [],
    });
  }

  function titles(kind: string): string[] {
    const card = document.querySelector(`[data-rank="${kind}"]`);
    return [...(card?.querySelectorAll('.od-rank-title') ?? [])].map((el) => el.textContent ?? '');
  }

  it('排序、筆數上限、切期間 0 讀、點擊不把姓名寫進網址', async () => {
    rankDoc();
    await openAs(viewer('super_admin'));
    await screen.findByText('熱門活動');
    expect(titles('events')).toEqual(['高', '中', '新', '舊', '低', '尾0', '尾1', '尾2', '尾3', '尾4']);
    expect(titles('hosts')).toEqual(['阿強', '阿明', '阿花', '人8', '人7', '人6', '人5', '人4', '人3', '人2']);
    expect(screen.queryByText('無上限')).toBeNull();
    expect(screen.queryByText('空')).toBeNull();
    expect(screen.queryByText('U-a')).toBeNull();
    expect(document.querySelector('[data-rank="events"]')?.textContent).toContain('9/10');
    expect(document.querySelector('[data-rank="hosts"]')?.textContent).toContain('5 場 · 40 人次');
    expect(document.querySelector('[data-rank="hosts"]')?.textContent).not.toContain('U-');
    const before = totalReads();
    fireEvent.click(screen.getByRole('button', { name: /高/ }));
    fireEvent.click(screen.getByRole('button', { name: /阿明/ }));
    expect(state.route).toHaveBeenNthCalledWith(1, '/events/ev-hi');
    expect(state.route).toHaveBeenNthCalledWith(2, '/profile/U-a');
    fireEvent.click(screen.getByRole('button', { name: '7 天' }));
    expect(titles('events')).toEqual(['七日場']);
    expect(titles('hosts')).toEqual(['小七']);
    expect(screen.queryByText('高')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '90 天' }));
    expect(document.querySelector('[data-rank]')).toBeNull();
    expect(screen.queryByText('讀取失敗')).toBeNull();
    expect(document.querySelector('[data-cost="projected"]')?.textContent).toBe('TWD 1,500');
    expect(totalReads()).toBe(before);
  });

  it('admin 有入口權限看得到排行與費用卡', async () => {
    rankDoc();
    await openAs(viewer('admin', { admin: ['admin.dashboard.entry'] }));
    expect(await screen.findByText('熱門活動')).toBeTruthy();
    expect(screen.getByText('本月已花')).toBeTruthy();
    expect(screen.getByText('預估月底')).toBeTruthy();
    expect(screen.getByText('上月')).toBeTruthy();
  });

  it('cost 缺漏整張不顯示，不當成讀取失敗，A3 也不另造數字', async () => {
    rankDoc({ cost: null, attention: [] });
    await openAs(viewer('super_admin'));
    await screen.findByText('熱門活動');
    expect(document.querySelector('.od-a-cost')).toBeNull();
    expect(screen.queryByText('費用偏高')).toBeNull();
    expect(screen.queryByText('本月已花')).toBeNull();
    expect(screen.queryByText('讀取失敗')).toBeNull();
  });

  it('未過 1.2 倍：費用卡三數字在，A3 不在', async () => {
    rankDoc({
      attention: [],
      cost: { month: '2026-11', currency: 'TWD', monthToDate: 100, projected: 100, prevMonthTotal: 100, sourceDateKey: '2026-11-08' },
    });
    await openAs(viewer('super_admin'));
    await screen.findByText('本月已花');
    expect(document.querySelector('.od-a-cost')?.getAttribute('data-cost-high')).toBe('0');
    expect(document.querySelector('[data-cost="projected"]')?.textContent).toBe('TWD 100');
    expect(screen.queryByText('費用偏高')).toBeNull();
  });

  it('月初不估：預估與上月是破折號', async () => {
    rankDoc({
      attention: [],
      cost: { month: '2026-11', currency: 'TWD', monthToDate: 10, projected: null, prevMonthTotal: null, sourceDateKey: '2026-11-02' },
    });
    await openAs(viewer('super_admin'));
    await screen.findByText('預估月底');
    expect(document.querySelector('[data-cost="projected"]')?.textContent).toBe('—');
    expect(document.querySelector('[data-cost="prevMonthTotal"]')?.textContent).toBe('—');
    expect(document.querySelector('[data-cost="monthToDate"]')?.textContent).toBe('TWD 10');
    expect(screen.queryByText('費用偏高')).toBeNull();
  });

  it.each([
    ['admin（沒有入口碼）', viewer('admin')],
    ['user', viewer('user')],
  ])('%s：權限不足、看不到排行與費用、0 讀', async (_label, v) => {
    rankDoc();
    await openAs(v);
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(screen.queryByText('熱門活動')).toBeNull();
    expect(screen.queryByText('本月已花')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('formatUpdatedAt（台北日界）', () => {
  const now = Date.UTC(2026, 10, 9, 2, 0); // 台北 11-09 10:00
  it('今天、昨天、更早', () => {
    expect(formatUpdatedAt(Date.UTC(2026, 10, 8, 19, 0), now, opsT)).toBe('今天 03:00');
    expect(formatUpdatedAt(Date.UTC(2026, 10, 7, 19, 0), now, opsT)).toBe('昨天 03:00');
    expect(formatUpdatedAt(Date.UTC(2026, 10, 6, 19, 0), now, opsT)).toBe('11/07 03:00');
    // UTC 同一天、台北已跨日
    expect(formatUpdatedAt(Date.UTC(2026, 10, 8, 15, 59), now, opsT)).toBe('昨天 23:59');
  });
});
