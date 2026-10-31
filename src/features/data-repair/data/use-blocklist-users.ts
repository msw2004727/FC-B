import { useEffect, useRef, useState } from 'preact/hooks';
import type { BlocklistUser } from './event-blocklist-model';

export function useBlocklistUsers() {
  const [users, setUsers] = useState<BlocklistUser[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [partial, setPartial] = useState(false);
  const pending = useRef<Promise<BlocklistUser[]> | null>(null);
  const loaded = useRef<BlocklistUser[] | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = (): Promise<BlocklistUser[]> => {
    if (loaded.current) return Promise.resolve(loaded.current);
    if (pending.current) return pending.current;
    setStatus('loading');
    pending.current = (async () => {
      try {
        const { loadAdminUsers } = await import('@/features/admin-users/data/admin-users');
        const result = await loadAdminUsers();
        const list = result.users.map(({ uid, name, lineUserId }) => ({ uid, name, lineUserId }));
        if (!alive.current) return list;
        setUsers(list);
        setPartial(result.partial);
        loaded.current = list;
        setStatus('ready');
        return list;
      } catch {
        if (alive.current) setStatus('error');
        return [];
      } finally { pending.current = null; }
    })();
    return pending.current;
  };
  return { users, status, partial, load };
}
