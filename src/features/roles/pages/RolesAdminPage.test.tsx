import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import { createMinimalViewer } from '@/features/profile/data/viewer';
import { rolesFixture } from '../data/role-test-fixtures';
import type { RolePreview, RolesData } from '../data/role-model';
import RolesAdminPage from './RolesAdminPage';
import { RoleAdminGuardError } from '../data/role-errors';
import { RoleHierarchyList } from '../components/RoleHierarchyList';

let viewer: ViewerView;
let knownUid: string | null | undefined = 'test-actor';
const mockLoad = vi.fn();
const mockWrite = vi.fn();
const mockSavePermissions = vi.fn();
const mockSaveDefaults = vi.fn();
const mockResetPermissions = vi.fn();
const mockSaveCapabilities = vi.fn();
const mockToast = vi.fn();
vi.mock('@/core/back-guard', () => ({ useGoBack: () => () => undefined }));
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => knownUid }));
vi.mock('@/ui/Toast', () => ({ toast: { show: (...args: unknown[]) => mockToast(...args) } }));
vi.mock('@/features/profile/data/viewer', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  return { ...actual, useViewer: () => viewer };
});
vi.mock('../data/role-admin', () => ({ loadRolesData: () => mockLoad() }));
vi.mock('../data/role-admin-writes', () => ({
  ROLES_WRITE_CONFIRM_ENABLED: true,
  saveRolePermissions: (...args: unknown[]) => mockSavePermissions(...args),
  saveRolePermissionDefaults: (...args: unknown[]) => mockSaveDefaults(...args),
  resetRolePermissions: (...args: unknown[]) => mockResetPermissions(...args),
  saveRoleActivityCapabilities: (...args: unknown[]) => mockSaveCapabilities(...args),
}));
vi.mock('@/i18n/i18n', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const raw = JSON.parse(readFileSync(resolve(__dirname, '../locales/zh-TW.json'), 'utf8'));
  const dict: Record<string, string> = {};
  const walk = (value: Record<string, unknown>, prefix: string): void => {
    for (const [key, item] of Object.entries(value)) {
      if (item && typeof item === 'object') walk(item as Record<string, unknown>, prefix + '.' + key);
      else dict[prefix + '.' + key] = String(item);
    }
  };
  walk(raw, 'roles');
  const t = (key: string) => dict[key] ?? key;
  return { useT: () => t, t };
});

function actor(role = 'super_admin', uid: string | null = 'test-actor'): ViewerView {
  return { ...createMinimalViewer(uid ?? ''), uid, role, displayName: '測試操作者',
    hasPermission: () => true, permissionSources: { rolePermissions: [], userGrants: [], customRoles: [] } };
}
async function chooseRole(role = 'coach'): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp('Lv\\..*' + role) }));
}
function toggle(code = 'event.publish'): void {
  const input = document.querySelector<HTMLInputElement>('input[aria-label$="(' + code + ')"]');
  if (!input) throw new Error('missing checkbox');
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function pendingDialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name: '確認權限變更' });
}

function expectReadonlyHierarchy(card: Element): void {
  const buttons = [...card.querySelectorAll('button')];
  // 只允許標題內唯一的說明鈕；階層選擇列是 div[role=button]。
  const info = card.querySelector('.role-hierarchy-title > button.perm-info-btn');
  expect(info?.textContent).toBe('?');
  expect(buttons).toEqual([info]);
  expect(card.querySelectorAll('.role-hierarchy-list button')).toHaveLength(0);
}

beforeEach(() => {
  vi.resetAllMocks();
  viewer = actor(); knownUid = 'test-actor';
  mockLoad.mockResolvedValue(rolesFixture());
  mockWrite.mockImplementation(async (_data: RolesData, preview: RolePreview) => ({ document: preview.after, refreshFailed: false }));
  for (const write of [mockSavePermissions, mockSaveDefaults, mockResetPermissions, mockSaveCapabilities]) {
    write.mockImplementation((...args: unknown[]) => mockWrite(...args));
  }
});
afterEach(cleanup);

describe('T-079a 權限管理頁', () => {
  it.each(['user', 'coach', 'captain', 'venue_owner', 'admin'])('%s 擁有所有碼仍拒絕直連且不載入', role => {
    viewer = actor(role);
    render(<RolesAdminPage />);
    expect(screen.getByRole('alert').textContent).toContain('權限不足');
    expect(mockLoad).not.toHaveBeenCalled();
  });
  it('UID 延後與最小 viewer 先顯示載入，不閃權限不足', async () => {
    knownUid = undefined;
    viewer = actor('guest', null);
    const view = render(<RolesAdminPage />);
    expect(screen.getByRole('status').textContent).toBe('載入中');
    viewer = createMinimalViewer('test-actor');
    view.rerender(<RolesAdminPage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockLoad).not.toHaveBeenCalled();
    viewer = actor();
    view.rerender(<RolesAdminPage />);
    await chooseRole();
    expect(mockLoad).toHaveBeenCalledOnce();
  });
  it('只有權限設定與個別授權，沒有新增／刪除角色、權限測試', async () => {
    const data = rolesFixture(); data.customRoles = [{ key: 'custom', label: '自訂測試', afterRole: 'captain' }];
    mockLoad.mockResolvedValue(data);
    render(<RolesAdminPage />);
    await chooseRole('custom');
    expect(document.querySelectorAll('.role-admin-tab')).toHaveLength(2);
    expectReadonlyHierarchy(document.querySelector('.role-hierarchy-card')!);
    expect(screen.getByRole('button', { name: '個別授權' })).toBeTruthy();
    expect(screen.queryByText('權限測試')).toBeNull();
    expect(document.querySelectorAll('.role-level-row')).toHaveLength(7);
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) expect(input.disabled).toBe(true);
  });
  it('T18 不同文字與 class 的新增鈕也會使階層唯讀斷言變紅', () => {
    const view = render(<RoleHierarchyList data={rolesFixture()} selected={null} busy={false}
      onSelect={() => undefined} onInfo={() => undefined} />);
    const card = view.container.querySelector('.role-hierarchy-card')!;
    expectReadonlyHierarchy(card);
    const inserted = document.createElement('button');
    inserted.textContent = '建立另一層'; inserted.className = 'alternative-action';
    card.querySelector('.role-hierarchy-list')!.append(inserted);
    try { expect(() => expectReadonlyHierarchy(card)).toThrow(); }
    finally { inserted.remove(); }
    expectReadonlyHierarchy(card);
  });
  it.each([
    { kind: 'toggle', label: '', code: 'event.publish', role: 'coach', write: mockSavePermissions },
    { kind: 'save-defaults', label: '儲存成預設', code: '', role: 'coach', write: mockSaveDefaults },
    { kind: 'restore-defaults', label: '復原預設', code: '', role: 'coach', write: mockResetPermissions },
    { kind: 'capability', label: '', code: 'user.activity.basic_create', role: 'user', write: mockSaveCapabilities },
  ])('S4 $kind 第一參數深度等於載入原始 RolesData，不含樂觀 after', async operation => {
    const loaded = rolesFixture();
    const original = structuredClone(loaded);
    mockLoad.mockResolvedValueOnce(loaded);
    render(<RolesAdminPage />);
    await chooseRole(operation.role);
    if (operation.code) toggle(operation.code);
    else fireEvent.click(screen.getByRole('button', { name: operation.label }));
    fireEvent.click(within(await pendingDialog()).getByRole('button', { name: '確定' }));
    await waitFor(() => expect(operation.write).toHaveBeenCalledOnce());
    const [data, preview, proof] = operation.write.mock.calls[0] as [RolesData, RolePreview, string];
    expect(preview.action.kind).toBe(operation.kind);
    expect(data).toEqual(original);
    expect(loaded).toEqual(original);
    const documents = preview.collection === 'rolePermissions' ? data.rolePermissions : data.roleActivityDocuments;
    expect(documents[preview.role]).toEqual(preview.before);
    expect(documents[preview.role]).not.toEqual(preview.after);
    expect(proof).toBe(preview.fingerprint);
    for (const write of [mockSavePermissions, mockSaveDefaults, mockResetPermissions, mockSaveCapabilities]) {
      if (write !== operation.write) expect(write).not.toHaveBeenCalled();
    }
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('S5 stale 後提示重新載入，切換角色也不能再以過期資料寫入', async () => {
    mockWrite.mockRejectedValueOnce(new RoleAdminGuardError('stale-document'));
    render(<RolesAdminPage />);
    await chooseRole(); toggle();
    fireEvent.click(within(await pendingDialog()).getByRole('button', { name: '確定' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('alert').textContent).toContain('重新');
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('重新') }));
    expect(document.querySelector<HTMLInputElement>('input[aria-label$="(event.publish)"]')?.checked).toBe(false);
    await chooseRole('captain');
    const input = document.querySelector<HTMLInputElement>('input[aria-label$="(event.publish)"]')!;
    expect(input.disabled).toBe(true);
    toggle();
    for (const label of ['儲存成預設', '復原預設']) {
      const button = screen.getByRole('button', { name: label }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockLoad).toHaveBeenCalledOnce();
  });
  for (const flag of [true, false]) {
    it('確認呈現旗標 ' + flag + '：未確認不寫，顯示完整 diff 與舊碼變更', async () => {
      render(<RolesAdminPage confirmEnabled={flag} />);
      await chooseRole(); toggle();
      const dialog = await pendingDialog();
      expect(dialog.querySelector(flag ? '.role-diff-expanded' : '.role-diff-compact')).not.toBeNull();
      expect(dialog.querySelector(flag ? '.role-diff-compact' : '.role-diff-expanded')).toBeNull();
      expect(mockWrite).not.toHaveBeenCalled();
      expect(dialog.textContent).toContain('event.edit_own');
      expect(dialog.textContent).toContain('20260506b');
      expect(dialog.textContent).toContain('預設權限');
      fireEvent.click(within(dialog).getByRole('button', { name: '確定' }));
      await waitFor(() => expect(mockWrite).toHaveBeenCalledOnce());
      expect(mockWrite.mock.calls[0]?.[2]).toBe((mockWrite.mock.calls[0]?.[1] as RolePreview).fingerprint);
    });
    it('確認呈現旗標 ' + flag + '：取消不寫、不變動開關', async () => {
      render(<RolesAdminPage confirmEnabled={flag} />);
      await chooseRole(); toggle();
      const dialog = await pendingDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
      expect(mockWrite).not.toHaveBeenCalled();
      expect(document.querySelector<HTMLInputElement>('input[aria-label$="(event.publish)"]')?.checked).toBe(false);
    });
  }
  it('P28 待確認與寫入期間頁籤按鈕停用，完成後恢復', async () => {
    let finish!: (value: { document: Record<string, unknown>; refreshFailed: boolean }) => void;
    mockWrite.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<RolesAdminPage />); await chooseRole();
    const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('.role-admin-tab')];
    expect(tabs().map(tab => tab.id)).toEqual(['role-admin-tab-settings', 'role-admin-tab-user-grants']);
    expect(tabs().every(tab => !tab.disabled)).toBe(true);
    toggle(); const dialog = await pendingDialog();
    expect(tabs().every(tab => tab.disabled)).toBe(true); expect(mockWrite).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '確定' }));
    await waitFor(() => expect(mockWrite).toHaveBeenCalledOnce());
    try {
      expect(tabs().every(tab => tab.disabled)).toBe(true);
    } finally {
      const preview = mockWrite.mock.calls[0]?.[1] as RolePreview;
      await act(async () => finish({ document: preview.after, refreshFailed: false }));
    }
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(tabs().every(tab => !tab.disabled)).toBe(true);
  });
  it('M18 寫入失敗回復，第二次可成功；連點確認不重複送出', async () => {
    let reject!: (error: Error) => void;
    mockWrite.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    render(<RolesAdminPage />);
    await chooseRole(); toggle();
    const dialog = await pendingDialog();
    const confirm = within(dialog).getByRole('button', { name: '確定' });
    act(() => {
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLInputElement>('input[aria-label$="(event.publish)"]')?.checked).toBe(true);
    await act(async () => reject(new Error('synthetic-failure')));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector<HTMLInputElement>('input[aria-label$="(event.publish)"]')?.checked).toBe(false);
    toggle();
    fireEvent.click(within(await pendingDialog()).getByRole('button', { name: '確定' }));
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(2));
  });
  it('user 權限鎖定，活動能力可關至 []，確認框顯示無預設', async () => {
    render(<RolesAdminPage />);
    await chooseRole('user');
    expect((screen.getByRole('button', { name: '復原預設' }) as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('input[aria-label$="(event.create)"]') as HTMLInputElement).disabled).toBe(true);
    toggle('user.activity.basic_create');
    const dialog = await pendingDialog();
    expect(dialog.textContent).toContain('無預設');
    fireEvent.click(within(dialog).getByRole('button', { name: '確定' }));
    await waitFor(() => expect(mockWrite).toHaveBeenCalledOnce());
    expect((mockWrite.mock.calls[0]?.[1] as RolePreview).payload).toMatchObject({ capabilities: [] });
  });
  it('儲存／復原預設都要確認；只顯示已有權限可切回', async () => {
    render(<RolesAdminPage />);
    await chooseRole();
    fireEvent.click(screen.getByRole('button', { name: '只顯示已有權限' }));
    expect(document.querySelector('input[aria-label$="(event.publish)"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '顯示全部權限' }));
    for (const label of ['儲存成預設', '復原預設']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(mockWrite).not.toHaveBeenCalled();
      fireEvent.click(within(await pendingDialog()).getByRole('button', { name: '取消' }));
    }
  });
  it.each(['儲存成預設', '復原預設', '活動能力'])('%s 失敗回復原始文件，重試成功', async label => {
    mockWrite.mockRejectedValueOnce(new Error('synthetic-failure'));
    render(<RolesAdminPage />);
    await chooseRole(label === '活動能力' ? 'user' : 'coach');
    const open = (): void => {
      if (label === '活動能力') toggle('user.activity.basic_create');
      else fireEvent.click(screen.getByRole('button', { name: label }));
    };
    open();
    fireEvent.click(within(await pendingDialog()).getByRole('button', { name: '確定' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const before = (mockWrite.mock.calls[0]?.[1] as RolePreview).before;
    open();
    fireEvent.click(within(await pendingDialog()).getByRole('button', { name: '確定' }));
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(2));
    expect((mockWrite.mock.calls[1]?.[1] as RolePreview).before).toEqual(before);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ message: '權限已更新' }));
  });
  it('換帳號後舊寫入結果不得污染新帳號頁面', async () => {
    let finish!: (result: { document: Record<string, unknown>; refreshFailed: boolean }) => void;
    mockWrite.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<RolesAdminPage />);
    await chooseRole(); toggle();
    fireEvent.click(within(await pendingDialog()).getByRole('button', { name: '確定' }));
    const preview = mockWrite.mock.calls[0]?.[1] as RolePreview;
    viewer = actor('super_admin', 'new-test-actor'); knownUid = 'new-test-actor';
    view.rerender(<RolesAdminPage />);
    await chooseRole();
    await act(async () => finish({ document: preview.after, refreshFailed: false }));
    expect(document.querySelector<HTMLInputElement>('input[aria-label$="(event.publish)"]')?.checked).toBe(false);
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ message: '權限已更新' }));
  });
  it('換帳號與離頁後丟棄晚到載入結果', async () => {
    let resolve!: (value: RolesData) => void;
    mockLoad.mockImplementationOnce(() => new Promise(resolvePromise => { resolve = resolvePromise; }));
    const view = render(<RolesAdminPage />);
    viewer = actor('admin', 'other-test-actor');
    view.rerender(<RolesAdminPage />);
    await act(async () => resolve(rolesFixture()));
    expect(screen.getByRole('alert').textContent).toContain('權限不足');
    expect(document.querySelector('.role-hierarchy-list')).toBeNull();
    view.unmount();
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
