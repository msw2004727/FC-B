// 活動參與查詢與分享網址：四身分權限、網址進頁自動查、驗證、結果三數字、名單分頁、超過 50 場、讀取失敗。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => (await import('../ops-test-utils')).sdk);
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: {} }) }));
const state = vi.hoisted(() => ({
  viewer: null as unknown,
  lastUid: null as string | null,
  route: null as unknown,
  query: {} as Record<string, string>,
}));
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => state.lastUid }));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('preact-iso', () => ({ useLocation: () => ({ route: state.route, query: state.query }) }));
vi.mock('@/features/profile/data/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  return { createMinimalViewer: actual.createMinimalViewer, useViewer: () => state.viewer };
});

import { addTaipeiDays, formatTaipei } from '@/core/taipei-time';
import { setLocale } from '@/i18n/i18n';
import type { ViewerView } from '@/features/profile/data/viewer';
import { createPermissionChecker } from '@/features/profile/data/permissions';
import { calls, failures, FORBIDDEN_APIS, resetStore, sdk, totalReads } from '../ops-test-utils';
import OpsParticipantsPage from './OpsParticipantsPage';

const ASOF = formatTaipei(addTaipeiDays(Date.now(), -1), 'YYYY-MM-DD');
const ASOF_ID = ASOF.replace(/-/g, '');
const PREV_ID = formatTaipei(addTaipeiDays(Date.now(), -2), 'YYYY-MM-DD').replace(/-/g, '');

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
  // asOf 那天：1 場羽球 60 人（第 2 頁 10 人）＋1 場籃球；前一天：1 場羽球 2 人（U0、U1 重複）
  const uids = Array.from({ length: 60 }, (_, i) => `U${String(i).padStart(2, '0')}`);
  resetStore({
    opsParticipantDays: [
      { id: PREV_ID, data: { events: [{ docId: 'e0', id: 'e0', title: '週三羽球', checkedInUids: ['U00', 'U01'] }] } },
      {
        id: ASOF_ID,
        data: {
          events: [
            { docId: 'e1', id: 'e1', title: '週六羽球團', checkedInUids: uids },
            { docId: 'e2', id: 'e2', title: '籃球', checkedInUids: ['U99'] },
          ],
        },
      },
    ],
    users: uids.map((u) => ({ id: u, data: { displayName: `名${u}` } })),
  });
}

beforeAll(async () => {
  await setLocale('zh-TW');
});

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  state.lastUid = null;
  state.route = vi.fn();
  state.query = {};
});

afterEach(() => cleanup());

function shareQuery() {
  return { q: '羽球', from: formatTaipei(addTaipeiDays(Date.now(), -30), 'YYYY-MM-DD'), to: ASOF };
}

describe('權限（分享網址開啟者也要 admin.dashboard.entry）', () => {
  it.each([
    ['super_admin', viewer('super_admin')],
    ['admin＋admin.dashboard.entry', viewer('admin', { admin: ['admin.dashboard.entry'] })],
  ])('%s 開分享網址：自動查詢並顯示結果', async (_label, v) => {
    state.query = shareQuery();
    state.viewer = v;
    render(<OpsParticipantsPage />);
    await screen.findByText('符合活動');
    const nums = Array.from(document.querySelectorAll('.od-qsum .od-num')).map((n) => n.textContent);
    expect(nums).toEqual(['2', '60', '62']);
    await screen.findByText('名U00');
    // 索引 1 次 2 份＋當頁名稱 50 份（30＋20）
    expect(totalReads()).toBe(2 + 50);
    for (const name of FORBIDDEN_APIS) expect(sdk[name]).not.toHaveBeenCalled();
  });

  it.each([
    ['admin（預設）', viewer('admin')],
    ['user', viewer('user')],
  ])('%s 開分享網址：權限不足、0 讀', async (_label, v) => {
    state.query = shareQuery();
    state.viewer = v;
    render(<OpsParticipantsPage />);
    expect(screen.getByText('權限不足')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });

  it('沒登入開分享網址：權限不足、0 讀', async () => {
    state.query = shareQuery();
    state.viewer = { ...viewer('user'), uid: null, hasPermission: () => false };
    render(<OpsParticipantsPage />);
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe('查詢', () => {
  it('沒有網址條件：不自動查（0 讀），預設區間迄日＝asOf、上限＝asOf', async () => {
    state.viewer = viewer('super_admin');
    render(<OpsParticipantsPage />);
    const dates = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    expect(dates[1]!.value).toBe(ASOF);
    expect(dates.every((d) => d.max === ASOF)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });

  it('關鍵字空白：顯示錯誤、不讀', async () => {
    state.viewer = viewer('super_admin');
    render(<OpsParticipantsPage />);
    fireEvent.click(screen.getByRole('button', { name: '查詢' }));
    expect((await screen.findByRole('alert')).textContent).toBe('請輸入活動關鍵字');
    expect(calls).toHaveLength(0);
  });

  it('輸入後查詢：網址換成分享網址（只含關鍵字與日期）、名單分頁 50 人、第 2 頁才讀第 2 頁名稱、可複製網址', async () => {
    const replace = vi.spyOn(history, 'replaceState');
    state.viewer = viewer('super_admin');
    render(<OpsParticipantsPage />);
    fireEvent.input(document.querySelector('input[type="search"]')!, { target: { value: '羽球' } });
    fireEvent.click(screen.getByRole('button', { name: '查詢' }));
    await screen.findByText('名U00');
    const url = String(replace.mock.calls[replace.mock.calls.length - 1]?.[2]);
    expect(url).toMatch(/^\/admin\/ops\/participants\?q=%E7%BE%BD%E7%90%83&from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
    expect(document.querySelectorAll('.od-rank li')).toHaveLength(50);
    expect(screen.getByText('1/2')).toBeTruthy();
    // U00、U01 參加 2 次排最前
    expect(screen.getAllByText('2 次')).toHaveLength(2);
    const readsPage1 = totalReads();
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    await screen.findByText('名U59');
    expect(document.querySelectorAll('.od-rank li')).toHaveLength(10);
    expect(totalReads() - readsPage1).toBe(10);
    expect(screen.getByRole('button', { name: '複製網址' })).toBeTruthy();
    fireEvent.click(screen.getByText('名U59'));
    expect(state.route).toHaveBeenCalledWith('/profile/U59');
    replace.mockRestore();
  });

  it('索引被 Rules 擋：顯示讀取失敗（不顯示 0）', async () => {
    failures['opsParticipantDays'] = 'permission-denied';
    state.query = shareQuery();
    state.viewer = viewer('super_admin');
    render(<OpsParticipantsPage />);
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    expect(document.querySelector('.od-qsum')).toBeNull();
  });

  it('名稱讀取失敗：名單區顯示讀取失敗，三個數字仍在', async () => {
    failures['users'] = 'permission-denied';
    state.query = shareQuery();
    state.viewer = viewer('super_admin');
    render(<OpsParticipantsPage />);
    expect(await screen.findByText('讀取失敗')).toBeTruthy();
    expect(document.querySelectorAll('.od-qsum .od-num')).toHaveLength(3);
  });

  it('區間內沒有索引：查無資料', async () => {
    resetStore({ opsParticipantDays: [], users: [] });
    state.query = shareQuery();
    state.viewer = viewer('super_admin');
    render(<OpsParticipantsPage />);
    expect(await screen.findByText('查無資料')).toBeTruthy();
    await waitFor(() => expect(calls).toHaveLength(1));
  });
});
