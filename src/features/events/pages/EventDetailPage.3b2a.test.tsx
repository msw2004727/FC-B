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
}));

vi.mock('preact-iso', () => ({ useLocation: () => ({ path: '/activities/public', route: vi.fn() }) }));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: mocks.viewer }));
vi.mock('@/data/user-roles', () => ({ useUserRoles: () => ({}), getCachedUserLevel: () => 0 }));
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
  mocks.viewer.mockReturnValue(viewer());
  mocks.load.mockResolvedValue({ event: { ...event }, eventDocId: 'document-id' });
  mocks.registrations.mockResolvedValue([]);
  mocks.history.mockResolvedValue([]);
  mocks.attendance.mockResolvedValue([]);
  mocks.increment.mockResolvedValue({ incremented: true, viewCount: 12 });
  mocks.staff.mockResolvedValue(new Set());
});
afterEach(() => cleanup());

it('M-089／090：訪客無頁首按鈕及瀏覽數，不呼叫計數', async () => {
  mocks.viewer.mockReturnValue(viewer({ uid: null, role: 'guest' }));
  const view = render(<EventDetailPage id="public" />);
  await screen.findByText('測試活動');
  expect(view.container.querySelector('#detail-view-count-wrap')).toBeNull();
  expect(screen.queryByRole('button', { name: '重新整理' })).toBeNull();
  expect(screen.queryByRole('button', { name: '活動編輯' })).toBeNull();
  expect(screen.queryByText('Log')).toBeNull();
  expect(mocks.increment).not.toHaveBeenCalled();
});

it('M-090：一般 user 呼叫 public ID＋文件 ID；瀏覽數不可點擊', async () => {
  render(<EventDetailPage id="public" />);
  await screen.findByText('12');
  expect(mocks.increment).toHaveBeenCalledWith('user', 'public', 'document-id');
  expect(screen.queryByText('Log')).toBeNull();
  expect(screen.queryByRole('button', { name: '活動編輯' })).toBeNull();
  fireEvent.click(screen.getByTitle('瀏覽次數'));
  expect(mocks.toast).not.toHaveBeenCalled();
});

it('M-089：owner 基本編輯開 lazy 表單；補文件 ID，成功重讀', async () => {
  mocks.viewer.mockReturnValue(viewer({
    uid: 'owner', capabilities: ['user.activity.own_edit_basic'],
  }));
  render(<EventDetailPage id="public" />);
  fireEvent.click(await screen.findByRole('button', { name: '活動編輯' }));
  fireEvent.click(await screen.findByRole('button', { name: '測試存檔' }));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(mocks.form).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'edit',
    existing: expect.objectContaining({ id: 'public', _docId: 'document-id' }),
  }));
});

it('M-089：scoped coach 有編輯、Log、refresh；teamOnly 加公開', async () => {
  mocks.viewer.mockReturnValue(viewer({ uid: 'owner', role: 'coach', roleLevel: 1 }));
  mocks.load.mockResolvedValue({
    event: { ...event, teamOnly: true, isPublic: false, creatorTeamId: 'team' },
    eventDocId: 'document-id',
  });
  render(<EventDetailPage id="public" />);
  expect(await screen.findByRole('button', { name: '活動編輯' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: '活動公開' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新整理' })).toBeTruthy();
  fireEvent.click(screen.getByText('Log'));
  expect(await screen.findByRole('dialog')).toBeTruthy();
});

it('M-089：refresh 重讀活動與名單；失敗保留畫面及 A 提示', async () => {
  render(<EventDetailPage id="public" />);
  await screen.findByText('測試活動');
  mocks.load.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
    message: '刷新失敗，請稍後再試',
  }));
  expect(screen.getByText('測試活動')).toBeTruthy();
  expect(mocks.registrations).toHaveBeenCalledWith('document-id');
});

it('M-090：舊活動回傳晚到，不污染新頁', async () => {
  let resolve!: (result: { incremented: boolean; viewCount: number }) => void;
  mocks.increment.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<EventDetailPage id="public" />);
  await waitFor(() => expect(mocks.increment).toHaveBeenCalledOnce());
  mocks.load.mockResolvedValue({
    event: { ...event, id: 'next', title: '下一場', viewCount: 2 },
    eventDocId: 'next-doc',
  });
  mocks.increment.mockResolvedValue({ incremented: false, viewCount: 3 });
  view.rerender(<EventDetailPage id="next" />);
  await screen.findByText('下一場');
  resolve({ incremented: true, viewCount: 9999 });
  await waitFor(() => expect(view.container.querySelector('#detail-view-count-num')?.textContent).toBe('3'));
});
