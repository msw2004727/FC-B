import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';

import type { ViewerView } from '../../data/viewer';
import {
  LegacyRelatedActivities,
  useRelatedActivitiesData,
  type RelatedSection,
} from './LegacyProfileSocialAndRelated';

// 全部外部依賴以 hoisted mock 提供，避免觸及真實 Firestore／Callable。
const {
  useViewerMock,
  useRemoteMock,
  canEditMock,
  canCancelMock,
  runLifecycleMock,
  beginCancelMock,
  loadRelatedActivitiesMock,
  loadEventDetailMock,
  loadViewerRegistrationsMock,
  routeMock,
  toastShowMock,
} = vi.hoisted(() => ({
  useViewerMock: vi.fn(),
  useRemoteMock: vi.fn(),
  canEditMock: vi.fn(),
  canCancelMock: vi.fn(),
  runLifecycleMock: vi.fn(),
  beginCancelMock: vi.fn(),
  loadRelatedActivitiesMock: vi.fn(),
  loadEventDetailMock: vi.fn(),
  loadViewerRegistrationsMock: vi.fn(),
  routeMock: vi.fn(),
  toastShowMock: vi.fn(),
}));

vi.mock('preact-iso', () => ({ useLocation: () => ({ route: routeMock }) }));
vi.mock('@/ui/Toast', () => ({ toast: { show: toastShowMock } }));

vi.mock('@/features/events/data/operate-permissions', () => ({
  canEditOwnActivityBasic: canEditMock,
  canCancelOwnActivity: canCancelMock,
}));

vi.mock('@/features/events/components/legacy/event-lifecycle-action', () => ({
  runEventLifecycleAction: runLifecycleMock,
}));

vi.mock('@/features/events/components/legacy/use-cancel-registration', () => ({
  useCancelRegistration: vi.fn(() => ({
    beginCancel: beginCancelMock,
    confirmCancel: vi.fn(),
    modal: null,
    closeModal: vi.fn(),
    renderModal: () => null,
  })),
}));

vi.mock('@/features/events/data/event-create-context', () => ({
  operateContextFromViewer: vi.fn(() => ({
    uid: 'u1',
    role: 'user',
    rolePermissions: null,
    userGrants: null,
    capabilities: [],
    customRoles: [],
  })),
}));

vi.mock('@/features/events/data/signup-context', () => ({
  createDetailSignupContexts: vi.fn(() => ({ signup: {}, cancel: {} })),
}));

vi.mock('@/features/events/data/event-detail', () => ({
  loadEventDetail: loadEventDetailMock,
}));

vi.mock('@/features/events/data/viewer-registrations', () => ({
  loadViewerRegistrationsFresh: loadViewerRegistrationsMock,
}));

vi.mock('../../data/viewer', () => ({ useViewer: useViewerMock }));

vi.mock('../../data/related-activities', () => ({
  loadRelatedActivities: loadRelatedActivitiesMock,
}));

vi.mock('../../ui/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/shared')>();
  return { ...actual, useRemote: useRemoteMock };
});

const viewerStub = {
  uid: 'u1',
  role: 'user',
  displayName: null,
  pictureUrl: null,
  capabilities: [],
} as unknown as ViewerView;

function setLoading(): void {
  useRemoteMock.mockReturnValue({
    state: { status: 'loading' },
    retry: vi.fn(),
  });
}

function setReady(payload: { registered?: unknown[]; hosted?: unknown[] }): void {
  useRemoteMock.mockReturnValue({
    state: {
      status: 'ready',
      data: {
        registered: payload.registered ?? [],
        hosted: payload.hosted ?? [],
        counts: {
          registered: payload.registered?.length ?? 0,
          hosted: payload.hosted?.length ?? 0,
        },
      },
    },
    retry: vi.fn(),
  });
}

// 測試同步更新：11-06 個人頁改版，清單外殼改由 ProfileQuickBar 負責，資料由頁面 useRelatedActivitiesData 讀一次後傳入；
// 這裡用同一支 hook 組出展開後的單一區段。
function Section({ section, active = true }: { section: RelatedSection; active?: boolean }) {
  const data = useRelatedActivitiesData('u1');
  return <LegacyRelatedActivities section={section} data={data} active={active} />;
}

describe('LegacyRelatedActivities 卡片右側動作鈕（照 A）', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    useViewerMock.mockReturnValue(viewerStub);
    canEditMock.mockReturnValue(true);
    canCancelMock.mockReturnValue(true);
    runLifecycleMock.mockResolvedValue(true);
    beginCancelMock.mockResolvedValue(undefined);
    loadEventDetailMock.mockResolvedValue({
      event: { id: 'e1', title: '活動A', status: 'open' },
      eventDocId: 'e1',
    });
    loadViewerRegistrationsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('我開的團：有 canEditOwnActivityBasic 才出現編輯鈕', () => {
    setReady({
      hosted: [{ event: { id: 'e1', title: '活動A', status: 'open' }, effectiveStatus: 'open' }],
    });

    canEditMock.mockReturnValue(true);
    canCancelMock.mockReturnValue(false);
    render(<Section section="hosted" />);
    expect(screen.queryByRole('button', { name: '編輯活動' })).not.toBeNull();

    cleanup();
    canEditMock.mockReturnValue(false);
    render(<Section section="hosted" />);
    expect(screen.queryByRole('button', { name: '編輯活動' })).toBeNull();
  });

  it('我開的團：terminal 活動不出現取消活動鈕', () => {
    setReady({
      hosted: [{
        event: { id: 'e1', title: '活動A', status: 'cancelled' },
        effectiveStatus: 'cancelled',
      }],
    });
    render(<Section section="hosted" />);
    expect(screen.queryByRole('button', { name: '取消活動' })).toBeNull();
  });

  it('我開的團：點取消活動呼叫 runEventLifecycleAction 的 kind 為 cancel', async () => {
    setReady({
      hosted: [{ event: { id: 'e1', title: '活動A', status: 'open' }, effectiveStatus: 'open' }],
    });
    render(<Section section="hosted" />);

    fireEvent.click(screen.getByRole('button', { name: '取消活動' }));
    await waitFor(() => expect(runLifecycleMock).toHaveBeenCalledTimes(1));
    expect(runLifecycleMock.mock.calls[0]?.[0]).toBe('cancel');
  });

  // 測試同步更新：照 A（fix-2e 項目 1）owned 只留本活動有效報名（本人＋同行者）。
  it('我的報名：owned 只含有效報名（confirmed／waitlisted），排除 cancelled／removed／其他活動', async () => {
    setReady({
      registered: [{
        event: { id: 'e1', title: '活動A' },
        effectiveStatus: 'open',
        registrationStatus: 'confirmed',
        registration: {},
      }],
    });
    loadViewerRegistrationsMock.mockResolvedValue([
      { eventId: 'e1', userId: 'u1', status: 'confirmed', _docId: 'r1' },
      { eventId: 'e1', userId: 'u1', status: 'confirmed', participantType: 'companion', companionId: 'c1', _docId: 'r2' },
      { eventId: 'e1', userId: 'u1', status: 'waitlisted', _docId: 'r3' },
      { eventId: 'e1', userId: 'u1', status: 'cancelled', _docId: 'r4' },
      { eventId: 'e1', userId: 'u1', status: 'removed', _docId: 'r5' },
      { eventId: 'other', userId: 'u1', status: 'confirmed', _docId: 'r6' },
    ]);

    render(<Section section="registered" />);

    fireEvent.click(screen.getByRole('button', { name: '取消報名' }));
    await waitFor(() => expect(beginCancelMock).toHaveBeenCalledTimes(1));
    const arg = beginCancelMock.mock.calls[0]?.[0] as {
      publicId: string;
      owned: Array<{ _docId?: string }>;
    };
    expect(arg.publicId).toBe('e1');
    const ids = arg.owned.map(o => o._docId);
    // 排序依 _docId 字典序（registeredAt 全部 undefined → Infinity，promotionOrder 0）。
    expect(ids).toEqual(['r1', 'r2', 'r3']);
  });

  // 審查 P2-2：取消流程進行中切到別的圖示（元件保持掛載、active=false），完成後仍會 reload 刷新清單。
  it('切走（active=false）時清單不渲染，進行中的取消活動完成後仍會重新載入', async () => {
    setReady({
      hosted: [{ event: { id: 'e1', title: '活動A', status: 'open' }, effectiveStatus: 'open' }],
    });
    let finish!: () => void;
    runLifecycleMock.mockImplementation((_kind: string, _event: unknown, opts: { onDone: () => void }) =>
      new Promise<boolean>((resolve) => {
        finish = () => { opts.onDone(); resolve(true); };
      }));
    const { rerender } = render(<Section section="hosted" />);
    fireEvent.click(screen.getByRole('button', { name: '取消活動' }));
    await waitFor(() => expect(runLifecycleMock).toHaveBeenCalledTimes(1));

    rerender(<Section section="hosted" active={false} />);
    expect(document.getElementById('profile-hosted-activities-list')).toBeNull();
    expect(useRemoteMock.mock.calls.at(-1)?.[0]).toBe('u1:0');

    finish();
    await waitFor(() => expect(useRemoteMock.mock.calls.at(-1)?.[0]).toBe('u1:1'));
  });

  it('點動作鈕不會觸發開詳情', async () => {
    setReady({
      hosted: [{ event: { id: 'e1', title: '活動A', status: 'open' }, effectiveStatus: 'open' }],
    });
    render(<Section section="hosted" />);

    fireEvent.click(screen.getByRole('button', { name: '取消活動' }));
    await waitFor(() => expect(runLifecycleMock).toHaveBeenCalledTimes(1));
    expect(routeMock).not.toHaveBeenCalled();
  });

  // 測試同步更新：照 A（fix-2e 項目 2）編輯 handler 內重新檢查權限。
  it('編輯 handler 在權限被收回後不開表單並 toast', async () => {
    setReady({
      hosted: [{ event: { id: 'e1', title: '活動A', status: 'open' }, effectiveStatus: 'open' }],
    });
    canEditMock.mockReturnValue(true);
    canCancelMock.mockReturnValue(false);

    render(<Section section="hosted" />);

    const editBtn = screen.getByRole('button', { name: '編輯活動' });

    // 點擊前權限被收回：handler 內必須再次檢查，不開表單、toast 拒絕。
    canEditMock.mockReturnValue(false);
    fireEvent.click(editBtn);

    await waitFor(() => expect(toastShowMock).toHaveBeenCalledTimes(1));
    expect(toastShowMock).toHaveBeenCalledWith({
      message: '您只能管理自己的活動',
      tone: 'error',
    });
  });

  // 測試同步更新：照 A（fix-2e 項目 3）非同步期間換帳號丟棄結果。
  it('載入期間 uid 改變：不呼叫 beginCancel', async () => {
    setReady({
      registered: [{
        event: { id: 'e1', title: '活動A' },
        effectiveStatus: 'open',
        registrationStatus: 'confirmed',
        registration: {},
      }],
    });

    let resolveDetail!: (v: unknown) => void;
    let resolveRegs!: (v: unknown) => void;
    loadEventDetailMock.mockReturnValueOnce(new Promise((r) => { resolveDetail = r; }));
    loadViewerRegistrationsMock.mockReturnValueOnce(new Promise((r) => { resolveRegs = r; }));

    const { rerender } = render(<Section section="registered" />);
    fireEvent.click(screen.getByRole('button', { name: '取消報名' }));

    await waitFor(() => {
      expect(loadEventDetailMock).toHaveBeenCalledWith('e1');
      expect(loadViewerRegistrationsMock).toHaveBeenCalledWith('u1');
    });

    // 換帳號：viewer 切換到 u2，觸發 uid 變化的 effect（清 snapshot、closeModal）。
    useViewerMock.mockReturnValue({
      ...viewerStub,
      uid: 'u2',
    } as unknown as ViewerView);
    rerender(<Section section="registered" />);

    // 現在才讓舊帳號的載入完成。
    resolveDetail({ event: { id: 'e1', title: '活動A', status: 'open' }, eventDocId: 'e1' });
    resolveRegs([{ eventId: 'e1', userId: 'u1', status: 'confirmed', _docId: 'r1' }]);

    await new Promise(r => setTimeout(r, 30));
    expect(beginCancelMock).not.toHaveBeenCalled();
  });

  it('我的報名讀取中是 .reg-loading（圈＋原載入文字），讀完換成清單', async () => {
    _setDictLoaderForTest(async () => ({ 'profile.loading': '載入中…' }));
    await setLocale('zh-TW');
    setLoading();
    const view = render(<Section section="registered" />);
    const loading = document.querySelector('#profile-registered-activities-list .reg-loading');
    expect(loading?.getAttribute('role')).toBe('status');
    expect(loading?.textContent).toContain('載入中…');
    expect(document.querySelector('.profile-state')).toBeNull();

    setReady({ registered: [] });
    view.rerender(<Section section="registered" />);
    expect(document.querySelector('.reg-loading')).toBeNull();
    expect(screen.getByText('目前沒有正取或候補中的報名活動')).toBeTruthy();
    _setDictLoaderForTest(null);
  });

  it('我開的團讀取中是 .reg-loading，失敗改回既有失敗畫面', () => {
    setLoading();
    const view = render(<Section section="hosted" />);
    expect(document.querySelector('#profile-hosted-activities-list .reg-loading')?.getAttribute('role')).toBe('status');

    useRemoteMock.mockReturnValue({ state: { status: 'error' }, retry: vi.fn() });
    view.rerender(<Section section="hosted" />);
    expect(document.querySelector('.reg-loading')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(document.querySelector('#profile-hosted-activities-list .profile-state button')).not.toBeNull();
  });
});
