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
  it('super_admin：可進、讀 2 次（≤ 60）', async () => {
    await openAs(viewer('super_admin'));
    expect(await screen.findByText('報名中')).toBeTruthy();
    expect(screen.getByText('38')).toBeTruthy();
    expect(screen.getByText('活動參與查詢')).toBeTruthy();
    expect(totalReads()).toBe(2);
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
    expect(calls.length).toBe(before + 2);
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
