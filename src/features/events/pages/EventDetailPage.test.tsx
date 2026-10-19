import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { LoadedEventDetail } from '../data/event-detail';
import type { DetailRegistration } from '../data/detail-model';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  registrations: vi.fn(),
  history: vi.fn(),
  register: vi.fn(),
  cancel: vi.fn(),
  signIn: vi.fn(),
  viewer: vi.fn(),
  companions: vi.fn(),
}));

vi.mock('@/features/events/data/event-detail', () => ({
  loadEventDetail: mocks.detail,
  loadEventRegistrations: mocks.registrations,
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
        current: 1, max: 10, waitlist: 1,
        notes: '<img src=x onerror=alert(1)>',
      },
    });
    mocks.registrations.mockResolvedValue([
      self,
      { ...self, _docId: 'wait', userId: 'u2', userName: '小華', status: 'waitlisted' },
      { ...self, _docId: 'removed', userId: 'u3', userName: '不可顯示', status: 'removed' },
    ]);
    const view = mount();
    await screen.findByText('青埔五人制', undefined, { timeout: 3000 });
    await screen.findByText('小華', undefined, { timeout: 3000 });
    expect(screen.getByText('青埔籃足球共用球場')).toBeTruthy();
    expect(screen.getByText('Neo')).toBeTruthy();
    expect(screen.queryByText('不可顯示')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(view.container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByRole('link', { name: '在地圖開啟' }).getAttribute('rel'))
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

    mount();
    await screen.findByRole('heading', { name: '青埔五人制', level: 1 });
    expect(screen.getByText('青埔籃足球共用球場')).toBeTruthy();
    expect(screen.getByText('Neo')).toBeTruthy();
    expect(screen.getByText('請攜帶飲水')).toBeTruthy();
    expect(screen.getByText('3/10人')).toBeTruthy();
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

  it('登入但名單讀取失敗：主資訊與報名按鈕仍顯示，名單區塊可重試', async () => {
    let resolveRetry!: (registrations: DetailRegistration[]) => void;
    const retryRegistrations = new Promise<DetailRegistration[]>((resolve) => {
      resolveRetry = resolve;
    });
    mocks.registrations
      .mockRejectedValueOnce(new Error('private permission detail'))
      .mockReturnValueOnce(retryRegistrations);

    mount();
    const title = await screen.findByRole('heading', { name: '青埔五人制', level: 1 });
    const region = screen.getByRole('region', { name: '參加名單' });
    await within(region).findByText('無法載入參加名單，請重試。');

    expect(screen.getByText('青埔籃足球共用球場')).toBeTruthy();
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
    await within(region).findByText('參加名單載入中…');
    expect(screen.getByRole('heading', { name: '青埔五人制', level: 1 })).toBe(title);
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
    expect(screen.getByRole('heading', { name: '青埔五人制', level: 1 })).toBe(title);
  });

  it('名單尚未回應時主資訊先顯示，登出後舊名單回應不能進入訪客頁', async () => {
    let resolveOld!: (registrations: DetailRegistration[]) => void;
    mocks.registrations.mockReturnValue(new Promise<DetailRegistration[]>((resolve) => {
      resolveOld = resolve;
    }));
    const view = mount();
    await screen.findByRole('heading', { name: '青埔五人制', level: 1 });
    await screen.findByText('參加名單載入中…');
    expect(screen.getByRole('button', { name: '立即報名' })).toBeTruthy();

    mocks.viewer.mockReturnValue({ ...viewer, uid: null });
    view.rerender(<LocationProvider><EventDetailPage id="ce_123_abc" /></LocationProvider>);
    await screen.findByRole('heading', { name: '青埔五人制', level: 1 });
    resolveOld([{ ...self, userName: '舊登入名單不可顯示' }]);
    await waitFor(() => {
      expect(screen.queryByText('舊登入名單不可顯示')).toBeNull();
      expect(screen.queryByText('參加名單載入中…')).toBeNull();
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
    await screen.findByRole('heading', { name: '青埔五人制', level: 1 });
    await screen.findByText('無法同步你的報名狀態，請重試後再報名。');
    expect(screen.queryByText('無法載入活動詳情，請重試。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '立即報名' }));
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(1));
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.companions).not.toHaveBeenCalled();
  });

  it('報名成功只更新名單、計數與按鈕，不重載活動', async () => {
    mocks.registrations.mockResolvedValueOnce([]).mockResolvedValue([self]);
    mocks.history.mockResolvedValueOnce([]).mockResolvedValue([self]);
    mount();
    const title = await screen.findByText('青埔五人制');
    fireEvent.click(screen.getByRole('button', { name: '立即報名' }));
    await screen.findByRole('button', { name: '取消報名' });
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'ce_123_abc',
      user: { uid: 'u1', displayName: '小明' },
    }));
    expect(screen.getByText('青埔五人制')).toBe(title);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledTimes(2);
    expect(screen.getByText('1/0人')).toBeTruthy();
  });

  it('確認選取後才取消，payload 使用子文件 ID', async () => {
    mocks.registrations.mockResolvedValueOnce([self]).mockResolvedValue([]);
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
    // registerForEvent 已被 mock，本測試驗證頁面重試契約，
    // 不代表 signup 寫入整合已通過驗證。
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T04:00:00+08:00'));

    let resolveRetry!: (registrations: DetailRegistration[]) => void;
    const retryRegistrations = new Promise<DetailRegistration[]>((resolve) => {
      resolveRetry = resolve;
    });

    mocks.registrations
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(retryRegistrations);
    mocks.history
      .mockResolvedValueOnce([])
      .mockResolvedValue([self]);

    mount();
    fireEvent.click(await screen.findByRole('button', { name: '立即報名' }));

    const retry = await screen.findByRole('button', { name: '重試' });
    await waitFor(() => {
      expect((retry as HTMLButtonElement).disabled).toBe(false);
    });
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledTimes(2);
    expect(mocks.history).toHaveBeenCalledTimes(2);
    expect((screen.getByRole('button', { name: '立即報名' }) as HTMLButtonElement).disabled)
      .toBe(true);
    const companionButton = screen.queryByRole('button', { name: '幫夥伴報名' }) as HTMLButtonElement | null;
    expect(companionButton === null || companionButton.disabled).toBe(true);

    fireEvent.click(retry);

    await waitFor(() => {
      expect(mocks.registrations).toHaveBeenCalledTimes(3);
      expect(mocks.history).toHaveBeenCalledTimes(3);
      expect((retry as HTMLButtonElement).disabled).toBe(true);
    });
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenNthCalledWith(3, 'firestore-doc-a');
    expect(mocks.history).toHaveBeenNthCalledWith(3, 'u1');

    resolveRetry([self]);

    const cancel = await screen.findByRole('button', { name: '取消報名' });
    await waitFor(() => {
      expect((cancel as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByRole('button', { name: '重試' })).toBeNull();
    });
    expect(screen.getByText('1/0人')).toBeTruthy();
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.companions).toHaveBeenCalledTimes(1);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.registrations).toHaveBeenCalledTimes(3);
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
    await waitFor(() => expect(mocks.registrations).toHaveBeenCalledTimes(2));
  });

  it('快速切換活動時舊請求不能覆蓋新頁', async () => {
    let resolveOld!: (value: LoadedEventDetail) => void;
    mocks.detail.mockImplementation((id: string) => id === 'old'
      ? new Promise<LoadedEventDetail>((done) => { resolveOld = done; })
      : Promise.resolve(detail));

    const view = render(<LocationProvider><EventDetailPage id="old" /></LocationProvider>);
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledWith('old'));
    view.rerender(<LocationProvider><EventDetailPage id="ce_123_abc" /></LocationProvider>);
    await screen.findByText('青埔五人制');
    resolveOld({ ...detail, event: { ...detail.event, id: 'old', title: '舊活動' } });
    await waitFor(() => expect(screen.queryByText('舊活動')).toBeNull());
  });
});
