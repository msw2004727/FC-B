import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { LoadedEventDetail } from '../data/event-detail';
import type { DetailRegistration } from '../data/detail-model';

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
  mocks.register.mockResolvedValue({ deduplicated: false });
  mocks.cancel.mockResolvedValue({ deduplicated: false });
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

  it('點擊未開放功能顯示「此功能尚未開放，請先使用舊版」提示', async () => {
    const view = mount();
    await screen.findByRole('heading', { level: 2 });

    fireEvent.click(screen.getByRole('button', { name: '分享活動' }));
    expect(mocks.toastShow).toHaveBeenLastCalledWith({ message: '此功能尚未開放，請先使用舊版' });

    fireEvent.click(screen.getByRole('button', { name: '加入行事曆' }));
    expect(mocks.toastShow).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: '聯繫主辦' }));
    expect(mocks.toastShow).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole('button', { name: '報名紀錄' }));
    expect(mocks.toastShow).toHaveBeenCalledTimes(4);

    const viewCountWrap = view.container.querySelector('#detail-view-count-wrap')!;
    fireEvent.click(viewCountWrap);
    expect(mocks.toastShow).toHaveBeenCalledTimes(5);
  });

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
    mocks.detail.mockResolvedValueOnce(null);
    const first = mount();
    await screen.findByText('找不到此活動');
    const missing = first.container.innerHTML;
    first.unmount();

    mocks.detail.mockResolvedValue({
      ...detail,
      event: { ...detail.event, blockedUids: ['u1'] },
    });
    const second = mount();
    await screen.findByText('找不到此活動');
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
    expect(screen.getByText('公開正取')).toBeTruthy();
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
    const title = await screen.findByRole('heading', { level: 2 });
    const region = screen.getByRole('region', { name: '參加名單' });
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
    fireEvent.click(screen.getByRole('button', { name: '立即報名' }));
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.companions).not.toHaveBeenCalled();
  });

  it('報名成功只更新名單、計數與按鈕，不重載活動', async () => {
    mocks.registrations.mockResolvedValue([self]);
    mocks.history.mockResolvedValueOnce([]).mockResolvedValue([self]);
    const view = mount();
    const title = await screen.findByRole('heading', { level: 2 });
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

  it('確認選取後才取消，payload 使用子文件 ID', async () => {
    mocks.registrations.mockResolvedValue([]);
    mocks.history.mockResolvedValueOnce([self]).mockResolvedValue([]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '取消報名' }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: '確認取消' }));
    await screen.findByRole('button', { name: '立即報名' });
    expect(mocks.cancel).toHaveBeenCalledWith({
      eventId: 'ce_123_abc',
      userId: 'u1',
      registrationIds: ['registration-self'],
      kind: 'self',
    });
    expect(mocks.detail).toHaveBeenCalledTimes(1);
  });

  it('未登入點報名呼叫動態載入的 signIn', async () => {
    mocks.viewer.mockReturnValue({ ...viewer, uid: null });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.registrations).not.toHaveBeenCalled();
  });

  it('有同行者時先選擇，未確認不送出', async () => {
    mocks.companions.mockResolvedValue([{ id: 'c1', name: '同行小王' }]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '同行小王' }));
    expect(mocks.register).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '確認報名' }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        companions: [{ companionId: 'c1', companionName: '同行小王' }],
      }),
    ));
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
    expect(mocks.companions).toHaveBeenCalledTimes(1);
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
