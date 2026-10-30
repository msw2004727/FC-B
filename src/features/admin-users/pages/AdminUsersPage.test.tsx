import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';

import {
  PERM_USERS_CHANGE_ROLE,
  PERM_USERS_EDIT_PROFILE,
  PERM_USERS_ENTRY,
  PERM_USERS_RESTRICT,
  type AdminUser,
} from '../data/admin-users-model';
import type { AdminUsersLoad } from '../data/admin-users';
import AdminUsersPage, { ADMIN_USERS_EXTRA_UI_ENABLED } from './AdminUsersPage';

const mockRoute = vi.fn();
vi.mock('preact-iso', () => ({
  useLocation: () => ({ route: mockRoute, path: '/admin/users' }),
}));

const mockUseViewer = vi.fn<() => ViewerView>();
// createMinimalViewer 保留真的（viewer-ready 用它辨認「權限還沒載入」的最小 viewer）。
vi.mock('@/features/profile/data/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  return { createMinimalViewer: actual.createMinimalViewer, useViewer: () => mockUseViewer() };
});

const mockGoBack = vi.fn();
vi.mock('@/core/back-guard', () => ({ useGoBack: () => mockGoBack }));

let lastKnownUid: string | null | undefined = 'me';
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => lastKnownUid }));

vi.mock('@/data/user-roles', () => ({
  userLevelFromExp: () => 0,
  getCachedUserLevel: () => undefined,
  useUserRoles: () => ({}),
}));

const mockToast = vi.fn();
vi.mock('@/ui/Toast', () => ({ toast: { show: (...args: unknown[]) => mockToast(...args) } }));

const mockConfirm = vi.fn();
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: (...args: unknown[]) => mockConfirm(...args) }));

const mockCallFn = vi.fn();
vi.mock('@/data/callables', () => ({ callFn: (...args: unknown[]) => mockCallFn(...args) }));

const mockGetIdToken = vi.fn();
vi.mock('@/data/firebase', () => ({
  getFirebase: () => Promise.resolve({ db: {}, auth: { currentUser: { getIdToken: (...a: unknown[]) => mockGetIdToken(...a) } } }),
}));

const mockLoadUsers = vi.fn<() => Promise<AdminUsersLoad>>();
const mockLoadMore = vi.fn<(prev: AdminUsersLoad) => Promise<AdminUsersLoad>>();
const mockFetchRoles = vi.fn();
const mockAudit = vi.fn();
const mockNotify = vi.fn();
const mockOpLog = vi.fn();
vi.mock('../data/admin-users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/admin-users')>();
  return {
    ...actual,
    loadAdminUsers: () => mockLoadUsers(),
    loadMoreAdminUsers: (prev: AdminUsersLoad) => mockLoadMore(prev),
    fetchCustomRoles: () => mockFetchRoles(),
    writeUserAudit: (entry: unknown) => mockAudit(entry),
    sendRoleUpgradeInbox: (notice: unknown) => mockNotify(notice),
    recordUserOpLog: (input: unknown) => mockOpLog(input),
  };
});

vi.mock('@/i18n/i18n', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const raw = JSON.parse(readFileSync(resolve(__dirname, '../locales/zh-TW.json'), 'utf8')) as Record<string, unknown>;
  const dict: Record<string, string> = {};
  const walk = (obj: Record<string, unknown>, prefix: string): void => {
    for (const [key, value] of Object.entries(obj)) {
      const full = `${prefix}.${key}`;
      if (value && typeof value === 'object') walk(value as Record<string, unknown>, full);
      else dict[full] = String(value);
    }
  };
  walk(raw, 'admin-users');
  const t = (key: string, params?: Record<string, string | number>): string => {
    let text = dict[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
    return text;
  };
  return {
    t,
    useT: () => t,
    lt: (key: string, fallback?: string) => fallback ?? key,
    useLegacyT: () => (key: string, fallback?: string) => fallback ?? key,
    formatNumber: (n: number) => String(n),
    getCurrentLocale: () => 'zh-TW',
  };
});

const DAY = 86_400_000;

function viewerOf(role: string, perms: readonly string[] | 'all', uid: string | null = 'me'): ViewerView {
  return {
    uid,
    role,
    displayName: '操作者',
    pictureUrl: null,
    capabilities: [],
    teamIds: new Set<string>(),
    roleLevel: 0,
    isRestricted: false,
    hasPermission: (code: string) => perms === 'all' || perms.includes(code),
  } as unknown as ViewerView;
}

/** 完整載入後的 viewer：permissionSources 是新物件（最小 viewer 才是共用的凍結物件）。 */
function loadedViewerOf(role: string, perms: readonly string[] | 'all', uid: string | null = 'me'): ViewerView {
  return {
    ...viewerOf(role, perms, uid),
    permissionSources: { rolePermissions: null, userGrants: [], customRoles: [] },
  } as unknown as ViewerView;
}

const FULL_ADMIN_PERMS = [PERM_USERS_ENTRY, PERM_USERS_EDIT_PROFILE, PERM_USERS_CHANGE_ROLE, PERM_USERS_RESTRICT] as const;

function makeUser(id: string, patch: Partial<AdminUser> = {}): AdminUser {
  return {
    _docId: id, uid: id, lineUserId: '', name: `名字-${id}`, role: 'user', email: '', gender: '', region: '', sports: '',
    phone: '', birthday: '', exp: 0, pictureUrl: '', teamName: '', isRestricted: false, stealth: false,
    joinedAtMs: null, lastLoginMs: null, lastLoginIp: '', lastLoginRegion: '', lastLoginIsp: '', ...patch,
  };
}

function loadOf(users: AdminUser[], patch: Partial<AdminUsersLoad> = {}): AdminUsersLoad {
  return { users, total: users.length, partial: false, lastId: null, done: true, ...patch };
}

function cardOf(name: string): HTMLElement {
  const card = Array.from(document.querySelectorAll<HTMLElement>('.admin-user-card')).find((el) => el.textContent?.includes(name));
  if (!card) throw new Error(`找不到用戶卡：${name}`);
  return card;
}

function changeSelect(id: string, value: string): void {
  const el = document.getElementById(id) as HTMLSelectElement;
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function typeInto(id: string, value: string): void {
  fireEvent.input(document.getElementById(id) as HTMLInputElement, { target: { value } });
}

const toastMessages = (): string[] => mockToast.mock.calls.map((call) => String((call[0] as { message: string }).message));

async function renderReady(
  users: AdminUser[],
  viewer: ViewerView = viewerOf('admin', FULL_ADMIN_PERMS),
  extraUiEnabled = false,
): Promise<void> {
  mockUseViewer.mockReturnValue(viewer);
  mockLoadUsers.mockResolvedValue(loadOf(users));
  render(<AdminUsersPage extraUiEnabled={extraUiEnabled} />);
  await waitFor(() => expect(document.querySelectorAll('.admin-user-card').length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [mockCallFn, mockConfirm, mockLoadUsers, mockLoadMore, mockFetchRoles, mockAudit, mockNotify, mockOpLog, mockGetIdToken]) fn.mockReset();
  lastKnownUid = 'me';
  mockFetchRoles.mockResolvedValue([]);
  mockCallFn.mockResolvedValue({ success: true, targetUid: 'uid-target' });
  mockAudit.mockResolvedValue(undefined);
  mockNotify.mockResolvedValue(true);
  mockOpLog.mockResolvedValue(undefined);
  mockGetIdToken.mockResolvedValue('token');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
});

describe('入口權限（四身分）', () => {
  it.each(['user', 'coach', 'captain'])('%s 沒有 admin.users.entry：只看到權限不足，不讀取名單', async (role) => {
    mockUseViewer.mockReturnValue(viewerOf(role, []));
    render(<AdminUsersPage />);
    expect(await screen.findByText('權限不足')).toBeTruthy();
    expect(document.querySelector('.admin-user-card')).toBeNull();
    expect(mockLoadUsers).not.toHaveBeenCalled();
    expect(mockCallFn).not.toHaveBeenCalled();
  });

  it('admin 有入口權限碼：讀取並顯示名單，依名字排序', async () => {
    await renderReady([makeUser('b', { name: 'Bob' }), makeUser('a', { name: 'Alice' })]);
    const names = Array.from(document.querySelectorAll('.admin-user-card .ui-user-tag')).map((el) => el.textContent);
    expect(names).toEqual(['Alice', 'Bob']);
    expect(mockLoadUsers).toHaveBeenCalledTimes(1);
  });

  it('super_admin（擁有全部權限碼）可進入', async () => {
    await renderReady([makeUser('a')], viewerOf('super_admin', 'all'));
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1);
  });

  it('訪客（已確認未登入）顯示權限不足；登入狀態未確定時顯示載入中且不讀取（L-43）', async () => {
    mockUseViewer.mockReturnValue(viewerOf('guest', [], null));
    lastKnownUid = null;
    const first = render(<AdminUsersPage />);
    expect(await screen.findByText('權限不足')).toBeTruthy();
    first.unmount();

    lastKnownUid = undefined;
    render(<AdminUsersPage />);
    expect(screen.getByText('載入中…')).toBeTruthy();
    expect(mockLoadUsers).not.toHaveBeenCalled();
  });

  it('uid 延後出現才載入：先不讀，uid 到位後才讀取', async () => {
    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS, null));
    lastKnownUid = undefined;
    mockLoadUsers.mockResolvedValue(loadOf([makeUser('a')]));
    const view = render(<AdminUsersPage />);
    expect(mockLoadUsers).not.toHaveBeenCalled();
    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS, 'me'));
    view.rerender(<AdminUsersPage />);
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1));
    expect(mockLoadUsers).toHaveBeenCalledTimes(1);
  });

  // F3（L-43）：useViewer 先給最小 viewer（有 uid、權限一律 false），完整資料到位才換成真正的 viewer。
  it('uid 先到、權限後到：載入中不顯示權限不足，也不讀取；權限到位後才載入名單', async () => {
    mockUseViewer.mockReturnValue(createMinimalViewer('me'));
    mockLoadUsers.mockResolvedValue(loadOf([makeUser('a', { name: 'Ann' })]));
    const view = render(<AdminUsersPage />);
    expect(screen.getByText('載入中…')).toBeTruthy();
    expect(screen.queryByText('權限不足')).toBeNull();
    expect(mockLoadUsers).not.toHaveBeenCalled();

    mockUseViewer.mockReturnValue(loadedViewerOf('admin', FULL_ADMIN_PERMS));
    view.rerender(<AdminUsersPage />);
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1));
    expect(screen.queryByText('權限不足')).toBeNull();
    expect(mockLoadUsers).toHaveBeenCalledTimes(1);
  });

  it('uid 先到、權限後到，但最終沒有入口權限：載入中之後才出現權限不足，從不讀取名單', async () => {
    mockUseViewer.mockReturnValue(createMinimalViewer('me'));
    const view = render(<AdminUsersPage />);
    expect(screen.queryByText('權限不足')).toBeNull();

    mockUseViewer.mockReturnValue(loadedViewerOf('coach', []));
    view.rerender(<AdminUsersPage />);
    expect(await screen.findByText('權限不足')).toBeTruthy();
    expect(mockLoadUsers).not.toHaveBeenCalled();
  });
});

describe('名單、分頁與篩選', () => {
  it('每頁 30 筆，按「載入更多」再 +30，顯示已顯示／總數', async () => {
    const users = Array.from({ length: 65 }, (_, i) => makeUser(`u${String(i).padStart(3, '0')}`));
    await renderReady(users);
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(30);
    fireEvent.click(screen.getByText('載入更多（已顯示 30 / 65）'));
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(60);
    fireEvent.click(screen.getByText('載入更多（已顯示 60 / 65）'));
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(65);
    expect(screen.queryByText(/載入更多（已顯示/)).toBeNull();
  });

  it('剛好 30 筆沒有「載入更多」', async () => {
    await renderReady(Array.from({ length: 30 }, (_, i) => makeUser(`u${i}`)));
    expect(screen.queryByText(/載入更多（已顯示/)).toBeNull();
  });

  it('搜尋面板預設收合，點放大鏡展開（aria-expanded），再點收合', async () => {
    await renderReady([makeUser('a')]);
    const toggle = document.getElementById('admin-user-filter-toggle') as HTMLButtonElement;
    const panel = document.getElementById('admin-user-filter-panel') as HTMLElement;
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.classList.contains('visible')).toBe(true);
    fireEvent.click(toggle);
    expect(panel.hidden).toBe(true);
  });

  it('關鍵字、身份、性別、地區、Email 一起篩選；篩選後回到第一頁', async () => {
    const users = [
      makeUser('a', { name: 'Alice', role: 'coach', gender: '女', region: '台北市', email: 'alice@x.com' }),
      makeUser('b', { name: 'Bob', role: 'user', gender: '男', region: '高雄市', email: 'bob@y.org' }),
      ...Array.from({ length: 40 }, (_, i) => makeUser(`z${i}`, { name: `Z${String(i).padStart(2, '0')}` })),
    ];
    await renderReady(users);
    fireEvent.click(document.getElementById('admin-user-filter-toggle') as HTMLElement);

    typeInto('admin-user-search', 'alice');
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1);

    typeInto('admin-user-search', '');
    changeSelect('admin-user-role-filter', 'coach');
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1);
    changeSelect('admin-user-role-filter', '');
    changeSelect('admin-user-gender-filter', '男');
    expect(cardOf('Bob')).toBeTruthy();
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1);
    changeSelect('admin-user-gender-filter', '');

    typeInto('admin-user-region-filter', '高雄');
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1);
    typeInto('admin-user-region-filter', '');
    typeInto('admin-user-email-filter', 'ALICE@X');
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1);
    typeInto('admin-user-email-filter', '');
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(30);
  });

  it('加入區間（日）與最後登入區間（日），沒有時間的人被排除', async () => {
    const now = Date.now();
    await renderReady([
      makeUser('a', { name: 'Recent', joinedAtMs: now - 2 * DAY, lastLoginMs: now - 1 * DAY }),
      makeUser('b', { name: 'Old', joinedAtMs: now - 60 * DAY, lastLoginMs: now - 50 * DAY }),
      makeUser('c', { name: 'Never' }),
    ]);
    fireEvent.click(document.getElementById('admin-user-filter-toggle') as HTMLElement);
    typeInto('admin-user-joined-min-days', '30');
    expect(Array.from(document.querySelectorAll('.admin-user-card')).map((el) => el.textContent)).toEqual([expect.stringContaining('Old')]);
    typeInto('admin-user-joined-min-days', '');
    typeInto('admin-user-login-min-days', '10');
    typeInto('admin-user-login-max-days', '0'); // 起 10、迄 0：互換成 0～10
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1);
    expect(cardOf('Recent')).toBeTruthy();
  });

  it('沒有符合條件的人：顯示「找不到符合條件的使用者」', async () => {
    await renderReady([makeUser('a')]);
    fireEvent.click(document.getElementById('admin-user-filter-toggle') as HTMLElement);
    typeInto('admin-user-search', 'zzzz-not-found');
    expect(screen.getByText('找不到符合條件的使用者')).toBeTruthy();
  });

  it('身份下拉包含內建角色、自訂角色與名單中出現的角色', async () => {
    mockFetchRoles.mockResolvedValue([{ key: 'vip', label: 'VIP 會員', afterRole: 'captain' }]);
    await renderReady([makeUser('a', { role: 'legacy_role' })]);
    const labels = Array.from((document.getElementById('admin-user-role-filter') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toEqual(['全部身份', '一般用戶', '教練', '領隊', 'VIP 會員', '場主', '管理員', '總管', 'legacy_role']);
  });

  it('旗標開：載入失敗顯示錯誤與重試，重試成功後顯示名單', async () => {
    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS));
    mockLoadUsers.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(loadOf([makeUser('a')]));
    render(<AdminUsersPage extraUiEnabled />);
    expect(await screen.findByText('載入用戶資料失敗')).toBeTruthy();
    fireEvent.click(screen.getByText('重試'));
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1));
  });

  it('旗標關（預設）：載入失敗只顯示純文字錯誤訊息，沒有重試鈕', async () => {
    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS));
    mockLoadUsers.mockRejectedValue(new Error('network'));
    render(<AdminUsersPage />);
    const message = await screen.findByText('載入用戶資料失敗');
    expect(message.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByText('重試')).toBeNull();
    expect(document.querySelector('#admin-user-list button')).toBeNull();
  });

  it('旗標預設值為 false（A 沒有的介面待站長預覽同意後才改 true）', () => {
    expect(ADMIN_USERS_EXTRA_UI_ENABLED).toBe(false);
  });

  it('旗標開：手動重新整理：重新讀取並提示', async () => {
    await renderReady([makeUser('a')], viewerOf('admin', FULL_ADMIN_PERMS), true);
    mockLoadUsers.mockResolvedValue(loadOf([makeUser('a'), makeUser('b')]));
    fireEvent.click(document.getElementById('admin-user-refresh') as HTMLElement);
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(2));
    expect(mockLoadUsers).toHaveBeenCalledTimes(2);
    expect(toastMessages()).toContain('已重新整理');
  });

  it('旗標關（預設）：頁首沒有重新整理圖示鈕，只剩 A 原有的搜尋鈕', async () => {
    await renderReady([makeUser('a')]);
    expect(document.getElementById('admin-user-refresh')).toBeNull();
    expect(document.querySelector('.admin-user-refresh-btn')).toBeNull();
    expect(document.querySelectorAll('.page-search-title-wrap > button')).toHaveLength(1);
    expect(document.getElementById('admin-user-filter-toggle')).not.toBeNull();
  });

  it('旗標關（預設）：人數過多仍只讀第一批，但不顯示說明列與「載入更多用戶」', async () => {
    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS));
    mockLoadUsers.mockResolvedValue(loadOf([makeUser('a', { name: 'Ann' })], { total: 6000, partial: true, done: false, lastId: 'a' }));
    render(<AdminUsersPage />);
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1));
    expect(screen.queryByText('載入更多用戶')).toBeNull();
    expect(screen.queryByText(/目前只載入/)).toBeNull();
    expect(mockLoadMore).not.toHaveBeenCalled();
    expect(mockLoadUsers).toHaveBeenCalledTimes(1);
  });

  it('旗標開：人數過多只載入一部分：顯示說明並可載入更多用戶', async () => {
    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS));
    const first = loadOf([makeUser('a')], { total: 6000, partial: true, done: false, lastId: 'a' });
    mockLoadUsers.mockResolvedValue(first);
    mockLoadMore.mockResolvedValue(loadOf([makeUser('a'), makeUser('b')], { total: 6000, partial: false, done: true }));
    render(<AdminUsersPage extraUiEnabled />);
    expect(await screen.findByText(/目前只載入 1 \/ 6000 位/)).toBeTruthy();
    fireEvent.click(screen.getByText('載入更多用戶'));
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(2));
    expect(mockLoadMore).toHaveBeenCalledWith(first);
    expect(screen.queryByText('載入更多用戶')).toBeNull();
  });
});

describe('用戶卡內容與按鈕顯示（四身分＋權限碼）', () => {
  it('卡片顯示 Email、限制狀態、最後登入（台北時間）；admin／super_admin 看得到原始 UID', async () => {
    await renderReady([
      makeUser('uid-aaa', { name: 'Ann', email: 'ann@x.com', region: '台北市', gender: '女', teamName: '雷霆隊', lastLoginMs: Date.UTC(2026, 9, 27, 0, 5), lastLoginIp: '1.2.3.4' }),
    ]);
    const text = cardOf('Ann').textContent ?? '';
    expect(text).toContain('uid-aaa ・一般用戶 ・台北市 ♀ ・雷霆隊');
    expect(text).toContain('Email：ann@x.com');
    expect(text).toContain('限制狀態：正常');
    expect(text).toContain('最後登入：2026/10/27 08:05 ・ 1.2.3.4');
  });

  it('沒有 UID 檢視資格（非 admin 角色但被個別授權進入）時不顯示原始 UID', async () => {
    await renderReady([makeUser('uid-secret', { name: 'Ann' })], viewerOf('coach', [PERM_USERS_ENTRY]));
    expect(cardOf('Ann').textContent).not.toContain('uid-secret');
  });

  it('只有 admin.users.entry、沒有任何子權限：看得到名單與「查看」，沒有編輯與限制鈕', async () => {
    await renderReady([makeUser('a', { name: 'Ann' })], viewerOf('admin', [PERM_USERS_ENTRY]));
    const card = within(cardOf('Ann'));
    expect(card.queryByText('編輯')).toBeNull();
    expect(card.queryByText('限制')).toBeNull();
    expect(card.getByText('查看')).toBeTruthy();
  });

  it('各子權限獨立：只有 restrict → 只有限制鈕；只有 edit_profile → 只有編輯鈕；只有 change_role → 有編輯鈕', async () => {
    await renderReady([makeUser('a', { name: 'Ann' })], viewerOf('admin', [PERM_USERS_ENTRY, PERM_USERS_RESTRICT]));
    expect(within(cardOf('Ann')).queryByText('編輯')).toBeNull();
    expect(within(cardOf('Ann')).getByText('限制')).toBeTruthy();
    cleanup();

    await renderReady([makeUser('a', { name: 'Ann' })], viewerOf('admin', [PERM_USERS_ENTRY, PERM_USERS_EDIT_PROFILE]));
    expect(within(cardOf('Ann')).getByText('編輯')).toBeTruthy();
    expect(within(cardOf('Ann')).queryByText('限制')).toBeNull();
    cleanup();

    await renderReady([makeUser('a', { name: 'Ann' })], viewerOf('admin', [PERM_USERS_ENTRY, PERM_USERS_CHANGE_ROLE]));
    expect(within(cardOf('Ann')).getByText('編輯')).toBeTruthy();
  });

  it('限制鈕只出現在 role=user 的非自己；教練、管理員、super_admin、自己都沒有；super_admin 目標沒有編輯鈕', async () => {
    await renderReady([
      makeUser('u1', { name: 'Plain' }),
      makeUser('me', { name: 'Myself' }),
      makeUser('c1', { name: 'Coach', role: 'coach' }),
      makeUser('ad', { name: 'AdminT', role: 'admin' }),
      makeUser('su', { name: 'SuperT', role: 'super_admin' }),
    ], viewerOf('super_admin', 'all'));
    expect(within(cardOf('Plain')).getByText('限制')).toBeTruthy();
    for (const name of ['Myself', 'Coach', 'AdminT', 'SuperT']) {
      expect(within(cardOf(name)).queryByText('限制')).toBeNull();
    }
    expect(within(cardOf('Coach')).getByText('編輯')).toBeTruthy();
    expect(within(cardOf('SuperT')).queryByText('編輯')).toBeNull();
  });

  it('admin 看不到對 super_admin 目標的任何管理按鈕', async () => {
    await renderReady([makeUser('su', { name: 'SuperT', role: 'super_admin' })]);
    const card = within(cardOf('SuperT'));
    expect(card.queryByText('編輯')).toBeNull();
    expect(card.queryByText('限制')).toBeNull();
  });

  it('已限制的人顯示「限制中」與「解除限制」', async () => {
    await renderReady([makeUser('u1', { name: 'Plain', isRestricted: true })]);
    expect(cardOf('Plain').textContent).toContain('限制狀態：限制中');
    expect(within(cardOf('Plain')).getByText('解除限制')).toBeTruthy();
  });

  it('「查看」與膠囊都導向該用戶名片（以 UID 為準）', async () => {
    await renderReady([makeUser('uid 1', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('查看'));
    expect(mockRoute).toHaveBeenCalledWith('/profile/uid%201');
    mockRoute.mockClear();
    fireEvent.click(cardOf('Ann').querySelector('.ui-user-tag') as HTMLElement);
    expect(mockRoute).toHaveBeenCalledWith('/profile/uid%201');
  });

  it('管理員隱身時膠囊顯示一般用戶底色，角色文字仍顯示實際角色', async () => {
    await renderReady([makeUser('ad', { name: 'Hidden', role: 'admin', stealth: true })], viewerOf('super_admin', 'all'));
    const tag = cardOf('Hidden').querySelector('.user-capsule') as HTMLElement;
    expect(tag.classList.contains('uc-user')).toBe(true);
    expect(cardOf('Hidden').textContent).toContain('管理員');
  });
});

describe('編輯用戶彈窗', () => {
  it('預填目前值；標題含名字；角色下拉對 admin 只列到場主（不含管理員／總管）', async () => {
    await renderReady([makeUser('uid-target', { name: 'Ann', region: '台北市', gender: '女', sports: '足球', phone: '0912', email: 'a@b.co', birthday: '1990-05-01' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    expect(document.getElementById('user-edit-modal-title')?.textContent).toBe('編輯用戶 — Ann');
    expect((document.getElementById('ue-region') as HTMLSelectElement).value).toBe('台北市');
    expect((document.getElementById('ue-gender') as HTMLSelectElement).value).toBe('女');
    expect((document.getElementById('ue-sports') as HTMLInputElement).value).toBe('足球');
    expect((document.getElementById('ue-phone') as HTMLInputElement).value).toBe('0912');
    expect((document.getElementById('ue-email') as HTMLInputElement).value).toBe('a@b.co');
    expect((document.getElementById('ue-birthday') as HTMLInputElement).value).toBe('1990-05-01');
    const roles = Array.from((document.getElementById('ue-role') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(roles).toEqual(['一般用戶', '教練', '領隊', '場主']);
  });

  it('super_admin 的角色下拉包含管理員與總管', async () => {
    await renderReady([makeUser('uid-target', { name: 'Ann' })], viewerOf('super_admin', 'all'));
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    const roles = Array.from((document.getElementById('ue-role') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(roles).toEqual(['一般用戶', '教練', '領隊', '場主', '管理員', '總管']);
  });

  it('目前值不在選項內（舊資料地區）時保留「目前值：xxx」', async () => {
    await renderReady([makeUser('a', { name: 'Ann', region: '火星' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    const region = document.getElementById('ue-region') as HTMLSelectElement;
    expect(region.value).toBe('火星');
    expect(region.options[1]?.textContent).toBe('目前值：火星');
  });

  it('只有 edit_profile：角色下拉停用；只有 change_role：資料欄位停用', async () => {
    await renderReady([makeUser('a', { name: 'Ann' })], viewerOf('admin', [PERM_USERS_ENTRY, PERM_USERS_EDIT_PROFILE]));
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    expect((document.getElementById('ue-role') as HTMLSelectElement).disabled).toBe(true);
    expect((document.getElementById('ue-phone') as HTMLInputElement).disabled).toBe(false);
    cleanup();

    await renderReady([makeUser('a', { name: 'Ann' })], viewerOf('admin', [PERM_USERS_ENTRY, PERM_USERS_CHANGE_ROLE]));
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    expect((document.getElementById('ue-role') as HTMLSelectElement).disabled).toBe(false);
    for (const id of ['ue-region', 'ue-gender', 'ue-birthday', 'ue-sports', 'ue-phone', 'ue-email']) {
      expect((document.getElementById(id) as HTMLInputElement).disabled).toBe(true);
    }
  });

  it('admin 編輯同級（admin）：角色下拉停用並顯示目前角色，資料欄位可改', async () => {
    await renderReady([makeUser('ad', { name: 'AdminT', role: 'admin' })]);
    fireEvent.click(within(cardOf('AdminT')).getByText('編輯'));
    const role = document.getElementById('ue-role') as HTMLSelectElement;
    expect(role.disabled).toBe(true);
    expect(role.value).toBe('admin');
    expect((document.getElementById('ue-phone') as HTMLInputElement).disabled).toBe(false);
  });

  it('改電話與 Email → 以 adminManageUser 送出「只有改動的欄位」，成功後關閉、提示、更新稽核', async () => {
    mockCallFn.mockResolvedValue({ success: true, targetUid: 'uid-target' });
    await renderReady([makeUser('uid-target', { name: 'Ann', phone: '0912', region: '台北市' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    typeInto('ue-phone', ' 0988 ');
    typeInto('ue-email', 'ann@x.com');
    fireEvent.click(screen.getByText('儲存'));

    await waitFor(() => expect(mockCallFn).toHaveBeenCalledTimes(1));
    expect(mockCallFn).toHaveBeenCalledWith('adminManageUser', {
      targetUid: 'uid-target',
      profileUpdates: { phone: '0988', email: 'ann@x.com' },
    });
    await waitFor(() => expect(document.getElementById('user-edit-modal')).toBeNull());
    expect(toastMessages()).toContain('已更新「Ann」的資料');
    expect(cardOf('Ann').textContent).toContain('Email：ann@x.com');
    await waitFor(() => expect(mockAudit).toHaveBeenCalledTimes(1));
    expect(mockAudit).toHaveBeenCalledWith({
      action: 'admin_user_edit', target: { uid: 'uid-target', name: 'Ann' }, statusFrom: 'user', statusTo: '',
    });
    expect(mockNotify).not.toHaveBeenCalled();
    // 操作日誌：沒有改角色 → 只有「編輯用戶資料」一筆，actorUid 是操作者 'me'（不是被改的 uid-target）。
    await waitFor(() => expect(mockOpLog).toHaveBeenCalledTimes(1));
    expect(mockOpLog).toHaveBeenCalledWith({
      type: 'user_edit', typeName: '編輯用戶資料', content: '編輯「Ann」的資料：聯繫電話、電子郵件', actorUid: 'me', operator: '操作者',
    });
    expect(JSON.stringify(mockOpLog.mock.calls)).not.toMatch(/0988|ann@x\.com|uid-target/);
  });

  it('改角色 → roleChange 送出；寫兩筆稽核（admin_user_edit、role_change）、操作日誌、站內信（走收件匣、不走 LINE）', async () => {
    mockCallFn.mockResolvedValue({ success: true, targetUid: 'uid-resolved', role: 'coach' });
    // F14：站內信用真的 sendRoleUpgradeInbox，讓「不呼叫 enqueuePrivilegedLineNotification」是對真實 callable 層的斷言。
    const realData = await vi.importActual<typeof import('../data/admin-users')>('../data/admin-users');
    mockNotify.mockImplementation((notice: Parameters<typeof realData.sendRoleUpgradeInbox>[0]) => realData.sendRoleUpgradeInbox(notice));
    await renderReady([makeUser('uid-target', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    changeSelect('ue-role', 'coach');
    fireEvent.click(screen.getByText('儲存'));

    await waitFor(() => expect(mockCallFn).toHaveBeenCalledTimes(1));
    expect(mockCallFn).toHaveBeenCalledWith('adminManageUser', {
      targetUid: 'uid-target',
      roleChange: { role: 'coach', manualRole: 'coach' },
    });
    await waitFor(() => expect(mockNotify).toHaveBeenCalledTimes(1));
    expect(mockAudit.mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual(['admin_user_edit', 'role_change']);
    expect(mockAudit).toHaveBeenLastCalledWith({
      action: 'role_change', target: { uid: 'uid-resolved', name: 'Ann' }, statusFrom: 'user', statusTo: 'coach',
    });
    expect(mockNotify).toHaveBeenCalledWith({ targetUid: 'uid-resolved', userName: 'Ann', roleName: '教練', senderUid: 'me' });
    expect(mockOpLog).toHaveBeenCalledTimes(1);
    expect(mockOpLog).toHaveBeenCalledWith({
      type: 'role', typeName: '角色變更', content: 'Ann 手動晉升為「教練」（原：一般用戶）', actorUid: 'me', operator: '操作者',
    });
    expect(within(cardOf('Ann')).getByText('編輯')).toBeTruthy();
    expect(cardOf('Ann').textContent).toContain('教練');
    // 站內信確實走 deliverToInbox，且整個流程沒有任何一次 enqueuePrivilegedLineNotification。
    await waitFor(() => expect(mockCallFn.mock.calls.some((c) => c[0] === 'deliverToInbox')).toBe(true));
    const inboxCall = mockCallFn.mock.calls.find((c) => c[0] === 'deliverToInbox');
    expect(inboxCall?.[1]).toMatchObject({ targetUid: 'uid-resolved', message: { title: '身份變更通知', senderName: '系統' } });
    expect(mockCallFn.mock.calls.map((c) => c[0] as string).sort()).toEqual(['adminManageUser', 'deliverToInbox']);
    expect(mockCallFn.mock.calls.some((c) => c[0] === 'enqueuePrivilegedLineNotification')).toBe(false);
  });

  it('資料與角色一起改：一次 Callable 呼叫送出兩個區塊', async () => {
    await renderReady([makeUser('uid-target', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    changeSelect('ue-role', 'captain');
    changeSelect('ue-region', '高雄市');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(mockCallFn).toHaveBeenCalledTimes(1));
    expect(mockCallFn).toHaveBeenCalledWith('adminManageUser', {
      targetUid: 'uid-target',
      profileUpdates: { region: '高雄市' },
      roleChange: { role: 'captain', manualRole: 'captain' },
    });
    // 角色與資料都改 → 兩筆操作日誌（角色變更、編輯用戶資料），都以操作者為 actorUid。
    await waitFor(() => expect(mockOpLog).toHaveBeenCalledTimes(2));
    expect(mockOpLog.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(['role', 'user_edit']);
    expect(mockOpLog.mock.calls.every((c) => (c[0] as { actorUid: string }).actorUid === 'me')).toBe(true);
  });

  it('沒有任何變更：提示「沒有變更」，不呼叫 Callable，彈窗保留', async () => {
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    fireEvent.click(screen.getByText('儲存'));
    expect(toastMessages()).toContain('沒有變更');
    expect(mockCallFn).not.toHaveBeenCalled();
    expect(document.getElementById('user-edit-modal')).not.toBeNull();
  });

  it('Email 格式錯誤：提示並且不送出', async () => {
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    typeInto('ue-email', 'not-an-email');
    fireEvent.click(screen.getByText('儲存'));
    expect(toastMessages()).toContain('請輸入有效的電子郵件，或留空清除。');
    expect(mockCallFn).not.toHaveBeenCalled();
  });

  it('伺服器拒絕（permission-denied）→ 轉成人話訊息，彈窗保留，不寫稽核與站內信', async () => {
    mockCallFn.mockRejectedValue(Object.assign(new Error('Cannot modify user with equal or higher role'), { code: 'functions/permission-denied' }));
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    changeSelect('ue-role', 'coach');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(toastMessages()).toContain('權限不足，無法執行此操作'));
    expect(document.getElementById('user-edit-modal')).not.toBeNull();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockOpLog).not.toHaveBeenCalled();
    // 本機名單沒有被改動。
    expect(cardOf('Ann').textContent).toContain('一般用戶');
  });

  it('其他錯誤 → 「儲存失敗，資料未更新」，且按鈕恢復可再送', async () => {
    mockCallFn.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ success: true, targetUid: 'a' });
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    typeInto('ue-phone', '0911');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(toastMessages()).toContain('儲存失敗，資料未更新'));
    await waitFor(() => expect((screen.getByText('儲存') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(mockCallFn).toHaveBeenCalledTimes(2));
  });

  it('送出中不重複送出，也不能關閉彈窗', async () => {
    let release: (value: unknown) => void = () => undefined;
    mockCallFn.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    typeInto('ue-phone', '0911');
    fireEvent.click(screen.getByText('儲存'));
    fireEvent.click(screen.getByText('儲存'));
    expect(mockCallFn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('取消'));
    expect(document.getElementById('user-edit-modal')).not.toBeNull();
    expect(toastMessages()).toContain('資料儲存中，請稍候');
    await act(async () => { release({ success: true, targetUid: 'a' }); });
    await waitFor(() => expect(document.getElementById('user-edit-modal')).toBeNull());
  });

  it('取消與 ✕ 關閉彈窗且不送出', async () => {
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    fireEvent.click(screen.getByText('取消'));
    expect(document.getElementById('user-edit-modal')).toBeNull();
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    fireEvent.click(screen.getByLabelText('關閉'));
    expect(document.getElementById('user-edit-modal')).toBeNull();
    expect(mockCallFn).not.toHaveBeenCalled();
  });

  it('僅有 change_role 的人改了資料欄位也不會送出資料（欄位已停用，送出時以權限再過濾）', async () => {
    mockCallFn.mockResolvedValue({ success: true, targetUid: 'a' });
    await renderReady([makeUser('a', { name: 'Ann' })], viewerOf('admin', [PERM_USERS_ENTRY, PERM_USERS_CHANGE_ROLE]));
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    changeSelect('ue-role', 'coach');
    // 欄位已停用，但假設事件被硬塞進來（例如瀏覽器擴充套件改了值）：送出時仍以權限過濾，不會夾帶資料欄位。
    typeInto('ue-phone', '0999');
    changeSelect('ue-region', '高雄市');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(mockCallFn).toHaveBeenCalledTimes(1));
    expect(mockCallFn.mock.calls[0]?.[1]).toEqual({ targetUid: 'a', roleChange: { role: 'coach', manualRole: 'coach' } });
  });

  it('自己的角色被改（伺服器回 forceRefreshToken）→ 換新 ID token', async () => {
    mockCallFn.mockResolvedValue({ success: true, targetUid: 'me', role: 'coach', forceRefreshToken: true });
    await renderReady([makeUser('me', { name: 'Myself', role: 'admin' })], viewerOf('super_admin', 'all'));
    fireEvent.click(within(cardOf('Myself')).getByText('編輯'));
    changeSelect('ue-role', 'coach');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(mockGetIdToken).toHaveBeenCalledWith(true));
  });
});

describe('限制／解除限制', () => {
  it('確認後以 restrictionUpdate 送出，成功後卡片改為「限制中」、寫稽核', async () => {
    mockConfirm.mockResolvedValue(true);
    await renderReady([makeUser('uid-target', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('限制'));
    await waitFor(() => expect(mockCallFn).toHaveBeenCalledTimes(1));
    expect(mockConfirm).toHaveBeenCalledWith('確定要限制「Ann」嗎？');
    expect(mockCallFn).toHaveBeenCalledWith('adminManageUser', { targetUid: 'uid-target', restrictionUpdate: { isRestricted: true } });
    await waitFor(() => expect(cardOf('Ann').textContent).toContain('限制狀態：限制中'));
    expect(toastMessages()).toContain('已限制使用者');
    expect(within(cardOf('Ann')).getByText('解除限制')).toBeTruthy();
    await waitFor(() => expect(mockAudit).toHaveBeenCalledWith({
      action: 'admin_user_edit', target: { uid: 'uid-target', name: 'Ann' }, statusFrom: 'active', statusTo: 'restricted',
    }));
    // 操作日誌：actorUid 是操作者 'me'，被限制的人只出現在 content。
    expect(mockOpLog).toHaveBeenCalledTimes(1);
    expect(mockOpLog).toHaveBeenCalledWith({
      type: 'user_restrict', typeName: '帳號限制', content: '限制「Ann」', actorUid: 'me', operator: '操作者',
    });
  });

  it('解除限制：isRestricted=false，稽核狀態相反', async () => {
    mockConfirm.mockResolvedValue(true);
    await renderReady([makeUser('uid-target', { name: 'Ann', isRestricted: true })]);
    fireEvent.click(within(cardOf('Ann')).getByText('解除限制'));
    await waitFor(() => expect(mockCallFn).toHaveBeenCalledTimes(1));
    expect(mockConfirm).toHaveBeenCalledWith('確定要解除限制「Ann」嗎？');
    expect(mockCallFn).toHaveBeenCalledWith('adminManageUser', { targetUid: 'uid-target', restrictionUpdate: { isRestricted: false } });
    await waitFor(() => expect(toastMessages()).toContain('已解除限制'));
    await waitFor(() => expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ statusFrom: 'restricted', statusTo: 'active' })));
    expect(mockOpLog).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_restrict', content: '解除限制「Ann」', actorUid: 'me' }));
  });

  it('取消確認：不送出', async () => {
    mockConfirm.mockResolvedValue(false);
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('限制'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockCallFn).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockOpLog).not.toHaveBeenCalled();
  });

  // F2（L-29）：確認框開著的期間再點只會排一個確認、只送一次。
  it('連點兩次「限制」只跳一個確認框、只送一次、只寫一筆稽核與日誌', async () => {
    let answer: (value: boolean) => void = () => undefined;
    mockConfirm.mockReturnValue(new Promise<boolean>((resolve) => { answer = resolve; }));
    await renderReady([makeUser('uid-target', { name: 'Ann' }), makeUser('uid-other', { name: 'Bob' })]);
    const button = within(cardOf('Ann')).getByText('限制');
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(within(cardOf('Bob')).getByText('限制')); // 另一個人的限制鈕也鎖住
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { answer(true); });
    await waitFor(() => expect(mockCallFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockAudit).toHaveBeenCalledTimes(1));
    expect(mockOpLog).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  it('取消確認後立刻解鎖，可以再點一次', async () => {
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await renderReady([makeUser('uid-target', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('限制'));
    await waitFor(() => expect((within(cardOf('Ann')).getByText('限制') as HTMLButtonElement).disabled).toBe(false));
    expect(mockCallFn).not.toHaveBeenCalled();

    fireEvent.click(within(cardOf('Ann')).getByText('限制'));
    await waitFor(() => expect(mockCallFn).toHaveBeenCalledTimes(1));
    expect(mockConfirm).toHaveBeenCalledTimes(2);
  });

  it('確認框開著期間名單被重新整理成「已被別人限制」：確認後不再重複送出', async () => {
    let answer: (value: boolean) => void = () => undefined;
    mockConfirm.mockReturnValue(new Promise<boolean>((resolve) => { answer = resolve; }));
    await renderReady([makeUser('uid-target', { name: 'Ann' })], viewerOf('admin', FULL_ADMIN_PERMS), true);
    fireEvent.click(within(cardOf('Ann')).getByText('限制'));
    mockLoadUsers.mockResolvedValue(loadOf([makeUser('uid-target', { name: 'Ann', isRestricted: true })]));
    fireEvent.click(document.getElementById('admin-user-refresh') as HTMLElement);
    await waitFor(() => expect(cardOf('Ann').textContent).toContain('限制狀態：限制中'));
    await act(async () => { answer(true); });
    await waitFor(() => expect((within(cardOf('Ann')).getByText('解除限制') as HTMLButtonElement).disabled).toBe(false));
    expect(mockCallFn).not.toHaveBeenCalled();
  });

  // N5：確認框（await）之後驗權限要用「現在」的權限，不能用點擊當下的舊閉包。
  it('確認框開著期間限制權限被收回：確認後不送出，提示權限不足', async () => {
    let answer: (value: boolean) => void = () => undefined;
    mockConfirm.mockReturnValue(new Promise<boolean>((resolve) => { answer = resolve; }));
    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS));
    mockLoadUsers.mockResolvedValue(loadOf([makeUser('uid-target', { name: 'Ann' })]));
    const view = render(<AdminUsersPage />);
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1));
    fireEvent.click(within(cardOf('Ann')).getByText('限制'));
    expect(mockConfirm).toHaveBeenCalledTimes(1);

    mockUseViewer.mockReturnValue(viewerOf('admin', [PERM_USERS_ENTRY, PERM_USERS_EDIT_PROFILE, PERM_USERS_CHANGE_ROLE]));
    view.rerender(<AdminUsersPage />);
    await act(async () => { answer(true); });
    await waitFor(() => expect(toastMessages()).toContain('權限不足'));
    expect(mockCallFn).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockOpLog).not.toHaveBeenCalled();
    expect(within(cardOf('Ann')).queryByText('限制')).toBeNull();
  });

  it('失敗：提示「限制失敗，請稍後再試」，卡片維持原狀，不寫稽核與操作日誌', async () => {
    mockConfirm.mockResolvedValue(true);
    mockCallFn.mockRejectedValue(new Error('boom'));
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('限制'));
    await waitFor(() => expect(toastMessages()).toContain('限制失敗，請稍後再試'));
    expect(cardOf('Ann').textContent).toContain('限制狀態：正常');
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockOpLog).not.toHaveBeenCalled();
  });

  it('伺服器拒絕（permission-denied）→ 權限不足訊息', async () => {
    mockConfirm.mockResolvedValue(true);
    mockCallFn.mockRejectedValue(Object.assign(new Error('x'), { code: 'permission-denied' }));
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('限制'));
    await waitFor(() => expect(toastMessages()).toContain('權限不足，無法執行此操作'));
  });
});

describe('DOM 結構照 A（pages/admin-users.html＋renderAdminUsers）', () => {
  it('頁首、篩選面板、清單容器的 id 與 class', async () => {
    await renderReady([makeUser('a', { name: 'Ann' })]);
    expect(document.querySelector('#page-admin-users.page > .page-header.admin-user-page-header > button.back-btn')).not.toBeNull();
    expect(document.querySelector('.page-search-title-wrap.admin-user-page-heading > h2.page-header-title')?.textContent).toBe('用戶管理');
    const toggle = document.querySelector('#admin-user-filter-toggle.page-search-toggle-btn.admin-user-filter-toggle-btn');
    expect(toggle?.getAttribute('aria-controls')).toBe('admin-user-filter-panel');
    expect(toggle?.getAttribute('aria-label')).toBe('搜尋與篩選用戶');
    expect(document.querySelector('#admin-user-filter-panel.admin-search.collapsible-search-panel.admin-user-filter-panel')).not.toBeNull();
    for (const id of [
      'admin-user-search', 'admin-user-role-filter', 'admin-user-gender-filter',
      'admin-user-joined-min-days', 'admin-user-joined-max-days', 'admin-user-login-min-days', 'admin-user-login-max-days',
      'admin-user-region-filter', 'admin-user-email-filter',
    ]) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    expect(document.querySelectorAll('.admin-user-range-field > .admin-user-range-inputs > input[type="number"]')).toHaveLength(4);
    expect(document.querySelector('#admin-user-list.admin-card-list')).not.toBeNull();
    expect((document.getElementById('admin-user-search') as HTMLInputElement).placeholder).toBe('搜尋用戶...');
    expect((document.getElementById('admin-user-region-filter') as HTMLInputElement).placeholder).toBe('地區');
    expect((document.getElementById('admin-user-email-filter') as HTMLInputElement).type).toBe('email');
  });

  it('用戶卡：頭像、膠囊、五行 meta、操作按鈕的 class 與順序', async () => {
    await renderReady([makeUser('a', { name: 'Ann' })]);
    const card = cardOf('Ann');
    expect(card.classList.contains('admin-user-card')).toBe(true);
    const [avatar, body] = Array.from(card.children);
    expect(avatar?.className).toBe('au-avatar au-avatar-fallback');
    expect(avatar?.textContent).toBe('A');
    expect(body?.className).toBe('admin-user-body');
    expect(body?.querySelector('.admin-user-info > .admin-user-name .user-capsule')).not.toBeNull();
    expect(body?.querySelectorAll('.admin-user-info > .admin-user-meta')).toHaveLength(5);
    const buttons = Array.from(body?.querySelectorAll('.admin-user-actions > button') ?? []);
    expect(buttons.map((b) => b.textContent)).toEqual(['編輯', '查看', '限制']);
    expect(buttons.map((b) => b.className)).toEqual(['au-btn au-btn-edit', 'au-btn au-btn-view', 'au-btn au-btn-edit']);
  });

  it('有頭像網址輸出 img.au-avatar；載入失敗改回首字圓形', async () => {
    await renderReady([makeUser('a', { name: 'Ann', pictureUrl: 'https://example.com/a.png' })]);
    const img = cardOf('Ann').querySelector('img.au-avatar') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://example.com/a.png');
    fireEvent.error(img);
    expect(cardOf('Ann').querySelector('img.au-avatar')).toBeNull();
    expect(cardOf('Ann').querySelector('.au-avatar.au-avatar-fallback')?.textContent).toBe('A');
  });

  it('頭像網址不是 http／https 時不輸出 img（避免 javascript: 等網址）', async () => {
    await renderReady([makeUser('a', { name: 'Ann', pictureUrl: 'javascript:alert(1)' })]);
    expect(cardOf('Ann').querySelector('img')).toBeNull();
  });

  it('編輯彈窗：id、class 與欄位順序（權限、地區、性別、生日、運動類別、聯繫電話、電子郵件）', async () => {
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    const modal = document.getElementById('user-edit-modal') as HTMLElement;
    expect(modal.classList.contains('modal')).toBe(true);
    expect(modal.querySelector('.modal-header > #user-edit-modal-title')).not.toBeNull();
    expect(modal.querySelector('.modal-header > button.modal-close')).not.toBeNull();
    const rows = Array.from(modal.querySelectorAll('.modal-body > .ce-form > .ce-row'));
    expect(rows.map((row) => row.querySelector('label')?.textContent)).toEqual(['權限', '地區', '性別', '生日', '運動類別', '聯繫電話', '電子郵件']);
    expect(rows.map((row) => row.querySelector('select, input')?.id)).toEqual(['ue-role', 'ue-region', 'ue-gender', 'ue-birthday', 'ue-sports', 'ue-phone', 'ue-email']);
    expect(modal.querySelector('.modal-actions > button.outline-btn')?.textContent).toBe('取消');
    expect(modal.querySelector('.modal-actions > button.primary-btn')?.textContent).toBe('儲存');
    expect((document.getElementById('ue-email') as HTMLInputElement).maxLength).toBe(254);
    expect(document.querySelector('.modal-overlay.open')).not.toBeNull();
  });
});

describe('退修 1：目標文件不一致、序號保護、可指派角色、焦點與無障礙', () => {
  it('F9：儲存成功但伺服器改到的文件（targetDocId）和本機這筆不同 → 重新讀取名單', async () => {
    mockCallFn.mockResolvedValue({ success: true, targetUid: 'uid-target', targetDocId: 'another-doc' });
    await renderReady([makeUser('uid-target', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    typeInto('ue-phone', '0911');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(mockLoadUsers).toHaveBeenCalledTimes(2));
  });

  it('F9：targetDocId 相同或伺服器沒回 → 不重讀', async () => {
    mockCallFn.mockResolvedValue({ success: true, targetUid: 'uid-target', targetDocId: 'uid-target' });
    await renderReady([makeUser('uid-target', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    typeInto('ue-phone', '0911');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(mockAudit).toHaveBeenCalledTimes(1));
    expect(mockLoadUsers).toHaveBeenCalledTimes(1);
  });

  it('F9：限制成功但 targetDocId 不同 → 同樣重讀；稽核用伺服器回傳的 targetUid', async () => {
    mockConfirm.mockResolvedValue(true);
    mockCallFn.mockResolvedValue({ success: true, targetUid: 'uid-resolved', targetDocId: 'another-doc' });
    await renderReady([makeUser('uid-target', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('限制'));
    await waitFor(() => expect(mockLoadUsers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockAudit).toHaveBeenCalledTimes(1));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ target: { uid: 'uid-resolved', name: 'Ann' } }));
  });

  it('F10：手動重新整理進行中又因 uid 變動重載，舊結果回來後重新整理鈕不會永久停用', async () => {
    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS, 'me'));
    const first = loadOf([makeUser('a', { name: 'Ann' })]);
    let finishManual: (value: AdminUsersLoad) => void = () => undefined;
    mockLoadUsers
      .mockResolvedValueOnce(first)
      .mockReturnValueOnce(new Promise<AdminUsersLoad>((resolve) => { finishManual = resolve; }))
      .mockResolvedValue(first);
    const view = render(<AdminUsersPage extraUiEnabled />);
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1));
    const refresh = document.getElementById('admin-user-refresh') as HTMLButtonElement;
    fireEvent.click(refresh);
    expect(refresh.disabled).toBe(true);

    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS, 'me2'));
    view.rerender(<AdminUsersPage extraUiEnabled />);
    await waitFor(() => expect(mockLoadUsers).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1));
    await act(async () => { finishManual(first); });
    await waitFor(() => expect(refresh.disabled).toBe(false));
  });

  it('F10：載入更多用戶只補新的人，不蓋掉剛套用的本機變更（例如剛限制的人）', async () => {
    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS));
    mockConfirm.mockResolvedValue(true);
    mockLoadUsers.mockResolvedValue(loadOf([makeUser('u1', { name: 'Ann' })], { total: 6000, partial: true, done: false, lastId: 'u1' }));
    mockLoadMore.mockResolvedValue(loadOf(
      [makeUser('u1', { name: 'Ann', isRestricted: false }), makeUser('u3', { name: 'Cat' })],
      { total: 6000, partial: false, done: true },
    ));
    render(<AdminUsersPage extraUiEnabled />);
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1));
    fireEvent.click(within(cardOf('Ann')).getByText('限制'));
    await waitFor(() => expect(cardOf('Ann').textContent).toContain('限制狀態：限制中'));

    fireEvent.click(screen.getByText('載入更多用戶'));
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(2));
    expect(cardOf('Ann').textContent).toContain('限制狀態：限制中');
    expect(cardOf('Cat')).toBeTruthy();
  });

  it('F10：載入更多進行中又重載（uid 變動）→ 舊的載入更多結果作廢', async () => {
    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS, 'me'));
    const partial = loadOf([makeUser('u1', { name: 'Ann' })], { total: 6000, partial: true, done: false, lastId: 'u1' });
    let finishMore: (value: AdminUsersLoad) => void = () => undefined;
    mockLoadUsers.mockResolvedValueOnce(partial).mockResolvedValue(loadOf([makeUser('u9', { name: 'Zed' })]));
    mockLoadMore.mockReturnValue(new Promise<AdminUsersLoad>((resolve) => { finishMore = resolve; }));
    const view = render(<AdminUsersPage extraUiEnabled />);
    await waitFor(() => expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1));
    fireEvent.click(screen.getByText('載入更多用戶'));

    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS, 'me2'));
    view.rerender(<AdminUsersPage extraUiEnabled />);
    await waitFor(() => expect(cardOf('Zed')).toBeTruthy());
    await act(async () => {
      finishMore(loadOf([makeUser('u1', { name: 'Ann' }), makeUser('u5', { name: 'Late' })], { partial: false, done: true }));
    });
    expect(document.querySelectorAll('.admin-user-card')).toHaveLength(1);
    expect(() => cardOf('Late')).toThrow();
    expect(toastMessages()).not.toContain('重新整理失敗，請稍後再試');
  });

  it('F4：admin 的角色下拉不含排在 admin 之後的自訂角色；排在 admin 之前的自訂角色可選', async () => {
    mockFetchRoles.mockResolvedValue([
      { key: 'vip', label: 'VIP 會員', afterRole: 'captain' },
      { key: 'top', label: '頂級管理', afterRole: 'admin' },
    ]);
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    const labels = Array.from((document.getElementById('ue-role') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toEqual(['一般用戶', '教練', '領隊', 'VIP 會員', '場主']);
  });

  it('F4：super_admin 的角色下拉含全部自訂角色', async () => {
    mockFetchRoles.mockResolvedValue([
      { key: 'vip', label: 'VIP 會員', afterRole: 'captain' },
      { key: 'top', label: '頂級管理', afterRole: 'admin' },
    ]);
    await renderReady([makeUser('a', { name: 'Ann' })], viewerOf('super_admin', 'all'));
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    const labels = Array.from((document.getElementById('ue-role') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toEqual(['一般用戶', '教練', '領隊', 'VIP 會員', '場主', '管理員', '頂級管理', '總管']);
  });

  it('F4：即使有人用開發者工具把下拉改成排在 admin 之後的自訂角色，送出時仍被擋（不呼叫 Callable）', async () => {
    mockFetchRoles.mockResolvedValue([{ key: 'top', label: '頂級管理', afterRole: 'admin' }]);
    await renderReady([makeUser('uid-target', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    const select = document.getElementById('ue-role') as HTMLSelectElement;
    expect(Array.from(select.options).some((o) => o.value === 'top')).toBe(false);
    const forged = document.createElement('option');
    forged.value = 'top';
    forged.textContent = '頂級管理';
    select.appendChild(forged);
    changeSelect('ue-role', 'top');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(toastMessages()).toContain('權限不足，無法執行此操作'));
    expect(mockCallFn).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(document.getElementById('user-edit-modal')).not.toBeNull();
  });

  it('F4：選自訂角色（排在 admin 之前）送出時 roleChange 帶該自訂角色', async () => {
    mockFetchRoles.mockResolvedValue([{ key: 'vip', label: 'VIP 會員', afterRole: 'captain' }]);
    await renderReady([makeUser('uid-target', { name: 'Ann' })]);
    fireEvent.click(within(cardOf('Ann')).getByText('編輯'));
    changeSelect('ue-role', 'vip');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(mockCallFn).toHaveBeenCalledTimes(1));
    expect(mockCallFn.mock.calls[0]?.[1]).toEqual({ targetUid: 'uid-target', roleChange: { role: 'vip', manualRole: 'vip' } });
  });

  it('F11：舊資料角色 team_leader 顯示「領隊」，完全沒有對照的角色才顯示原字串', async () => {
    await renderReady([
      makeUser('t1', { name: 'Legacy', role: 'team_leader' }),
      makeUser('m1', { name: 'Mystery', role: 'mystery_role' }),
    ], viewerOf('super_admin', 'all'));
    expect(cardOf('Legacy').textContent).toContain('領隊');
    expect(cardOf('Legacy').textContent).not.toContain('team_leader');
    expect(cardOf('Mystery').textContent).toContain('mystery_role');
  });

  // 「編輯」鈕用 data-edit-user-doc 重新查詢（不持有舊節點），避免測試只比對一個可能已脫離 DOM 的舊元素。
  const editButtonOf = (docId: string): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>(`[data-edit-user-doc="${docId}"]`);

  it('F13：關閉編輯彈窗（取消）後，焦點回到原本按下的「編輯」鈕', async () => {
    await renderReady([makeUser('a', { name: 'Ann' })]);
    const editButton = editButtonOf('a') as HTMLButtonElement;
    fireEvent.click(editButton);
    expect(document.getElementById('user-edit-modal')).not.toBeNull();
    expect(document.activeElement).not.toBe(editButton);
    fireEvent.click(screen.getByText('取消'));
    expect(document.getElementById('user-edit-modal')).toBeNull();
    expect(document.activeElement).toBe(editButtonOf('a'));
    expect(document.activeElement).not.toBe(document.body);
  });

  // CI 實測：Preact 先卸載被移除的彈窗、才更新其他節點，彈窗卸載當下「編輯」鈕還是 disabled（busy 尚未改回 false），
  // 所以焦點要等整個 commit 完成（頁面層 useLayoutEffect）才還。
  it('F13：儲存成功關閉彈窗後焦點同樣回到「編輯」鈕（儲存期間按鈕被停用，commit 後才還焦點）', async () => {
    await renderReady([makeUser('a', { name: 'Ann' })]);
    fireEvent.click(editButtonOf('a') as HTMLButtonElement);
    typeInto('ue-phone', '0911');
    fireEvent.click(screen.getByText('儲存'));
    await waitFor(() => expect(document.getElementById('user-edit-modal')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(editButtonOf('a')));
    expect((editButtonOf('a') as HTMLButtonElement).disabled).toBe(false);
  });

  it('F13：編輯期間名單被重載、原「編輯」鈕節點已換新 → 焦點回到同一個人的新「編輯」鈕', async () => {
    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS, 'me'));
    mockLoadUsers.mockResolvedValue(loadOf([makeUser('a', { name: 'Ann' })]));
    const view = render(<AdminUsersPage />);
    await waitFor(() => expect(editButtonOf('a')).not.toBeNull());
    const oldButton = editButtonOf('a') as HTMLButtonElement;
    fireEvent.click(oldButton);
    expect(document.getElementById('user-edit-modal')).not.toBeNull();

    mockUseViewer.mockReturnValue(viewerOf('admin', FULL_ADMIN_PERMS, 'me2'));
    view.rerender(<AdminUsersPage />);
    await waitFor(() => expect(mockLoadUsers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(editButtonOf('a')).not.toBeNull());
    const newButton = editButtonOf('a') as HTMLButtonElement;
    expect(newButton).not.toBe(oldButton);
    expect(oldButton.isConnected).toBe(false);

    fireEvent.click(screen.getByText('取消'));
    expect(document.getElementById('user-edit-modal')).toBeNull();
    expect(document.activeElement).toBe(newButton);
  });

  it('F13：區間起迄輸入與身份、性別下拉都有 aria-label', async () => {
    await renderReady([makeUser('a')]);
    expect(screen.getByLabelText('加入區間（日） 起')).toBe(document.getElementById('admin-user-joined-min-days'));
    expect(screen.getByLabelText('加入區間（日） 迄')).toBe(document.getElementById('admin-user-joined-max-days'));
    expect(screen.getByLabelText('最後登入區間（日） 起')).toBe(document.getElementById('admin-user-login-min-days'));
    expect(screen.getByLabelText('最後登入區間（日） 迄')).toBe(document.getElementById('admin-user-login-max-days'));
    expect(screen.getByLabelText('身份')).toBe(document.getElementById('admin-user-role-filter'));
    expect(screen.getByLabelText('性別')).toBe(document.getElementById('admin-user-gender-filter'));
  });
});
