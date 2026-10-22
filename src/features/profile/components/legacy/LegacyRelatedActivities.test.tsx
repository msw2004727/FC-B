import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewerView } from '../../data/viewer';
import { LegacyRelatedActivities } from './LegacyProfileSocialAndRelated';

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
  loadViewerRegistrations: loadViewerRegistrationsMock,
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

function expand(cardId: string): void {
  const toggle = document.querySelector(
    `#${cardId} .profile-collapse-toggle`,
  ) as HTMLElement | null;
  if (!toggle) throw new Error(`collapse toggle missing: ${cardId}`);
  fireEvent.click(toggle);
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
    render(<LegacyRelatedActivities uid="u1" />);
    expand('profile-hosted-activities-card');
    expect(screen.queryByRole('button', { name: '編輯活動' })).not.toBeNull();

    cleanup();
    canEditMock.mockReturnValue(false);
    render(<LegacyRelatedActivities uid="u1" />);
    expand('profile-hosted-activities-card');
    expect(screen.queryByRole('button', { name: '編輯活動' })).toBeNull();
  });

  it('我開的團：terminal 活動不出現取消活動鈕', () => {
    setReady({
      hosted: [{
        event: { id: 'e1', title: '活動A', status: 'cancelled' },
        effectiveStatus: 'cancelled',
      }],
    });
    render(<LegacyRelatedActivities uid="u1" />);
    expand('profile-hosted-activities-card');
    expect(screen.queryByRole('button', { name: '取消活動' })).toBeNull();
  });

  it('我開的團：點取消活動呼叫 runEventLifecycleAction 的 kind 為 cancel', async () => {
    setReady({
      hosted: [{ event: { id: 'e1', title: '活動A', status: 'open' }, effectiveStatus: 'open' }],
    });
    render(<LegacyRelatedActivities uid="u1" />);
    expand('profile-hosted-activities-card');

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

    render(<LegacyRelatedActivities uid="u1" />);
    expand('profile-registered-activities-card');

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

  it('點動作鈕不會觸發開詳情', async () => {
    setReady({
      hosted: [{ event: { id: 'e1', title: '活動A', status: 'open' }, effectiveStatus: 'open' }],
    });
    render(<LegacyRelatedActivities uid="u1" />);
    expand('profile-hosted-activities-card');

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

    render(<LegacyRelatedActivities uid="u1" />);
    expand('profile-hosted-activities-card');

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

    const { rerender } = render(<LegacyRelatedActivities uid="u1" />);
    expand('profile-registered-activities-card');
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
    rerender(<LegacyRelatedActivities uid="u1" />);

    // 現在才讓舊帳號的載入完成。
    resolveDetail({ event: { id: 'e1', title: '活動A', status: 'open' }, eventDocId: 'e1' });
    resolveRegs([{ eventId: 'e1', userId: 'u1', status: 'confirmed', _docId: 'r1' }]);

    await new Promise(r => setTimeout(r, 30));
    expect(beginCancelMock).not.toHaveBeenCalled();
  });
});
