import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
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
  signupProfile: vi.fn(),
  confirm: vi.fn(),
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
  getCachedUserLevel: () => 0,
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
vi.mock('@/features/events/data/signup-profile', () => ({
  loadSignupProfile: mocks.signupProfile,
}));
vi.mock('@/ui/AppConfirm', async (o) => ({
  ...(await o<typeof import('@/ui/AppConfirm')>()),
  appConfirm: mocks.confirm,
}));
vi.mock('@/features/events/data/line-notify-bind', () => ({
  shouldShowLineNotifyPrompt: async () => false,
  bindLineNotify: vi.fn(),
  dismissLineNotifyPrompt: vi.fn(),
}));
// 測試同步更新：照 A（M-084），此既有頁面測試隔離 context 的額外讀取。
// 真實 context 的讀取及限制由 signup-context.test.ts 驗證。
vi.mock('@/features/events/data/signup-context', async (o) => ({
  ...(await o<typeof import('../data/signup-context')>()),
  createDetailSignupContexts: (deps: {
    getViewer: () => ViewerView | null;
    generation: number;
  }) => ({
    signup: {
      getAuth: () => ({ uid: deps.getViewer()?.uid ?? null, generation: deps.generation }),
      load: async (eventId: string) => ({
        event: { id: eventId, status: 'open' },
        viewer: deps.getViewer(),
        registrations: [],
        profileComplete: true,
        participantCheck: { ok: true },
        earlyBirdWindow: false,
        teamSignupAllowed: true,
        requiresTeamSelection: false,
      }),
    },
    cancel: {
      getAuth: () => ({ uid: deps.getViewer()?.uid ?? null, generation: deps.generation }),
      load: async (eventId: string) => ({ event: { id: eventId, status: 'open' } }),
    },
  }),
}));
vi.mock('@/data/auth', () => ({ signIn: mocks.signIn, getLastKnownAuthUid: () => undefined }));
vi.mock('@/features/events/data/signup', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/signup')>();
  return { ...original, registerForEvent: mocks.register, cancelRegistration: mocks.cancel };
});

import EventDetailPage from './EventDetailPage';
import { setLocale } from '@/i18n/i18n';
import { SignupError } from '../data/signup';

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
  // 測試同步更新：照 A（M-084／M-083）。
  mocks.signupProfile.mockResolvedValue({
    gender: '女', birthday: '2000/01/01', exp: 100, lineNotifyBound: true,
  });
  mocks.confirm.mockResolvedValue(true);
  mocks.register.mockResolvedValue({
    deduplicated: false, confirmed: 1, registrations: [{ participantType: 'self', status: 'confirmed' }],
  });
  mocks.cancel.mockResolvedValue({ deduplicated: false, event: { current: 0, max: 0 } });
  mocks.signIn.mockResolvedValue({ uid: 'u1' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EventDetailPage', () => {
  it('輸出舊版 A 的主要 DOM 結構、id、class 與資訊格欄位文字（含熱度欄）', async () => {
    mocks.detail.mockResolvedValue({
      ...detail,
      event: {
        ...detail.event,
        current: 8,
        max: 10,
        waitlist: 1,
        fee: 150,
        feeEnabled: true,
        minAge: 18,
        genderRestrictionEnabled: true,
        allowedGender: '女',
        regOpenTime: '2026-01-01T12:00:00+08:00',
        delegates: [{ uid: 'del1', name: '小幫手' }],
        contact: 'LINE: @sporthub',
        teamOnly: true,
        isPublic: true,
        creatorTeamName: '閃電隊',
        privateEvent: false,
      } as LoadedEventDetail['event'],
    });

    const view = mount();
    await screen.findByRole('heading', { level: 2 });

    expect(view.container.querySelector('.legacy-ui #page-activity-detail.page.active')).toBeTruthy();
    expect(view.container.querySelector('#detail-title')?.textContent).toContain('青埔五人制');
    expect(view.container.querySelector('#detail-view-count-num')?.textContent).toBe('0');
    expect(view.container.querySelector('#detail-img-placeholder.td-img-placeholder')).toBeTruthy();
    expect(view.container.querySelector('#detail-body.detail-body')).toBeTruthy();
    expect(view.container.querySelector('#detail-action-primary.detail-action-primary')).toBeTruthy();
    expect(view.container.querySelector('#detail-attendance-table')).toBeTruthy();
    expect(view.container.querySelector('#detail-waitlist-container')).toBeTruthy();
    expect(view.container.querySelector('#detail-comments-container')).toBeTruthy();

    expect(view.container.querySelector('[data-detail-field="location"]')?.textContent)
      .toContain('地點青埔籃足球共用球場 📍');
    expect(view.container.querySelector('[data-detail-field="date"]')?.textContent)
      .toContain('時間2099/10/19 18:30~21:00');
    expect(view.container.querySelector('[data-detail-field="registration-open"]')?.textContent)
      .toContain('開放報名');
    expect(view.container.querySelector('[data-detail-field="fee"]')?.textContent)
      .toBe('費用NT$150');
    expect(view.container.querySelector('[data-detail-field="capacity-count"]')?.textContent)
      .toBe('人數已報 8/10 候補 1');
    expect(view.container.querySelector('[data-detail-field="countdown"]')?.textContent)
      .toContain('倒數');
    expect(view.container.querySelector('[data-detail-field="age-limit"]')?.textContent)
      .toBe('年齡18 歲以上');
    expect(view.container.querySelector('[data-detail-field="gender-limit"]')?.textContent)
      .toBe('性別限女生');
    const heatEl = view.container.querySelector('[data-detail-field="heat"]');
    expect(heatEl?.textContent).toBe('熱度高人氣即將額滿');
    expect(heatEl?.querySelector('span:last-child')?.getAttribute('style')).toContain('rgb(220, 38, 38)'); // jsdom 把 A 的 #dc2626 轉成 rgb
    expect(view.container.querySelector('[data-detail-field="delegates"]')?.textContent)
      .toContain('小幫手');
    expect(view.container.querySelector('[data-detail-field="contact"]')?.textContent)
      .toBe('聯繫LINE: @sporthub');
    expect(view.container.querySelector('[data-detail-field="team-limit"]')?.textContent)
      .toContain('閃電隊 專屬活動');
  });

  it('熱度欄依條件顯示不同顏色與文字，且已結束或無上限時不顯示', async () => {
    // 1. warm (#f59e0b 報名熱烈增加中)
    mocks.detail.mockResolvedValueOnce({
      ...detail,
      event: { ...detail.event, current: 5, max: 10 },
    });
    let view = mount();
    await screen.findByRole('heading', { level: 2 });
    let heatEl = view.container.querySelector('[data-detail-field="heat"]');
    expect(heatEl?.textContent).toBe('熱度報名熱烈增加中');
    expect(heatEl?.querySelector('span:last-child')?.getAttribute('style')).toContain('rgb(245, 158, 11)'); // #f59e0b
    view.unmount();

    // 2. normal (#3b82f6 穩定開放報名中)
    mocks.detail.mockResolvedValueOnce({
      ...detail,
      event: { ...detail.event, current: 1, max: 10 },
    });
    view = mount();
    await screen.findByRole('heading', { level: 2 });
    heatEl = view.container.querySelector('[data-detail-field="heat"]');
    expect(heatEl?.textContent).toBe('熱度穩定開放報名中');
    expect(heatEl?.querySelector('span:last-child')?.getAttribute('style')).toContain('rgb(59, 130, 246)'); // #3b82f6
    view.unmount();

    // 3. ended -> hidden
    mocks.detail.mockResolvedValueOnce({
      ...detail,
      event: { ...detail.event, current: 8, max: 10, status: 'ended' },
    });
    view = mount();
    await screen.findByRole('heading', { level: 2 });
    expect(view.container.querySelector('[data-detail-field="heat"]')).toBeNull();
    view.unmount();
  });

  it('名單摘要列（on-demand）：依三種權限顯示對應標題與按鈕，點擊前不載入名單', async () => {
    mocks.detail.mockResolvedValue({
      ...detail,
      event: {
        ...detail.event,
        current: 3,
        max: 10,
        waitlist: 2,
      },
    });

    // 1. 一般使用者（無管理與檢視紀錄權限）→「出席名單」＋「查看出席名單」
    let view = mount();
    await screen.findByRole('heading', { level: 2 });
    let summary = view.container.querySelector('.detail-attendance-summary');
    expect(summary).toBeTruthy();
    expect(summary?.textContent).toContain('出席名單');
    expect(summary?.textContent).toContain('3/10');
    expect(summary?.textContent).toContain('候補 2');
    expect(screen.getByRole('button', { name: '查看出席名單' })).toBeTruthy();
    expect(mocks.registrations).not.toHaveBeenCalled();
    expect(mocks.attendance).not.toHaveBeenCalled();
    view.unmount();

    // 2. 可看紀錄（activity.view_noshow）→「出席管理」＋「查看出席紀錄」
    mocks.viewer.mockReturnValue({
      ...viewer,
      uid: 'u-noshow',
      hasPermission: (code: string) => code === 'activity.view_noshow',
    });
    view = mount();
    await screen.findByRole('heading', { level: 2 });
    summary = view.container.querySelector('.detail-attendance-summary');
    expect(summary?.textContent).toContain('出席管理');
    expect(screen.getByRole('button', { name: '查看出席紀錄' })).toBeTruthy();
    expect(mocks.registrations).not.toHaveBeenCalled();
    view.unmount();

    // 3. 可管理（主辦人 host1 + site_operate）→「出席管理」＋「管理名單 / 出席紀錄」
    mocks.viewer.mockReturnValue({
      ...viewer,
      uid: 'host1',
      capabilities: ['user.activity.site_operate'],
    });
    view = mount();
    await screen.findByRole('heading', { level: 2 });
    summary = view.container.querySelector('.detail-attendance-summary');
    expect(summary?.textContent).toContain('出席管理');
    expect(screen.getByRole('button', { name: '管理名單 / 出席紀錄' })).toBeTruthy();
    expect(mocks.registrations).not.toHaveBeenCalled();
    view.unmount();
  });

  it('publicRosterOnly 權限：一般登入者點擊展開後不讀簽到紀錄且不顯示簽到／簽退／備註三欄；有權限者才讀取並顯示', async () => {
    mocks.detail.mockResolvedValue({
      ...detail,
      event: {
        ...detail.event,
        current: 1,
        max: 10,
        waitlist: 1,
      },
    });
    mocks.registrations.mockResolvedValue([
      self,
      { ...self, _docId: 'wait', userId: 'u2', userName: '小華', status: 'waitlisted' },
      { ...self, _docId: 'removed', userId: 'u3', userName: '不可顯示', status: 'removed' },
    ]);
    mocks.attendance.mockResolvedValue([
      { _docId: 'att1', uid: 'u1', userName: '小明', type: 'checkin', status: 'active' },
    ]);

    // 1. 一般登入者（publicRosterOnly = true）
    let view = mount();
    await screen.findByRole('heading', { level: 2 });
    fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
    await screen.findByText('小華');
    expect(screen.getByText('小明')).toBeTruthy();
    expect(screen.queryByText('不可顯示')).toBeNull();
    expect(mocks.registrations).toHaveBeenCalledWith('firestore-doc-a');
    expect(mocks.attendance).not.toHaveBeenCalled();
    expect(screen.queryByText('簽到')).toBeNull();
    expect(screen.queryByText('簽退')).toBeNull();
    expect(screen.queryByText('備註')).toBeNull();
    view.unmount();

    // 2. 具 activity.view_noshow 權限者（publicRosterOnly = false）
    mocks.viewer.mockReturnValue({
      ...viewer,
      uid: 'u-viewer',
      hasPermission: (code: string) => code === 'activity.view_noshow',
    });
    view = mount();
    await screen.findByRole('heading', { level: 2 });
    fireEvent.click(screen.getByRole('button', { name: '查看出席紀錄' }));
    await screen.findByText('小華');
    expect(mocks.attendance).toHaveBeenCalledWith('firestore-doc-a');
    expect(screen.getByText('簽到')).toBeTruthy();
    expect(screen.getByText('簽退')).toBeTruthy();
    expect(screen.getByText('備註')).toBeTruthy();
    expect(screen.getByText('✓')).toBeTruthy();
    view.unmount();
  });

  // 測試同步更新：照 A（M-091／M-089／M-090）分享、行事曆、聯繫主辦、Log、瀏覽數都已接上，
  // 原「點擊未開放功能顯示提示」案例刪除，改由 EventDetailPage.3b2a／3b2b 測試驗證各自行為。

  it('支援登入者與訪客的各種主按鈕狀態文字', async () => {
    // 1. ended
    mocks.detail.mockResolvedValueOnce({
      ...detail,
      event: { ...detail.event, status: 'ended' },
    });
    let view = mount();
    expect((await screen.findByRole('button', { name: '已結束' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();

    // 2. notOpen
    mocks.detail.mockResolvedValueOnce({
      ...detail,
      event: { ...detail.event, status: 'upcoming' },
    });
    view = mount();
    expect((await screen.findByRole('button', { name: '報名尚未開放' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();

    // 3. teamOnly
    mocks.detail.mockResolvedValueOnce({
      ...detail,
      event: { ...detail.event, teamOnly: true, isPublic: true, creatorTeamId: 'team-x' },
    });
    view = mount();
    expect((await screen.findByRole('button', { name: '球隊限定' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();

    // 4. waitlist
    mocks.detail.mockResolvedValueOnce({
      ...detail,
      event: { ...detail.event, current: 10, max: 10 },
    });
    view = mount();
    expect((await screen.findByRole('button', { name: '報名候補' }) as HTMLButtonElement).disabled).toBe(false);
    view.unmount();

    // 5. cancelWaitlist
    const waitReg: DetailRegistration = { ...self, status: 'waitlisted' };
    mocks.registrations.mockResolvedValueOnce([waitReg]);
    mocks.history.mockResolvedValueOnce([waitReg]);
    view = mount();
    expect((await screen.findByRole('button', { name: '取消候補' }) as HTMLButtonElement).disabled).toBe(false);
    view.unmount();

    // 6. Guest ended → 報名已結束
    mocks.viewer.mockReturnValue({ ...viewer, uid: null });
    mocks.detail.mockResolvedValueOnce({
      ...detail,
      event: { ...detail.event, status: 'ended', isPublic: true },
    });
    view = mount();
    expect((await screen.findByRole('button', { name: '報名已結束' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
  });

  it('找不到與被封鎖具有相同畫面，且不讀取名單', async () => {
    // 測試同步更新：照 A（M-094）找不到時 toast「找不到此活動」並返回，不再顯示大標題。
    mocks.detail.mockResolvedValueOnce(null);
    const first = mount();
    await waitFor(() => {
      expect(mocks.toastShow).toHaveBeenLastCalledWith({ message: '找不到此活動' });
    });
    const missing = first.container.innerHTML;
    first.unmount();
    mocks.toastShow.mockClear();

    mocks.detail.mockResolvedValue({
      ...detail,
      event: { ...detail.event, blockedUids: ['u1'] },
    });
    const second = mount();
    await waitFor(() => {
      expect(mocks.toastShow).toHaveBeenLastCalledWith({ message: '找不到此活動' });
    });
    expect(second.container.innerHTML).toBe(missing);
    expect(mocks.registrations).not.toHaveBeenCalled();
  });

  it('顯示活動與正取／候補名單，只呈現文字說明', async () => {
    mocks.detail.mockResolvedValue({
      ...detail,
      event: {
        ...detail.event,
        current: 1,
        max: 10,
        waitlist: 1,
        notes: '<img src=x onerror=alert(1)>',
      },
    });
    mocks.registrations.mockResolvedValue([
      self,
      { ...self, _docId: 'wait', userId: 'u2', userName: '小華', status: 'waitlisted' },
      { ...self, _docId: 'removed', userId: 'u3', userName: '不可顯示', status: 'removed' },
    ]);
    const view = mount();
    await screen.findByRole('heading', { level: 2 });
    fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
    await screen.findByText('小華', undefined, { timeout: 3000 });
    expect(screen.getByText('青埔籃足球共用球場 📍')).toBeTruthy();
    expect(screen.getByText('Neo')).toBeTruthy();
    expect(screen.queryByText('不可顯示')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(view.container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByRole('link', { name: /青埔籃足球共用球場/ }).getAttribute('rel'))
      .toContain('noopener');
    expect(mocks.registrations).toHaveBeenCalledWith('firestore-doc-a');
  });

  it('訪客：不讀 registrations，主要資訊與報名按鈕顯示，名單依 A 使用活動文件', async () => {
    mocks.viewer.mockReturnValue({ ...viewer, uid: null });
    mocks.registrations.mockRejectedValue(new Error('permission-denied'));
    mocks.detail.mockResolvedValue({
      ...detail,
      event: {
        ...detail.event,
        isPublic: true,
        current: 3,
        max: 10,
        waitlist: 1,
        notes: '請攜帶飲水',
        participantsWithUid: [
          { uid: 'public-user', name: '公開正取' },
          { uid: '', name: '無效資料' },
        ],
        participants: ['舊正取不應混入'],
        waitlistWithUid: [{ uid: 'wait-user', name: '公開候補' }],
        waitlistNames: ['舊候補不應混入'],
      },
    });

    const view = mount();
    await screen.findByRole('heading', { level: 2 });
    expect(screen.getByText('青埔籃足球共用球場 📍')).toBeTruthy();
    expect(screen.getByText('Neo')).toBeTruthy();
    expect(screen.getByText('請攜帶飲水')).toBeTruthy();
    expect(view.container.querySelector('[data-detail-field="capacity-count"]')?.textContent)
      .toContain('已報 3/10');
    // 測試同步更新：照 A（M-087）訪客先看摘要卡，按下才展開膠囊。
    expect(screen.getByText('出席名單')).toBeTruthy();
    expect(screen.getByText('3/10')).toBeTruthy();
    expect(screen.getByText('候補 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
    await waitFor(() => expect(screen.getByText('公開正取')).toBeTruthy());
    expect(screen.getByText('公開候補')).toBeTruthy();
    expect(screen.queryByText('無效資料')).toBeNull();
    expect(screen.queryByText('舊正取不應混入')).toBeNull();
    expect(screen.queryByText('舊候補不應混入')).toBeNull();
    expect(screen.queryByText('無法載入活動詳情，請重試。')).toBeNull();
    expect(mocks.registrations).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();

    const signup = screen.getByRole('button', { name: '立即報名' });
    expect((signup as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(signup);
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
    expect(mocks.registrations).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('訪客：WithUid 陣列為空時依 A 回退舊名稱陣列，姓名只呈現文字', async () => {
    mocks.viewer.mockReturnValue({ ...viewer, uid: null });
    mocks.detail.mockResolvedValue({
      ...detail,
      event: {
        ...detail.event,
        isPublic: true,
        max: 10,
        participantsWithUid: [],
        participants: ['舊正取', '', '   ', null, '<img src=x onerror=alert(1)>'],
        waitlistWithUid: [],
        waitlistNames: ['舊候補'],
      },
    });

    const view = mount();
    await screen.findByRole('heading', { level: 2 });
    // 測試同步更新：照 A（M-087）訪客先看摘要卡，按下才展開膠囊。
    fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
    await screen.findByText('舊正取');
    expect(screen.getByText('舊候補')).toBeTruthy();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(view.container.querySelector('img[src="x"]')).toBeNull();
    expect(mocks.registrations).not.toHaveBeenCalled();
  });

  it('登入點擊載入名單失敗：主資訊與報名按鈕仍顯示，名單區塊可重試', async () => {
    let resolveRetry!: (registrations: DetailRegistration[]) => void;
    const retryRegistrations = new Promise<DetailRegistration[]>((resolve) => {
      resolveRetry = resolve;
    });
    mocks.registrations
      .mockRejectedValueOnce(new Error('private permission detail'))
      .mockReturnValueOnce(retryRegistrations);

    mount();
    // 測試同步更新：照 A（U-024）載入骨架也有 h2，先等名單區出現再取標題。
    const region = await screen.findByRole('region', { name: '參加名單' });
    const title = screen.getByRole('heading', { level: 2 });
    fireEvent.click(within(region).getByRole('button', { name: '查看出席名單' }));
    await within(region).findByText('無法載入參加名單，請重試。');

    expect(screen.getByText('青埔籃足球共用球場 📍')).toBeTruthy();
    expect(screen.getByText('Neo')).toBeTruthy();
    expect(screen.queryByText('無法載入活動詳情，請重試。')).toBeNull();
    expect(screen.queryByText('private permission detail')).toBeNull();
    expect((screen.getByRole('button', { name: '立即報名' }) as HTMLButtonElement).disabled)
      .toBe(false);
    expect((screen.getByRole('button', { name: '幫夥伴報名' }) as HTMLButtonElement).disabled)
      .toBe(false);

    const retry = within(region).getByRole('button', { name: '重試' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await within(region).findByText('名單載入中...');
    expect(screen.getByRole('heading', { level: 2 })).toBe(title);
    expect((screen.getByRole('button', { name: '立即報名' }) as HTMLButtonElement).disabled)
      .toBe(false);
    expect(mocks.registrations).toHaveBeenCalledTimes(2);
    expect(mocks.registrations).toHaveBeenNthCalledWith(2, 'firestore-doc-a');
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(mocks.register).not.toHaveBeenCalled();

    resolveRetry([
      { ...self, userId: 'u2', userName: '重試後參加者' },
    ]);
    await within(region).findByText('重試後參加者');
    expect(within(region).queryByRole('button', { name: '重試' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2 })).toBe(title);
  });

  it('點擊展開名單尚未回應時顯示載入中，登出後舊名單回應不能進入訪客頁', async () => {
    let resolveOld!: (registrations: DetailRegistration[]) => void;
    mocks.registrations.mockReturnValue(new Promise<DetailRegistration[]>((resolve) => {
      resolveOld = resolve;
    }));
    const view = mount();
    await screen.findByRole('heading', { level: 2 });
    fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
    await screen.findByText('名單載入中...');
    expect(screen.getByRole('button', { name: '立即報名' })).toBeTruthy();

    mocks.viewer.mockReturnValue({ ...viewer, uid: null });
    view.rerender(<LocationProvider><EventDetailPage id="ce_123_abc" /></LocationProvider>);
    await screen.findByRole('heading', { level: 2 });
    resolveOld([{ ...self, userName: '舊登入名單不可顯示' }]);
    await waitFor(() => {
      expect(screen.queryByText('舊登入名單不可顯示')).toBeNull();
      expect(screen.queryByText('名單載入中...')).toBeNull();
    });
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
  });

  it('活動文件讀取失敗才顯示整頁錯誤', async () => {
    mocks.detail.mockRejectedValue(new Error('offline'));
    mount();
    await screen.findByRole('heading', { name: '無法載入活動詳情，請重試。' });
    expect(screen.getByRole('button', { name: '重試' })).toBeTruthy();
    expect(mocks.registrations).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('本人歷史讀取失敗不顯示活動整頁錯誤，也不繞過報名前置檢查', async () => {
    mocks.history.mockRejectedValue(new Error('offline'));
    mount();
    await screen.findByRole('heading', { level: 2 });
    await screen.findByText('無法同步你的報名狀態，請重試後再報名。');
    expect(screen.queryByText('無法載入活動詳情，請重試。')).toBeNull();
    // 測試同步更新：照 A（M-084），歷史失敗顯示同步狀態而非可按的立即報名。
    expect(screen.getByRole('button', { name: '報名狀態同步中' }))
      .toHaveProperty('disabled', true);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.companions).not.toHaveBeenCalled();
  });

  it('報名成功只更新名單、計數與按鈕，不重載活動', async () => {
    mocks.registrations.mockResolvedValue([self]);
    mocks.history.mockResolvedValueOnce([]).mockResolvedValue([self]);
    const view = mount();
    // 測試同步更新：照 A（U-024）載入骨架也有 h2，先等主按鈕出現再取標題。
    await screen.findByRole('button', { name: '立即報名' });
    const title = screen.getByRole('heading', { level: 2 });
    fireEvent.click(screen.getByRole('button', { name: '立即報名' }));
    await screen.findByRole('button', { name: '取消報名' });
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'ce_123_abc',
      user: { uid: 'u1', displayName: '小明' },
    }));
    expect(screen.getByRole('heading', { level: 2 })).toBe(title);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('[data-detail-field="capacity-count"]')?.textContent)
      .toContain('已報 1/0');
  });

  // 測試同步更新：照 A（M-081），單人取消走 appConfirm，不開選人彈窗。
  it('單人確認後才取消，payload 使用子文件 ID 與 context', async () => {
    let confirm!: (value: boolean) => void;
    mocks.confirm.mockReturnValue(new Promise<boolean>(resolve => { confirm = resolve; }));
    mocks.registrations.mockResolvedValue([]);
    mocks.history.mockResolvedValueOnce([self]).mockResolvedValue([]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '取消報名' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('確定要取消報名？'));
    expect(mocks.cancel).not.toHaveBeenCalled();
    await act(async () => { confirm(true); });
    await screen.findByRole('button', { name: '立即報名' });
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'ce_123_abc',
      userId: 'u1',
      registrationIds: ['registration-self'],
      kind: 'self',
      context: expect.objectContaining({ getAuth: expect.any(Function), load: expect.any(Function) }),
    }));
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.toastShow).toHaveBeenCalledWith({ message: '已取消報名' });
  });

  it('未登入點報名呼叫動態載入的 signIn', async () => {
    mocks.viewer.mockReturnValue({ ...viewer, uid: null });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.registrations).not.toHaveBeenCalled();
  });

  // 測試同步更新：照 A（M-084），本人直接報名，不查詢或開啟同行者選擇。
  it('有同行者仍直接報名本人', async () => {
    mocks.companions.mockResolvedValue([{ id: 'c1', name: '同行小王' }]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { uid: 'u1', displayName: '小明' },
        context: expect.objectContaining({ getAuth: expect.any(Function) }),
      }),
    ));
    expect(mocks.companions).not.toHaveBeenCalled();
    expect(document.querySelector('#companion-select-overlay')).toBeNull();
    expect(mocks.toastShow).toHaveBeenCalledWith({ message: '報名成功！' });
  });

  it('SignupError 以翻譯後 Toast 呈現', async () => {
    mocks.register.mockRejectedValue(new SignupError({
      code: 'failed-precondition',
      originalCode: 'PROFILE_INCOMPLETE',
      messageKey: 'event.signup.error.profileIncomplete',
      message: 'private server detail',
    }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await screen.findByText('請先完成個人資料');
    expect(screen.queryByText('private server detail')).toBeNull();
  });

  it('寫入成功但刷新失敗，重試只刷新不重送報名', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T04:00:00+08:00'));

    let resolveRetry!: (registrations: DetailRegistration[]) => void;
    const retryRegistrations = new Promise<DetailRegistration[]>((resolve) => {
      resolveRetry = resolve;
    });

    mocks.registrations
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(retryRegistrations);
    mocks.history
      .mockResolvedValueOnce([])
      .mockResolvedValue([self]);

    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));

    const retry = await screen.findByRole('button', { name: '重試' });
    await waitFor(() => {
      expect((retry as HTMLButtonElement).disabled).toBe(false);
    });
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    expect(mocks.history).toHaveBeenCalledTimes(2);
    expect((screen.getByRole('button', { name: '立即報名' }) as HTMLButtonElement).disabled)
      .toBe(true);
    const companionButton = screen.queryByRole('button', { name: '幫夥伴報名' }) as HTMLButtonElement | null;
    expect(companionButton === null || companionButton.disabled).toBe(true);

    fireEvent.click(retry);

    await waitFor(() => {
      expect(mocks.registrations).toHaveBeenCalledTimes(2);
      expect(mocks.history).toHaveBeenCalledTimes(3);
      expect((retry as HTMLButtonElement).disabled).toBe(true);
    });
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenNthCalledWith(2, 'firestore-doc-a');
    expect(mocks.history).toHaveBeenNthCalledWith(3, 'u1');

    resolveRetry([self]);

    const cancel = await screen.findByRole('button', { name: '取消報名' });
    await waitFor(() => {
      expect((cancel as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByRole('button', { name: '重試' })).toBeNull();
    });
    expect(view.container.querySelector('[data-detail-field="capacity-count"]')?.textContent)
      .toContain('已報 1/0');
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
    // 測試同步更新：照 A（M-084），本人報名不載入同行者。
    expect(mocks.companions).not.toHaveBeenCalled();
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledTimes(2);
    expect(mocks.history).toHaveBeenCalledTimes(3);
  });

  it('同一輪連點不會重複送出', async () => {
    let resolve!: (value: { deduplicated: boolean }) => void;
    mocks.register.mockReturnValue(new Promise((done) => { resolve = done; }));
    mount();
    const button = await screen.findByRole('button', { name: '立即報名' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    resolve({ deduplicated: false });
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
  });

  it('快速切換活動時舊請求不能覆蓋新頁', async () => {
    let resolveOld!: (value: LoadedEventDetail) => void;
    mocks.detail.mockImplementation((id: string) => id === 'old'
      ? new Promise<LoadedEventDetail>((done) => { resolveOld = done; })
      : Promise.resolve(detail));

    const view = render(<LocationProvider><EventDetailPage id="old" /></LocationProvider>);
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledWith('old'));
    view.rerender(<LocationProvider><EventDetailPage id="ce_123_abc" /></LocationProvider>);
    await screen.findByRole('heading', { level: 2 });
    resolveOld({ ...detail, event: { ...detail.event, id: 'old', title: '舊活動' } });
    await waitFor(() => expect(screen.queryByText('舊活動')).toBeNull());
  });
});

describe('名單結算「完成」（C-001）', () => {
  function successResult(
    overrides: Partial<Extract<SettleAttendanceResult, { ok: true }>> = {},
  ): Extract<SettleAttendanceResult, { ok: true }> {
    return {
      ok: true,
      added: 0,
      removed: 0,
      targets: [],
      granted: [],
      skippedAlready: [],
      skippedZeroAmount: false,
      failed: [],
      ...overrides,
    };
  }

  async function enterRosterEdit(): Promise<void> {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '管理名單 / 出席紀錄' }));
    fireEvent.click(await screen.findByRole('button', { name: '管理名單', exact: true }));
    await screen.findByRole('button', { name: '完成' });
  }

  function checkinBox(): HTMLInputElement {
    const box = screen.getByRole('checkbox', { name: '小明 簽到' });
    if (!(box instanceof HTMLInputElement)) {
      throw new Error('簽到 checkbox 不存在');
    }
    return box;
  }

  beforeEach(() => {
    mocks.viewer.mockReturnValue({
      ...viewer,
      uid: 'host1',
      capabilities: ['user.activity.site_operate'],
    });
    mocks.registrations.mockResolvedValue([self]);
    mocks.writeAttendanceOps.mockResolvedValue({ addedDocIds: ['att1'], removedDocIds: [] });
    mocks.settleAttendance.mockResolvedValue(successResult());
  });

  it('成功以公開活動 id、名單與登入者結算，提示成功並退出編輯', async () => {
    await enterRosterEdit();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await screen.findByText('儲存完成');
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(mocks.settleAttendance).toHaveBeenCalledTimes(1);
    const input = mocks.settleAttendance.mock.calls[0]?.[0];
    expect(input?.event.id).toBe('ce_123_abc');
    expect(input?.people.length).toBeGreaterThan(0);
    expect(input?.operatorUid).toBe('host1');
    expect(input?.operatorName).toBe('小明');
    expect(input?.getSelection).toEqual(expect.any(Function));
    expect(mocks.toastShow).not.toHaveBeenCalled();
  });

  it('結算失敗保留編輯與已勾選狀態，再按完成可重試成功', async () => {
    let finishWrite!: () => void;
    mocks.writeAttendanceOps.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishWrite = resolve;
    }));
    mocks.settleAttendance
      .mockImplementationOnce(async (input) => {
        const person = input.people.find((entry) => entry.uid === 'u1');
        expect(person).toBeDefined();
        if (!person) throw new Error('測試名單缺少 u1');
        expect(input.getSelection(person)?.checkin).toBe(true);
        return { ok: false, stage: 'confirm', error: 'x' };
      })
      .mockResolvedValueOnce(successResult());

    await enterRosterEdit();
    fireEvent.click(checkinBox());
    expect(checkinBox().checked).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '完成' }));
    });
    expect(mocks.writeAttendanceOps).toHaveBeenCalledTimes(1);
    expect(mocks.settleAttendance).not.toHaveBeenCalled();

    mocks.attendance.mockResolvedValue([
      { _docId: 'att1', uid: 'u1', userName: '小明', type: 'checkin', status: 'active' },
    ]);
    await act(async () => {
      finishWrite();
    });

    await screen.findByText('儲存失敗，勾選已保留 請再按一次「完成」重試');
    expect(screen.getByRole('button', { name: '完成' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '管理名單', exact: true })).toBeNull();
    expect(checkinBox().checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await screen.findByText('儲存完成');
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(mocks.settleAttendance).toHaveBeenCalledTimes(2);
  });

  it('部分發放失敗另外提示未發放人數一次', async () => {
    mocks.settleAttendance.mockResolvedValue(successResult({
      targets: ['u1', 'u2'],
      failed: [{ uid: 'u1', error: 'x' }, { uid: 'u2', error: 'y' }],
    }));

    await enterRosterEdit();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await screen.findByText('儲存完成');
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(mocks.toastShow).toHaveBeenCalledExactlyOnceWith({
      message: '有 2 人經驗值未發放，請聯繫管理員',
    });
  });

  it('只有 skippedAlready 時不提示經驗值未發放', async () => {
    mocks.settleAttendance.mockResolvedValue(successResult({
      targets: ['u1'],
      skippedAlready: [{ uid: 'u1', source: 'expLogs' }],
    }));

    await enterRosterEdit();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await screen.findByText('儲存完成');
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(mocks.toastShow).not.toHaveBeenCalled();
  });

  it('skippedZeroAmount 時不提示經驗值未發放', async () => {
    mocks.settleAttendance.mockResolvedValue(successResult({
      targets: ['u1'],
      skippedZeroAmount: true,
      amountSkipReason: 'zero',
    }));

    await enterRosterEdit();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await screen.findByText('儲存完成');
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(mocks.toastShow).not.toHaveBeenCalled();
  });

  it('送出中顯示儲存中並 disabled，再點不會重複結算', async () => {
    let finishSettle!: (result: SettleAttendanceResult) => void;
    mocks.settleAttendance.mockReturnValue(new Promise<SettleAttendanceResult>((resolve) => {
      finishSettle = resolve;
    }));

    await enterRosterEdit();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(mocks.settleAttendance).toHaveBeenCalledTimes(1));

    const button = screen.getByRole('button', { name: '儲存中...' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(mocks.settleAttendance).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishSettle(successResult());
    });
    await screen.findByRole('button', { name: '管理名單', exact: true });
  });

  it('settleAttendance 意外 throw 時保留編輯並解除送出狀態', async () => {
    mocks.settleAttendance.mockRejectedValueOnce(new Error('unexpected'));

    await enterRosterEdit();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await screen.findByText('儲存失敗，勾選已保留 請再按一次「完成」重試');
    expect(screen.getByRole('button', { name: '完成' })).toHaveProperty('disabled', false);
    expect(screen.queryByRole('button', { name: '管理名單', exact: true })).toBeNull();
    expect(mocks.toastShow).not.toHaveBeenCalled();
  });

  it('結算成功後重讀失敗仍保留成功提示並退出編輯', async () => {
    await enterRosterEdit();
    mocks.attendance.mockRejectedValueOnce(new Error('reload failed'));
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await screen.findByText('儲存完成');
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(screen.queryByText('儲存失敗，勾選已保留 請再按一次「完成」重試')).toBeNull();
    expect(mocks.settleAttendance).toHaveBeenCalledTimes(1);
  });
});
