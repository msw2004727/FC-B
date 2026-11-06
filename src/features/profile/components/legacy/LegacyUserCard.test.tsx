import { render as preactRender } from 'preact';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('../../data/profile-model', () => ({ loadUserProfile: vi.fn() }));
vi.mock('../../data/activity-records', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/activity-records')>();
  return {
    formatUserAttendanceSummaryTime: actual.formatUserAttendanceSummaryTime,
    loadUserStats: vi.fn(),
    getFilteredRecords: vi.fn(() => []),
    RECORDS_PAGE_SIZE: 10,
  };
});
vi.mock('../../data/attendance-summary', () => ({
  loadUserAttendanceSummary: vi.fn(),
}));
vi.mock('../../data/viewer', () => ({ useViewer: vi.fn() }));
vi.mock('@/data/identity-settings', () => ({ useIdentitySettings: vi.fn(() => null) }));
const routeMock = vi.hoisted(() => vi.fn());
vi.mock('preact-iso', async (importOriginal) => ({
  ...(await importOriginal<typeof import('preact-iso')>()),
  useLocation: () => ({ route: routeMock }),
}));
vi.mock('@/features/inbox/components/pm-dialog-store', () => ({ openPmDialog: vi.fn() }));
vi.mock('@/core/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/events')>()),
  emit: vi.fn(),
}));
vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn(async () => ({ db: {} })) }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  getDocs: vi.fn(),
}));

import { getDocs } from 'firebase/firestore';

import { emit } from '@/core/events';
import { openPmDialog } from '@/features/inbox/components/pm-dialog-store';
import { toast } from '@/ui/Toast';

import { loadUserStats, getFilteredRecords } from '../../data/activity-records';
import { loadUserAttendanceSummary } from '../../data/attendance-summary';
import { loadUserProfile, type UserProfile } from '../../data/profile-model';
import { _resetPublicProfileCacheForTest } from '../../data/public-profile-cache';
import { useViewer, type ViewerView } from '../../data/viewer';

import { LegacyUserCard } from './LegacyUserCard';

const TARGET = `U${'a'.repeat(32)}`;
const VIEWER = `U${'b'.repeat(32)}`;

function makeViewer(overrides: Partial<ViewerView> = {}): ViewerView {
  return {
    uid: VIEWER,
    role: 'user',
    displayName: 'viewer',
    pictureUrl: null,
    capabilities: [],
    hasPermission: () => false,
    ...overrides,
  } as unknown as ViewerView;
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: TARGET,
    name: 'Bob',
    _docId: TARGET,
    lastActive: null,
    displayName: 'Bob',
    phone: '0912345678',
    gender: '男',
    birthday: '1990-01-01',
    region: '台北市',
    sports: '籃球',
    createdAt: null,
    role: 'user',
    pictureUrl: 'https://example.com/bob.jpg',
    ...overrides,
  };
}

function summaryOf(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    uid,
    exists: true,
    sourceVersion: 1,
    expectedCount: 5,
    attendedCount: 4,
    completedCount: 4,
    attendRate: 80,
    updatedAt: null,
    ...overrides,
  };
}

function cssColor(hex: string): string {
  const probe = document.createElement('span');
  probe.style.color = hex;
  return probe.style.color;
}

const toggleOf = (c: Element): HTMLButtonElement =>
  c.querySelector('#uc-records-toggle') as HTMLButtonElement;

describe('LegacyUserCard（11-06 名片型）', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    vi.clearAllMocks();
    _resetPublicProfileCacheForTest();
    vi.mocked(loadUserProfile).mockResolvedValue(makeProfile());
    vi.mocked(loadUserStats).mockImplementation(async (uid: string) => ({
      uid,
      activityRecords: [],
      attendanceRecords: [],
    }));
    vi.mocked(loadUserAttendanceSummary).mockImplementation(async (uid: string) => summaryOf(uid));
    vi.mocked(getFilteredRecords).mockReturnValue([]);
    vi.mocked(useViewer).mockReturnValue(makeViewer());
  });

  afterEach(() => {
    cleanup();
  });

  async function renderCard(uid = TARGET) {
    const r = render(<LegacyUserCard uid={uid} />);
    await waitFor(() => expect(r.container.querySelector('.pp-hd')).toBeTruthy());
    return r;
  }

  it('版面順序：頭部 → 動作鈕 → 分隔線 → 三格統計 → 資料 → 活動明細 → 分享名片；徽章格已移除', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(
      makeProfile({ socialLinks: { fb: 'bob.fb' } }),
    );
    const { container } = await renderCard();
    const order = [
      '.pp-hd',
      '.pp-acts',
      '.pp-social',
      '.pp-sep',
      '.pp-stats',
      '.pp-h',
      '.pp-rows',
      '#uc-records-toggle',
      '#uc-records-panel',
      '.pp-share',
    ].map((sel) => container.querySelector(sel));
    order.forEach((el) => expect(el).toBeTruthy());
    for (let i = 1; i < order.length; i++) {
      const prev = order[i - 1] as Element;
      const cur = order[i] as Element;
      // eslint-disable-next-line no-bitwise
      expect(prev.compareDocumentPosition(cur) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const labels = Array.from(container.querySelectorAll('.pp-row > span:first-child')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['性別', '生日', '地區', '運動類別', '所屬俱樂部', '加入時間']);
    expect(container.textContent).not.toContain('徽章');
    expect(container.querySelector('.uc-blur-overlay')).toBeNull();
    expect(container.textContent).toContain('分享名片');
  });

  it('三格統計開頁自動讀 1 次（應到／完成／出席率），明細不讀', async () => {
    vi.mocked(loadUserAttendanceSummary).mockResolvedValue(
      summaryOf(TARGET, { expectedCount: 26, attendedCount: 22, completedCount: 14, attendRate: 85 }),
    );
    const { container } = await renderCard();
    await waitFor(() => expect(container.querySelector('#uc-stat-total')?.textContent).toBe('26'));
    expect(container.querySelector('#uc-stat-done')?.textContent).toBe('14');
    expect(container.querySelector('#uc-stat-rate')?.textContent).toBe('85%');
    expect(loadUserAttendanceSummary).toHaveBeenCalledTimes(1);
    expect(loadUserAttendanceSummary).toHaveBeenCalledWith(TARGET, {});
    expect(loadUserStats).not.toHaveBeenCalled();
    // 明細收合時先顯示應到場次
    expect(container.querySelector('.pp-cnt')?.textContent).toBe('26');
    expect(toggleOf(container).getAttribute('aria-expanded')).toBe('false');
    expect((container.querySelector('#uc-records-panel') as HTMLElement).hidden).toBe(true);
  });

  it('活動明細點開才讀 loadUserStats；收合再展開不重讀；清單以公開模式過濾', async () => {
    const { container } = await renderCard();
    expect(loadUserStats).not.toHaveBeenCalled();
    fireEvent.click(toggleOf(container));
    await waitFor(() => expect(loadUserStats).toHaveBeenCalledWith(TARGET));
    expect(toggleOf(container).getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(getFilteredRecords).toHaveBeenCalled());
    for (const call of vi.mocked(getFilteredRecords).mock.calls) expect(call[2]).toBe(true);

    fireEvent.click(toggleOf(container));
    fireEvent.click(toggleOf(container));
    expect(loadUserStats).toHaveBeenCalledTimes(1);

    // 頁籤：預設「全部」，切換到「取消」
    const allTab = container.querySelector('#uc-record-tabs [data-filter="all"]');
    expect(allTab?.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(container.querySelector('#uc-record-tabs [data-filter="cancelled"]') as Element);
    await waitFor(() =>
      expect(vi.mocked(getFilteredRecords)).toHaveBeenCalledWith(expect.anything(), 'cancelled', true),
    );
  });

  it('快取：同一工作階段同一 uid 重開名片不重讀三格統計與明細；重新整理鈕強制重讀', async () => {
    const first = await renderCard();
    await waitFor(() => expect(first.container.querySelector('#uc-stat-total')?.textContent).toBe('5'));
    fireEvent.click(toggleOf(first.container));
    await waitFor(() => expect(loadUserStats).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = await renderCard();
    await waitFor(() => expect(second.container.querySelector('#uc-stat-total')?.textContent).toBe('5'));
    fireEvent.click(toggleOf(second.container));
    await waitFor(() =>
      expect(second.container.querySelector('#uc-activity-records .pp-loading')).toBeNull(),
    );
    expect(loadUserAttendanceSummary).toHaveBeenCalledTimes(1);
    expect(loadUserStats).toHaveBeenCalledTimes(1);

    vi.mocked(loadUserAttendanceSummary).mockResolvedValue(summaryOf(TARGET, { expectedCount: 9 }));
    fireEvent.click(second.container.querySelector('#uc-records-refresh') as Element);
    await waitFor(() => expect(loadUserStats).toHaveBeenCalledTimes(2));
    expect(loadUserAttendanceSummary).toHaveBeenLastCalledWith(TARGET, { fresh: true });
    await waitFor(() => expect(second.container.querySelector('#uc-stat-total')?.textContent).toBe('9'));
  });

  it('私訊：他人且為合法 LINE UID 時顯示（主色），點了呼叫 openPmDialog({uid,name,pictureUrl})', async () => {
    const { container } = await renderCard();
    const pm = container.querySelector('[data-action="pm"]') as HTMLButtonElement;
    expect(pm).toBeTruthy();
    expect(pm.classList.contains('pp-pri')).toBe(true);
    fireEvent.click(pm);
    expect(openPmDialog).toHaveBeenCalledWith({
      uid: TARGET,
      name: 'Bob',
      pictureUrl: 'https://example.com/bob.jpg',
    });
  });

  it('私訊：對方不是合法 LINE UID 時不顯示（加好友、關注仍在）', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(makeProfile({ uid: 'doc-uid', _docId: 'doc-uid' }));
    const { container } = await renderCard('doc-uid');
    expect(container.querySelector('[data-action="pm"]')).toBeNull();
    expect(container.querySelector('[data-action="friend"]')).toBeTruthy();
    expect(container.querySelector('[data-action="follow"]')).toBeTruthy();
  });

  it('私訊：未登入時按私訊改導登入，不開私訊', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: null as unknown as string }));
    const { container } = await renderCard();
    vi.mocked(emit).mockClear();
    fireEvent.click(container.querySelector('[data-action="pm"]') as Element);
    expect(emit).toHaveBeenCalledWith('auth:login-request', {});
    expect(openPmDialog).not.toHaveBeenCalled();
  });

  it('加好友、關注：顯示「功能尚未開放」（照 A）', async () => {
    const { container } = await renderCard();
    fireEvent.click(container.querySelector('[data-action="friend"]') as Element);
    fireEvent.click(container.querySelector('[data-action="follow"]') as Element);
    expect(vi.mocked(toast.show).mock.calls).toEqual([
      [{ message: '功能尚未開放' }],
      [{ message: '功能尚未開放' }],
    ]);
  });

  it('本人看自己：沒有動作列（無私訊），有聯繫方式', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: TARGET }));
    const { container } = await renderCard();
    expect(container.querySelector('.pp-acts')).toBeNull();
    expect(container.querySelector('[data-action="pm"]')).toBeNull();
    expect(container.textContent).toContain('聯繫方式');
    expect(container.textContent).toContain('0912345678');
  });

  it('一般登入者看他人 → 沒有聯繫方式；全域管理員看他人 → 有', async () => {
    const r1 = await renderCard();
    expect(r1.container.textContent).not.toContain('聯繫方式');
    expect(r1.container.textContent).not.toContain('0912345678');
    r1.unmount();

    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: 'admin-uid', role: 'admin' }));
    const r2 = await renderCard();
    expect(r2.container.textContent).toContain('聯繫方式');
    expect(r2.container.textContent).toContain('0912345678');
  });

  it.each([
    ['user', '一般用戶', '#6b7280'],
    ['coach', '教練', '#0d9488'],
    ['captain', '領隊', '#7c3aed'],
    ['team_leader', '一般用戶', '#6b7280'],
    ['venue_owner', '場主', '#d97706'],
    ['admin', '管理員', '#2563eb'],
    ['super_admin', '總管', '#dc2626'],
  ])('身分標籤照 A ROLES：%s → %s', async (role, label, color) => {
    vi.mocked(loadUserProfile).mockResolvedValue(makeProfile({ role }));
    const { container } = await renderCard();
    const tag = container.querySelector('.pp-role') as HTMLElement;
    expect(tag.textContent).toBe(label);
    expect(tag.style.color).toBe(cssColor(color));
  });

  it('身分標籤直接看讀到的文件：網址 uid 與 _docId 不同時仍顯示 profile 的實際角色；隱身管理員顯示一般用戶', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(
      makeProfile({ uid: 'doc-uid', _docId: 'doc-uid', role: 'coach' }),
    );
    const r1 = await renderCard('line-user-id');
    expect(r1.container.querySelector('.pp-role')?.textContent).toBe('教練');
    r1.unmount();

    vi.mocked(loadUserProfile).mockResolvedValue(makeProfile({ role: 'admin', stealth: true }));
    const r2 = await renderCard();
    expect(r2.container.querySelector('.pp-role')?.textContent).toBe('一般用戶');
  });

  it('自訂角色：照 A 顯示自訂名稱與顏色（讀 customRoles 一次）；查不到退回一般用戶', async () => {
    vi.mocked(getDocs).mockResolvedValue({
      docs: [{ id: 'r1', data: () => ({ key: 'vip', label: '貴賓', color: '#123456' }) }],
    } as never);
    vi.mocked(loadUserProfile).mockResolvedValue(makeProfile({ role: 'vip' }));
    const r1 = await renderCard();
    await waitFor(() => expect(r1.container.querySelector('.pp-role')?.textContent).toBe('貴賓'));
    expect((r1.container.querySelector('.pp-role') as HTMLElement).style.color).toBe(cssColor('#123456'));
    r1.unmount();

    vi.mocked(loadUserProfile).mockResolvedValue(makeProfile({ role: 'ghost' }));
    const r2 = await renderCard();
    await waitFor(() => expect(r2.container.querySelector('.pp-role')?.textContent).toBe('一般用戶'));
    expect(getDocs).toHaveBeenCalledTimes(1);
  });

  it('自訂角色色碼不是 #hex 時退回 #6366f1', async () => {
    vi.mocked(getDocs).mockResolvedValue({
      docs: [{ id: 'r1', data: () => ({ key: 'vip', label: '貴賓', color: 'red;background:url(x)' }) }],
    } as never);
    vi.mocked(loadUserProfile).mockResolvedValue(makeProfile({ role: 'vip' }));
    const { container } = await renderCard();
    await waitFor(() => expect(container.querySelector('.pp-role')?.textContent).toBe('貴賓'));
    const tag = container.querySelector('.pp-role') as HTMLElement;
    expect(tag.style.color).toBe(cssColor('#6366f1'));
    expect(tag.getAttribute('style')).not.toContain('url');
  });

  it('未登入：對方是自訂角色也不讀 customRoles', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: null as unknown as string }));
    vi.mocked(loadUserProfile).mockResolvedValue(makeProfile({ role: 'vip' }));
    const { container } = await renderCard();
    await new Promise((r) => setTimeout(r, 30));
    expect(getDocs).not.toHaveBeenCalled();
    expect(container.querySelector('.pp-role')?.textContent).toBe('一般用戶');
  });

  it('活動明細載入失敗：toast＋明細區顯示錯誤與重試（不卡載入中），按重試可讀到', async () => {
    vi.mocked(loadUserStats).mockRejectedValueOnce(new Error('network'));
    const { container } = await renderCard();
    fireEvent.click(toggleOf(container));
    await waitFor(() =>
      expect(vi.mocked(toast.show)).toHaveBeenCalledWith({ message: '活動紀錄刷新失敗' }),
    );
    await waitFor(() => expect(container.querySelector('#uc-activity-records .pp-retry')).toBeTruthy());
    expect(container.querySelector('#uc-activity-records')?.textContent).not.toContain('載入中');
    fireEvent.click(container.querySelector('#uc-activity-records .pp-retry') as Element);
    await waitFor(() => expect(loadUserStats).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.querySelector('#uc-activity-records .pp-loading')).toBeNull());
  });

  it('網址 uid 與登入者不同、但讀到的文件就是自己：不顯示動作列（不能私訊自己）', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer({ uid: TARGET }));
    const { container } = await renderCard('line-user-id');
    expect(container.querySelector('.pp-acts')).toBeNull();
    expect(container.querySelector('[data-action="pm"]')).toBeNull();
  });

  it('「活動明細 N」固定用應到場次，展開後也不變', async () => {
    vi.mocked(getFilteredRecords).mockReturnValue([
      { _docId: 'a', name: 'x', status: 'completed', _displayStatus: 'completed' },
    ]);
    const { container } = await renderCard();
    await waitFor(() => expect(container.querySelector('.pp-cnt')?.textContent).toBe('5'));
    fireEvent.click(toggleOf(container));
    await waitFor(() => expect(container.querySelector('#uc-activity-records .mini-activity')).toBeTruthy());
    expect(container.querySelector('.pp-cnt')?.textContent).toBe('5');
  });

  it('社群連結：只列合法的（不合法的不列）', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(
      makeProfile({ socialLinks: { fb: 'bob.fb', ig: 'javascript:alert(1)', yt: 'https://user:pw@evil.example/x' } }),
    );
    const { container } = await renderCard();
    const links = Array.from(container.querySelectorAll('.pp-social a')) as HTMLAnchorElement[];
    expect(links.map((a) => a.dataset['platform'])).toEqual(['fb']);
    expect(links[0]?.getAttribute('href')?.startsWith('https://')).toBe(true);
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('所屬俱樂部：點了導到 /teams/{id}', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(
      makeProfile({ teamIds: ['tm_1 2'], teamNames: ['台中隊'] }),
    );
    const { container } = await renderCard();
    const club = container.querySelector('.pp-club') as HTMLButtonElement;
    expect(club.textContent).toContain('台中隊');
    fireEvent.click(club);
    expect(routeMock).toHaveBeenCalledWith('/teams/tm_1%202');
  });

  it('同一元件換看另一個人：前一人還在飛的統計延後完成，不可寫進新的名片', async () => {
    const uidA = `U${'1'.repeat(32)}`;
    const uidB = `U${'2'.repeat(32)}`;
    vi.mocked(loadUserProfile).mockImplementation(async (uid: string) =>
      makeProfile({ uid, _docId: uid, name: uid, displayName: uid }),
    );
    let resolveA: (v: ReturnType<typeof summaryOf>) => void = () => {};
    vi.mocked(loadUserAttendanceSummary).mockImplementation((uid: string) =>
      uid === uidA
        ? new Promise((resolve) => {
          resolveA = resolve as typeof resolveA;
        })
        : Promise.resolve(summaryOf(uid, { expectedCount: 5 })),
    );

    const { container, rerender } = render(<LegacyUserCard uid={uidA} />);
    await waitFor(() => expect(loadUserAttendanceSummary).toHaveBeenCalledWith(uidA, {}));

    rerender(<LegacyUserCard uid={uidB} />);
    await waitFor(() => expect(container.querySelector('#uc-stat-total')?.textContent).toBe('5'));

    resolveA(summaryOf(uidA, { expectedCount: 99 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('#uc-stat-total')?.textContent).toBe('5');
  });

  it('T-048 F8：同一實例換看另一個人的第一次 render（effect 清狀態之前）就不顯示前一人的資料', async () => {
    let resolveB: (p: UserProfile | null) => void = () => {};
    vi.mocked(loadUserProfile).mockImplementation((uid: string) =>
      uid === 'uid-a'
        ? Promise.resolve(makeProfile({ uid, _docId: uid, name: 'Alice', displayName: 'Alice' }))
        : new Promise<UserProfile | null>((resolve) => {
          resolveB = resolve;
        }),
    );

    // 直接用 preact render（不包 act）：effect 在繪製後才跑，render() 回來時的 DOM 就是換 uid 的第一次 render。
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      preactRender(<LegacyUserCard uid="uid-a" />, container);
      await waitFor(() => expect(container.textContent).toContain('Alice'));

      preactRender(<LegacyUserCard uid="uid-b" />, container);
      expect(container.textContent).not.toContain('Alice');
      expect(container.textContent).toContain('載入中...');

      await waitFor(() => expect(loadUserProfile).toHaveBeenCalledWith('uid-b'));
      resolveB(makeProfile({ uid: 'uid-b', _docId: 'uid-b', name: 'Bob2', displayName: 'Bob2' }));
      await waitFor(() => expect(container.textContent).toContain('Bob2'));
    } finally {
      preactRender(null, container);
      container.remove();
    }
  });

  it('profile.uid 與請求的 uid 不同（以 lineUserId／doc id 後備查詢到）仍正常顯示，統計用讀到的 uid', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(
      makeProfile({ uid: 'doc-uid', _docId: 'doc-uid', name: 'Carol', displayName: 'Carol' }),
    );
    const { container } = render(<LegacyUserCard uid="line-user-id" />);
    await waitFor(() => expect(container.textContent).toContain('Carol'));
    await waitFor(() => expect(loadUserAttendanceSummary).toHaveBeenCalledWith('doc-uid', {}));
  });

  it('對方 secondaryEnabled=true 時一般登入者仍看得到名片（不整張隱藏）', async () => {
    vi.mocked(loadUserProfile).mockResolvedValue(
      makeProfile({ secondaryEnabled: true, secondaryIdentityEnabled: true }),
    );
    const { container } = await renderCard();
    expect(container.textContent).toContain('Bob');
    expect(container.querySelector('.pp-rows')).toBeTruthy();
  });
});
