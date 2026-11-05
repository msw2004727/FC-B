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

  // T-087c：T-087a 伺服器新代碼；修正前落到「夥伴報名調整失敗，請稍後再試」。
  function serverError(originalCode: string, message: string): SignupError {
    return new SignupError({
      code: 'failed-precondition',
      originalCode,
      messageKey: 'event.signup.error.unknown',
      message,
    });
  }

  async function openCompanionSelect(): Promise<{ confirm: HTMLElement; boxes: HTMLElement[] }> {
    fireEvent.click(await screen.findByRole('button', { name: '幫夥伴報名' }));
    const confirm = await screen.findByRole('button', { name: '確認', exact: true });
    const overlay = document.querySelector('#companion-select-overlay');
    if (!(overlay instanceof HTMLElement)) throw new Error('缺少同行者彈窗');
    return { confirm, boxes: within(overlay).getAllByRole('checkbox') };
  }

  it('(T-087c) 同行者勾選取消被伺服器以 EVENT_STARTED 拒絕 → 顯示取消時限文案', async () => {
    mocks.history.mockResolvedValue([self, companion]);
    mocks.cancel.mockRejectedValue(serverError('EVENT_STARTED', '活動已於開始時間結束，無法取消報名'));
    mount();
    const { confirm, boxes } = await openCompanionSelect();
    const first = boxes[0];
    if (!first) throw new Error('缺少同行者');
    fireEvent.click(first);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'companion',
      companionToggle: true,
    })));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: '活動已於開始時間結束，無法取消報名',
    }));
    expect(mocks.selection).not.toHaveBeenCalled();
  });

  it.each([
    ['EVENT_UNAVAILABLE', '此活動目前無法報名'],
    ['REQUEST_ID_CONFLICT', '請重新整理後再試'],
    ['PARTICIPANT_NOT_ALLOWED', '無權限執行此操作'],
  ] as const)('(T-087c) 同行者加報被伺服器以 %s 拒絕 → 顯示對應文案', async (code, text) => {
    mocks.selection.mockRejectedValue(serverError(code, text));
    mount();
    const { confirm, boxes } = await openCompanionSelect();
    const first = boxes[0];
    if (!first) throw new Error('缺少同行者');
    fireEvent.click(first);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.selection).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: text }));
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('(T-087c) 本人取消被伺服器以 EVENT_STARTED 拒絕 → 顯示伺服器文案', async () => {
    mocks.history.mockResolvedValue([self]);
    mocks.cancel.mockRejectedValue(serverError('EVENT_STARTED', '活動已於開始時間結束，無法取消報名'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '取消報名' }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({ kind: 'self' })));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: '活動已於開始時間結束，無法取消報名',
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

describe('T-086a 本人報名／取消縮短往返', () => {
  const viewerA: ViewerView = { ...viewer, uid: 'uidA', displayName: '甲' };
  const detailA: LoadedEventDetail = {
    eventDocId: 'doc-evtA',
    event: { ...detail.event, id: 'evtA' },
  };
  const selfA: DetailRegistration = {
    ...self,
    _docId: 'targetA',
    eventId: 'evtA',
    userId: 'uidA',
    userName: '甲',
  };

  function mountA() {
    return render(<LocationProvider><EventDetailPage id="evtA" /></LocationProvider>);
  }

  function busyButton(container: Element): Element | null {
    return container.querySelector('button[aria-busy="true"]');
  }

  beforeEach(() => {
    mocks.viewer.mockReturnValue(viewerA);
    mocks.detail.mockResolvedValue(detailA);
  });

  it('本人報名把剛讀的同組快照交給 registerForEvent（頁面只讀 1 次）', async () => {
    mountA();
    const button = await screen.findByRole('button', { name: '立即報名' });
    const before = mocks.detail.mock.calls.length;
    fireEvent.click(button);
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    // 頁面前置檢查 1 次；registerForEvent 內是否重讀由 signup.test.ts 以 load 計數驗證。
    expect(mocks.detail).toHaveBeenCalledTimes(before + 1);
    const input = mocks.register.mock.calls[0]?.[0] as {
      context: { getAuth: () => { generation: number } };
      snapshotGeneration?: number;
    } | undefined;
    expect(input).toMatchObject({
      eventId: 'evtA',
      user: { uid: 'uidA', displayName: '甲' },
      snapshot: expect.objectContaining({
        event: expect.objectContaining({ id: 'evtA' }),
        viewer: expect.objectContaining({ uid: 'uidA' }),
      }),
      snapshotLoadedAt: expect.any(Number),
      snapshotParticipants: [{ type: 'self' }],
    });
    expect(input?.snapshotGeneration).toBe(input?.context.getAuth().generation);
  });

  it('早鳥確認視窗之後不傳快照，registerForEvent 必定重讀', async () => {
    mocks.detail.mockResolvedValue({
      ...detailA,
      event: {
        ...detailA.event,
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
    mountA();
    fireEvent.click(await screen.findByRole('button', { name: '早鳥報名 · 20 積分' }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    const input = mocks.register.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(input).toMatchObject({ earlyBirdAccepted: true, earlyBirdExpectedCost: 20 });
    expect(input).not.toHaveProperty('snapshot');
    expect(input).not.toHaveProperty('snapshotLoadedAt');
  });

  it('報名成功後刷新在背景：讀取未回時已解除忙碌並顯示成功，晚到後才更新按鈕', async () => {
    let resolveRegs!: (rows: DetailRegistration[]) => void;
    mocks.registrations.mockReturnValue(new Promise<DetailRegistration[]>((resolve) => {
      resolveRegs = resolve;
    }));
    mocks.history.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([selfA]);
    const view = mountA();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '報名成功！' }));
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(busyButton(view.container)).toBeNull());
    expect(mocks.register).toHaveBeenCalledTimes(1);
    await act(async () => { resolveRegs([selfA]); });
    await screen.findByRole('button', { name: '取消報名' });
  });

  it('成功後立刻再按報名：重讀後以已報名拒絕，不送第二次 Callable', async () => {
    mocks.registrations.mockReturnValue(new Promise<DetailRegistration[]>(() => {}));
    mocks.history.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([selfA]);
    const view = mountA();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '報名成功！' }));
    await waitFor(() => expect(busyButton(view.container)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '你已經報名這場活動' }));
    expect(mocks.register).toHaveBeenCalledTimes(1);
  });

  it('背景刷新晚到不覆蓋較新的快照', async () => {
    let resolveStale!: (rows: DetailRegistration[]) => void;
    mocks.registrations
      .mockReturnValueOnce(new Promise<DetailRegistration[]>((resolve) => { resolveStale = resolve; }))
      .mockResolvedValue([selfA]);
    // 進頁、按下前置檢查、背景刷新（舊）、重新整理（新）。
    mocks.history
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([selfA]);
    const view = mountA();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(busyButton(view.container)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
    await screen.findByRole('button', { name: '取消報名' });
    expect(mocks.registrations).toHaveBeenCalledTimes(2);
    await act(async () => { resolveStale([]); });
    expect(screen.getByRole('button', { name: '取消報名' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '立即報名' })).toBeNull();
  });

  it('deduplicated 報名：不顯示成功、不渲染回應名單，等重讀完成才解除忙碌', async () => {
    let resolveRegs!: (rows: DetailRegistration[]) => void;
    mocks.registrations.mockReturnValue(new Promise<DetailRegistration[]>((resolve) => {
      resolveRegs = resolve;
    }));
    mocks.register.mockResolvedValue({ deduplicated: true, registrations: [{ ...selfA }] });
    const view = mountA();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '報名處理中，請稍候' }));
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    expect(busyButton(view.container)).not.toBeNull();
    expect(mocks.toast).not.toHaveBeenCalledWith({ message: '報名成功！' });
    expect(view.container.querySelector('.signup-flip-back')).toBeNull();
    expect(screen.queryByRole('button', { name: '取消報名' })).toBeNull();
    await act(async () => { resolveRegs([]); });
    await waitFor(() => expect(busyButton(view.container)).toBeNull());
    expect(screen.getByRole('button', { name: '立即報名' })).toBeTruthy();
  });

  it('報名逾時：顯示既有錯誤訊息後重讀名單，不重送', async () => {
    mocks.register.mockRejectedValue(new SignupError({
      code: 'deadline-exceeded',
      originalCode: 'CALLABLE_TIMEOUT',
      messageKey: 'event.signup.error.unknown',
      message: '連線逾時，請檢查網路後重新整理再試',
    }));
    mountA();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: '連線逾時，請檢查網路後重新整理再試',
    }));
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalledWith({ message: '報名成功！' });
  });

  it('單人取消：確認視窗前不讀活動，確認後才送出（頁面 0 次）', async () => {
    mocks.history.mockResolvedValue([selfA]);
    let confirm!: (value: boolean) => void;
    mocks.confirm.mockReturnValue(new Promise<boolean>(resolve => { confirm = resolve; }));
    mountA();
    const button = await screen.findByRole('button', { name: '取消報名' });
    const before = mocks.detail.mock.calls.length;
    fireEvent.click(button);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('確定要取消報名？'));
    expect(mocks.detail).toHaveBeenCalledTimes(before);
    expect(mocks.cancel).not.toHaveBeenCalled();
    await act(async () => { confirm(true); });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '已取消報名' }));
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evtA',
      registrationIds: ['targetA'],
      kind: 'self',
    }));
    // cancelRegistration 已 mock；函式內送出前那 1 次重讀由 signup.test.ts 驗證。
    expect(mocks.detail).toHaveBeenCalledTimes(before);
  });

  it('取消成功後刷新在背景：讀取未回時已解除忙碌', async () => {
    mocks.history.mockResolvedValue([selfA]);
    mocks.registrations.mockReturnValue(new Promise<DetailRegistration[]>(() => {}));
    const view = mountA();
    fireEvent.click(await screen.findByRole('button', { name: '取消報名' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '已取消報名' }));
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(busyButton(view.container)).toBeNull());
  });

  it('deduplicated 取消：不顯示成功，等重讀完成才解除忙碌', async () => {
    mocks.history.mockResolvedValue([selfA]);
    let resolveRegs!: (rows: DetailRegistration[]) => void;
    mocks.registrations.mockReturnValue(new Promise<DetailRegistration[]>((resolve) => {
      resolveRegs = resolve;
    }));
    mocks.cancel.mockResolvedValue({ deduplicated: true });
    const view = mountA();
    fireEvent.click(await screen.findByRole('button', { name: '取消報名' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '取消處理中，請稍候' }));
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    expect(busyButton(view.container)).not.toBeNull();
    expect(mocks.toast).not.toHaveBeenCalledWith({ message: '已取消報名' });
    await act(async () => { resolveRegs([selfA]); });
    await waitFor(() => expect(busyButton(view.container)).toBeNull());
  });

  // R-REG-002：結果未知且無 Callable 投影時，current 改用重讀的活動文件（伺服器重算值）。
  function capacityText(container: Element): string | null | undefined {
    return container.querySelector('[data-detail-field="capacity-count"]')?.textContent;
  }

  it('deduplicated 報名後人數改用重讀的活動文件', async () => {
    const before = { ...detailA, event: { ...detailA.event, current: 0, max: 10 } };
    const fresh = { ...detailA, event: { ...detailA.event, current: 1, max: 10 } };
    // 送出寫入前一律讀到舊值；寫入後的重讀才拿到伺服器重算值。
    mocks.detail.mockImplementation(async () => (mocks.register.mock.calls.length ? fresh : before));
    mocks.register.mockResolvedValue({ deduplicated: true });
    const view = mountA();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '報名處理中，請稍候' }));
    await waitFor(() => expect(capacityText(view.container)).toContain('已報 1/10'));
  });

  it('報名逾時後人數改用重讀的活動文件', async () => {
    const before = { ...detailA, event: { ...detailA.event, current: 0, max: 10 } };
    const fresh = { ...detailA, event: { ...detailA.event, current: 1, max: 10 } };
    mocks.detail.mockImplementation(async () => (mocks.register.mock.calls.length ? fresh : before));
    mocks.register.mockRejectedValue(new SignupError({
      code: 'deadline-exceeded',
      originalCode: 'CALLABLE_TIMEOUT',
      messageKey: 'event.signup.error.unknown',
      message: '連線逾時，請檢查網路後重新整理再試',
    }));
    const view = mountA();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(capacityText(view.container)).toContain('已報 1/10'));
    expect(mocks.register).toHaveBeenCalledTimes(1);
  });

  it('deduplicated 取消後人數改用重讀的活動文件', async () => {
    const before = { ...detailA, event: { ...detailA.event, current: 1, max: 10 } };
    const fresh = { ...detailA, event: { ...detailA.event, current: 0, max: 10 } };
    mocks.detail.mockImplementation(async () => (mocks.cancel.mock.calls.length ? fresh : before));
    mocks.history.mockResolvedValue([selfA]);
    mocks.registrations.mockResolvedValue([selfA]);
    mocks.cancel.mockResolvedValue({ deduplicated: true });
    const view = mountA();
    fireEvent.click(await screen.findByRole('button', { name: '取消報名' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '取消處理中，請稍候' }));
    await waitFor(() => expect(capacityText(view.container)).toContain('已報 0/10'));
  });
});
