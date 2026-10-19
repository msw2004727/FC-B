import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import type { EventDoc } from '../data/types';
import MyActivitiesPage from './MyActivitiesPage';

// 取消／重新開放／上架按鈕：顯示條件與流程照 A `renderMyActivities`＋`cancelMyActivity` 等。
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-01T00:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
});

let mockViewer: ViewerView = createMinimalViewer('u-coach');
let mockActiveEvents: EventDoc[] = [];
let mockTerminalEvents: EventDoc[] = [];
const cancelMock = vi.fn(async () => undefined);
const reopenMock = vi.fn(async () => undefined);
const relistMock = vi.fn(async () => undefined);
const toastShow = vi.fn();

vi.mock('preact-iso', () => ({
  useLocation: () => ({ url: '/my-activities', path: '/my-activities', query: {}, route: vi.fn() }),
}));

vi.mock('@/features/profile/data/viewer', async () => {
  const actual = await vi.importActual<typeof import('@/features/profile/data/viewer')>(
    '@/features/profile/data/viewer',
  );
  return { ...actual, useViewer: () => mockViewer };
});

vi.mock('@/data/user-roles', () => ({ useUserRoles: () => ({}), getCachedUserLevel: () => undefined }));

vi.mock('@/ui/Toast', async () => {
  const actual = await vi.importActual<typeof import('@/ui/Toast')>('@/ui/Toast');
  return { ...actual, toast: { ...actual.toast, show: (...args: unknown[]) => toastShow(...args) } };
});

vi.mock('../data/events-repo', () => ({
  getEventsRepo: () => ({
    loadEventsStatic: async () => ['events'],
    ensureTerminalEventsLoaded: async () => ['events'],
    loadMoreTerminalEvents: async () => 0,
    getSnapshot: () => ({ active: [...mockActiveEvents], terminal: [...mockTerminalEvents] }),
  }),
}));

vi.mock('../data/event-lifecycle', async () => {
  const actual = await vi.importActual<typeof import('../data/event-lifecycle')>('../data/event-lifecycle');
  return {
    ...actual,
    cancelEvent: (...args: unknown[]) => cancelMock(...(args as [])),
    reopenEvent: (...args: unknown[]) => reopenMock(...(args as [])),
    relistEvent: (...args: unknown[]) => relistMock(...(args as [])),
  };
});

vi.mock('../components/EventFormModal', () => ({ EventFormModal: () => null }));

const testDict: Record<string, string> = {
  'common.ok': '確定',
  'common.cancel': '取消',
  'events.manage.tab.all': '全部',
  'events.manage.editBtn': '編輯',
  'events.manage.cancelBtn': '取消活動鈕',
  'events.manage.reopenBtn': '重新開放',
  'events.manage.relistBtn': '上架',
  'events.manage.deleteBtn': '刪除',
  'events.manage.lifecycle.confirmCancel': '確定要取消此活動？',
  'events.manage.lifecycle.confirmReopen': '確定要重新開放此活動？',
  'events.manage.lifecycle.confirmRelist': '確定要重新上架此活動？\n報名名單與候補名單將會保留。',
  'events.manage.lifecycle.doneCancel': '活動已取消',
  'events.manage.lifecycle.startPassedReopen': '活動時間已過，請先編輯活動並更新時間後再重新開放。',
  'events.manage.lifecycle.courseLinked': '課程轉化的活動請回課堂管理',
  'events.manage.lifecycle.deleteInLegacy': '新版暫不提供刪除活動，要前往舊版刪除嗎？',
};

function coachViewer(extra: string[] = []): ViewerView {
  const perms = ['activity.manage.entry', ...extra];
  return {
    ...createMinimalViewer('u-coach'),
    role: 'coach',
    roleLevel: 1,
    displayName: '教練A',
    hasPermission: (code) => perms.includes(code),
    permissionSources: { rolePermissions: perms, userGrants: [], customRoles: [] },
  };
}

function ownEvent(overrides: Partial<EventDoc> & Record<string, unknown>): EventDoc {
  return {
    id: 'ev-1',
    _docId: 'doc-1',
    title: '週六足球',
    status: 'open',
    creatorUid: 'u-coach',
    creator: '教練A',
    location: '大安',
    date: '2026/05/10 14:00~16:00',
    ...overrides,
  } as EventDoc;
}

function renderPage(): void {
  render(
    <>
      <MyActivitiesPage />
      <AppConfirmHost />
    </>,
  );
}

describe('MyActivitiesPage 生命週期按鈕', () => {
  beforeEach(async () => {
    cancelMock.mockClear();
    reopenMock.mockClear();
    relistMock.mockClear();
    toastShow.mockClear();
    mockActiveEvents = [];
    mockTerminalEvents = [];
    mockViewer = coachViewer();
    _setDictLoaderForTest(async () => testDict);
    await setLocale('zh-TW');
  });

  afterEach(() => {
    _resetAppConfirmForTest();
    cleanup();
    _setDictLoaderForTest(null);
  });

  it('報名中：顯示編輯與取消，不顯示重新開放／上架；確認後以文件 ID 取消並提示', async () => {
    mockActiveEvents = [ownEvent({})];
    renderPage();
    const btn = await screen.findByRole('button', { name: '取消活動鈕' });
    expect(screen.queryByRole('button', { name: '重新開放' })).toBeNull();
    expect(screen.queryByRole('button', { name: '上架' })).toBeNull();

    fireEvent.click(btn);
    expect(await screen.findByText('確定要取消此活動？')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確定' }));

    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(1));
    const input = (cancelMock.mock.calls[0] as unknown as [{ eventDocId: string }])[0];
    expect(input.eventDocId).toBe('doc-1');
    await waitFor(() =>
      expect(toastShow).toHaveBeenCalledWith({ message: '活動已取消', tone: 'success' }),
    );
  });

  it('確認框按取消：不寫入', async () => {
    mockActiveEvents = [ownEvent({})];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '取消活動鈕' }));
    await screen.findByText('確定要取消此活動？');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByText('確定要取消此活動？')).toBeNull());
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('已取消且時間未到：顯示重新開放，按下確認後重開', async () => {
    mockTerminalEvents = [ownEvent({ status: 'cancelled' })];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '重新開放' }));
    expect(await screen.findByText('確定要重新開放此活動？')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await waitFor(() => expect(reopenMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: '取消活動鈕' })).toBeNull();
  });

  it('已取消但時間已過：只顯示 A 的提示，不寫入', async () => {
    mockTerminalEvents = [ownEvent({ status: 'cancelled', date: '2026/04/20 10:00' })];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '重新開放' }));
    expect(
      await screen.findByText('活動時間已過，請先編輯活動並更新時間後再重新開放。'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確定' }));
    await waitFor(() =>
      expect(screen.queryByText('活動時間已過，請先編輯活動並更新時間後再重新開放。')).toBeNull(),
    );
    expect(reopenMock).not.toHaveBeenCalled();
  });

  it('已結束：顯示上架；有 event.delete_self 時顯示刪除並導向舊版確認', async () => {
    mockViewer = coachViewer(['event.delete_self']);
    mockTerminalEvents = [ownEvent({ status: 'ended', date: '2026/04/20 10:00' })];
    renderPage();
    expect(await screen.findByRole('button', { name: '上架' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    expect(await screen.findByText('新版暫不提供刪除活動，要前往舊版刪除嗎？')).toBeTruthy();
  });

  it('沒有刪除權限時不顯示刪除', async () => {
    mockTerminalEvents = [ownEvent({ status: 'ended', date: '2026/04/20 10:00' })];
    renderPage();
    await screen.findByRole('button', { name: '上架' });
    expect(screen.queryByRole('button', { name: '刪除' })).toBeNull();
  });

  it('課程轉化活動：按取消只提示，不開確認框', async () => {
    mockActiveEvents = [ownEvent({ courseLinked: true })];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '取消活動鈕' }));
    await waitFor(() =>
      expect(toastShow).toHaveBeenCalledWith({ message: '課程轉化的活動請回課堂管理', tone: 'error' }),
    );
    expect(screen.queryByText('確定要取消此活動？')).toBeNull();
    expect(cancelMock).not.toHaveBeenCalled();
  });
});
