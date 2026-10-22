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
}));

vi.mock('preact-iso', () => ({ useLocation: () => ({ route: routeMock }) }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));

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

  it('我的報名：點取消報名呼叫 beginCancel，owned 含本人與同行者', async () => {
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
      { eventId: 'other', userId: 'u1', status: 'confirmed', _docId: 'r3' },
    ]);

    render(<LegacyRelatedActivities uid="u1" />);
    expand('profile-registered-activities-card');

    fireEvent.click(screen.getByRole('button', { name: '取消報名' }));
    await waitFor(() => expect(beginCancelMock).toHaveBeenCalledTimes(1));
    const arg = beginCancelMock.mock.calls[0]?.[0] as { publicId: string; owned: unknown[] };
    expect(arg.publicId).toBe('e1');
    expect(arg.owned.length).toBe(2);
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
});
