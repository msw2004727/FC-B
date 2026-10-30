import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import { createMinimalViewer } from '@/features/profile/data/viewer';
import { mapUserDoc } from '@/features/admin-users/data/admin-users-model';
import { rolesFixture } from '../data/role-test-fixtures';
import type { UserGrantPreview, UserGrantSnapshot } from '../data/user-grant-model';
import RolesAdminPage from './RolesAdminPage';

const hoisted = vi.hoisted(() => ({
  viewer: null as unknown as ViewerView, knownUid: 'test-actor' as string | null,
  users: vi.fn(), more: vi.fn(), roles: vi.fn(), read: vi.fn(), permission: vi.fn(), enabled: vi.fn(), toast: vi.fn(),
}));
export const h = hoisted;
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => hoisted.knownUid }));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => () => undefined }));
vi.mock('@/ui/Toast', () => ({ toast: { show: (...args: unknown[]) => hoisted.toast(...args) } }));
vi.mock('@/features/profile/data/viewer', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  return { ...actual, useViewer: () => hoisted.viewer };
});
vi.mock('@/features/admin-users/data/admin-users', () => ({
  loadAdminUsers: () => hoisted.users(), loadMoreAdminUsers: (...args: unknown[]) => hoisted.more(...args),
}));
vi.mock('../data/role-admin', () => ({ loadRolesData: () => hoisted.roles() }));
vi.mock('../data/user-grant-admin', () => ({ loadUserGrant: (...args: unknown[]) => hoisted.read(...args) }));
vi.mock('../data/user-grant-writes', () => ({
  toggleUserGrantPermission: (...args: unknown[]) => hoisted.permission(...args),
  toggleUserGrantEnabled: (...args: unknown[]) => hoisted.enabled(...args),
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
export function actor(role = 'super_admin', uid: string | null = 'test-actor'): ViewerView {
  return { ...createMinimalViewer(uid ?? ''), uid, role, hasPermission: () => true,
    permissionSources: { rolePermissions: [], userGrants: [], customRoles: [] } };
}
export const user = (id = 'test-target', name = '合成用戶') => mapUserDoc({ uid: id, displayName: name, role: 'user' }, id);
export const fixture = (id = 'test-target', name = '合成用戶'): UserGrantSnapshot => ({ uid: id, targetName: name,
  document: { uid: id, permissions: ['event.create'], enabled: true, updatedAt: { seconds: 1 }, oldField: '合成舊欄位' } });
export function renderPage(confirmEnabled = true) { return render(<RolesAdminPage confirmEnabled={confirmEnabled} />); }
export async function openGrants(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: '個別授權' }));
}
export function search(value = '合成'): void { fireEvent.input(screen.getByRole('searchbox'), { target: { value } }); }
export async function choose(name = '合成用戶'): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  await waitFor(() => { if (!document.querySelector('#user-permission-grant-editor input')) throw new Error('waiting editor'); });
}
export function input(code = 'event.publish'): HTMLInputElement {
  const query = code === 'enabled' ? 'input[aria-label="啟用此用戶的個別授權"]' : 'input[aria-label$="(' + code + ')"]';
  const element = document.querySelector<HTMLInputElement>('#user-permission-grant-editor ' + query);
  if (!element) throw new Error('missing grant input');
  return element;
}
export function toggle(code = 'event.publish'): void {
  act(() => { input(code).dispatchEvent(new Event('change', { bubbles: true })); });
}
export async function dialog(): Promise<HTMLElement> { return screen.findByRole('dialog', { name: '確認權限變更' }); }
export async function confirm(): Promise<void> { fireEvent.click(within(await dialog()).getByRole('button', { name: '確定' })); }
export async function settled(): Promise<void> { await waitFor(() => { if (screen.queryByRole('dialog')) throw new Error('waiting confirmation'); }); }
beforeEach(() => {
  vi.resetAllMocks(); h.viewer = actor(); h.knownUid = 'test-actor';
  h.roles.mockResolvedValue(rolesFixture());
  h.users.mockResolvedValue({ users: [user()], total: 1, lastId: 'test-target', done: true, partial: false });
  h.read.mockImplementation(async (uid: string, name: string) => fixture(uid, name));
  for (const write of [h.permission, h.enabled]) write.mockImplementation(async (_original: UserGrantSnapshot, preview: UserGrantPreview) => ({ document: preview.after, refreshFailed: false }));
});
afterEach(cleanup);
