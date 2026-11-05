import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import type { EventDoc } from '../data/types';
import MyActivitiesPage from './MyActivitiesPage';

// T-074 終驗 P3-3：卡片已依權限隱藏編輯鈕，這裡把卡片換成「一律顯示編輯鈕」的替身，
// 單獨驗證頁面層 handleEdit 的 canEditOwnActivityBasic 保底（拿掉保底時無權限也會開窗）。
let mockViewer: ViewerView = createMinimalViewer('u-owner');
let mockActiveEvents: EventDoc[] = [];
const toastShow = vi.fn();

// 斷開建立活動入口的個人資料預讀等裝飾性讀取，測試不可初始化真實 Firebase。
vi.mock('@/data/firebase', async (importOriginal) => {
  const offline = async () => { throw new Error('offline page test'); };
  return {
    ...(await importOriginal<typeof import('@/data/firebase')>()),
    getFirebase: offline,
    getFirebaseCore: offline,
  };
});

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
}));

vi.mock('preact-iso', () => ({
  useLocation: () => ({ url: '/my-activities', path: '/my-activities', query: {}, route: vi.fn() }),
}));

vi.mock('@/features/profile/data/viewer', async () => {
  const actual = await vi.importActual<typeof import('@/features/profile/data/viewer')>(
    '@/features/profile/data/viewer',
  );
  return { ...actual, useViewer: () => mockViewer };
});

vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}),
  getCachedUserLevel: () => undefined,
}));

vi.mock('@/ui/Toast', async () => {
  const actual = await vi.importActual<typeof import('@/ui/Toast')>('@/ui/Toast');
  return { ...actual, toast: { ...actual.toast, show: (...args: unknown[]) => toastShow(...args) } };
});

vi.mock('../data/events-repo', () => ({
  getEventsRepo: () => ({
    loadEventsStatic: async () => ['events'],
    ensureTerminalEventsLoaded: async () => ['events'],
    loadMoreTerminalEvents: async () => 0,
    getSnapshot: () => ({ active: [...mockActiveEvents], terminal: [] }),
  }),
}));

vi.mock('../components/EventFormModal', () => ({ EventFormModal: () => null }));

vi.mock('../components/ExternalEventEditModal', () => ({
  ExternalEventEditModal: (props: { event: EventDoc }) => (
    <div data-testid="external-edit-modal">{String(props.event.title ?? '')}</div>
  ),
}));

vi.mock('../components/legacy/MyActivityCard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/legacy/MyActivityCard')>()),
  MyActivityCard: (props: { event: EventDoc; onEdit: (event: EventDoc) => void }) => (
    <div>
      <span>{String(props.event.title ?? '')}</span>
      <button type="button" onClick={() => props.onEdit(props.event)}>編輯替身</button>
    </div>
  ),
}));

function ownerViewer(capabilities: string[]): ViewerView {
  return {
    ...createMinimalViewer('u-owner'),
    role: 'user',
    roleLevel: 0,
    displayName: '主辦人',
    capabilities,
  };
}

function externalEvent(): EventDoc {
  return {
    id: 'ev-ext',
    _docId: 'doc-ext',
    type: 'external',
    title: '外部聯賽',
    status: 'open',
    creatorUid: 'u-owner',
    creator: '主辦人',
    location: '大安',
    date: '2026/06/20 10:00',
  } as EventDoc;
}

describe('MyActivitiesPage 外部活動編輯頁面層權限', () => {
  beforeEach(() => {
    toastShow.mockClear();
    mockActiveEvents = [externalEvent()];
  });

  afterEach(() => {
    cleanup();
  });

  it('無基本編輯權限時點編輯：不開外部活動編輯窗並提示', async () => {
    // 可進頁面（own_manage_entry）且是主辦人，但沒有 own_edit_basic。
    mockViewer = ownerViewer(['user.activity.own_manage_entry']);
    render(<MyActivitiesPage />);
    fireEvent.click(await screen.findByRole('button', { name: '編輯替身' }));
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith({
      message: '您只能編輯自己的活動',
      tone: 'error',
    }));
    expect(screen.queryByTestId('external-edit-modal')).toBeNull();
  });

  it('有基本編輯權限時點編輯：開外部活動編輯窗、不提示', async () => {
    mockViewer = ownerViewer(['user.activity.own_manage_entry', 'user.activity.own_edit_basic']);
    render(<MyActivitiesPage />);
    fireEvent.click(await screen.findByRole('button', { name: '編輯替身' }));
    expect((await screen.findByTestId('external-edit-modal')).textContent).toBe('外部聯賽');
    expect(toastShow).not.toHaveBeenCalledWith(expect.objectContaining({ message: '您只能編輯自己的活動' }));
  });
});
