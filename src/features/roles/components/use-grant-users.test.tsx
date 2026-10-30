import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminUsers, loadMoreAdminUsers, type AdminUsersLoad } from '@/features/admin-users/data/admin-users';
import { mapUserDoc } from '@/features/admin-users/data/admin-users-model';
import { useGrantUsers } from './use-grant-users';

vi.mock('@/features/admin-users/data/admin-users', () => ({ loadAdminUsers: vi.fn(), loadMoreAdminUsers: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

describe('個別授權搜尋載入狀態', () => {
  it('P25 載入中連續要求更多與重試只維持一次載入', async () => {
    let finish!: (value: AdminUsersLoad) => void;
    const pending = new Promise<AdminUsersLoad>(resolve => { finish = resolve; });
    vi.mocked(loadAdminUsers).mockReturnValue(pending);
    let users!: ReturnType<typeof useGrantUsers>;
    function Harness() { users = useGrantUsers(true, '合成'); return null; }
    render(<Harness />);
    await waitFor(() => expect(loadAdminUsers).toHaveBeenCalledOnce());
    try {
      expect(users.busy).toBe(true);
      act(() => { users.more(); users.retry(); users.more(); users.retry(); });
      expect(loadAdminUsers).toHaveBeenCalledOnce();
      expect(loadMoreAdminUsers).not.toHaveBeenCalled();
    } finally {
      await act(async () => finish({ users: [mapUserDoc({ uid: 'test-target', displayName: '合成用戶' }, 'test-target')],
        total: 1, lastId: 'test-target', done: true, partial: false }));
    }
    await waitFor(() => expect(users.busy).toBe(false));
    expect(users.users.map(user => user.uid)).toEqual(['test-target']);
    expect(loadAdminUsers).toHaveBeenCalledOnce();
  });
});
