import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import type { EventDoc } from '../data/types';
import MyActivitiesPage from './MyActivitiesPage';

// T-076b：刪除改走 Callable deleteEvent（修正前按刪除只會問要不要前往舊版，這裡的流程測試都會失敗）。
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-01T00:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
});

let mockViewer: ViewerView = createMinimalViewer('u-coach');
let mockActiveEvents: EventDoc[] = [];
const toastShow = vi.fn();
const callFn = vi.fn();
const ensureTerminal = vi.fn(async (_opts?: unknown) => ['events']);

const testDict: Record<string, string> = {
  'common.ok': '確定',
  'common.cancel': '取消',
  'events.manage.delete.confirmFirst': '確定要刪除此活動？刪除後無法恢復。',
  'events.manage.delete.confirmFinal': '刪除「{title}」',
  'events.manage.delete.untitled': '此活動',
  'events.manage.delete.check': '我確定要刪除',
  'events.manage.delete.ok': '刪除',
  'events.manage.delete.pending': '刪除中…',
  'ui.userTag.unknown': '用戶',
  'ui.userTag.role.user': '一般用戶',
  'ui.userTag.openProfile': '開啟 {name} 的個人頁',
};

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string, params?: Record<string, unknown>) => {
    let tmpl = testDict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) tmpl = tmpl.replace(`{${k}}`, String(v));
    }
    return tmpl;
  },
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

vi.mock('@/data/callables', () => ({ callFn: (...args: unknown[]) => callFn(...args) }));

vi.mock('@/ui/Toast', async () => {
  const actual = await vi.importActual<typeof import('@/ui/Toast')>('@/ui/Toast');
  return { ...actual, toast: { ...actual.toast, show: (...args: unknown[]) => toastShow(...args) } };
});

vi.mock('../data/events-repo', () => ({
  getEventsRepo: () => ({
    loadEventsStatic: async () => ['events'],
    ensureTerminalEventsLoaded: (opts?: unknown) => ensureTerminal(opts),
    loadMoreTerminalEvents: async () => 0,
    getSnapshot: () => ({ active: [...mockActiveEvents], terminal: [] }),
  }),
}));

vi.mock('../components/EventFormModal', () => ({ EventFormModal: () => null }));

function coachViewer(perms: string[]): ViewerView {
  const all = ['activity.manage.entry', ...perms];
  return {
    ...createMinimalViewer('u-coach'),
    role: 'coach',
    roleLevel: 1,
    displayName: '教練A',
    hasPermission: (code) => all.includes(code),
    permissionSources: { rolePermissions: all, userGrants: [], customRoles: [] },
  };
}

function ownEvent(overrides: Record<string, unknown> = {}): EventDoc {
  return {
    id: 'ev-1',
    _docId: 'doc-1',
    title: '週六足球',
    // 刪除鈕照 A 只出現在已結束／已取消的卡片。
    status: 'ended',
    creatorUid: 'u-coach',
    creator: '教練A',
    location: '大安',
    date: '2026/04/20 10:00',
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

async function openFinalConfirm(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: '刪除' }));
  await screen.findByText('確定要刪除此活動？刪除後無法恢復。');
  fireEvent.click(screen.getByRole('button', { name: '確定' }));
  await screen.findByText('刪除「週六足球」');
}

function finalDeleteButton(): HTMLButtonElement {
  return document.querySelector('#delete-event-confirm-modal .app-confirm-ok') as HTMLButtonElement;
}

function finalCancelButton(): HTMLButtonElement {
  return document.querySelector('#delete-event-confirm-modal .app-confirm-cancel') as HTMLButtonElement;
}

describe('MyActivitiesPage 刪除活動', () => {
  beforeEach(() => {
    toastShow.mockClear();
    callFn.mockReset();
    ensureTerminal.mockClear();
    mockViewer = coachViewer(['event.delete_self']);
    mockActiveEvents = [ownEvent()];
  });

  afterEach(() => {
    _resetAppConfirmForTest();
    cleanup();
  });

  it('第一次確認按取消：不開第二次確認、不呼叫伺服器', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '刪除' }));
    await screen.findByText('確定要刪除此活動？刪除後無法恢復。');
    fireEvent.click(document.getElementById('app-confirm-cancel')!);
    await waitFor(() => expect(screen.queryByText('確定要刪除此活動？刪除後無法恢復。')).toBeNull());
    expect(document.getElementById('delete-event-confirm-modal')).toBeNull();
    expect(callFn).not.toHaveBeenCalled();
  });

  it('第二次確認按取消：不呼叫伺服器', async () => {
    renderPage();
    await openFinalConfirm();
    fireEvent.click(finalCancelButton());
    await waitFor(() => expect(document.getElementById('delete-event-confirm-modal')).toBeNull());
    expect(callFn).not.toHaveBeenCalled();
  });

  it('未勾選時刪除鈕停用；勾選後刪除：傳公開 id、成功提示、移除卡片並重新整理列表', async () => {
    callFn.mockImplementation(async () => {
      mockActiveEvents = [];
      return { ok: true, alreadyDeleted: false };
    });
    renderPage();
    await openFinalConfirm();
    expect(finalDeleteButton().disabled).toBe(true);
    fireEvent.click(finalDeleteButton());
    expect(callFn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(finalDeleteButton().disabled).toBe(false);
    ensureTerminal.mockClear();
    fireEvent.click(finalDeleteButton());

    await waitFor(() => expect(toastShow).toHaveBeenCalledWith({ message: '活動已刪除', tone: 'success' }));
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(callFn).toHaveBeenCalledWith('deleteEvent', { eventId: 'ev-1' });
    expect(ensureTerminal).toHaveBeenCalledWith({ mode: 'history', force: true });
    await waitFor(() => expect(screen.queryByText('週六足球')).toBeNull());
    expect(document.getElementById('delete-event-confirm-modal')).toBeNull();
  });

  it('alreadyDeleted 也當成功', async () => {
    callFn.mockResolvedValue({ ok: true, alreadyDeleted: true });
    renderPage();
    await openFinalConfirm();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(finalDeleteButton());
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith({ message: '活動已刪除', tone: 'success' }));
  });

  it.each([
    ['EVENT_DELETE_DENIED', '您只能管理自己的活動'],
    ['COURSE_LINKED_EVENT_MANAGED_BY_COURSE', '課程轉化的活動請回課堂管理，不能在活動端取消、結束、刪除或重新開放'],
    ['EVENT_ID_MISMATCH', '此活動資料格式較舊，請聯繫管理員處理'],
    ['EVENT_DELETE_FAILED', '刪除失敗，請稍後再試'],
  ])('伺服器回 %s：只顯示「%s」，不露原始錯誤', async (reason, text) => {
    callFn.mockRejectedValue(Object.assign(new Error(reason), { code: 'functions/x' }));
    renderPage();
    await openFinalConfirm();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(finalDeleteButton());
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith({ message: text, tone: 'error' }));
    expect(screen.queryByText(reason)).toBeNull();
    expect(screen.getByText('週六足球')).toBeTruthy();
  });

  it('防連點：進行中按鈕停用、顯示刪除中，再按不會重送', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    callFn.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderPage();
    await openFinalConfirm();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(finalDeleteButton());
    await waitFor(() => expect(callFn).toHaveBeenCalledTimes(1));
    expect(finalDeleteButton().disabled).toBe(true);
    expect(finalDeleteButton().textContent).toBe('刪除中…');
    expect(finalCancelButton().disabled).toBe(true);
    fireEvent.click(finalDeleteButton());
    fireEvent.click(finalCancelButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    await Promise.resolve();
    expect(document.getElementById('delete-event-confirm-modal')).toBeTruthy();
    expect(callFn).toHaveBeenCalledTimes(1);
    resolve({ ok: true, alreadyDeleted: false });
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith({ message: '活動已刪除', tone: 'success' }));
  });

  it('課程轉化活動：按刪除只提示原因，不開確認、不呼叫伺服器', async () => {
    mockActiveEvents = [ownEvent({ courseLinkId: 'cl_1' })];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '刪除' }));
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith({
      message: '課程轉化的活動請回課堂管理，不能在活動端取消、結束、刪除或重新開放',
      tone: 'error',
    }));
    expect(screen.queryByText('確定要刪除此活動？刪除後無法恢復。')).toBeNull();
    expect(callFn).not.toHaveBeenCalled();
  });

  it('私密活動的 delegate（即使有 event.delete）不顯示刪除', async () => {
    mockViewer = coachViewer(['event.delete']);
    mockActiveEvents = [ownEvent({ creatorUid: 'u-other', delegateUids: ['u-coach'], privateEvent: true })];
    renderPage();
    await screen.findByText('週六足球');
    expect(screen.queryByRole('button', { name: '刪除' })).toBeNull();
  });

  it('只有 event.edit_all：不顯示刪除（伺服器不認）', async () => {
    mockViewer = coachViewer(['event.edit_all']);
    renderPage();
    await screen.findByText('週六足球');
    expect(screen.queryByRole('button', { name: '刪除' })).toBeNull();
  });
});
