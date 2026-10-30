import { useEffect, useRef, useState } from 'preact/hooks';
import { loadAdminUsers, loadMoreAdminUsers, type AdminUsersLoad } from '@/features/admin-users/data/admin-users';
import { ADMIN_USER_PAGE_SIZE, sliceVisible, sortUsersByName } from '@/features/admin-users/data/admin-users-model';

/** 沿用 M-142 載入／分頁；只在開啟個別授權且輸入第一個字後才啟動。 */
export function useGrantUsers(active: boolean, query: string) {
  const [data, setData] = useState<AdminUsersLoad | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [count, setCount] = useState(ADMIN_USER_PAGE_SIZE);
  const alive = useRef(true);
  const loading = useRef(false);
  const keyword = query.trim().toLowerCase();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = async (): Promise<void> => {
    if (loading.current) return;
    loading.current = true; setBusy(true); setFailed(false);
    try {
      const result = data ? await loadMoreAdminUsers(data) : await loadAdminUsers();
      if (alive.current) setData(result);
    } catch { if (alive.current) setFailed(true); }
    finally { if (alive.current) { loading.current = false; setBusy(false); } }
  };
  useEffect(() => {
    if (active && keyword && !data && !busy && !failed) load().catch(() => setFailed(true));
  }, [active, keyword, data, busy, failed]);
  useEffect(() => { setCount(ADMIN_USER_PAGE_SIZE); }, [keyword]);
  const matches = !keyword ? [] : sortUsersByName(data?.users ?? []).filter(user =>
    [user.name, user.uid, user.lineUserId, user._docId].some(value => value.toLowerCase().includes(keyword)));
  const page = sliceVisible(matches, count);
  const more = (): void => {
    if (page.hasMore) setCount(value => value + ADMIN_USER_PAGE_SIZE);
    else load().catch(() => setFailed(true));
  };
  return { users: page.visible, busy, failed, partial: data?.partial ?? false,
    hasMore: page.hasMore || (data !== null && !data.done), more,
    retry: () => { load().catch(() => setFailed(true)); } };
}
