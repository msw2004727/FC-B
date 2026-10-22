import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { LoadedEventDetail } from '../data/event-detail';
import type { DetailRegistration } from '../data/detail-model';
import type { SettleAttendanceInput, SettleAttendanceResult } from '../data/attendance-settle';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  registrations: vi.fn(),
  attendance: vi.fn(),
  history: vi.fn(),
  register: vi.fn(),
  cancel: vi.fn(),
  signIn: vi.fn(),
  viewer: vi.fn(),
  companions: vi.fn(),
  toastShow: vi.fn(),
  settleAttendance: vi.fn<(input: SettleAttendanceInput) => Promise<SettleAttendanceResult>>(),
  writeAttendanceOps: vi.fn(),
}));

vi.mock('@/features/events/data/attendance-settle', () => ({
  settleAttendance: mocks.settleAttendance,
}));

vi.mock('@/features/events/data/attendance-edit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/attendance-edit')>()),
  writeAttendanceOps: mocks.writeAttendanceOps,
}));

vi.mock('@/data/user-roles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/user-roles')>()),
  useUserRoles: () => ({}),
}));

const ZH_DICT: Record<string, string> = {
  'events.pageTitle': '活動列表',
  'events.retry': '重試',
  'events.card.untitled': '未命名活動',
  'events.detailPage.loading': '活動資料載入中...',
  'events.detailPage.loadError': '無法載入活動詳情，請重試。',
  'events.detailPage.notFound': '找不到此活動',
  'events.detailPage.unnamed': '未命名使用者',
  'events.detailPage.confirmed': '正取名單',
  'events.detailPage.waitlisted': '候補名單',
  'events.detailPage.emptyRoster': '尚無參加者',
  'events.detailPage.roster': '參加名單',
  'events.detailPage.rosterLoading': '參加名單載入中…',
  'events.detailPage.rosterError': '無法載入參加名單，請重試。',
  'events.detailPage.historyError': '無法同步你的報名狀態，請重試後再報名。',
  'events.detailPage.refreshError': '無法更新名單，請重試。',
  'events.detailPage.actionError': '操作失敗，請稍後再試。',
  'events.detailPage.selectSomeone': '請至少選擇一位參加者',
  'events.detailPage.signupSuccess': '報名成功',
  'events.detailPage.cancelSuccess': '已取消報名',
  'events.detailPage.cancelTitle': '取消報名',
  'events.detailPage.chooseParticipants': '選擇參加人員',
  'events.detailPage.confirmCancel': '確認取消',
  'events.detailPage.confirmSignup': '確認報名',
  'events.detailPage.cancelHint': '請勾選要取消的人員',
  'events.detailPage.self': '(本人)',
  'events.detailPage.registered': '(已報名)',
  'events.detailPage.noCompanions': '尚無同行者資料',
  'events.detailPage.selected': '已選 {count} 人',
  'events.detailPage.totalFee': '總費用 NT${fee}',
  'events.detailPage.remaining': '剩餘名額 {count} 人',
  'events.detailPage.waitlistEstimate': '預計候補 {count} 人',
  'events.detailPage.button.ended': '已結束',
  'events.detailPage.button.cancelWaitlist': '取消候補',
  'events.detailPage.button.cancel': '取消報名',
  'events.detailPage.button.notOpen': '報名尚未開放',
  'events.detailPage.button.teamOnly': '球隊限定',
  'events.detailPage.button.restricted': '性別限定',
  'events.detailPage.button.waitlist': '報名候補',
  'events.detailPage.button.signup': '立即報名',
  'events.roster.title': '正取名單 ({count}/{max})',
  'events.roster.checkin': '簽到',
  'events.roster.checkout': '簽退',
  'events.roster.note': '備註',
  'events.roster.empty': '尚無正取名單',
  'events.roster.manage': '管理名單',
  'events.roster.noPermission': '權限不足',
  'events.roster.settleSuccess': '儲存完成',
  'events.roster.settleFailed': '儲存失敗，勾選已保留\n請再按一次「完成」重試',
  'events.roster.expGrantFailed': '有 {count} 人經驗值未發放，請聯繫管理員',
  'events.signup.error.profileIncomplete': '請先完成個人資料',
};

function translateKey(key: string, params?: Record<string, string | number>): string {
  const tpl = ZH_DICT[key] ?? key;
  if (!params) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
}

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => translateKey,
}));

vi.mock('@/ui/Toast', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/ui/Toast')>();
  return {
    ...original,
    toast: {
      ...original.toast,
      show: mocks.toastShow,
    },
  };
});

vi.mock('@/features/events/data/event-detail', () => ({
  loadEventDetail: mocks.detail,
  loadEventRegistrations: mocks.registrations,
}));
vi.mock('@/features/checkin/data/attendance', () => ({
  loadEventAttendance: mocks.attendance,
}));
vi.mock('@/features/events/data/viewer-registrations', () => ({
  loadViewerRegistrations: mocks.history,
}));
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: mocks.viewer }));
vi.mock('@/features/events/data/companions', () => ({
  loadSignupCompanions: mocks.companions,
}));
vi.mock('@/data/auth', () => ({ signIn: mocks.signIn }));
vi.mock('@/features/events/data/signup', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/signup')>();
  return { ...original, registerForEvent: mocks.register, cancelRegistration: mocks.cancel };
});

import EventDetailPage from './EventDetailPage';
import { setLocale } from '@/i18n/i18n';

const viewer: ViewerView = {
  uid: 'u1',
  displayName: '小明',
  pictureUrl: null,
  role: 'user',
  roleLevel: 0,
  teamIds: new Set(),
  capabilities: [],
  hasPermission: () => false,
};

const detail: LoadedEventDetail = {
  eventDocId: 'firestore-doc-a',
  event: {
    id: 'ce_123_abc',
    title: '青埔五人制',
    date: '2099/10/19 18:30~21:00',
    location: '青埔籃足球共用球場',
    creatorUid: 'host1',
    creator: 'Neo',
    status: 'open',
  },
};

const self: DetailRegistration = {
  _docId: 'registration-self',
  eventId: 'ce_123_abc',
  userId: 'u1',
  userName: '小明',
  participantType: 'self',
  status: 'confirmed',
};

function mount(): ReturnType<typeof render> {
  return render(<LocationProvider><EventDetailPage id="ce_123_abc" /></LocationProvider>);
}

beforeEach(async () => {
  vi.resetAllMocks();
  await setLocale('zh-TW');
  history.replaceState(null, '', '/events/ce_123_abc');
  mocks.viewer.mockReturnValue(viewer);
  mocks.detail.mockResolvedValue(detail);
  mocks.registrations.mockResolvedValue([]);
  mocks.attendance.mockResolvedValue([]);
  mocks.history.mockResolvedValue([]);
  mocks.companions.mockResolvedValue([]);
  mocks.register.mockResolvedValue({ deduplicated: false });
  mocks.cancel.mockResolvedValue({ deduplicated: false });
  mocks.signIn.mockResolvedValue({ uid: 'u1' });
});

afterEach(() => {
  cleanup();
});

describe('EventDetailPage 3b-3（M-086／M-087）', () => {
  it('登入者名單區塊順序照 A：正取 → 未報名單 → 候補', async () => {
    mocks.detail.mockResolvedValue({
      ...detail,
      event: { ...detail.event, current: 1, max: 10, waitlist: 1 },
    });
    const view = mount();
    await screen.findByRole('heading', { level: 2 });

    const ids = Array.from(
      view.container.querySelectorAll(
        '#detail-attendance-table, #detail-unreg-section, #detail-waitlist-container',
      ),
    ).map((el) => (el as HTMLElement).id);
    expect(ids).toEqual([
      'detail-attendance-table',
      'detail-unreg-section',
      'detail-waitlist-container',
    ]);
    expect((view.container.querySelector('#detail-unreg-section') as HTMLElement).style.display)
      .toBe('none');
  });

  it('訪客先看 A 摘要卡（候補區直接顯示），按下才展開正取膠囊，不讀 registrations', async () => {
    mocks.viewer.mockReturnValue({ ...viewer, uid: null });
    mocks.detail.mockResolvedValue({
      ...detail,
      event: {
        ...detail.event,
        isPublic: true,
        current: 3,
        max: 10,
        waitlist: 1,
        participantsWithUid: [{ uid: 'public-user', name: '公開正取' }],
        waitlistWithUid: [{ uid: 'wait-user', name: '公開候補' }],
        waitlistNames: ['公開候補'],
      } as LoadedEventDetail['event'],
    });

    const view = mount();
    await screen.findByRole('heading', { level: 2 });

    const summary = view.container.querySelector('.detail-attendance-summary');
    expect(summary?.textContent).toContain('出席名單');
    expect(summary?.textContent).toContain('3/10');
    expect(summary?.textContent).toContain('候補 1');
    // 照 A：正取只出摘要卡，候補區進頁即顯示（_renderGuestWaitlistSection 無 on-demand 判斷）。
    expect(view.container.querySelectorAll('#detail-attendance-table .user-capsule.uc-user').length).toBe(0);
    expect(view.container.querySelectorAll('#detail-waitlist-container .user-capsule.uc-user').length).toBe(1);
    expect(mocks.registrations).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
    await waitFor(() => {
      // 主辦列也是 user-capsule，只數名單區。
      expect(view.container.querySelectorAll('#detail-attendance-table .user-capsule.uc-user').length).toBe(1);
      expect(view.container.querySelectorAll('#detail-waitlist-container .user-capsule.uc-user').length).toBe(1);
    });
    expect(view.container.querySelector('#detail-waitlist-container .detail-section-title')?.textContent)
      .toBe('候補名單 (1)');
    expect(mocks.registrations).not.toHaveBeenCalled();

    const ids = Array.from(
      view.container.querySelectorAll(
        '#detail-attendance-table, #detail-unreg-section, #detail-waitlist-container',
      ),
    ).map((el) => (el as HTMLElement).id);
    expect(ids).toEqual([
      'detail-attendance-table',
      'detail-unreg-section',
      'detail-waitlist-container',
    ]);
    expect((view.container.querySelector('#detail-unreg-section') as HTMLElement).style.display)
      .toBe('none');
  });

  it('訪客展開後無名單顯示尚無報名，且候補區不出', async () => {
    mocks.viewer.mockReturnValue({ ...viewer, uid: null });
    mocks.detail.mockResolvedValue({
      ...detail,
      event: {
        ...detail.event,
        isPublic: true,
        current: 0,
        max: 10,
        participantsWithUid: [],
        participants: [],
        waitlistWithUid: [],
        waitlistNames: [],
      } as LoadedEventDetail['event'],
    });

    const view = mount();
    await screen.findByRole('heading', { level: 2 });
    fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
    await screen.findByText('尚無報名');
    expect(view.container.querySelector('#detail-waitlist-container')?.children.length).toBe(0);
  });
});
