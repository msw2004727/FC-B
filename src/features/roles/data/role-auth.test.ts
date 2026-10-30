import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireRoleAdmin, requireSameRoleActor } from './role-auth';
let uid: string | null = 'test-actor';
const mockViewer = vi.fn();
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => uid }));
vi.mock('@/features/profile/data/viewer', () => ({ loadViewer: (...args: unknown[]) => mockViewer(...args) }));
beforeEach(() => { vi.resetAllMocks(); uid = 'test-actor'; mockViewer.mockResolvedValue({ uid, role: 'super_admin' }); });
describe('共用角色守衛的獨立條件', () => {
  it('A01 沒有 auth UID 立即拒絕，不載入 viewer', async () => {
    uid = null; await expect(requireRoleAdmin()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockViewer).not.toHaveBeenCalled();
  });
  it.each(['guest', 'user', 'coach', 'captain', 'venue_owner', 'admin', 'custom'])('A02 精確 super_admin，拒絕 %s', async role => {
    mockViewer.mockResolvedValueOnce({ uid, role, roleLevel: 999, hasPermission: () => true });
    await expect(requireRoleAdmin()).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('A03 viewer UID 必須等於查詢的 auth UID', async () => {
    mockViewer.mockResolvedValueOnce({ uid: 'other-test', role: 'super_admin' });
    await expect(requireRoleAdmin()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(uid).toBe('test-actor');
  });
  it('A04 loadViewer 等待期間換帳號，即使回傳原 super_admin 也拒絕', async () => {
    mockViewer.mockImplementationOnce(async () => { await Promise.resolve(); uid = 'other-test'; return { uid: 'test-actor', role: 'super_admin' }; });
    await expect(requireRoleAdmin()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockViewer).toHaveBeenCalledExactlyOnceWith('test-actor');
  });
  it('A05 super_admin 相同 UID 通過', async () => {
    expect(await requireRoleAdmin()).toMatchObject({ uid: 'test-actor', role: 'super_admin' });
    expect(() => requireSameRoleActor('test-actor')).not.toThrow();
  });
  it.each([null, 'other-test'])('A06 await 後身分 %s 不同即拒絕', changed => {
    uid = changed; expect(() => requireSameRoleActor('test-actor')).toThrow('permission-denied');
  });
});
