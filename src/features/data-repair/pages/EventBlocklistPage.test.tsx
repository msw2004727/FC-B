import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import { createMinimalViewer } from '@/features/profile/data/viewer';
import type { BlocklistEvent } from '../data/event-blocklist-model';
import EventBlocklistPage from './EventBlocklistPage';

const mocks = vi.hoisted(() => ({
  viewer: null as unknown as ViewerView, users: vi.fn(), write: vi.fn(), confirm: vi.fn(), toast: vi.fn(),
  loadEvents: vi.fn(), emit: vi.fn(), events: [] as BlocklistEvent[], lastUid: 'uidA' as string | null,
}));
vi.mock('@/features/profile/data/viewer', async original => {
  const actual = await original<typeof import('@/features/profile/data/viewer')>();
  return { ...actual, useViewer: () => mocks.viewer };
});
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/core/events', () => ({ emit: mocks.emit, on: () => () => undefined }));
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => mocks.lastUid }));
vi.mock('@/ui/EmptyState', () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.toast } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: mocks.confirm }));
vi.mock('../data/event-blocklist', () => ({ changeEventBlocklist: mocks.write }));
vi.mock('@/features/admin-users/data/admin-users', () => ({ loadAdminUsers: mocks.users }));
vi.mock('@/features/events/data/events-repo', () => ({ getEventsRepo: () => ({
  getSnapshot: () => ({ active: mocks.events, terminal: [] }), loadEventsStatic: mocks.loadEvents,
}) }));
vi.mock('@/i18n/i18n', async () => {
  const { default: zh } = await import('../locales/zh-TW.json');
  return { useT: () => (key: string, params: Record<string, string | number> = {}) => {
    const suffix = key.replace('data-repair.blocklist.', '') as keyof typeof zh.blocklist;
    let result = zh.blocklist[suffix] || key;
    for (const [name, value] of Object.entries(params)) result = result.split('{' + name + '}').join(String(value));
    return result;
  } };
});
const neutral = '此帳號的授權方式目前無法使用本功能，請聯絡管理員改以角色授權。';
const event = (): BlocklistEvent => ({ id: 'evtA', _docId: 'evtA', title: '週末活動', date: '2026/10/30', creator: '主辦人', blockedUids: [] });
const target = { uid: 'targetA', name: '小明', lineUserId: '', isRestricted: true };
const eventInput = () => screen.getByPlaceholderText('輸入標題、日期、主辦人、地點...');
const userInput = () => screen.getByPlaceholderText('輸入名字或識別碼...');
const addButton = () => screen.getByRole('button', { name: '加入黑名單' });
async function selectEvent() {
  fireEvent.input(eventInput(), { target: { value: '週末' } });
  fireEvent.click(await screen.findByRole('button', { name: /週末活動/ }));
}
async function selectUser() {
  fireEvent.input(userInput(), { target: { value: '小明' } });
  fireEvent.click(await screen.findByRole('button', { name: /小明/ }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lastUid = 'uidA';
  mocks.viewer = { uid: 'uidA', role: 'admin', roleLevel: 4, displayName: '管理員', pictureUrl: null,
    capabilities: [], teamIds: new Set(), hasPermission: () => true,
    permissionSources: { rolePermissions: ['admin.repair.event_blocklist'], userGrants: [], customRoles: [] } };
  mocks.events = [event()];
  mocks.users.mockResolvedValue({ users: [target], total: 1, partial: false, done: true, lastId: 'targetA' });
  mocks.confirm.mockResolvedValue(true);
  mocks.loadEvents.mockResolvedValue([]);
  mocks.write.mockResolvedValue({ changed: true, event: { ...event(), blockedUids: ['targetA'] } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('黑名單管理', () => {
  it('無權限', () => {
    mocks.viewer = { ...mocks.viewer, hasPermission: () => false };
    render(<EventBlocklistPage />);
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(screen.queryByPlaceholderText('輸入名字或識別碼...')).toBeNull();
    expect(mocks.users).not.toHaveBeenCalled();
  });
  it('尚未就緒', () => {
    mocks.viewer = createMinimalViewer('uidA');
    render(<EventBlocklistPage />);
    expect(screen.getByText('載入中...')).toBeTruthy();
    expect(screen.queryByText('權限不足')).toBeNull();
  });
  it('未登入', () => {
    mocks.viewer = { ...mocks.viewer, uid: null }; mocks.lastUid = null;
    render(<EventBlocklistPage />);
    expect(screen.getByText('權限不足')).toBeTruthy();
  });
  it('唯讀與停用', () => {
    mocks.viewer = { ...mocks.viewer, role: 'user', permissionSources: undefined };
    mocks.events = [{ ...event(), blockedUids: ['targetA'] }];
    render(<EventBlocklistPage />);
    expect(screen.getByText(neutral)).toBeTruthy();
    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '移除' }) as HTMLButtonElement).disabled).toBe(true);
    expect((userInput() as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('targetA')).toBeTruthy();
  });
  it('完整頁面與懶載入', async () => {
    render(<EventBlocklistPage />);
    expect((addButton() as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.users).not.toHaveBeenCalled();
    await selectUser();
    expect(mocks.users).toHaveBeenCalledTimes(1);
    fireEvent.input(userInput(), { target: { value: 'targetA' } });
    await screen.findByRole('button', { name: /小明/ });
    expect(mocks.users).toHaveBeenCalledTimes(1);
  });
  it('搜尋空值、無結果與上限', async () => {
    mocks.events = Array.from({ length: 25 }, (_, index) => ({ ...event(), title: '活動' + index }));
    mocks.users.mockResolvedValue({ users: Array.from({ length: 25 }, () => target), partial: false });
    render(<EventBlocklistPage />);
    fireEvent.input(eventInput(), { target: { value: '活動' } });
    expect(screen.getAllByRole('button', { name: /活動\d/ })).toHaveLength(20);
    fireEvent.input(eventInput(), { target: { value: '' } });
    expect(screen.queryByRole('button', { name: /活動\d/ })).toBeNull();
    fireEvent.input(eventInput(), { target: { value: '無結果' } });
    expect(screen.getByText('找不到符合的活動')).toBeTruthy();
    fireEvent.input(userInput(), { target: { value: '小明' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: /小明/ })).toHaveLength(20));
    fireEvent.input(userInput(), { target: { value: '無結果' } });
    expect(screen.getByText('找不到符合的用戶')).toBeTruthy();
    fireEvent.input(userInput(), { target: { value: ' ' } });
    expect(screen.queryByText('找不到符合的用戶')).toBeNull();
  });
  it('加入流程', async () => {
    render(<EventBlocklistPage />);
    fireEvent.click(addButton());
    expect(mocks.toast).toHaveBeenLastCalledWith({ message: '請先選擇活動' });
    await selectEvent(); fireEvent.click(addButton());
    expect(mocks.toast).toHaveBeenLastCalledWith({ message: '請先選擇用戶' });
    await selectUser();
    fireEvent.input(screen.getByPlaceholderText('例：反覆放鴿子、違反規則...'), { target: { value: '原因' } });
    fireEvent.click(addButton());
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('尚未選擇活動')).toBeTruthy());
    expect(screen.getByText('尚未選擇用戶')).toBeTruthy();
    expect((screen.getByPlaceholderText('例：反覆放鴿子、違反規則...') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: '移除' })).toBeTruthy();
  });
  it('移除二段式', async () => {
    mocks.events = [{ ...event(), blockedUids: ['targetA'] }];
    mocks.confirm.mockResolvedValueOnce(false);
    mocks.write.mockResolvedValue({ changed: true, event: event() });
    render(<EventBlocklistPage />);
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole('button', { name: '移除' }) as HTMLButtonElement).disabled).toBe(false));
    expect(mocks.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ uid: 'targetA', action: 'remove' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: '移除' })).toBeNull());
  });
  it('未搜尋用戶直接移除也帶出名稱', async () => {
    mocks.events = [{ ...event(), blockedUids: ['targetA'] }];
    mocks.write.mockResolvedValue({ changed: true, event: event() });
    render(<EventBlocklistPage />);
    await waitFor(() => expect(mocks.users).toHaveBeenCalledTimes(1));
    await screen.findByText('小明');
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(mocks.confirm.mock.calls[0]?.[0]).toContain('小明');
    expect(mocks.write.mock.calls[0]?.[0].users).toEqual([expect.objectContaining({ uid: 'targetA', name: '小明' })]);
  });
  it('最後一筆與倒序分組', () => {
    mocks.events = [
      { ...event(), title: '舊活動', date: '2026/10/01', blockedUids: ['uidB'] },
      { ...event(), _docId: 'targetA', title: '新活動', blockedUids: ['targetA'], blockedUidsLog: [
        { uid: 'targetA', by: 'uidA', action: 'add', at: '2026-10-29T00:00:00Z', reason: '舊原因' },
        { uid: 'targetA', by: 'uidA', action: 'add', at: '2026-10-30T00:00:00Z', reason: '新原因' },
        { uid: 'targetA', by: 'uidA', action: 'remove', reason: '忽略' },
      ] },
    ];
    const { container } = render(<EventBlocklistPage />);
    expect(container.querySelector('.eb-group-heading')?.textContent).toContain('新活動');
    expect(screen.getByText(/新原因/)).toBeTruthy();
    expect(screen.queryByText(/舊原因/)).toBeNull();
    expect(screen.getAllByRole('button', { name: '移除' })).toHaveLength(2);
  });
  it('惡意字串以文字顯示', async () => {
    const text = '<img src=x onerror=alert(1)>';
    mocks.events = [{ ...event(), title: text, blockedUids: ['targetA'], blockedUidsLog: [
      { uid: 'targetA', action: 'add', by: 'uidA', reason: text, at: '2026-10-30T00:00:00Z' },
    ] }];
    mocks.users.mockResolvedValue({ users: [{ ...target, name: text }], partial: false });
    const { container } = render(<EventBlocklistPage />);
    fireEvent.input(userInput(), { target: { value: 'img' } });
    await screen.findByRole('button', { name: /<img/ });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain(text);
  });
  it('T10 T11 寫入被拒', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.write.mockRejectedValue({ code: 'permission-denied', message: 'denied (detail A) targetA' });
    render(<EventBlocklistPage />); await selectEvent(); await selectUser(); fireEvent.click(addButton());
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ message: neutral }));
    expect(mocks.emit).toHaveBeenCalledWith('viewer:refresh', {});
    expect(screen.queryByText(/detail A/)).toBeNull();
  });
  it('名單上限提示', async () => {
    mocks.users.mockResolvedValue({ users: [target], partial: true });
    render(<EventBlocklistPage />); await selectUser();
    expect(screen.getByText('目前僅搜尋已載入的用戶，尚有用戶未載入。')).toBeTruthy();
  });
  it('用戶載入失敗可再搜尋', async () => {
    mocks.users.mockRejectedValueOnce(new Error('失敗'));
    render(<EventBlocklistPage />);
    fireEvent.input(userInput(), { target: { value: '小明' } });
    await screen.findByText('用戶載入失敗，請重新輸入搜尋。');
    fireEvent.input(userInput(), { target: { value: 'targetA' } });
    await screen.findByRole('button', { name: /小明/ });
    expect(mocks.users).toHaveBeenCalledTimes(2);
  });
  it('切換帳號不沿用名單', async () => {
    const view = render(<EventBlocklistPage />); await selectUser();
    mocks.viewer = { ...mocks.viewer, uid: 'uidB' }; mocks.lastUid = 'uidB';
    view.rerender(<EventBlocklistPage />);
    expect(screen.getByText('尚未選擇用戶')).toBeTruthy();
    expect(mocks.users).toHaveBeenCalledTimes(1);
    await selectUser();
    expect(mocks.users).toHaveBeenCalledTimes(2);
  });
  it('連點只送一次', async () => {
    let finish!: (value: { changed: boolean; event: BlocklistEvent }) => void;
    mocks.write.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<EventBlocklistPage />); await selectEvent(); await selectUser();
    fireEvent.click(addButton()); fireEvent.click(addButton());
    expect(mocks.write).toHaveBeenCalledTimes(1);
    await act(async () => finish({ changed: true, event: { ...event(), blockedUids: ['targetA'] } }));
  });
  it('活動未載入時沿用既有來源', async () => {
    mocks.events = [];
    render(<EventBlocklistPage />);
    await waitFor(() => expect(mocks.loadEvents).toHaveBeenCalledWith({ terminalMode: 'none' }));
    await screen.findByText('目前沒有任何活動黑名單項目');
    expect(mocks.users).not.toHaveBeenCalled();
  });
  it('確認期間權限改變', async () => {
    let settle!: (ok: boolean) => void;
    mocks.confirm.mockReturnValue(new Promise<boolean>(resolve => { settle = resolve; }));
    mocks.events = [{ ...event(), blockedUids: ['targetA'] }];
    const view = render(<EventBlocklistPage />);
    await screen.findByText('小明');
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    mocks.viewer = { ...mocks.viewer, role: 'user', permissionSources: undefined };
    view.rerender(<EventBlocklistPage />);
    await act(async () => settle(true));
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
