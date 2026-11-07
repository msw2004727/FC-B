import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import {
  registerMock as registerCallableMock, clearMocks as clearCallableMocks,
  startRecording as startCallableRecording, stopRecording as stopCallableRecording,
  CallableError as CallableFailure,
} from '@/data/callables';
import { translate as rosterTranslate, demoted as demoteResponse, promoted as promoteResponse } from '../data/roster-status-test-fixtures';
vi.mock('@/data/op-log', () => ({ writeOpLog: vi.fn(async () => {}) }));
import type { ViewerView } from '@/features/profile/data/viewer';
import type { LoadedEventDetail } from '../data/event-detail';
import type { DetailRegistration } from '../data/detail-model';
import type { SettleAttendanceInput, SettleAttendanceResult } from '../data/attendance-settle';

const mocks = vi.hoisted(() => ({
  // 斷開未 mock 的裝飾性資料讀取，整個頁面測試不可初始化真實 Firebase。
  offlineFirebase: vi.fn(async () => { throw new Error('offline page test'); }),
  detail: vi.fn(),
  reservationSignupEvent: {} as Record<string, unknown>,
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
  roles: vi.fn(),
  noShowStats: vi.fn(),
  noShowAdjustments: vi.fn(),
  noShowCounted: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({ getFirebase: mocks.offlineFirebase, getFirebaseCore: mocks.offlineFirebase }));

vi.mock('@/features/events/data/attendance-settle', () => ({
  settleAttendance: mocks.settleAttendance,
}));

vi.mock('@/features/events/data/attendance-edit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/attendance-edit')>()),
  writeAttendanceOps: mocks.writeAttendanceOps,
}));

vi.mock('@/data/user-roles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/user-roles')>()),
  useUserRoles: () => mocks.roles(),
  getCachedUserLevel: () => 0,
  getCachedUserNoShowStats: mocks.noShowStats,
}));

vi.mock('../data/noshow-corrections', () => ({ loadNoShowAdjustments: mocks.noShowAdjustments }));
// 站長 11-06 放鴿子 v2：管理名單才讀 userAttendanceStats（資料層另有測試）。
vi.mock('../data/noshow-counted', () => ({ loadCountedNoShowStats: mocks.noShowCounted }));

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
  const tpl = ZH_DICT[key] ?? rosterTranslate(key, params);
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
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: mocks.viewer, requestViewerRefresh: vi.fn() }));
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
        event: { id: eventId, status: 'open', ...mocks.reservationSignupEvent },
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
// T-088：分隊批次只負責呼叫 publish，避免 commit 碰到 Firestore 後把樂觀分隊打回。
vi.mock('../data/team-split-writes', () => ({
  runTeamSplitBatch: async (deps: {
    isCurrent: () => boolean;
    loadRegistrations: () => Promise<ReadonlyArray<{ teamKey?: string | null }>>;
    publish: (rows: Array<{ teamKey?: string | null }>) => void;
  }) => {
    const rows = await deps.loadRegistrations();
    if (!deps.isCurrent()) return;
    deps.publish(rows.map(row => ({ ...row, teamKey: 'B' })));
  },
}));

import { writeOpLog } from '@/data/op-log';
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
  mocks.reservationSignupEvent = {};
  await setLocale('zh-TW');
  history.replaceState(null, '', '/events/ce_123_abc');
  mocks.roles.mockReturnValue({});
  mocks.noShowAdjustments.mockResolvedValue(new Map());
  mocks.noShowCounted.mockResolvedValue(new Map());
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
  vi.unstubAllEnvs();
  clearCallableMocks();
  stopCallableRecording();
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

    // 3. 可管理（主辦人 host1 + site_operate）→ 進頁自動展開，名單只讀一次
    mocks.registrations.mockClear();
    mocks.viewer.mockReturnValue({
      ...viewer,
      uid: 'host1',
      capabilities: ['user.activity.site_operate'],
    });
    view = mount();
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledWith('firestore-doc-a');
    expect(screen.queryByRole('button', { name: '管理名單 / 出席紀錄' })).toBeNull();
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
    // T-085：活動讀取與本人報名改為同時發出，失敗時 history 也已啟動。
    expect(mocks.history).toHaveBeenCalledTimes(1);
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
    // R-REG-002：正常成功由 Callable 回傳佔位投影，名單重讀不再自行改寫 current。
    mocks.register.mockResolvedValue({ deduplicated: false, confirmed: 1, waitlisted: 0,
      registrations: [self], event: { current: 1, realCurrent: 1, waitlist: 0, status: 'open',
        participants: [self.userName], participantsWithUid: [{ uid: self.userId, name: self.userName }],
        waitlistNames: [], waitlistWithUid: [], teamReservationSummaries: [] } });
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
    // R-REG-002：正常成功由 Callable 回傳佔位投影，名單重讀不再自行改寫 current。
    mocks.register.mockResolvedValue({ deduplicated: false, confirmed: 1, waitlisted: 0,
      registrations: [self], event: { current: 1, realCurrent: 1, waitlist: 0, status: 'open',
        participants: [self.userName], participantsWithUid: [{ uid: self.userId, name: self.userName }],
        waitlistNames: [], waitlistWithUid: [], teamReservationSummaries: [] } });
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
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('儲存失敗，勾選已保留 請再按一次「完成」重試')).toBeNull();
    expect(screen.queryByText('無法更新名單，請重試。')).toBeNull();
    expect(mocks.settleAttendance).toHaveBeenCalledTimes(1);
  });

  it('較舊的出席重讀晚回來時不覆蓋較新的名單', async () => {
    mocks.registrations.mockResolvedValue([
      { ...self, _docId: 'targetA', userId: 'uidA', userName: '甲', eventId: 'evtA' },
    ]);
    const pending: Array<(rows: unknown) => void> = [];
    await enterRosterEdit();
    mocks.attendance.mockImplementation(
      () => new Promise((resolve) => {
        pending.push(resolve);
      }),
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '甲 簽到' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '完成' }));
    });
    await waitFor(() => {
      expect(pending.length).toBeGreaterThanOrEqual(2);
    });
    const resolveStale = pending[0];
    const resolveFresh = pending[pending.length - 1];
    if (!resolveStale || !resolveFresh || resolveStale === resolveFresh) {
      throw new Error('需要兩次重疊的出席重讀');
    }

    const fresh = [{
      _docId: 'targetA',
      uid: 'uidA',
      userName: '甲',
      type: 'checkin',
      status: 'active',
    }];
    await act(async () => {
      resolveFresh(fresh);
    });
    await screen.findByRole('button', { name: '管理名單', exact: true });
    await act(async () => {
      resolveStale([]);
    });

    const table = document.querySelector('#detail-attendance-table');
    const row = Array.from(table?.querySelectorAll('tr') ?? []).find((tr) => tr.textContent?.includes('甲'));
    expect(row?.textContent).toContain('✓');
  });

  it('結算成功先退出編輯，出席重讀在背景進行', async () => {
    let finishReload!: (value: unknown) => void;
    await enterRosterEdit();
    const callsBefore = mocks.attendance.mock.calls.length;
    mocks.attendance.mockImplementationOnce(() => new Promise((resolve) => {
      finishReload = resolve;
    }));

    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await screen.findByText('儲存完成');
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(screen.queryByRole('button', { name: '儲存中...' })).toBeNull();
    expect(mocks.attendance.mock.calls.length).toBe(callsBefore + 1);
    expect(screen.queryByText('無法更新名單，請重試。')).toBeNull();

    await act(async () => {
      finishReload([]);
    });
    expect(screen.getByText('儲存完成')).toBeTruthy();
    expect(screen.queryByText('儲存失敗，勾選已保留 請再按一次「完成」重試')).toBeNull();
    expect(screen.queryByText('無法更新名單，請重試。')).toBeNull();
  });
});

describe('名單狀態調整頁面接線', () => {
  const rosterEvent = { ...detail.event, id: 'evtA', creatorUid: 'uidA', max: 2, title: '週末活動' };
  const rosterReg = { ...self, eventId: 'evtA', userId: 'uidB', _docId: 'regA' };
  async function openRoster(status: 'confirmed' | 'waitlisted' = 'confirmed') {
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
    clearCallableMocks();
    mocks.viewer.mockReturnValue({ ...viewer, uid: 'uidA', capabilities: ['user.activity.site_operate'] });
    mocks.detail.mockResolvedValue({ eventDocId: 'docA', event: rosterEvent });
    mocks.registrations.mockResolvedValue([{ ...rosterReg, status }]);
    history.replaceState(null, '', '/events/evtA');
    const view = render(<LocationProvider><EventDetailPage id="evtA" /></LocationProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '管理名單', exact: true }));
    return view;
  }
  it('名單狀態調整：確認、刷新與後續結算採用新名單', async () => {
    const view = await openRoster();
    let release!: () => void;
    mocks.confirm.mockImplementation(() => new Promise<boolean>(resolve => { release = () => resolve(true); }));
    registerCallableMock('forceDemoteToWaitlist', () => {
      mocks.registrations.mockResolvedValue([{ ...rosterReg, status: 'waitlisted' }]);
      mocks.detail.mockResolvedValue({ eventDocId: 'docA', event: { ...rosterEvent, current: 3, realCurrent: 0, waitlist: 1 } });
      // 測試同步更新：按鈕加速①先套伺服器投影，投影要和下放後的名單一致。
      return { ...demoteResponse, current: 3, waitlist: 1, event: { ...demoteResponse.event,
        current: 3, realCurrent: 0, waitlist: 1, participants: [], participantsWithUid: [],
        waitlistNames: ['小明'], waitlistWithUid: [{ uid: 'uidB', name: '小明' }] } };
    });
    startCallableRecording();
    const originalPage = view.container.querySelector('#page-activity-detail');
    fireEvent.click(screen.getByRole('button', { name: '將 小明 下放到候補' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('確定將 小明 下放到候補嗎？'));
    expect(screen.getByRole('button', { name: '將 小明 下放到候補' })).toHaveProperty('disabled', true);
    await act(async () => { release(); });
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' })));
    expect(view.container.querySelector('#page-activity-detail')).toBe(originalPage);
    expect(screen.queryByRole('button', { name: '將 小明 下放到候補' })).toBeNull();
    expect(screen.getByRole('button', { name: '將 小明 正取' })).toBeTruthy();
    expect(view.container.querySelector('[data-detail-field="capacity-count"]')?.textContent).toContain('3/2');
    const calls = stopCallableRecording();
    expect(calls).toHaveLength(1); expect(calls[0]?.request).toMatchObject({ eventId: 'evtA', userId: 'uidB' });
    expect(mocks.writeAttendanceOps).not.toHaveBeenCalled();
    mocks.settleAttendance.mockResolvedValue({ ok: true, added: 0, removed: 0, targets: [],
      granted: [], skippedAlready: [], skippedZeroAmount: false, failed: [] });
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(mocks.settleAttendance).toHaveBeenCalledOnce());
    expect(mocks.settleAttendance.mock.calls[0]?.[0].people.some(person => person.uid === 'uidB')).toBe(false);
  });
  it('名單狀態調整：正取二次確認與名單刷新', async () => {
    await openRoster('waitlisted');
    let attempt = 0;
    registerCallableMock('forcePromoteWaitlist', () => {
      if (++attempt === 1) throw new CallableFailure('failed-precondition', 'CAPACITY_EXCEEDED');
      mocks.registrations.mockResolvedValue([{ ...rosterReg, status: 'confirmed' }]);
      return promoteResponse;
    });
    startCallableRecording();
    fireEvent.click(screen.getByRole('button', { name: '將 小明 正取' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('正取後將超過名額上限，確定要繼續嗎？'));
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' })));
    const calls = stopCallableRecording();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.request).not.toHaveProperty('allowOverCapacity');
    expect(calls[1]?.request).toHaveProperty('allowOverCapacity', true);
    expect((calls[0]?.request as { requestId: string }).requestId)
      .not.toBe((calls[1]?.request as { requestId: string }).requestId);
    expect(screen.getByRole('button', { name: '將 小明 下放到候補' })).toBeTruthy();
  });

  it('踢人成功：toast 與人數投影先於名單重讀', async () => {
    // 測試同步更新：按鈕加速①
    const view = await openRoster();
    let releaseRegs!: (rows: DetailRegistration[]) => void;
    mocks.registrations.mockImplementation(
      () => new Promise((resolve) => { releaseRegs = resolve; }),
    );
    vi.mocked(writeOpLog).mockImplementation(() => new Promise(() => {}));
    registerCallableMock('cancelRegistration', () => ({
      success: true,
      cancelled: 1,
      event: { current: 9, max: 2, waitlist: 0 },
    }));
    fireEvent.click(screen.getByRole('button', { name: '踢' }));
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith({
      message: '已將 小明 從報名名單中移除', tone: 'success',
    }));
    expect(view.container.querySelector('[data-detail-field="capacity-count"]')?.textContent)
      .toContain('已報 9/2');
    expect(screen.getByText('小明')).toBeTruthy();
    // 名單重讀完成前仍持鎖，不能重複踢同一人（Opus／Gemini 審查）。
    expect(screen.getByRole('button', { name: '踢' })).toHaveProperty('disabled', true);
    await act(async () => { releaseRegs([]); });
  });

  it('踢人 deduplicated 仍等重讀，Callable 失敗不重讀', async () => {
    // 測試同步更新：按鈕加速①
    await openRoster();
    const callsBefore = mocks.registrations.mock.calls.length;
    let releaseRegs!: (rows: DetailRegistration[]) => void;
    mocks.registrations.mockImplementation(
      () => new Promise((resolve) => { releaseRegs = resolve; }),
    );
    registerCallableMock('cancelRegistration', () => ({ success: true, deduplicated: true }));
    fireEvent.click(screen.getByRole('button', { name: '踢' }));
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith({
      message: '已將 小明 從報名名單中移除', tone: 'success',
    }));
    expect(screen.getByRole('button', { name: '踢' })).toHaveProperty('disabled', true);
    expect(mocks.registrations.mock.calls.length).toBeGreaterThan(callsBefore);
    await act(async () => { releaseRegs([{ ...rosterReg, status: 'confirmed' }]); });
    await waitFor(() => expect(screen.getByRole('button', { name: '踢' })).toHaveProperty('disabled', false));

    mocks.toastShow.mockClear();
    const after = mocks.registrations.mock.calls.length;
    registerCallableMock('cancelRegistration', () => {
      throw new CallableFailure('permission-denied', 'PERMISSION_DENIED', { code: 'PERMISSION_DENIED' });
    });
    fireEvent.click(screen.getByRole('button', { name: '踢' }));
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'error',
    })));
    expect(mocks.registrations.mock.calls.length).toBe(after);
  });
});

describe('T-085 名單展開與進頁讀取', () => {
  function manager(): ViewerView {
    return {
      ...viewer,
      uid: 'host1',
      capabilities: ['user.activity.site_operate'],
    };
  }

  it('管理者進頁自動展開且名單只讀一次', async () => {
    mocks.viewer.mockReturnValue(manager());
    mocks.registrations.mockResolvedValue([self]);
    mount();
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(screen.queryByRole('button', { name: '管理名單 / 出席紀錄' })).toBeNull();
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledWith('firestore-doc-a');
    await act(async () => { await Promise.resolve(); });
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
  });

  it('一般用戶與訪客不自動展開、不多讀名單', async () => {
    const userView = mount();
    await screen.findByRole('heading', { level: 2 });
    expect(screen.getByRole('button', { name: '查看出席名單' })).toBeTruthy();
    expect(mocks.registrations).not.toHaveBeenCalled();
    expect(mocks.attendance).not.toHaveBeenCalled();
    userView.unmount();

    mocks.history.mockClear();
    mocks.registrations.mockClear();
    mocks.attendance.mockClear();
    mocks.viewer.mockReturnValue({ ...viewer, uid: null });
    mocks.detail.mockResolvedValue({
      ...detail,
      event: { ...detail.event, isPublic: true },
    });
    mount();
    await screen.findByRole('heading', { level: 2 });
    expect(screen.getByRole('button', { name: '查看出席名單' })).toBeTruthy();
    expect(mocks.registrations).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.attendance).not.toHaveBeenCalled();
  });

  it('operation 與 refreshFailed 期間不展開、不卡在載入中', async () => {
    let rejectRefresh!: (error: Error) => void;
    mocks.registrations.mockImplementationOnce(() => new Promise<DetailRegistration[]>((_resolve, reject) => {
      rejectRefresh = reject;
    }));
    mocks.viewer.mockReturnValue({ ...viewer, uid: 'host1', capabilities: [] });
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));

    mocks.viewer.mockReturnValue(manager());
    view.rerender(<LocationProvider><EventDetailPage id="ce_123_abc" /></LocationProvider>);
    expect(screen.getByRole('button', { name: '管理名單 / 出席紀錄' })).toBeTruthy();
    expect(screen.queryByText('名單載入中...')).toBeNull();
    expect(mocks.registrations).toHaveBeenCalledTimes(1);

    rejectRefresh(new Error('offline'));
    await waitFor(() => expect(screen.getAllByText('無法更新名單，請重試。').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: '管理名單 / 出席紀錄' })).toBeTruthy();
    expect(screen.queryByText('名單載入中...')).toBeNull();
    expect(mocks.registrations).toHaveBeenCalledTimes(1);

    mocks.registrations.mockResolvedValue([self]);
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(screen.queryByText('名單載入中...')).toBeNull();
    expect(screen.queryByRole('button', { name: '管理名單 / 出席紀錄' })).toBeNull();
    // 失敗那次 1；重試的 refresh 1；接著自動展開 1。
    expect(mocks.registrations).toHaveBeenCalledTimes(3);
    expect(mocks.registrations).toHaveBeenLastCalledWith('firestore-doc-a');
  });

  it('pointerdown 預讀後點擊只讀一次，且預讀當下不展開', async () => {
    let resolveRegs!: (rows: DetailRegistration[]) => void;
    mocks.registrations.mockReturnValue(new Promise<DetailRegistration[]>((resolve) => {
      resolveRegs = resolve;
    }));
    mount();
    const button = await screen.findByRole('button', { name: '查看出席名單' });
    fireEvent.pointerDown(button);
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '查看出席名單' })).toBeTruthy();
    expect(screen.queryByText('名單載入中...')).toBeNull();

    fireEvent.click(button);
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    await screen.findByText('名單載入中...');
    resolveRegs([self]);
    await screen.findByText('小明');
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledWith('firestore-doc-a');
  });

  it('換活動後重置，新活動再自動展開一次', async () => {
    mocks.viewer.mockReturnValue(manager());
    mocks.registrations.mockResolvedValue([self]);
    mocks.detail.mockImplementation(async (id: string) => {
      if (id === 'evtA') {
        return {
          ...detail,
          eventDocId: 'doc-evtA',
          event: { ...detail.event, id: 'evtA', title: '換場活動', creatorUid: 'host1' },
        };
      }
      return detail;
    });
    const view = render(<LocationProvider><EventDetailPage id="ce_123_abc" /></LocationProvider>);
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledWith('firestore-doc-a');

    mocks.registrations.mockClear();
    view.rerender(<LocationProvider><EventDetailPage id="evtA" /></LocationProvider>);
    await screen.findByText('換場活動');
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledWith('doc-evtA');
  });

  it('登入者進頁時活動讀取與本人報名同時發出', async () => {
    let resolveDetail!: (value: LoadedEventDetail) => void;
    let resolveHistory!: (value: DetailRegistration[]) => void;
    mocks.detail.mockReturnValue(new Promise<LoadedEventDetail>((resolve) => {
      resolveDetail = resolve;
    }));
    mocks.history.mockReturnValue(new Promise<DetailRegistration[]>((resolve) => {
      resolveHistory = resolve;
    }));
    mount();
    await waitFor(() => {
      expect(mocks.detail).toHaveBeenCalledTimes(1);
      expect(mocks.history).toHaveBeenCalledTimes(1);
      expect(mocks.history).toHaveBeenCalledWith('u1');
    });
    resolveHistory([]);
    resolveDetail(detail);
    await screen.findByRole('button', { name: '查看出席名單' });
    expect(mocks.registrations).not.toHaveBeenCalled();
  });

  it('預讀被不會結束的 promise 卡住，報名刷新後再展開會重讀且不卡在載入中', async () => {
    let calls = 0;
    mocks.registrations.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return new Promise<DetailRegistration[]>(() => {});
      return Promise.resolve([{ ...self, userName: '重讀參加者' }]);
    });
    mount();
    const open = await screen.findByRole('button', { name: '查看出席名單' });
    fireEvent.pointerDown(open);
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '查看出席名單' })).toBeTruthy();
    expect(screen.queryByText('名單載入中...')).toBeNull();
    expect(screen.queryByText('重讀參加者')).toBeNull();

    const signup = screen.getByRole('button', { name: '立即報名' });
    await waitFor(() => expect((signup as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(signup);
    await waitFor(() => {
      expect(mocks.registrations).toHaveBeenCalledTimes(2);
      expect(mocks.toastShow).toHaveBeenCalledWith({ message: '報名成功！' });
      expect((screen.getByRole('button', { name: '立即報名' }) as HTMLButtonElement).disabled)
        .toBe(false);
    });
    expect(screen.queryByText('重讀參加者')).toBeNull();
    expect(screen.queryByText('名單載入中...')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
    await screen.findByText('重讀參加者');
    expect(screen.queryByText('名單載入中...')).toBeNull();
    expect(mocks.registrations).toHaveBeenCalledTimes(3);
    expect(mocks.registrations).toHaveBeenLastCalledWith('firestore-doc-a');
  });

  it('重新整理時名單讀取失敗，已展開的載入中改為錯誤並可重試', async () => {
    let calls = 0;
    mocks.registrations.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return new Promise<DetailRegistration[]>(() => {});
      if (calls === 2) return Promise.reject(new Error('offline'));
      return Promise.resolve([{ ...self, userName: '重試後參加者' }]);
    });
    mocks.viewer.mockReturnValue(manager());
    mount();
    await screen.findByText('名單載入中...');
    expect(mocks.registrations).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
    const region = await screen.findByRole('region', { name: '參加名單' });
    await within(region).findByText('無法載入參加名單，請重試。');
    expect(within(region).queryByText('名單載入中...')).toBeNull();
    expect(mocks.registrations).toHaveBeenCalledTimes(2);

    fireEvent.click(within(region).getByRole('button', { name: '重試' }));
    await within(region).findByText('重試後參加者');
    expect(within(region).queryByText('名單載入中...')).toBeNull();
    expect(mocks.registrations).toHaveBeenCalledTimes(3);
    expect(mocks.registrations).toHaveBeenLastCalledWith('firestore-doc-a');
  });

  it('重新整理找不到活動時，已展開的載入中改為錯誤', async () => {
    let calls = 0;
    mocks.registrations.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return new Promise<DetailRegistration[]>(() => {});
      return Promise.resolve([]);
    });
    mocks.viewer.mockReturnValue(manager());
    mount();
    await screen.findByText('名單載入中...');
    mocks.detail.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
    const region = await screen.findByRole('region', { name: '參加名單' });
    await within(region).findByText('無法載入參加名單，請重試。');
    expect(within(region).queryByText('名單載入中...')).toBeNull();
    expect(within(region).getByRole('button', { name: '重試' })).toBeTruthy();
    expect(mocks.toastShow).toHaveBeenCalledWith({ message: '刷新失敗，找不到最新活動資料' });
  });

  it('setReload 重新載入後管理者再自動展開一次且 registrations 只讀一次', async () => {
    mocks.viewer.mockReturnValue(manager());
    mocks.registrations.mockResolvedValue([self]);
    mocks.history.mockRejectedValueOnce(new Error('offline'));
    mount();
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledWith('firestore-doc-a');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('無法同步你的報名狀態，請重試後再報名。');
    mocks.registrations.mockClear();
    fireEvent.click(within(alert).getByRole('button', { name: '重試' }));
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    await screen.findByRole('button', { name: '管理名單', exact: true });
    expect(screen.queryByRole('button', { name: '管理名單 / 出席紀錄' })).toBeNull();
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledWith('firestore-doc-a');
  });
});

describe('T-088 背景刷新晚到', () => {
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  function manager(): ViewerView {
    return {
      ...viewer,
      uid: 'uidA',
      displayName: '甲',
      capabilities: ['user.activity.site_operate', 'user.activity.addons_use'],
    };
  }

  const rosterReg: DetailRegistration = {
    _docId: 'targetA',
    eventId: 'evtA',
    userId: 'uidB',
    userName: '乙',
    participantType: 'self',
    status: 'confirmed',
  };

  const teamSplit = {
    enabled: true,
    mode: 'random',
    teams: [
      { key: 'A', color: '#EF4444', name: '紅隊' },
      { key: 'B', color: '#3B82F6', name: '藍隊' },
    ],
  };

  function detailFor(withTeams: boolean): LoadedEventDetail {
    return {
      eventDocId: 'evtA',
      event: {
        ...detail.event,
        id: 'evtA',
        creatorUid: 'uidA',
        title: '週末活動',
        max: 10,
        ...(withTeams ? { teamSplit } : {}),
      } as LoadedEventDetail['event'],
    };
  }

  function mountEvt(): ReturnType<typeof render> {
    history.replaceState(null, '', '/events/evtA');
    return render(<LocationProvider><EventDetailPage id="evtA" /></LocationProvider>);
  }

  function attendanceRowText(name: string): string {
    const table = document.querySelector('#detail-attendance-table');
    const row = Array.from(table?.querySelectorAll('tr') ?? [])
      .find((tr) => tr.textContent?.includes(name));
    return row?.textContent ?? '';
  }

  function teamCountTexts(): string[] {
    return Array.from(document.querySelectorAll('.team-stat-text'))
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
  }

  const checkin = {
    _docId: 'targetA',
    uid: 'uidB',
    userName: '乙',
    type: 'checkin',
    status: 'active',
  };

  async function clickEnabledSignup(): Promise<void> {
    await waitFor(() => expect(
      (screen.getByRole('button', { name: '立即報名' }) as HTMLButtonElement).disabled,
    ).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '立即報名' }));
  }

  // 晚到資料的提交排在 act 收尾之後：多沖兩輪巨集任務，讓提交、render、effect 都完成再斷言。
  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  it('refresh 的舊出席讀取晚到時，保留期間重讀寫入的新紀錄', async () => {
    mocks.viewer.mockReturnValue(manager());
    mocks.detail.mockResolvedValue(detailFor(false));
    mocks.registrations.mockResolvedValue([rosterReg]);
    mocks.attendance.mockResolvedValue([]);
    mocks.settleAttendance.mockResolvedValue({
      ok: true,
      added: 0,
      removed: 0,
      targets: [],
      granted: [],
      skippedAlready: [],
      skippedZeroAmount: false,
      failed: [],
    });
    mountEvt();
    await screen.findByText('乙');
    fireEvent.click(screen.getByRole('button', { name: '管理名單', exact: true }));
    await screen.findByRole('button', { name: '完成' });

    const queued: Array<ReturnType<typeof deferred<unknown[]>>> = [];
    mocks.attendance.mockImplementation(() => {
      const item = deferred<unknown[]>();
      queued.push(item);
      return item.promise;
    });
    await clickEnabledSignup();
    await waitFor(() => expect(queued.length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(queued.length).toBe(2));
    const stale = queued[0];
    const reloaded = queued[1];
    if (!stale || !reloaded) throw new Error('需要 refresh 與出席重讀各一次');

    await act(async () => {
      reloaded.resolve([checkin]);
    });
    await waitFor(() => expect(attendanceRowText('乙')).toContain('✓'));

    await act(async () => {
      stale.resolve([]);
    });
    await settle();
    expect(attendanceRowText('乙')).toContain('✓');
  });

  it('期間的出席重讀失敗時，晚到的 refresh 出席讀取結果仍被採用', async () => {
    mocks.viewer.mockReturnValue(manager());
    mocks.detail.mockResolvedValue(detailFor(false));
    mocks.registrations.mockResolvedValue([rosterReg]);
    mocks.attendance.mockResolvedValue([]);
    mocks.settleAttendance.mockResolvedValue({
      ok: true,
      added: 0,
      removed: 0,
      targets: [],
      granted: [],
      skippedAlready: [],
      skippedZeroAmount: false,
      failed: [],
    });
    mountEvt();
    await screen.findByText('乙');
    fireEvent.click(screen.getByRole('button', { name: '管理名單', exact: true }));
    await screen.findByRole('button', { name: '完成' });

    const refreshRead = deferred<unknown[]>();
    let reads = 0;
    mocks.attendance.mockImplementation(() => {
      reads += 1;
      // 第 1 次是 refresh 的讀取（掛起）；第 2 次是結算後的出席重讀（失敗）。
      return reads === 1 ? refreshRead.promise : Promise.reject(new Error('offline'));
    });
    await clickEnabledSignup();
    await waitFor(() => expect(reads).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(reads).toBe(2));

    // 重讀沒有寫入快照：不得因此丟掉同時進行的 refresh 讀到的新出席。
    await act(async () => {
      refreshRead.resolve([checkin]);
    });
    await waitFor(() => expect(attendanceRowText('乙')).toContain('✓'));
  });

  it('沒有出席重讀介入時，refresh 的出席讀取結果照常採用', async () => {
    mocks.viewer.mockReturnValue(manager());
    mocks.detail.mockResolvedValue(detailFor(false));
    mocks.registrations.mockResolvedValue([rosterReg]);
    mocks.attendance.mockResolvedValue([]);
    mountEvt();
    await screen.findByText('乙');
    expect(attendanceRowText('乙')).not.toContain('✓');

    const callsBefore = mocks.attendance.mock.calls.length;
    const refreshAttendance = deferred<unknown[]>();
    mocks.attendance.mockImplementation(() => refreshAttendance.promise);
    await clickEnabledSignup();
    await waitFor(() => expect(mocks.attendance.mock.calls.length).toBe(callsBefore + 1));

    await act(async () => {
      refreshAttendance.resolve([checkin]);
    });
    await waitFor(() => expect(attendanceRowText('乙')).toContain('✓'));
  });

  it('refresh 的舊名單晚到時，保留期間發布的 teamKey', async () => {
    mocks.viewer.mockReturnValue(manager());
    mocks.detail.mockResolvedValue(detailFor(true));
    mocks.registrations.mockResolvedValue([{ ...rosterReg, teamKey: 'A' }]);
    mountEvt();
    await screen.findByText('乙');
    const fill = await screen.findByRole('button', { name: '補齊' });
    await waitFor(() => {
      const counts = teamCountTexts();
      expect(counts[0]?.startsWith('1')).toBe(true);
      expect(counts[1]?.startsWith('0')).toBe(true);
    });

    const refreshRows = deferred<Array<typeof rosterReg & { teamKey: string }>>();
    const callsBefore = mocks.registrations.mock.calls.length;
    mocks.registrations.mockImplementation(() => refreshRows.promise);
    await clickEnabledSignup();
    await waitFor(() => expect(mocks.registrations.mock.calls.length).toBe(callsBefore + 1));

    fireEvent.click(fill);
    await waitFor(() => {
      const counts = teamCountTexts();
      expect(counts[0]?.startsWith('0')).toBe(true);
      expect(counts[1]?.startsWith('1')).toBe(true);
    });

    // 晚到的舊名單多帶一位「丙」當提交記號：看到丙代表這份讀取確實被採用，才有資格斷言 teamKey。
    await act(async () => {
      refreshRows.resolve([
        { ...rosterReg, teamKey: 'A' },
        { ...rosterReg, _docId: 'targetC', userId: 'uidC', userName: '丙', teamKey: 'A' },
      ]);
    });
    await screen.findByText('丙');
    await settle();
    const counts = teamCountTexts();
    expect(counts[0]?.startsWith('1')).toBe(true);
    expect(counts[1]?.startsWith('1')).toBe(true);
  });

  it('期間沒有分隊發布時，晚到的 refresh registrations 原樣採用', async () => {
    const stalled = deferred<unknown[]>();
    const refreshRows = deferred<unknown[]>();
    let calls = 0;
    mocks.registrations.mockImplementation(() => {
      calls += 1;
      return calls <= 2 ? stalled.promise : refreshRows.promise;
    });
    mocks.viewer.mockReturnValue(manager());
    mocks.detail.mockResolvedValue(detailFor(true));
    mountEvt();
    await screen.findByRole('button', { name: '立即報名' });
    await waitFor(() => expect(calls).toBe(2));
    await waitFor(() => {
      const counts = teamCountTexts();
      expect(counts[0]?.startsWith('0')).toBe(true);
      expect(counts[1]?.startsWith('0')).toBe(true);
    });

    await clickEnabledSignup();
    await waitFor(() => expect(calls).toBe(3));
    await act(async () => {
      refreshRows.resolve([{ ...rosterReg, teamKey: 'B' }]);
    });
    await waitFor(() => {
      const counts = teamCountTexts();
      expect(counts[0]?.startsWith('0')).toBe(true);
      expect(counts[1]?.startsWith('1')).toBe(true);
    });

    await act(async () => {
      stalled.resolve([]);
    });
    await settle();
    const counts = teamCountTexts();
    expect(counts[0]?.startsWith('0')).toBe(true);
    expect(counts[1]?.startsWith('1')).toBe(true);
  });
});


describe('T-073b 頁面共用權限與補正保底', () => {
  beforeEach(() => {
    mocks.registrations.mockResolvedValue([self]);
    mocks.roles.mockReturnValue({ u1: 'user' });
    mocks.noShowStats.mockReturnValue({ noShowCount: 2, endedRegCount: 3, lastEventWasNoShow: true });
    mocks.noShowAdjustments.mockResolvedValue(new Map([['u1', -1]]));
  });

  it.each(['activity.view_noshow', 'admin.repair.no_show_adjust'])(
    '只有 %s：展開名單也零讀取（不讀補正、不讀 userAttendanceStats），不染色／不出泡泡，無管理欄（測試同步更新：站長 11-06 放鴿子／出席率 v2）', async permission => {
      mocks.viewer.mockReturnValue({ ...viewer, hasPermission: (code: string) => code === permission });
      const view = mount();
      await screen.findByRole('heading', { level: 2 });
      expect(mocks.noShowAdjustments).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '查看出席紀錄' }));
      await screen.findByText('小明');
      await act(async () => {});
      expect(view.container.querySelector('.uc-att-warn, .uc-recent-noshow')).toBeNull();
      // 一般瀏覽（非管理名單）不讀 userCorrections／userAttendanceStats。
      expect(mocks.noShowAdjustments).not.toHaveBeenCalled();
      expect(mocks.noShowCounted).not.toHaveBeenCalled();
      expect(screen.queryByRole('columnheader', { name: '放鴿子／計入場次' })).toBeNull();
      expect(screen.queryByRole('button', { name: '管理名單', exact: true })).toBeNull();
    },
  );

  it('無權限即使有統計快取也不讀補正、不染色', async () => {
    const view = mount();
    await screen.findByRole('heading', { level: 2 });
    fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
    await screen.findByText('小明');
    expect(mocks.noShowAdjustments).not.toHaveBeenCalled();
    expect(view.container.querySelector('.uc-att-warn, .uc-recent-noshow')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '放鴿子／計入場次' })).toBeNull();
  });

  it('主辦人共用現場操作權：一般模式不染色，管理模式才出現補正後「放鴿子/計入」', async () => {
    mocks.viewer.mockReturnValue({ ...viewer, uid: 'host1', capabilities: ['user.activity.site_operate'] });
    const view = mount();
    await screen.findByRole('button', { name: '管理名單', exact: true });
    await act(async () => {});
    expect(view.container.querySelector('.uc-att-warn, .uc-recent-noshow')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '放鴿子／計入場次' })).toBeNull();
    // 一般瀏覽零讀取：補正與 userAttendanceStats 都等到進管理名單才讀。
    expect(mocks.noShowAdjustments).not.toHaveBeenCalled();
    expect(mocks.noShowCounted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '管理名單', exact: true }));
    await screen.findByRole('columnheader', { name: '放鴿子／計入場次' });
    await waitFor(() => expect(mocks.noShowCounted).toHaveBeenCalledWith(['u1'], true));
    // 沒有 countedSince（v2 資料）→ 退回 users 三欄＋舊補正：2 次補正 -1、計入 3。
    await waitFor(() => expect(view.container.querySelector('tbody span[title^="放鴿子"]')?.textContent).toBe('1/3'));
    expect(view.container.querySelector('.uc-att-warn, .uc-recent-noshow')).toBeNull();
    expect(view.container.querySelector('#detail-attendance-table table')?.classList.contains('att-roster-managing')).toBe(true);
  });

  it('管理名單：userAttendanceStats 有 countedSince 的人顯示放鴿子/計入並標紅，且不套舊補正', async () => {
    mocks.viewer.mockReturnValue({ ...viewer, uid: 'host1', capabilities: ['user.activity.site_operate'] });
    mocks.noShowCounted.mockResolvedValue(new Map([['u1', { noShowCount: 6, countedCount: 10 }]]));
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: '管理名單', exact: true }));
    await screen.findByRole('columnheader', { name: '放鴿子／計入場次' });
    // 舊補正 -1 不套用：6/10（≥3 場且 ≥50% 標紅）
    await waitFor(() => expect(view.container.querySelector('tbody span[title^="放鴿子"]')?.textContent).toBe('6/10'));
    expect((view.container.querySelector('tbody span[title^="放鴿子"]') as HTMLElement).style.color).toBe('var(--danger)');
    expect(mocks.noShowCounted).toHaveBeenCalledTimes(1);
    expect(mocks.noShowAdjustments).toHaveBeenCalledTimes(1);
  });

  it('管理名單：userAttendanceStats 讀取失敗不回退 users 三欄、不露錯誤，管理欄留空', async () => {
    mocks.viewer.mockReturnValue({ ...viewer, uid: 'host1', capabilities: ['user.activity.site_operate'] });
    mocks.noShowCounted.mockRejectedValue(new Error('private counted failure'));
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: '管理名單', exact: true }));
    await screen.findByRole('columnheader', { name: '放鴿子／計入場次' });
    await waitFor(() => expect(mocks.noShowCounted).toHaveBeenCalled());
    await act(async () => {});
    expect(mocks.noShowCounted).toHaveBeenCalledTimes(1);
    const table = view.container.querySelector('#detail-attendance-table table') as HTMLTableElement;
    const index = Array.from(table.querySelectorAll('th')).findIndex(th => th.textContent === '🕊');
    expect(table.querySelector<HTMLTableRowElement>('tbody tr')?.cells[index]?.textContent).toBe('');
    expect(view.container.textContent).not.toContain('private counted failure');
    expect(mocks.toastShow).not.toHaveBeenCalled();
  });

  it('補正讀取失敗不回退 raw、不顯示錯誤，管理欄留空', async () => {
    mocks.viewer.mockReturnValue({ ...viewer, uid: 'host1', capabilities: ['user.activity.site_operate'] });
    mocks.noShowAdjustments.mockRejectedValue(new Error('private correction failure'));
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: '管理名單', exact: true }));
    await screen.findByRole('columnheader', { name: '放鴿子／計入場次' });
    await waitFor(() => expect(mocks.noShowAdjustments).toHaveBeenCalled());
    await act(async () => {});
    expect(view.container.querySelector('.uc-att-warn, .uc-recent-noshow')).toBeNull();
    const table = view.container.querySelector('#detail-attendance-table table') as HTMLTableElement;
    const index = Array.from(table.querySelectorAll('th')).findIndex(th => th.textContent === '🕊');
    expect(table.querySelector<HTMLTableRowElement>('tbody tr')?.cells[index]?.textContent).toBe('');
    expect(view.container.textContent).not.toContain('private correction failure');
    expect(mocks.toastShow).not.toHaveBeenCalled();
  });
});

describe('T-074b 詳情頁整合', () => {
  const teams = [
    { teamId: 't1', teamName: '一隊', reservedSlots: 3, usedSlots: 1, remainingSlots: 2 },
    { teamId: 't2', teamName: '二隊', reservedSlots: 1, usedSlots: 0, remainingSlots: 1 },
  ];
  const staffViewer = { ...viewer, teamIds: new Set(['t1', 't2']),
    staffTeams: [{ id: 't1', name: '一隊' }, { id: 't2', name: '二隊' }] };
  const activity = { ...detail.event, creatorUid: 'u1', current: 4, realCurrent: 1, max: 10,
    waitlist: 1, teamReservationSummaries: teams };
  const waiting = { _docId: 'wait-doc', id: 'wait-id', eventId: detail.event.id,
    userId: 'u1', userName: '候補本人', participantType: 'self', status: 'waitlisted',
    teamReservationTeamId: 't1', teamReservationTeamName: '一隊', teamSeatSource: 'waitlist' };
  const updated = { current: 3, realCurrent: 1, waitlist: 0, status: 'open',
    participants: ['候補本人'], waitlistNames: [], participantsWithUid: [{ uid: 'u1', name: '候補本人' }],
    waitlistWithUid: [], teamReservationSummaries: [{ ...teams[0], reservedSlots: 2, usedSlots: 1, remainingSlots: 1 }] };
  const success = { success: true, event: updated,
    promoted: [{ id: 'wait-id', docId: 'wait-doc', userId: 'u1', userName: '候補本人', teamSeatSource: 'reserved' }] };
  beforeEach(() => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
    localStorage.clear();
    mocks.viewer.mockReturnValue(staffViewer);
    mocks.detail.mockResolvedValue({ ...detail, event: activity });
    mocks.reservationSignupEvent = activity;
  });
  async function openReservationRoster() {
    mount();
    // 此職員 fixture 未授予活動現場管理權，沿既有流程按需展開公開名單。
    fireEvent.click(await screen.findByRole('button', { name: '查看出席名單' }));
    await waitFor(() => expect(document.querySelector('.team-reservation-header-row')).toBeTruthy());
  }
  async function adjust(value = '2') {
    fireEvent.click(await screen.findByRole('button', { name: '調整名額' }));
    fireEvent.input(screen.getByLabelText('團隊名額'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '確認', exact: true }));
  }
  it('管理員若不是俱樂部職員，兩個入口都不顯示', async () => {
    mocks.viewer.mockReturnValue({ ...staffViewer, role: 'admin', roleLevel: 4,
      hasPermission: () => true, staffTeams: [] });
    mount();
    await waitFor(() => expect(document.querySelector('.team-reservation-header-row')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /調整名額|團隊報名|快速調整/ })).toBeNull();
  });
  it('名單快速調整預選該隊，非該隊職員沒有入口', async () => {
    mocks.viewer.mockReturnValue({ ...staffViewer, staffTeams: [{ id: 't2', name: '二隊' }] });
    await openReservationRoster();
    const button = await screen.findByRole('button', { name: '快速調整' });
    expect(button.closest('tr')?.textContent).toContain('二隊');
    expect(screen.getAllByRole('button', { name: '快速調整' })).toHaveLength(1);
    fireEvent.click(button);
    expect((screen.getByLabelText('俱樂部') as HTMLSelectElement).value).toBe('t2');
  });
  it('成功更新摘要、正候補名單與本人按鈕，只重讀該活動報名一次', async () => {
    mocks.registrations.mockResolvedValue([waiting]);
    mocks.history.mockResolvedValue([waiting]);
    const callable = vi.fn(async () => success);
    registerCallableMock('adjustTeamReservation', callable);
    await openReservationRoster();
    await screen.findAllByRole('button', { name: '快速調整' });
    expect(screen.getByRole('button', { name: '取消候補' })).toBeTruthy();
    const calls = [mocks.detail.mock.calls.length, mocks.registrations.mock.calls.length, mocks.history.mock.calls.length];
    mocks.registrations.mockResolvedValue([{ ...waiting, status: 'confirmed', teamSeatSource: 'reserved' }]);
    await adjust();
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith({ message: '已更新團隊名額' }));
    expect(screen.getByRole('button', { name: '取消報名' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '取消候補' })).toBeNull();
    expect(document.querySelector('#detail-attendance-table')?.textContent).toContain('候補本人');
    expect(document.querySelector('#detail-waitlist-container')?.textContent).not.toContain('候補本人');
    expect(document.querySelector('.team-reservation-seats')?.getAttribute('aria-label')).toContain('佔位 2，');
    expect([mocks.detail.mock.calls.length, mocks.registrations.mock.calls.length, mocks.history.mock.calls.length])
      .toEqual([calls[0], calls[1]! + 1, calls[2]]);
    expect(mocks.registrations).toHaveBeenLastCalledWith(detail.eventDocId);
    expect(callable).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('候補原無團隊標記，遞補耗盡席位仍保留俱樂部標頭與快速調整（舊讀取晚到 %s）', async lateRefresh => {
    const untagged = { ...waiting, teamReservationTeamId: undefined, teamReservationTeamName: undefined };
    const confirmed = { _docId: 'confirmed-doc', id: 'confirmed-id', eventId: detail.event.id,
      userId: 'u2', userName: '原正取', participantType: 'self', status: 'confirmed' };
    const rows = [confirmed, untagged];
    mocks.detail.mockResolvedValue({ ...detail, event: { ...activity, current: 2, realCurrent: 1, max: 2,
      teamReservationSummaries: [{ ...teams[0], reservedSlots: 1, usedSlots: 0, remainingSlots: 1 }] } });
    mocks.registrations.mockResolvedValue(rows);
    mocks.history.mockResolvedValue([untagged]);
    const callable = vi.fn(async () => ({ ...success, event: { ...updated,
      current: 2, realCurrent: 2, status: 'full', participants: ['原正取', '候補本人'],
      participantsWithUid: [
        { uid: 'u2', name: '原正取' },
        { uid: 'u1', name: '候補本人', teamReservationTeamId: 't1', teamReservationTeamName: '一隊', teamSeatSource: 'reserved' },
      ],
      teamReservationSummaries: [{ ...teams[0], reservedSlots: 1, usedSlots: 1, remainingSlots: 0 }],
    } }));
    registerCallableMock('adjustTeamReservation', callable);
    await openReservationRoster();
    expect(screen.getByRole('button', { name: '取消候補' })).toBeTruthy();
    let resolve: ((rows: unknown[]) => void) | undefined;
    if (lateRefresh) {
      mocks.registrations.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
      fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
      await waitFor(() => expect(resolve).toBeTypeOf('function'));
    }
    const reads = [mocks.detail.mock.calls.length, mocks.registrations.mock.calls.length, mocks.history.mock.calls.length, mocks.offlineFirebase.mock.calls.length];
    mocks.registrations.mockResolvedValue([confirmed, { ...waiting, status: 'confirmed', teamSeatSource: 'reserved' }]);
    await adjust('1');
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith({ message: '已更新團隊名額' }));
    if (resolve) {
      await act(async () => { resolve!([...rows, { ...confirmed, _docId: 'fresh-marker', id: 'fresh-marker',
        userId: 'u3', userName: '晚到未標記快照記號' }]); });
      expect(screen.queryByText('晚到未標記快照記號')).toBeNull();
    }
    expect(screen.getByRole('button', { name: '取消報名' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '取消候補' })).toBeNull();
    const headers = document.querySelectorAll('.team-reservation-header-row');
    expect(headers).toHaveLength(1);
    expect(headers[0]!.textContent).toContain('一隊');
    expect(within(headers[0] as HTMLElement).getByRole('button', { name: '快速調整' })).toBeTruthy();
    expect(document.querySelector('.team-reservation-member-row')?.textContent).toContain('候補本人');
    expect(document.querySelector('.team-reservation-placeholder-row')).toBeNull();
    expect(document.querySelector('#detail-waitlist-container')?.textContent).not.toContain('候補本人');
    expect([mocks.detail.mock.calls.length, mocks.registrations.mock.calls.length, mocks.history.mock.calls.length, mocks.offlineFirebase.mock.calls.length])
      .toEqual([reads[0], reads[1]! + 1, reads[2], reads[3]]);
    expect(mocks.registrations).toHaveBeenLastCalledWith(detail.eventDocId);
    expect(callable).toHaveBeenCalledTimes(1);
    expect(untagged.teamReservationTeamId).toBeUndefined();
    expect(untagged.status).toBe('waitlisted');
  });
  it('較早開始的重新整理晚到，保留最新摘要與遞補狀態', async () => {
    mocks.registrations.mockResolvedValue([waiting]);
    mocks.history.mockResolvedValue([waiting]);
    registerCallableMock('adjustTeamReservation', async () => success);
    await openReservationRoster();
    await screen.findAllByRole('button', { name: '快速調整' });
    let resolve!: (rows: unknown[]) => void;
    mocks.registrations.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
    mocks.registrations.mockResolvedValue([{ ...waiting, status: 'confirmed', teamSeatSource: 'reserved' }]);
    await adjust();
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith({ message: '已更新團隊名額' }));
    await act(async () => { resolve([waiting, { _docId: 'fresh-marker', eventId: detail.event.id,
      userId: 'u2', userName: '晚到讀取記號', participantType: 'self', status: 'confirmed' }]); });
    expect(screen.queryByText('晚到讀取記號')).toBeNull();
    expect(screen.getByRole('button', { name: '取消報名' })).toBeTruthy();
    expect(document.querySelector('#detail-waitlist-container')?.textContent).not.toContain('候補本人');
    expect(document.querySelector('.team-reservation-seats')?.getAttribute('aria-label')).toContain('佔位 2，');
  });
  function deferredReservationRead() {
    let resolve!: (rows: unknown[]) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<unknown[]>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  }
  it.each(['沒有舊讀取', '舊讀取先完成', '舊讀取後完成'] as const)(
    'promoted=[] 的既有正取補歸屬後，以完整重讀建立標頭與快速調整：%s', async order => {
      const member = { ...self, id: 'member-id', userName: '既有正取會員' };
      const stamped = { ...member, teamReservationTeamId: 't1', teamReservationTeamName: '一隊', teamSeatSource: 'reserved' };
      mocks.detail.mockResolvedValue({ ...detail, event: { ...activity, current: 1, realCurrent: 1, max: 2,
        waitlist: 0, teamReservationSummaries: [] } });
      mocks.registrations.mockResolvedValue([member]);
      mocks.history.mockResolvedValue([member]);
      const callable = vi.fn(async () => ({ success: true, promoted: [], event: { ...updated,
        current: 1, realCurrent: 1, participants: [member.userName],
        participantsWithUid: [{ uid: member.userId, name: member.userName,
          teamReservationTeamId: 't1', teamReservationTeamName: '一隊' }],
        teamReservationSummaries: [{ ...teams[0], reservedSlots: 1, usedSlots: 1, remainingSlots: 0 }],
      } }));
      registerCallableMock('adjustTeamReservation', callable);
      mount();
      fireEvent.click(await screen.findByRole('button', { name: '查看出席名單' }));
      await screen.findByText(member.userName);
      expect(document.querySelector('.team-reservation-header-row')).toBeNull();
      const stale = deferredReservationRead();
      if (order !== '沒有舊讀取') {
        mocks.registrations.mockReturnValueOnce(stale.promise);
        fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
        await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(2));
      }
      const refresh = deferredReservationRead();
      mocks.registrations.mockReturnValueOnce(refresh.promise);
      const reads = [mocks.registrations.mock.calls.length, mocks.detail.mock.calls.length,
        mocks.history.mock.calls.length, mocks.attendance.mock.calls.length, mocks.offlineFirebase.mock.calls.length];
      fireEvent.click(screen.getByRole('button', { name: '團隊報名' }));
      fireEvent.input(screen.getByLabelText('團隊名額'), { target: { value: '1' } });
      const confirmButton = screen.getByRole('button', { name: '確認', exact: true });
      fireEvent.click(confirmButton); fireEvent.click(confirmButton);
      await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(reads[0]! + 1));
      expect(mocks.registrations).toHaveBeenLastCalledWith(detail.eventDocId);
      expect(document.querySelector('.team-reservation-header-row')).toBeNull();
      expect(mocks.toastShow).toHaveBeenCalledWith({ message: '已更新團隊名額' });
      const adjustButton = screen.getByRole('button', { name: '調整名額' }) as HTMLButtonElement;
      expect(adjustButton.disabled).toBe(true);
      fireEvent.click(adjustButton); fireEvent.click(adjustButton);
      fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      const finishStale = async () => {
        await act(async () => { stale.resolve([member, { ...self, userId: 'stale', userName: '過期名單記號' }]); });
        expect(screen.queryByText('過期名單記號')).toBeNull();
      };
      if (order === '舊讀取先完成') await finishStale();
      await act(async () => { refresh.resolve([stamped]); });
      await waitFor(() => expect(adjustButton.disabled).toBe(false));
      if (order === '舊讀取後完成') await finishStale();
      const headers = document.querySelectorAll('.team-reservation-header-row');
      expect(headers).toHaveLength(1);
      expect(headers[0]!.textContent).toContain('一隊');
      expect(document.querySelector('.team-reservation-seats')?.getAttribute('aria-label')).toContain('佔位 1，');
      expect(within(headers[0] as HTMLElement).getByRole('button', { name: '快速調整' })).toBeTruthy();
      expect(document.querySelector('.team-reservation-member-row')?.textContent).toContain(member.userName);
      expect(document.querySelector('.team-reservation-placeholder-row')).toBeNull();
      expect(screen.getByRole('button', { name: '取消報名' })).toBeTruthy();
      expect(callable).toHaveBeenCalledTimes(1);
      expect([mocks.registrations.mock.calls.length, mocks.detail.mock.calls.length,
        mocks.history.mock.calls.length, mocks.attendance.mock.calls.length, mocks.offlineFirebase.mock.calls.length])
        .toEqual([reads[0]! + 1, ...reads.slice(1)]);
      expect(member).not.toHaveProperty('teamReservationTeamId');
    },
  );
  it('完整重讀同時採用既有正取與候補歸屬，不把同 UID 同行者改正取', async () => {
    const member = { ...self, id: 'member', userName: '既有正取會員' };
    const waiter = { ...waiting, userId: 'u2', userName: '既有候補會員', teamReservationTeamId: undefined,
      teamReservationTeamName: undefined };
    const companion = { ...waiting, _docId: 'companion-doc', id: 'companion', participantType: 'companion',
      companionId: 'c1', companionName: '同 UID 同行者', userName: '同 UID 同行者',
      teamReservationTeamId: undefined, teamReservationTeamName: undefined };
    const outsider = { ...self, _docId: 'outsider', id: 'outsider', userId: 'u3', userName: '其他正取' };
    const summary = { ...teams[0], reservedSlots: 1, usedSlots: 1, remainingSlots: 0 };
    mocks.detail.mockResolvedValue({ ...detail, event: { ...activity, current: 2, realCurrent: 2, max: 2,
      status: 'full', waitlist: 2, teamReservationSummaries: [summary] } });
    mocks.registrations.mockResolvedValue([member, outsider, waiter, companion]);
    mocks.history.mockResolvedValue([member, companion]);
    registerCallableMock('adjustTeamReservation', async () => ({ ...success, promoted: [], event: { ...updated,
      current: 2, realCurrent: 2, status: 'full', waitlist: 2, participants: [member.userName, outsider.userName],
      participantsWithUid: [{ uid: 'u1', name: member.userName,
        teamReservationTeamId: 't1', teamReservationTeamName: '一隊' }, { uid: 'u3', name: outsider.userName }],
      waitlistNames: [waiter.userName, companion.companionName],
      waitlistWithUid: [{ uid: 'u2', name: waiter.userName, teamReservationTeamId: 't1', teamReservationTeamName: '一隊' }],
      teamReservationSummaries: [summary],
    } }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '查看出席名單' }));
    await screen.findByText(member.userName);
    expect(document.querySelector('.team-reservation-header-row')).toBeNull();
    mocks.registrations.mockResolvedValue([
      { ...member, teamReservationTeamId: 't1', teamReservationTeamName: '一隊', teamSeatSource: 'reserved' },
      { ...waiter, teamReservationTeamId: 't1', teamReservationTeamName: '一隊', teamSeatSource: 'waitlist' },
      outsider, companion,
    ]);
    await adjust('1');
    await screen.findByRole('button', { name: '快速調整' });
    expect(document.querySelectorAll('.team-reservation-header-row')).toHaveLength(1);
    expect(document.querySelector('.team-reservation-member-row')?.textContent).toContain(member.userName);
    expect(document.querySelector('#detail-waitlist-container')?.textContent).toContain(waiter.userName);
    expect(document.querySelector('#detail-waitlist-container')?.textContent).toContain(companion.companionName);
    expect(document.querySelector('#detail-attendance-table')?.textContent).not.toContain(companion.companionName);
    expect(mocks.registrations).toHaveBeenCalledTimes(2);
  });
  it.each([
    { permission: 'activity.view_noshow', expanded: false },
    { permission: 'admin.repair.no_show_adjust', expanded: false },
    { permission: 'activity.view_noshow', expanded: true },
    { permission: 'admin.repair.no_show_adjust', expanded: true },
  ])('只有 $permission 的職員調整名額後保留簽到與備註，出席只讀一次（先展開 $expanded）', async ({ permission, expanded }) => {
    mocks.viewer.mockReturnValue({ ...staffViewer, hasPermission: (code: string) => code === permission });
    const member = { ...self, id: 'member-id', userName: '已簽到會員',
      teamReservationTeamId: 't1', teamReservationTeamName: '一隊', teamSeatSource: 'reserved' };
    const note = '調整名額前已填的出席備註';
    mocks.registrations.mockResolvedValue([member]);
    mocks.history.mockResolvedValue([member]);
    mocks.attendance.mockResolvedValue([
      { _docId: 'checkin-member', uid: member.userId, type: 'checkin', status: 'active' },
      { _docId: 'note-member', uid: member.userId, type: 'note', status: 'active', note },
    ]);
    const callable = vi.fn(async () => ({ ...success, promoted: [], event: { ...updated,
      participants: [member.userName], participantsWithUid: [{ uid: member.userId, name: member.userName }],
    } }));
    registerCallableMock('adjustTeamReservation', callable);
    mount();
    const open = await screen.findByRole('button', { name: '查看出席紀錄' });
    expect(screen.queryByRole('button', { name: '管理名單 / 出席紀錄' })).toBeNull();
    expect(mocks.registrations).not.toHaveBeenCalled();
    expect(mocks.attendance).not.toHaveBeenCalled();
    const expectAttendance = async () => {
      const row = (await screen.findByText(member.userName)).closest('tr')!;
      const cells = within(row).getAllByRole('cell');
      expect(cells[1]!.textContent).toBe('✓');
      expect(cells[2]!.textContent).toBe('');
      expect(cells[3]!.textContent).toBe(note);
    };
    if (expanded) {
      fireEvent.click(open);
      await expectAttendance();
    }
    const reads = [mocks.registrations.mock.calls.length, mocks.detail.mock.calls.length,
      mocks.history.mock.calls.length, mocks.attendance.mock.calls.length];
    await adjust();
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith({ message: '已更新團隊名額' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '調整名額' }) as HTMLButtonElement).disabled).toBe(false));
    expect([mocks.registrations.mock.calls.length, mocks.detail.mock.calls.length,
      mocks.history.mock.calls.length, mocks.attendance.mock.calls.length])
      .toEqual([reads[0]! + 1, ...reads.slice(1)]);
    if (!expanded) fireEvent.click(screen.getByRole('button', { name: '查看出席紀錄' }));
    await expectAttendance();
    expect(mocks.attendance).toHaveBeenCalledTimes(1);
    expect(mocks.attendance).toHaveBeenLastCalledWith(detail.eventDocId);
    expect(mocks.registrations).toHaveBeenCalledTimes(2);
    expect(callable).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.team-reservation-member-row')?.textContent).toContain(member.userName);
    expect(document.querySelector('.team-reservation-seats')?.getAttribute('aria-label')).toContain('佔位 2，');
  });
  it.each([
    'activity.view_noshow', 'admin.repair.no_show_adjust',
  ].flatMap(permission => [true, false].flatMap(openBeforeRefresh =>
    [true, false].map(registrationsFirst => ({ permission, openBeforeRefresh, registrationsFirst })),
  )))('名額重讀鎖與完整出席載入：$permission，重讀完成前點擊 $openBeforeRefresh，報名先完成 $registrationsFirst', async ({ permission, openBeforeRefresh, registrationsFirst }) => {
    mocks.viewer.mockReturnValue({ ...staffViewer, hasPermission: (code: string) => code === permission });
    const member = { ...self, id: 'member-id', userName: '重讀後簽到會員',
      teamReservationTeamId: 't1', teamReservationTeamName: '一隊', teamSeatSource: 'reserved' };
    const waiter = { ...waiting, userId: 'u2', userName: '重讀後候補會員' };
    const rows = [member, waiter];
    const note = '完整出席重讀備註';
    const attendanceRows = [
      { _docId: 'checkin-member', uid: member.userId, type: 'checkin', status: 'active' },
      { _docId: 'note-member', uid: member.userId, type: 'note', status: 'active', note },
    ];
    const refresh = deferredReservationRead();
    const registrations = deferredReservationRead();
    const attendance = deferredReservationRead();
    mocks.registrations.mockReturnValueOnce(refresh.promise).mockReturnValueOnce(registrations.promise);
    mocks.attendance.mockReturnValueOnce(attendance.promise);
    mocks.history.mockResolvedValue([member]);
    const callable = vi.fn(async () => ({ ...success, promoted: [], event: { ...updated,
      waitlist: 1, participants: [member.userName],
      participantsWithUid: [{ uid: member.userId, name: member.userName }],
      waitlistNames: [waiter.userName], waitlistWithUid: [{ uid: waiter.userId, name: waiter.userName }],
    } }));
    registerCallableMock('adjustTeamReservation', callable);
    mount();
    const open = await screen.findByRole('button', { name: '查看出席紀錄' }) as HTMLButtonElement;
    expect(screen.queryByRole('button', { name: '管理名單 / 出席紀錄' })).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: '調整名額' }) as HTMLButtonElement).disabled).toBe(false));
    await adjust();
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(open.disabled).toBe(true);
    if (openBeforeRefresh) {
      // 合成事件也必須被讀取入口拒絕，不能只依賴瀏覽器的 disabled 行為。
      fireEvent.pointerDown(open);
      fireEvent.click(open);
      fireEvent.click(open);
    }
    expect(screen.getByRole('button', { name: '查看出席紀錄' })).toBe(open);
    expect(document.querySelector('#detail-attendance-table table')).toBeNull();
    expect(document.querySelector('[data-attendance-loading]')).toBeNull();
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    expect(mocks.attendance).not.toHaveBeenCalled();

    await act(async () => { refresh.resolve(rows); });
    await waitFor(() => expect(open.disabled).toBe(false));
    expect(screen.getByRole('button', { name: '查看出席紀錄' })).toBe(open);
    expect(document.querySelector('#detail-attendance-table table')).toBeNull();
    expect(mocks.registrations).toHaveBeenCalledTimes(1);
    expect(mocks.attendance).not.toHaveBeenCalled();
    fireEvent.pointerDown(open);
    fireEvent.click(open);
    fireEvent.click(open);
    await waitFor(() => expect(mocks.attendance).toHaveBeenCalledTimes(1));
    expect(mocks.registrations).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-attendance-loading]')).toBeTruthy();
    expect(document.querySelector('#detail-attendance-table table')).toBeNull();
    expect(document.querySelector('#detail-waitlist-container table')).toBeNull();

    await act(async () => {
      if (registrationsFirst) registrations.resolve(rows);
      else attendance.resolve(attendanceRows);
    });
    // 任一資料尚未完成，都不能顯示半套表格。
    expect(document.querySelector('[data-attendance-loading]')).toBeTruthy();
    expect(document.querySelector('#detail-attendance-table table')).toBeNull();
    expect(document.querySelector('#detail-waitlist-container table')).toBeNull();
    await act(async () => {
      if (registrationsFirst) attendance.resolve(attendanceRows);
      else registrations.resolve(rows);
    });
    const row = (await screen.findByText(member.userName)).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]!.textContent).toBe('✓');
    expect(cells[2]!.textContent).toBe('');
    expect(cells[3]!.textContent).toBe(note);
    expect(document.querySelector('[data-attendance-loading]')).toBeNull();
    expect(document.querySelector('#detail-waitlist-container')?.textContent).toContain(waiter.userName);
    expect(document.querySelector('.team-reservation-member-row')?.textContent).toContain(member.userName);
    expect(mocks.registrations).toHaveBeenCalledTimes(2);
    expect(mocks.registrations).toHaveBeenLastCalledWith(detail.eventDocId);
    expect(mocks.attendance).toHaveBeenCalledTimes(1);
    expect(mocks.attendance).toHaveBeenLastCalledWith(detail.eventDocId);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledTimes(1);
  });
  it('團隊名額完整重讀後，晚到的分隊預載不能覆蓋名單或分隊快取', async () => {
    const stale = deferredReservationRead();
    const member = { ...self, userName: '分隊正取會員', teamKey: 'A' };
    mocks.detail.mockResolvedValue({ ...detail, event: { ...activity, teamSplit: { enabled: true, mode: 'random',
      teams: [{ key: 'A', color: '#EF4444', name: '紅隊' }, { key: 'B', color: '#3B82F6', name: '藍隊' }],
    } } });
    mocks.registrations.mockReturnValueOnce(stale.promise);
    registerCallableMock('adjustTeamReservation', async () => ({ ...success, promoted: [] }));
    mount();
    await screen.findByRole('button', { name: '調整名額' });
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    mocks.registrations.mockResolvedValue([{ ...member, teamKey: 'B',
      teamReservationTeamId: 't1', teamReservationTeamName: '一隊', teamSeatSource: 'reserved' }]);
    await adjust();
    await waitFor(() => expect((screen.getByRole('button', { name: '調整名額' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
    await screen.findByText(member.userName);
    const counts = () => Array.from(document.querySelectorAll('.team-stat-text')).map(node => node.textContent ?? '');
    expect(counts()[0]?.startsWith('0')).toBe(true);
    expect(counts()[1]?.startsWith('1')).toBe(true);
    await act(async () => { stale.resolve([member]); });
    expect(counts()[0]?.startsWith('0')).toBe(true);
    expect(counts()[1]?.startsWith('1')).toBe(true);
    expect(document.querySelector('.team-reservation-member-row')?.textContent).toContain(member.userName);
    expect(mocks.registrations).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('重讀失敗仍保留成功摘要與樂觀遞補，無原始錯誤且可手動恢復（先展開 %s）', async expanded => {
    mocks.registrations.mockResolvedValue([waiting]);
    mocks.history.mockResolvedValue([waiting]);
    const callable = vi.fn(async () => success);
    registerCallableMock('adjustTeamReservation', callable);
    if (expanded) await openReservationRoster(); else { mount(); await screen.findByRole('button', { name: '調整名額' }); }
    const stale = deferredReservationRead();
    if (expanded) {
      mocks.registrations.mockReturnValueOnce(stale.promise);
      fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
      await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(2));
    }
    const reads = mocks.registrations.mock.calls.length;
    mocks.registrations.mockRejectedValueOnce(new Error('SECRET_FIRESTORE_PATH_STACK'));
    await adjust();
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith({ message: '團隊名額已更新，但名單更新失敗，請重新整理' }));
    if (expanded) {
      await act(async () => { stale.resolve([waiting]); });
      expect(document.querySelector('.team-reservation-seats')?.getAttribute('aria-label')).toContain('佔位 2，');
    }
    expect(screen.getByRole('button', { name: '取消報名' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '取消候補' })).toBeNull();
    if (expanded) expect(document.querySelector('#detail-attendance-table')?.textContent).toContain('候補本人');
    expect(mocks.toastShow).not.toHaveBeenCalledWith({ message: '團隊名額調整失敗，請稍後重試' });
    expect(JSON.stringify(mocks.toastShow.mock.calls) + document.body.textContent).not.toContain('SECRET_FIRESTORE_PATH_STACK');
    expect(mocks.registrations).toHaveBeenCalledTimes(reads + 1);
    expect((screen.getByRole('button', { name: '調整名額' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '調整名額' }));
    expect((screen.getByLabelText('團隊名額') as HTMLInputElement).value).toBe('2');
    expect(document.querySelector('.team-reservation-help')?.textContent).toContain('已被俱樂部成員使用：1');
    expect(document.querySelector('.team-reservation-help')?.textContent).toContain('剩餘佔位：1');
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    mocks.detail.mockResolvedValue({ ...detail, event: { ...activity, ...updated } });
    mocks.registrations.mockResolvedValue([{ ...waiting, status: 'confirmed', teamSeatSource: 'reserved' }]);
    mocks.history.mockResolvedValue([{ ...waiting, status: 'confirmed', teamSeatSource: 'reserved' }]);
    const refreshButton = screen.getByRole('button', { name: '重新整理' }) as HTMLButtonElement;
    await waitFor(() => expect(refreshButton.disabled).toBe(false));
    fireEvent.click(refreshButton);
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(reads + 2));
    expect(callable).toHaveBeenCalledTimes(1);
  });
  it.each(['活動', '帳號', '離頁'] as const)('成功後的重讀晚到時隔離已切換%s', async mode => {
    mocks.registrations.mockResolvedValue([waiting]);
    const callable = vi.fn(async () => success);
    registerCallableMock('adjustTeamReservation', callable);
    const view = mount();
    await screen.findByRole('button', { name: '調整名額' });
    const refresh = deferredReservationRead();
    mocks.registrations.mockReturnValueOnce(refresh.promise);
    await adjust();
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    const toasts = mocks.toastShow.mock.calls.length;
    if (mode === '離頁') view.unmount();
    else {
      if (mode === '帳號') mocks.viewer.mockReturnValue({ ...staffViewer, uid: 'u2' });
      mocks.detail.mockResolvedValue({ ...detail, eventDocId: 'new-doc', event: { ...detail.event,
        id: mode === '活動' ? 'new-event' : detail.event.id, title: '新工作階段', teamReservationSummaries: [] } });
      view.rerender(<LocationProvider><EventDetailPage id={mode === '活動' ? 'new-event' : detail.event.id} /></LocationProvider>);
      await screen.findByRole('heading', { name: '新工作階段' });
    }
    await act(async () => { refresh.resolve([{ ...waiting, userName: '過期刷新會員', status: 'confirmed' }]); });
    expect(screen.queryByText('過期刷新會員')).toBeNull();
    expect(document.querySelector('.team-reservation-header-row')).toBeNull();
    expect(mocks.toastShow).toHaveBeenCalledTimes(toasts);
    expect(callable).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('團隊預留→個人報名→再次調整保留權威佔位與上限（名單先展開 %s）', async expanded => {
    const outsider = { ...self, _docId: 'outside-doc', userId: 'outside', userName: '一般正取會員' };
    const member = { ...self, userId: 'u1', userName: '預留報名本人',
      teamReservationTeamId: 't1', teamReservationTeamName: '一隊', teamSeatSource: 'reserved' };
    const initial = { ...activity, current: 1, realCurrent: 1, waitlist: 0, teamReservationSummaries: [],
      participants: [outsider.userName], participantsWithUid: [{ uid: outsider.userId, name: outsider.userName }],
      waitlistNames: [], waitlistWithUid: [] };
    const reserved = { ...initial, current: 4,
      teamReservationSummaries: [{ ...teams[0]!, usedSlots: 0, remainingSlots: 3 }] };
    const signedUp = { ...reserved, realCurrent: 2, teamReservationSummaries: [teams[0]!],
      participants: [outsider.userName, member.userName],
      participantsWithUid: [...reserved.participantsWithUid, { uid: member.userId, name: member.userName }] };
    const rows = [outsider, member];
    const callable = vi.fn(async () => ({ success: true, event: reserved, promoted: [] }));
    registerCallableMock('adjustTeamReservation', callable);
    mocks.viewer.mockReturnValue({ ...staffViewer, teamIds: new Set(['t1']), staffTeams: [staffViewer.staffTeams[0]] });
    mocks.detail.mockResolvedValue({ ...detail, event: initial });
    mocks.registrations.mockResolvedValue([outsider]);
    mount();
    const create = await screen.findByRole('button', { name: '團隊報名' });
    await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
    if (expanded) {
      fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
      await screen.findByText(outsider.userName);
    }

    // 先經真實調整入口建立三席預留，套用佔位重算的伺服器投影。
    fireEvent.click(create);
    fireEvent.input(screen.getByLabelText('團隊名額'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '確認', exact: true }));
    await waitFor(() => expect(callable).toHaveBeenCalledTimes(1));
    const adjustButton = await screen.findByRole('button', { name: '調整名額' });
    await waitFor(() => expect((adjustButton as HTMLButtonElement).disabled).toBe(false));
    expect(callable).toHaveBeenLastCalledWith(expect.objectContaining({ teamId: 't1', reservedSlots: 3 }));
    fireEvent.click(adjustButton);
    expect((screen.getByLabelText('團隊名額') as HTMLInputElement).max).toBe('9');
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));

    // 本人使用一席：正取兩人加剩餘兩席，權威 current 仍為 4。
    const backgroundRows = deferredReservationRead();
    const reads = mocks.registrations.mock.calls.length;
    mocks.reservationSignupEvent = reserved;
    mocks.registrations.mockReturnValueOnce(backgroundRows.promise);
    mocks.history.mockResolvedValue([member]);
    mocks.register.mockResolvedValue({ deduplicated: false, confirmed: 1, waitlisted: 0,
      registrations: [member], event: signedUp });
    const signup = screen.getByRole('button', { name: /立即報名|個人報名/ });
    await waitFor(() => expect((signup as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(signup);
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(reads + 1));
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ preferredTeamReservationTeamId: 't1' }));
    expect(document.querySelector('[data-detail-field="capacity-count"]')?.textContent).toContain('已報 4/10');
    await act(async () => { backgroundRows.resolve(rows); });
    await screen.findByRole('button', { name: '取消報名' });
    await waitFor(() => expect((screen.getByRole('button', { name: '調整名額' }) as HTMLButtonElement).disabled).toBe(false));

    // 必須等背景重讀完成再開窗，不能只驗證 Callable 剛回應的瞬間。
    fireEvent.click(screen.getByRole('button', { name: '調整名額' }));
    const slots = screen.getByLabelText('團隊名額') as HTMLInputElement;
    expect(slots.max).toBe('9');
    expect(slots.min).toBe('1');
    expect(slots.value).toBe('3');
    expect(document.querySelector('.team-reservation-help')?.textContent).toContain('剩餘佔位：2');
    expect(document.querySelector('[data-detail-field="capacity-count"]')?.textContent).toContain('已報 4/10');
    fireEvent.input(slots, { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: '確認', exact: true }));
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith({ message: '團隊名額超過目前活動可用名額' }));
    expect(callable).toHaveBeenCalledTimes(1);

    // 正確上限仍可送出，避免用停用功能來掩蓋問題。
    mocks.registrations.mockResolvedValue(rows);
    callable.mockResolvedValueOnce({ success: true, promoted: [], event: { ...signedUp, current: 10,
      teamReservationSummaries: [{ ...teams[0]!, reservedSlots: 9, remainingSlots: 8 }] } });
    fireEvent.input(slots, { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: '確認', exact: true }));
    await waitFor(() => expect(callable).toHaveBeenCalledTimes(2));
    expect(callable).toHaveBeenLastCalledWith(expect.objectContaining({ teamId: 't1', reservedSlots: 9 }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '團隊報名' })).toBeNull());
    await waitFor(() => expect((screen.getByRole('button', { name: '調整名額' }) as HTMLButtonElement).disabled).toBe(false));
    expect(mocks.registrations).toHaveBeenCalledTimes(reads + 2);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
  });
  it('兩隊選擇送入個人報名 payload，取消選擇不送出', async () => {
    mount();
    const button = await screen.findByRole('button', { name: /立即報名|個人報名/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: '選擇報名俱樂部' });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(mocks.register).not.toHaveBeenCalled();
    fireEvent.click(button);
    const choice = await screen.findByRole('dialog', { name: '選擇報名俱樂部' });
    fireEvent.click(within(choice).getByRole('radio', { name: /二隊/ }));
    fireEvent.click(within(choice).getByRole('button', { name: '確認報名' }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ preferredTeamReservationTeamId: 't2' })));
  });
  it('同行者加報也先選俱樂部，傳入既有 Callable payload', async () => {
    mocks.companions.mockResolvedValue([{ id: 'c1', name: '同行小友', gender: '女' }]);
    const register = vi.fn(async () => ({ success: true, confirmed: 1, waitlisted: 0 }));
    registerCallableMock('registerForEvent', register);
    mount();
    const companion = await screen.findByRole('button', { name: '幫夥伴報名' });
    await waitFor(() => expect((companion as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(companion);
    const checkbox = await screen.findByRole('checkbox', { name: /同行小友/ });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: '確認', exact: true }));
    const choice = await screen.findByRole('dialog', { name: '選擇報名俱樂部' });
    expect(register).not.toHaveBeenCalled();
    fireEvent.click(within(choice).getByRole('radio', { name: /二隊/ }));
    fireEvent.click(within(choice).getByRole('button', { name: '確認報名' }));
    await waitFor(() => expect(register).toHaveBeenCalledWith(expect.objectContaining({
      preferredTeamReservationTeamId: 't2', participants: [{ userId: 'u1', userName: '小明', companionId: 'c1', companionName: '同行小友' }],
    })));
  });
  it('同行者加報成功後計數採用 Callable 佔位投影，名單重讀不改寫 current', async () => {
    mocks.viewer.mockReturnValue({ ...staffViewer, teamIds: new Set(['t1']) });
    mocks.companions.mockResolvedValue([{ id: 'c1', name: '同行小友', gender: '女' }]);
    const register = vi.fn(async () => ({ success: true, confirmed: 1, waitlisted: 0,
      event: { ...activity, current: 5, realCurrent: 2, teamReservationSummaries: teams } }));
    registerCallableMock('registerForEvent', register);
    mount();
    const companion = await screen.findByRole('button', { name: '幫夥伴報名' });
    await waitFor(() => expect((companion as HTMLButtonElement).disabled).toBe(false));
    expect(document.querySelector('[data-detail-field="capacity-count"]')?.textContent).toContain('已報 4/10');
    const reads = mocks.registrations.mock.calls.length;
    fireEvent.click(companion);
    fireEvent.click(await screen.findByRole('checkbox', { name: /同行小友/ }));
    fireEvent.click(screen.getByRole('button', { name: '確認', exact: true }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(reads + 1));
    await waitFor(() => expect(document.querySelector('[data-detail-field="capacity-count"]')?.textContent).toContain('已報 5/10'));
  });
  it('只有一隊時直接帶入，不開選擇窗', async () => {
    mocks.viewer.mockReturnValue({ ...staffViewer, teamIds: new Set(['t1']) });
    mount();
    const button = await screen.findByRole('button', { name: /立即報名|個人報名/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ preferredTeamReservationTeamId: 't1' })));
    expect(screen.queryByRole('dialog', { name: '選擇報名俱樂部' })).toBeNull();
  });
  it('原始狀態仍 open 但開放時間未到，不出現團隊入口', async () => {
    mocks.detail.mockResolvedValue({ ...detail, event: { ...activity, regOpenTime: '2098-01-01T00:00:00+08:00' } });
    await openReservationRoster();
    await waitFor(() => expect(document.querySelector('.team-reservation-header-row')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /調整名額|團隊報名|快速調整/ })).toBeNull();
  });
  // T-074 終驗 P3-2：同行者入口與批次取消確認鈕不看 reservation.busy，只能靠 run() 的 isPending 守衛擋。
  it('團隊名額調整進行中不能開同行者報名或送出批次取消；完成後恢復', async () => {
    const mate = { ...self, _docId: 'registration-mate', participantType: 'companion',
      companionId: 'c1', companionName: '同行小友' };
    mocks.history.mockResolvedValue([self, mate]);
    mocks.registrations.mockResolvedValue([self, mate]);
    mocks.companions.mockResolvedValue([{ id: 'c1', name: '同行小友', gender: '女' }]);
    let finish: ((value: unknown) => void) | undefined;
    registerCallableMock('adjustTeamReservation', () => new Promise(done => { finish = done as (value: unknown) => void; }));
    mount();
    const primary = await screen.findByRole('button', { name: '取消報名' }) as HTMLButtonElement;
    await waitFor(() => expect(primary.disabled).toBe(false));
    fireEvent.click(primary);
    await screen.findByRole('button', { name: '確認取消' });
    await adjust();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: '確認取消' }));
    fireEvent.click(screen.getByRole('button', { name: '幫夥伴報名' }));
    await act(async () => { await new Promise(done => setTimeout(done, 0)); });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.companions).not.toHaveBeenCalled();
    await act(async () => { finish!(success); });
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledWith({ message: '已更新團隊名額' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '調整名額' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '幫夥伴報名' }));
    await waitFor(() => expect(mocks.companions).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '確認取消' }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      registrationIds: ['registration-self', 'registration-mate'],
    })));
  });
});
