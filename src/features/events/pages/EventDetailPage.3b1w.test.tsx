import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { LoadedEventDetail } from '../data/event-detail';
import type { DetailRegistration } from '../data/detail-model';
import type { SignupProfile } from '../data/signup-profile';

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
}));

vi.mock('@/features/profile/data/viewer', () => ({ useViewer: mocks.viewer }));
vi.mock('../data/event-detail', () => ({
  loadEventDetail: mocks.detail,
  loadEventRegistrations: mocks.registrations,
}));
vi.mock('../data/viewer-registrations', () => ({ loadViewerRegistrations: mocks.history }));
vi.mock('../data/signup-profile', () => ({ loadSignupProfile: mocks.profile }));
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

import EventDetailPage from './EventDetailPage';

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
const profile: SignupProfile = {
  gender: '女',
  birthday: '2000/01/01',
  exp: 100,
  lineNotifyBound: false,
};
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
const self: DetailRegistration = {
  _docId: 'self-document',
  eventId: 'public-event',
  userId: 'u1',
  userName: '小明',
  participantType: 'self',
  status: 'confirmed',
};
const companion: DetailRegistration = {
  ...self,
  _docId: 'companion-document',
  participantType: 'companion',
  companionId: 'c1',
  companionName: '小花',
};

function mount() {
  return render(
    <LocationProvider><EventDetailPage id="public-event" /></LocationProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  history.replaceState(null, '', '/activities/public-event');
  mocks.viewer.mockReturnValue(viewer);
  mocks.detail.mockResolvedValue(detail);
  mocks.history.mockResolvedValue([]);
  mocks.registrations.mockResolvedValue([]);
  mocks.profile.mockResolvedValue(profile);
  mocks.companions.mockResolvedValue([
    { id: 'c1', name: '小花', gender: '女' },
    { id: 'c2', name: '小美', gender: '女' },
  ]);
  mocks.confirm.mockResolvedValue(true);
  mocks.register.mockResolvedValue({
    confirmed: 1,
    registrations: [{ participantType: 'self', status: 'confirmed' }],
  });
  mocks.selection.mockResolvedValue({ confirmed: 1, waitlisted: 0 });
  mocks.cancel.mockResolvedValue({ event: { current: 0, max: 10 } });
  mocks.prompt.mockResolvedValue(false);
  mocks.bind.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('3b-1w 報名流程', () => {
  it('單人取消先確認，送 public eventId、報名文件 ID 與有效 context', async () => {
    mocks.history.mockResolvedValue([self]);
    let confirm!: (value: boolean) => void;
    mocks.confirm.mockReturnValue(new Promise<boolean>(resolve => { confirm = resolve; }));
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: '取消報名' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('確定要取消報名？'));
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(view.container.querySelector('#companion-cancel-overlay')).toBeNull();
    await act(async () => { confirm(true); });
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'public-event',
      registrationIds: ['self-document'],
      kind: 'self',
      context: expect.objectContaining({ getAuth: expect.any(Function), load: expect.any(Function) }),
    })));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '已取消報名' }));
  });

  it('有同行者開取消彈窗，預設全選且確認後分派 companion', async () => {
    mocks.history.mockResolvedValue([self, companion]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '取消報名' }));
    const confirm = await screen.findByRole('button', { name: '確認取消' });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect(box).toHaveProperty('checked', true);
    expect(mocks.confirm).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      registrationIds: ['self-document', 'companion-document'],
      kind: 'companion',
    })));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '已取消 2 筆報名' }));
  });

  it('立即報名不開同行者彈窗；成功 toast 與翻牌', async () => {
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    expect(mocks.companions).not.toHaveBeenCalled();
    expect(view.container.querySelector('#companion-select-overlay')).toBeNull();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '報名成功！' }));
    expect(view.container.querySelector('.signup-flip-back')?.textContent).toBe('取消報名');
    expect(view.container.querySelector('.signup-flip-back')?.getAttribute('style'))
      .toContain('rgb(220, 38, 38)');
  });

  // 測試同步更新：照 A _confirmCompanionRegisterUnlocked 先取消再加報（Gemini 審查 P1）。
  it('幫夥伴報名只按 companionId 比對，先取消再加報', async () => {
    mocks.history.mockResolvedValue([self, companion]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '幫夥伴報名' }));
    const confirm = await screen.findByRole('button', { name: '確認', exact: true });
    const overlay = document.querySelector('#companion-select-overlay');
    if (!(overlay instanceof HTMLElement)) throw new Error('缺少同行者彈窗');
    const boxes = within(overlay).getAllByRole('checkbox');
    const first = boxes[0];
    const second = boxes[1];
    if (!first || !second) throw new Error('缺少同行者');
    expect(first).toHaveProperty('checked', true);
    fireEvent.click(first);
    fireEvent.click(second);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1));
    expect(mocks.selection).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'public-event',
      participants: [{
        type: 'companion', companionId: 'c2', companionName: '小美',
      }],
      companionToggle: true,
    }), false);
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      registrationIds: ['companion-document'],
      kind: 'companion',
      companionToggle: true,
    }));
    const registerOrder = mocks.selection.mock.invocationCallOrder[0];
    const cancelOrder = mocks.cancel.mock.invocationCallOrder[0];
    expect(registerOrder).toBeDefined();
    expect(cancelOrder).toBeDefined();
    expect(cancelOrder ?? Infinity).toBeLessThan(registerOrder ?? 0);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: '夥伴報名已更新：新增 1 人、取消 1 人',
    }));
  });

  it('同名但不同 companionId 不視為已報名', async () => {
    mocks.history.mockResolvedValue([{
      ...companion, companionId: 'other-id',
    }]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '幫夥伴報名' }));
    await screen.findByRole('button', { name: '確認', exact: true });
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toHaveProperty('checked', false);
    }
  });

  it('早鳥確認文字、扣點 payload 及成功訊息', async () => {
    mocks.detail.mockResolvedValue({
      ...detail,
      event: {
        ...detail.event,
        status: 'upcoming',
        regOpenTime: '2099-10-18T12:00:00+08:00',
        earlyBirdEnabled: true,
        earlyBirdCost: 20,
      },
    });
    mocks.register.mockResolvedValue({
      confirmed: 1,
      registrations: [{ participantType: 'self', status: 'confirmed' }],
      earlyBirdCharged: true,
      earlyBirdCost: 20,
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '早鳥報名 · 20 積分' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(
      '早鳥報名確認\n你將使用 20 積分提前報名「測試活動」。\n若活動取消，系統會退回積分；若你自行取消報名，已扣除的早鳥積分不會退回。',
      { okText: '確認扣除並報名' },
    ));
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      earlyBirdAccepted: true,
      earlyBirdExpectedCost: 20,
      context: expect.objectContaining({ getAuth: expect.any(Function) }),
    }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: '早鳥報名成功，已扣除 20 積分',
    }));
  });

  it('早鳥拒絕確認不送出', async () => {
    mocks.detail.mockResolvedValue({
      ...detail,
      event: {
        ...detail.event, status: 'upcoming',
        regOpenTime: '2099-10-18T12:00:00+08:00',
        earlyBirdEnabled: true, earlyBirdCost: 20,
      },
    });
    mocks.confirm.mockResolvedValue(false);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '早鳥報名 · 20 積分' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('候補回應顯示候補 toast 與紫色翻牌', async () => {
    mocks.register.mockResolvedValue({ waitlisted: 1 });
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '已加入候補名單' }));
    expect(view.container.querySelector('.signup-flip-back')?.textContent).toBe('取消候補');
  });

  it.each([
    [false, true, true],
    [false, false, false],
    [true, true, false],
  ])('LINE 引導 bound=%s allowed=%s', async (bound, allowed, shown) => {
    mocks.profile.mockResolvedValue({ ...profile, lineNotifyBound: bound });
    mocks.prompt.mockResolvedValue(allowed);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalled());
    if (shown) {
      await screen.findByRole('button', { name: '立即綁定' });
    } else if (bound) {
      expect(mocks.prompt).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(mocks.prompt).toHaveBeenCalledWith('u1'));
    }
    if (!shown) expect(screen.queryByRole('button', { name: '立即綁定' })).toBeNull();
  });

  it('LINE 綁定使用目前 UID 並在卸載時取消延遲提示', async () => {
    mocks.prompt.mockResolvedValue(true);
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    fireEvent.click(await screen.findByRole('button', { name: '立即綁定' }));
    await waitFor(() => expect(mocks.bind).toHaveBeenCalledWith(
      'u1', '小明', expect.objectContaining({
        signal: expect.any(AbortSignal), notify: expect.any(Function),
      }),
    ));
    const options = mocks.bind.mock.calls[0]?.[2] as {
      signal: AbortSignal;
      notify: (message: string) => void;
    } | undefined;
    expect(options?.signal.aborted).toBe(false);
    view.unmount();
    expect(options?.signal.aborted).toBe(true);
    mocks.toast.mockClear();
    options?.notify('不可在卸載後顯示');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('性別限制按鈕點擊顯示 A 原文，不送報名', async () => {
    mocks.detail.mockResolvedValue({
      ...detail,
      event: { ...detail.event, genderRestrictionEnabled: true, allowedGender: '男' },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '男生限定' }));
    expect(mocks.toast).toHaveBeenCalledWith({ message: '限男性報名，目前無法報名' });
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('個人資料載入中顯示同步按鈕，完成後才能報名', async () => {
    let resolve!: (value: SignupProfile) => void;
    mocks.profile.mockReturnValue(new Promise<SignupProfile>(done => { resolve = done; }));
    mount();
    const button = await screen.findByRole('button', { name: '用戶資料同步中' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await act(async () => { resolve(profile); });
    await screen.findByRole('button', { name: '立即報名' });
  });

  it('舊 UID 的 profile 延遲回來不能覆蓋新 session', async () => {
    let resolveOld!: (value: SignupProfile) => void;
    mocks.profile.mockImplementation((uid: string) => uid === 'u1'
      ? new Promise<SignupProfile>(resolve => { resolveOld = resolve; })
      : Promise.resolve({ ...profile, gender: '男' }));
    mocks.detail.mockResolvedValue({
      ...detail,
      event: { ...detail.event, genderRestrictionEnabled: true, allowedGender: '男' },
    });
    const view = mount();
    await screen.findByRole('button', { name: '用戶資料同步中' });
    mocks.viewer.mockReturnValue({ ...viewer, uid: 'u2' });
    view.rerender(
      <LocationProvider><EventDetailPage id="public-event" /></LocationProvider>,
    );
    await screen.findByRole('button', { name: '立即報名' });
    await act(async () => { resolveOld(profile); });
    expect(screen.queryByRole('button', { name: '男生限定' })).toBeNull();
    expect(screen.getByRole('button', { name: '立即報名' })).toBeTruthy();
  });

  it('訪客不讀 profile，工具列先登入', async () => {
    mocks.viewer.mockReturnValue({ ...viewer, uid: null });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '幫夥伴報名' }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.companions).not.toHaveBeenCalled();
  });

  it('翻牌到期清除，卸載後 context 失效', async () => {
    const view = mount();
    const button = await screen.findByRole('button', { name: '立即報名' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(view.container.querySelector('.signup-flip-back')).toBeNull();
    const input = mocks.register.mock.calls[0]?.[0] as {
      context: { getAuth: () => { uid: string | null } };
    } | undefined;
    expect(input?.context.getAuth().uid).toBe('u1');
    view.unmount();
    expect(input?.context.getAuth().uid).toBeNull();
  });
});
