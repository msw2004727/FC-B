// W1C-I 無效資料查詢頁：四身分權限、每頁籤讀取預算、切頁籤不重讀、只讀（不呼叫任何寫入 API）。
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => (await import('../inactive-test-utils')).sdk);
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: {} }) }));
const state = vi.hoisted(() => ({ viewer: null as unknown, lastUid: null as string | null }));
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => state.lastUid }));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/features/profile/data/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  return { createMinimalViewer: actual.createMinimalViewer, useViewer: () => state.viewer };
});

import { setLocale } from '@/i18n/i18n';
import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import { createPermissionChecker } from '@/features/profile/data/permissions';
import { calls, resetStore, sdk, totalReads, ts, WRITE_OR_OTHER_READ_APIS } from '../inactive-test-utils';
import AdminInactivePage from './AdminInactivePage';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

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

function seed(): void {
  resetStore({
    teams: Array.from({ length: 30 }, (_, i) => ({
      id: `tm_${String(i).padStart(2, '0')}`,
      data: { name: `解散隊${i}`, captain: `領隊${i}`, members: i, region: '台北', active: false },
    })),
    events: Array.from({ length: 25 }, (_, i) => ({
      id: `ce_${String(i).padStart(2, '0')}`,
      data: { title: `活動${i}`, status: i % 2 ? 'ended' : 'cancelled', date: '2026/10/01', location: '球場', creator: '主辦', current: 3, max: 10, createdAt: ts(NOW - i * DAY) },
    })),
    users: [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `ua${i}`, data: { displayName: `活躍${i}`, lastLogin: ts(NOW - i * DAY) } })),
      ...Array.from({ length: 12 }, (_, i) => ({ id: `um${i}`, data: { displayName: `中段${i}`, role: 'coach', lastLogin: ts(NOW - (40 + i) * DAY) } })),
      ...Array.from({ length: 15 }, (_, i) => ({ id: `uo${i}`, data: { displayName: `久未${i}`, lastLogin: ts(NOW - (100 + i) * DAY), pictureUrl: 'https://example.invalid/a.png' } })),
      { id: 'never1', data: { displayName: '從沒登入' } },
      { id: 'legacy1', data: { displayName: '舊字串', lastLogin: '2025/01/01' } },
    ],
  });
}

// 用真的字典（含本功能 locales 與舊版 A 字典），順便驗證翻譯鍵存在。
beforeAll(async () => {
  await setLocale('zh-TW');
});

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  state.lastUid = null;
});

afterEach(() => cleanup());

function expectReadOnly(): void {
  for (const name of WRITE_OR_OTHER_READ_APIS) expect(sdk[name]).not.toHaveBeenCalled();
}

async function openAs(v: ViewerView): Promise<ReturnType<typeof render>> {
  state.viewer = v;
  const utils = render(<AdminInactivePage />);
  await waitFor(() => expect(utils.container.querySelector('[role="status"]')).toBeNull());
  return utils;
}

describe('權限（照 A：admin.inactive.entry，minRole super_admin）', () => {
  it.each(['user', 'captain', 'coach', 'admin'])('%s 預設沒有入口碼：權限不足、0 讀、沒有頁籤', async (role) => {
    await openAs(viewer(role));
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(document.querySelector('.tab-bar')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('super_admin 可進；admin 角色層級被授予入口碼也可進（同一判斷）', async () => {
    await openAs(viewer('super_admin'));
    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(['俱樂部', '活動', '用戶狀態']);
    cleanup();
    await openAs(viewer('admin', { admin: ['admin.inactive.entry'] }));
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('完整 viewer 未到位：顯示載入中、不閃權限不足、0 讀', async () => {
    state.viewer = createMinimalViewer('U-super');
    render(<AdminInactivePage />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('權限不足')).toBeNull();
    expect(document.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('viewer 尚未到位時不出現權限不足、出現轉圈；到位且無權限才出現權限不足；到位且有權限顯示內容', async () => {
    state.viewer = createMinimalViewer('U-super');
    const view = render(<AdminInactivePage />);
    expect(document.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();
    expect(screen.queryByText('權限不足')).toBeNull();
    expect(calls).toHaveLength(0);

    state.viewer = viewer('user');
    view.rerender(<AdminInactivePage />);
    expect(document.querySelector('.ui-page-spinner')).toBeNull();
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(document.querySelector('.tab-bar')).toBeNull();

    state.viewer = viewer('super_admin');
    view.rerender(<AdminInactivePage />);
    await waitFor(() => expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(['俱樂部', '活動', '用戶狀態']));
    expect(screen.queryByText('權限不足')).toBeNull();
  });

  it('viewer 延後到位：最小 viewer 時 0 讀，完整 viewer 到位後才開始讀', async () => {
    state.viewer = createMinimalViewer('U-super');
    const { container, rerender } = render(<AdminInactivePage />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(calls).toHaveLength(0);
    state.viewer = viewer('super_admin');
    rerender(<AdminInactivePage />);
    await waitFor(() => expect(container.querySelectorAll('[data-team-id]')).toHaveLength(20));
    expect(screen.queryByText('權限不足')).toBeNull();
    expect(calls.every((c) => c.name === 'teams')).toBe(true);
    expect(totalReads()).toBeLessThanOrEqual(21);
  });
});

describe('讀取預算（每頁籤進頁 ≤ 26）', () => {
  it('進頁只讀俱樂部頁籤：≤ 21 讀；20 張卡、載入更多一次 ≤ 20 讀', async () => {
    const { container } = await openAs(viewer('super_admin'));
    await waitFor(() => expect(container.querySelectorAll('[data-team-id]')).toHaveLength(20));
    expect(calls.every((c) => c.name === 'teams')).toBe(true);
    expect(totalReads()).toBeLessThanOrEqual(21);
    expect(screen.getByText('原領隊：領隊0 ・ 原成員：0 人')).toBeTruthy();
    calls.length = 0;
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }));
    await waitFor(() => expect(container.querySelectorAll('[data-team-id]')).toHaveLength(30));
    expect(totalReads()).toBeLessThanOrEqual(20);
    expect(screen.queryByRole('button', { name: '載入更多' })).toBeNull();
    expectReadOnly();
  });

  it('活動頁籤 ≤ 21 讀；切回俱樂部、再切回活動都不重讀', async () => {
    const { container } = await openAs(viewer('super_admin'));
    await waitFor(() => expect(container.querySelectorAll('[data-team-id]').length).toBeGreaterThan(0));
    calls.length = 0;
    fireEvent.click(screen.getByRole('tab', { name: '活動' }));
    await waitFor(() => expect(container.querySelectorAll('[data-event-id]')).toHaveLength(20));
    expect(calls.every((c) => c.name === 'events')).toBe(true);
    expect(totalReads()).toBeLessThanOrEqual(21);
    const before = calls.length;
    fireEvent.click(screen.getByRole('tab', { name: '俱樂部' }));
    fireEvent.click(screen.getByRole('tab', { name: '活動' }));
    await act(async () => { await Promise.resolve(); });
    expect(calls).toHaveLength(before);
    expectReadOnly();
  });

  it('用戶狀態頁籤 ≤ 24 讀（4 個 count＋兩段各 ≤ 10）；統計與 A 分組一致；沒有頭像檢測', async () => {
    const { container } = await openAs(viewer('super_admin'));
    await waitFor(() => expect(container.querySelectorAll('[data-team-id]').length).toBeGreaterThan(0));
    calls.length = 0;
    fireEvent.click(screen.getByRole('tab', { name: '用戶狀態' }));
    await waitFor(() => expect(screen.getByText('用戶登入統計')).toBeTruthy());
    expect(calls.every((c) => c.name === 'users')).toBe(true);
    expect(calls.filter((c) => c.kind === 'count')).toHaveLength(4);
    expect(totalReads()).toBeLessThanOrEqual(24);
    // 統計框含從未登入、lastLogin 非時間戳的 2 人；名單標題只算列得出的 15 人。
    expect(screen.getByText('超過 90 天').previousElementSibling!.textContent).toBe('17');
    expect(screen.getByText('超過 90 天未登入（15 人）')).toBeTruthy();
    expect(screen.getByText('30~90 天未登入（12 人）')).toBeTruthy();
    expect(container.querySelectorAll('[data-segment="over90"] [data-uid]')).toHaveLength(10);
    expect(screen.queryByText('頭像失效檢測')).toBeNull();
    expect(screen.queryByText('開始檢測')).toBeNull();
    calls.length = 0;
    const over90 = container.querySelector('[data-segment="over90"]')!;
    fireEvent.click(over90.querySelector('button')!);
    await waitFor(() => expect(container.querySelectorAll('[data-segment="over90"] [data-uid]')).toHaveLength(15));
    expect(totalReads()).toBeLessThanOrEqual(10);
    // 標題人數＝可列出的筆數，載完就沒有「載入更多」。
    expect(container.querySelector('[data-segment="over90"] button')).toBeNull();
    expectReadOnly();
  });

  it('讀取失敗顯示重試，重試後成功', async () => {
    sdk.getCountFromServer.mockRejectedValueOnce(new Error('synthetic'));
    state.viewer = viewer('super_admin');
    const { container } = render(<AdminInactivePage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await waitFor(() => expect(container.querySelectorAll('[data-team-id]')).toHaveLength(20));
  });

  it('沒有資料時顯示 A 的空狀態文字', async () => {
    resetStore({ teams: [], events: [], users: [] });
    await openAs(viewer('super_admin'));
    await waitFor(() => expect(screen.getByText('目前沒有已解散俱樂部')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: '活動' }));
    await waitFor(() => expect(screen.getByText('沒有已結束的活動')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: '用戶狀態' }));
    await waitFor(() => expect(screen.getByText('所有用戶都在 30 天內有登入記錄')).toBeTruthy());
  });
});
