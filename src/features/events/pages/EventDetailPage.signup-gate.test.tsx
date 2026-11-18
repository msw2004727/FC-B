import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { LoadedEventDetail } from '../data/event-detail';
import type { SignupProfile } from '../data/signup-profile';

// 報名鈕就緒鎖與資料未完善引導（站長 11-18、顧問 §3.268 五條件）。mock 架構同 EventDetailPage.3b1w.test.tsx。
const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  detail: vi.fn(),
  history: vi.fn(),
  registrations: vi.fn(),
  profile: vi.fn(),
  companions: vi.fn(),
  register: vi.fn(),
  selection: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  prompt: vi.fn(),
  bind: vi.fn(),
  signIn: vi.fn(),
  loadUserProfile: vi.fn(),
}));

vi.mock('@/features/profile/data/viewer', () => ({ useViewer: mocks.viewer }));
vi.mock('../data/event-detail', () => ({
  loadEventDetail: mocks.detail,
  loadEventRegistrations: mocks.registrations,
}));
vi.mock('../data/viewer-registrations', () => ({
  loadViewerRegistrations: mocks.history,
  loadViewerRegistrationsFresh: mocks.history,
}));
vi.mock('../data/signup-profile', async (o) => ({
  ...(await o<typeof import('../data/signup-profile')>()),
  loadSignupProfile: mocks.profile,
}));
vi.mock('../data/companions', () => ({ loadSignupCompanions: mocks.companions }));
vi.mock('../data/signup-selection', () => ({ registerSelection: mocks.selection }));
vi.mock('../data/signup', async (o) => ({
  ...(await o<typeof import('../data/signup')>()),
  registerForEvent: mocks.register,
  cancelRegistration: mocks.cancel,
}));
vi.mock('../data/line-notify-bind', () => ({
  shouldShowLineNotifyPrompt: mocks.prompt,
  bindLineNotify: mocks.bind,
  dismissLineNotifyPrompt: vi.fn(),
}));
vi.mock('@/ui/AppConfirm', async (o) => ({
  ...(await o<typeof import('@/ui/AppConfirm')>()),
  appConfirm: mocks.confirm,
}));
vi.mock('@/ui/Toast', async (o) => ({
  ...(await o<typeof import('@/ui/Toast')>()),
  toast: { show: mocks.toast },
}));
vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}),
  getCachedUserLevel: () => 0,
}));
vi.mock('@/i18n/i18n', async (o) => ({
  ...(await o<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
}));
vi.mock('@/data/auth', () => ({
  signIn: mocks.signIn,
  getLastKnownAuthUid: () => undefined,
}));
vi.mock('../data/event-view-count', () => ({
  incrementEventViewCount: async () => null,
  mergeViewCount: (...values: unknown[]) => Math.max(0, ...values.map(v => Number(v) || 0)),
}));
vi.mock('../data/team-staff', () => ({
  getEventLimitedTeamIds: () => [],
  loadEventStaffTeamIds: async () => new Set<string>(),
}));
vi.mock('@/features/checkin/data/attendance', () => ({
  loadEventAttendance: async () => [],
}));
vi.mock('../components/legacy/EventCommentsSection', () => ({
  default: () => null,
}));
// 完善資料彈窗換成替身：只驗證開了哪個元件、帶什麼初值、存好後回到本頁。
vi.mock('@/features/profile/ui/editors', () => ({
  needsFirstLogin: () => true,
  FirstLoginEditor: (props: {
    uid: string;
    profile: Record<string, unknown>;
    onClose: () => void;
    onSaved: (patch: Record<string, unknown>) => void;
  }) => (
    <div role="dialog" aria-label="完善個人資料" data-uid={props.uid} data-region={String(props.profile.region ?? '')}>
      <button
        type="button"
        onClick={() => {
          props.onSaved({ gender: '女', birthday: '2000/01/01', region: '臺北市' });
          props.onClose();
        }}
      >替身存檔</button>
    </div>
  ),
}));
vi.mock('@/features/profile/data/profile-model', () => ({ loadUserProfile: mocks.loadUserProfile }));

import EventDetailPage, { _displayErrorCodeForTest } from './EventDetailPage';
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
const guest: ViewerView = { ...viewer, uid: null, displayName: null, role: 'guest' };
const complete: SignupProfile = {
  gender: '女', birthday: '2000/01/01', exp: 100, lineNotifyBound: true, incomplete: false,
};
const incomplete: SignupProfile = { ...complete, gender: '', incomplete: true };
const detail: LoadedEventDetail = {
  eventDocId: 'event-document',
  event: {
    id: 'public-event',
    title: '測試活動',
    date: '2099/10/19 18:30~21:00',
    status: 'open',
    isPublic: true,
  },
};

function mount() {
  return render(
    <LocationProvider><EventDetailPage id="public-event" /></LocationProvider>,
  );
}

function rejectWith(code: string, originalCode: string, messageKey = 'event.signup.error.unknown') {
  mocks.register.mockRejectedValue(new SignupError({ code, originalCode, messageKey, message: originalCode }));
}

beforeEach(() => {
  vi.resetAllMocks();
  history.replaceState(null, '', '/activities/public-event');
  mocks.viewer.mockReturnValue(viewer);
  mocks.detail.mockResolvedValue(detail);
  mocks.history.mockResolvedValue([]);
  mocks.registrations.mockResolvedValue([]);
  mocks.profile.mockResolvedValue(complete);
  mocks.companions.mockResolvedValue([]);
  mocks.confirm.mockResolvedValue(true);
  mocks.register.mockResolvedValue({
    confirmed: 1,
    registrations: [{ participantType: 'self', status: 'confirmed' }],
  });
  mocks.prompt.mockResolvedValue(false);
  mocks.signIn.mockResolvedValue({ uid: 'u1' });
  mocks.loadUserProfile.mockResolvedValue({
    uid: 'u1', name: '小明', _docId: 'u1', lastActive: null, gender: '', birthday: '2000/01/01', region: '臺北市',
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('就緒鎖：三種狀態', () => {
  it('登入還原中顯示「LINE 登入中…」且不可按，不呼叫登入', async () => {
    mocks.viewer.mockReturnValue({ ...guest, authPending: true });
    mount();
    const button = await screen.findByRole('button', { name: 'LINE 登入中…' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('登入還原超過 12 秒放行成「請先登入」，按下走登入（不永久鎖住）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.viewer.mockReturnValue({ ...guest, authPending: true });
    mount();
    await screen.findByRole('button', { name: 'LINE 登入中…' });
    await act(async () => { vi.advanceTimersByTime(12_000); });
    fireEvent.click(await screen.findByRole('button', { name: '請先登入' }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
  });

  it('確定是訪客：顯示「請先登入」，按下走既有登入', async () => {
    mocks.viewer.mockReturnValue(guest);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '請先登入' }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
  });

  it('個人資料載入中顯示「資料載入中…」不可按，到齊後可報名', async () => {
    let resolve!: (value: SignupProfile) => void;
    mocks.profile.mockReturnValue(new Promise<SignupProfile>(done => { resolve = done; }));
    mount();
    expect(await screen.findByRole('button', { name: '資料載入中…' })).toHaveProperty('disabled', true);
    await act(async () => { resolve(complete); });
    await screen.findByRole('button', { name: '立即報名' });
  });

  it('個人資料超過 8 秒讀不到：放行報名，交給伺服器裁定（不永久鎖住）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.profile.mockReturnValue(new Promise<SignupProfile>(() => {}));
    mount();
    await screen.findByRole('button', { name: '資料載入中…' });
    await act(async () => { vi.advanceTimersByTime(8_000); });
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
  });

  it('個人資料讀取失敗：放行報名，交給伺服器裁定', async () => {
    mocks.profile.mockRejectedValue(new Error('offline'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
  });
});

describe('資料未完善：前端先擋並引導', () => {
  it('缺欄顯示「請先完善資料」，按下開彈窗不送報名；存好後留在本頁變「立即報名」', async () => {
    mocks.profile.mockResolvedValueOnce(incomplete).mockResolvedValue(complete);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '請先完善資料' }));
    const dialog = await screen.findByRole('dialog', { name: '完善個人資料' });
    expect(dialog.getAttribute('data-uid')).toBe('u1');
    expect(dialog.getAttribute('data-region')).toBe('臺北市');
    expect(mocks.register).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '替身存檔' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '完善個人資料' })).toBeNull());
    expect(location.pathname).toBe('/activities/public-event');
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
  });

  it('已報名的人缺欄仍顯示「取消報名」（不影響取消）', async () => {
    mocks.profile.mockResolvedValue(incomplete);
    mocks.history.mockResolvedValue([{
      _docId: 'self-document', eventId: 'public-event', userId: 'u1', userName: '小明',
      participantType: 'self', status: 'confirmed',
    }]);
    mount();
    expect(await screen.findByRole('button', { name: '取消報名' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '請先完善資料' })).toBeNull();
  });

  it('缺欄時按「幫夥伴報名」先開完善資料彈窗，不載入夥伴', async () => {
    mocks.profile.mockResolvedValue(incomplete);
    mount();
    await screen.findByRole('button', { name: '請先完善資料' });
    fireEvent.click(screen.getByRole('button', { name: '幫夥伴報名' }));
    expect(await screen.findByRole('dialog', { name: '完善個人資料' })).toBeTruthy();
    expect(mocks.companions).not.toHaveBeenCalled();
  });

  it('伺服器回 PROFILE_INCOMPLETE：提示並直達完善資料彈窗', async () => {
    rejectWith('failed-precondition', 'PROFILE_INCOMPLETE', 'event.signup.error.profileIncomplete');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    expect(await screen.findByRole('dialog', { name: '完善個人資料' })).toBeTruthy();
    expect(await screen.findByText('events.signup.error.profileIncomplete')).toBeTruthy();
  });
});

describe('錯誤提示：講清楚原因', () => {
  it('通用失敗顯示附代碼的提示', async () => {
    rejectWith('internal', 'internal');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    expect(await screen.findByText('events.signup.error.unknown')).toBeTruthy();
  });

  it('網路類錯誤改顯示網路提示', async () => {
    rejectWith('unavailable', 'unavailable');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    expect(await screen.findByText('events.signup.error.network')).toBeTruthy();
  });

  it('登入過期改顯示重新登入提示', async () => {
    rejectWith('unauthenticated', 'unauthenticated');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    expect(await screen.findByText('events.signup.error.loginExpired')).toBeTruthy();
  });
});

describe('錯誤代碼只顯示安全字串', () => {
  const err = (code: string, originalCode: string) =>
    new SignupError({ code, originalCode, messageKey: 'event.signup.error.unknown', message: 'x' });
  it('伺服器原因碼與傳輸類別照顯示；自由文字一律 unknown', () => {
    expect(_displayErrorCodeForTest(err('failed-precondition', 'SOME_NEW_CODE'))).toBe('SOME_NEW_CODE');
    expect(_displayErrorCodeForTest(err('functions/internal', 'internal'))).toBe('internal');
    expect(_displayErrorCodeForTest(err('permission-denied', 'First participant must be the caller'))).toBe('permission-denied');
    expect(_displayErrorCodeForTest(err('unknown', '王小明 台北市'))).toBe('unknown');
  });
});

describe('早鳥＋個人資料讀不到（Grok 初審 P1）', () => {
  it('讀取失敗時早鳥鈕可按，略過本地積分檢查直接送出', async () => {
    mocks.profile.mockRejectedValue(new Error('offline'));
    mocks.detail.mockResolvedValue({
      ...detail,
      event: {
        ...detail.event,
        status: 'upcoming',
        regOpenTime: '2099-10-18T12:00:00+08:00',
        earlyBirdEnabled: true,
        earlyBirdCost: 50,
      },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /早鳥報名/ }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    expect(mocks.register.mock.calls[0]?.[0]).toMatchObject({ earlyBirdAccepted: true, earlyBirdExpectedCost: 50 });
  });
});

describe('Opus 終審補測', () => {
  it('送出前預檢回小寫 profile_incomplete 也直達完善資料彈窗', async () => {
    rejectWith('failed-precondition', 'profile_incomplete', 'event.signup.error.profileIncomplete');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    expect(await screen.findByRole('dialog', { name: '完善個人資料' })).toBeTruthy();
  });

  it('取消報名遇網路錯誤顯示網路提示', async () => {
    mocks.history.mockResolvedValue([{
      _docId: 'self-document', eventId: 'public-event', userId: 'u1', userName: '小明',
      participantType: 'self', status: 'confirmed',
    }]);
    mocks.cancel.mockRejectedValue(new SignupError({
      code: 'unavailable', originalCode: 'unavailable', messageKey: 'event.cancel.error.unknown', message: 'x',
    }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '取消報名' }));
    expect(await screen.findByText('events.cancel.error.network')).toBeTruthy();
  });
});
