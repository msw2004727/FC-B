import type { ComponentChildren } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { LegacyDetailEvent } from '../components/legacy/EventDetailMainView';
import EventDetailPage from './EventDetailPage';

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  load: vi.fn(),
  registrations: vi.fn(),
  history: vi.fn(),
  attendance: vi.fn(),
  increment: vi.fn(),
  staff: vi.fn(),
  toast: vi.fn(),
  form: vi.fn(),
  goBack: vi.fn(),
  goBackOverlayState: [] as boolean[],
  confirm: vi.fn(),
  del: vi.fn(),
  lifecycle: vi.fn(),
}));

vi.mock('preact-iso', () => ({ useLocation: () => ({ path: '/activities/public', route: vi.fn() }) }));
vi.mock('@/core/back-guard', () => ({
  useGoBack: () => () => {
    const state: unknown = history.state;
    mocks.goBackOverlayState.push(!!state && typeof state === 'object' && '__overlay' in state);
    mocks.goBack();
  },
}));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: mocks.confirm }));
vi.mock('../components/legacy/event-lifecycle-action', () => ({ runEventLifecycleAction: mocks.lifecycle }));
vi.mock('../data/event-delete', async original => ({
  ...(await original<typeof import('../data/event-delete')>()),
  deleteEventViaCallable: mocks.del,
}));
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: mocks.viewer }));
vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}), getCachedUserLevel: () => 0, getCachedUserLateCancel: () => undefined, loadUserRoles: async () => ({}),
}));
vi.mock('@/i18n/i18n', async (o) => ({
  ...(await o<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
  lt: (_key: string, fallback: string) => fallback,
}));
vi.mock('@/ui/Toast', () => ({ Toast: () => null, toast: { show: mocks.toast } }));
vi.mock('@/ui/UserTag', () => ({ UserTag: () => null }));
vi.mock('../data/event-detail', () => ({
  loadEventDetail: mocks.load, loadEventRegistrations: mocks.registrations,
}));
vi.mock('../data/viewer-registrations', () => ({ loadViewerRegistrations: mocks.history }));
vi.mock('@/features/checkin/data/attendance', () => ({ loadEventAttendance: mocks.attendance }));
vi.mock('../data/event-view-count', async original => ({
  ...(await original<typeof import('../data/event-view-count')>()),
  incrementEventViewCount: mocks.increment,
}));
vi.mock('../data/team-staff', async original => ({
  ...(await original<typeof import('../data/team-staff')>()),
  loadEventStaffTeamIds: mocks.staff,
}));
vi.mock('../components/EventFormModal', () => ({
  EventFormModal: (props: {
    existing?: { _docId?: string };
    onSaved(id: string): void;
    children?: ComponentChildren;
  }) => {
    mocks.form(props);
    return <button onClick={() => props.onSaved('public')}>測試存檔</button>;
  },
}));
vi.mock('../components/legacy/EventRegLogModal', () => ({
  EventRegLogModal: () => <div role="dialog">報名紀錄</div>,
}));
vi.mock('../components/useAttendanceInstantSave', () => ({
  useAttendanceInstantSave: () => ({
    resetInstantSave: vi.fn(),
    flushInstantSaves: vi.fn().mockResolvedValue(undefined),
    getRowSelection: vi.fn(),
    inFlightKeys: new Set(),
    savedFlashKeys: new Set(),
    failedFlashKeys: new Set(),
    onToggleCheckbox: vi.fn(),
    onChangeNote: vi.fn(),
  }),
}));
vi.mock('../components/AttendanceRosterTable', () => ({ AttendanceRosterTable: () => null }));
vi.mock('../components/WaitlistRosterTable', () => ({ WaitlistRosterTable: () => null }));
vi.mock('../components/UnregRosterTable', () => ({
  UnregRosterTable: () => null, buildUnregPeopleList: () => [],
}));

function viewer(overrides: Partial<ViewerView> = {}): ViewerView {
  return {
    uid: 'user', role: 'user', roleLevel: 0, displayName: '測試者', pictureUrl: null,
    teamIds: new Set(), capabilities: [], hasPermission: () => false,
    permissionSources: { rolePermissions: [], userGrants: [], customRoles: [] },
    ...overrides,
  };
}

const event: LegacyDetailEvent = {
  id: 'public', title: '測試活動', creatorUid: 'owner', status: 'open',
  date: '2099/10/22 15:00~17:00', max: 20, current: 0, viewCount: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.goBackOverlayState.length = 0;
  mocks.confirm.mockResolvedValue(true);
  mocks.del.mockResolvedValue({ alreadyDeleted: false });
  mocks.lifecycle.mockResolvedValue(true);
  mocks.viewer.mockReturnValue(viewer());
  mocks.load.mockResolvedValue({ event: { ...event }, eventDocId: 'document-id' });
  mocks.registrations.mockResolvedValue([]);
  mocks.history.mockResolvedValue([]);
  mocks.attendance.mockResolvedValue([]);
  mocks.increment.mockResolvedValue({ incremented: true, viewCount: 12 });
  mocks.staff.mockResolvedValue(new Set());
});
afterEach(() => cleanup());

// 站長 11-24：活動內頁封面「活動編輯」右側的快速鈕：已結束／已取消是刪除（兩次確認），其餘是取消活動（同「我的活動」）。
const DEL = '刪除活動';
const CANCEL = '取消活動';
const admin = (): ViewerView => viewer({
  uid: 'admin', role: 'admin', roleLevel: 4,
  permissionSources: { rolePermissions: ['event.edit_all'], userGrants: [], customRoles: [] },
});
const ended = (): void => {
  mocks.load.mockResolvedValue({ event: { ...event, status: 'ended' }, eventDocId: 'document-id' });
};

it('報名中：管理員看到取消活動、沒有刪除；已結束、已取消：看到刪除、沒有取消', async () => {
  mocks.viewer.mockReturnValue(admin());
  const open = render(<EventDetailPage id="public" />);
  expect(await screen.findByRole('button', { name: CANCEL })).toBeTruthy();
  expect(screen.queryByRole('button', { name: DEL })).toBeNull();
  open.unmount();

  for (const status of ['ended', 'cancelled']) {
    mocks.load.mockResolvedValue({ event: { ...event, status }, eventDocId: 'document-id' });
    const view = render(<EventDetailPage id="public" />);
    expect(await screen.findByRole('button', { name: DEL })).toBeTruthy();
    expect(screen.queryByRole('button', { name: CANCEL })).toBeNull();
    view.unmount();
  }
});

it('權限：一般用戶看不到；擁有者照 own_cancel／event.delete_self；課程連結活動都不顯示', async () => {
  const first = render(<EventDetailPage id="public" />);
  await screen.findByText('測試活動');
  expect(screen.queryByRole('button', { name: CANCEL })).toBeNull();
  first.unmount();

  mocks.viewer.mockReturnValue(viewer({ uid: 'owner', capabilities: ['user.activity.own_edit_basic'] }));
  const second = render(<EventDetailPage id="public" />);
  expect(await screen.findByRole('button', { name: '活動編輯' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: CANCEL })).toBeNull();
  second.unmount();

  mocks.viewer.mockReturnValue(viewer({ uid: 'owner', capabilities: ['user.activity.own_cancel'] }));
  const third = render(<EventDetailPage id="public" />);
  expect(await screen.findByRole('button', { name: CANCEL })).toBeTruthy();
  third.unmount();

  ended();
  mocks.viewer.mockReturnValue(viewer({ uid: 'owner', capabilities: ['user.activity.own_edit_basic'] }));
  const fourth = render(<EventDetailPage id="public" />);
  await screen.findByText('測試活動');
  expect(screen.queryByRole('button', { name: DEL })).toBeNull();
  fourth.unmount();

  mocks.viewer.mockReturnValue(viewer({
    uid: 'owner',
    permissionSources: { rolePermissions: [], userGrants: ['event.delete_self'], customRoles: [] },
  }));
  const fifth = render(<EventDetailPage id="public" />);
  expect(await screen.findByRole('button', { name: DEL })).toBeTruthy();
  fifth.unmount();

  mocks.viewer.mockReturnValue(admin());
  for (const status of ['open', 'ended']) {
    mocks.load.mockResolvedValue({ event: { ...event, status, courseLinked: true }, eventDocId: 'document-id' });
    const view = render(<EventDetailPage id="public" />);
    await screen.findByText('測試活動');
    expect(screen.queryByRole('button', { name: DEL })).toBeNull();
    expect(screen.queryByRole('button', { name: CANCEL })).toBeNull();
    view.unmount();
  }
});

it('取消活動：走「我的活動」共用流程（補文件 ID），成功後重讀本頁、不離開', async () => {
  mocks.viewer.mockReturnValue(admin());
  render(<EventDetailPage id="public" />);
  fireEvent.click(await screen.findByRole('button', { name: CANCEL }));
  await waitFor(() => expect(mocks.lifecycle).toHaveBeenCalledTimes(1));
  const [kind, target, deps] = mocks.lifecycle.mock.calls[0] as [string, Record<string, unknown>, { onDone(): void }];
  expect(kind).toBe('cancel');
  expect(target).toEqual(expect.objectContaining({ id: 'public', _docId: 'document-id' }));
  expect(mocks.del).not.toHaveBeenCalled();
  expect(mocks.confirm).not.toHaveBeenCalled();
  deps.onDone();
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(mocks.goBack).not.toHaveBeenCalled();
});

it('刪除第一次確認取消：不開第二次確認、不呼叫刪除', async () => {
  mocks.viewer.mockReturnValue(admin());
  ended();
  mocks.confirm.mockResolvedValue(false);
  render(<EventDetailPage id="public" />);
  fireEvent.click(await screen.findByRole('button', { name: DEL }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('events.manage.delete.confirmFirst', { danger: true }));
  expect(document.querySelector('#delete-event-confirm-modal')).toBeNull();
  expect(mocks.del).not.toHaveBeenCalled();
});

it('刪除兩次確認（勾選後才可按）才刪；成功提示，確認框歷史紀錄退掉後才返回', async () => {
  mocks.viewer.mockReturnValue(admin());
  ended();
  render(<EventDetailPage id="public" />);
  fireEvent.click(await screen.findByRole('button', { name: DEL }));
  await waitFor(() => expect(document.querySelector('#delete-event-confirm-modal')).toBeTruthy());
  const modal = document.querySelector('#delete-event-confirm-modal') as HTMLElement;
  const ok = modal.querySelector('.app-confirm-ok') as HTMLButtonElement;
  expect(ok.disabled).toBe(true);
  fireEvent.click(ok);
  expect(mocks.del).not.toHaveBeenCalled();
  fireEvent.click(modal.querySelector('input[type="checkbox"]') as HTMLInputElement);
  expect(ok.disabled).toBe(false);
  fireEvent.click(ok);
  await waitFor(() => expect(mocks.del).toHaveBeenCalledTimes(1));
  expect(mocks.del).toHaveBeenCalledWith(expect.objectContaining({ id: 'public', _docId: 'document-id' }));
  await waitFor(() => expect(mocks.goBack).toHaveBeenCalledTimes(1));
  // 返回時確認框那筆同網址歷史紀錄已退掉，history.back 才會真的離開詳情頁。
  expect(mocks.goBackOverlayState[0]).toBe(false);
  expect(mocks.toast).toHaveBeenCalledWith({ message: '活動已刪除', tone: 'success' });
});

it('刪除失敗：提示錯誤、關閉確認框、留在原頁', async () => {
  mocks.viewer.mockReturnValue(admin());
  ended();
  mocks.del.mockRejectedValue(new Error('EVENT_DELETE_DENIED'));
  render(<EventDetailPage id="public" />);
  fireEvent.click(await screen.findByRole('button', { name: DEL }));
  await waitFor(() => expect(document.querySelector('#delete-event-confirm-modal')).toBeTruthy());
  const modal = document.querySelector('#delete-event-confirm-modal') as HTMLElement;
  fireEvent.click(modal.querySelector('input[type="checkbox"]') as HTMLInputElement);
  fireEvent.click(modal.querySelector('.app-confirm-ok') as HTMLButtonElement);
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: '您只能管理自己的活動', tone: 'error' }));
  await waitFor(() => expect(document.querySelector('#delete-event-confirm-modal')).toBeNull());
  expect(mocks.goBack).not.toHaveBeenCalled();
  expect(screen.getByText('測試活動')).toBeTruthy();
});
