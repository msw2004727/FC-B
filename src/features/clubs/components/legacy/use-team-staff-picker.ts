import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  getUserDirectory,
  loadUserDirectory,
  searchUserDirectory,
  verifyUserDirectorySelection,
} from '@/features/events/data/user-directory';
import type { DirectoryUser } from '@/features/events/data/user-directory';
import { toast } from '@/ui/Toast';

export interface StaffPickerApi {
  query: string;
  setQuery(q: string): void;
  suggestions: DirectoryUser[];
  pick(uid: string): Promise<{ uid: string; name: string } | null>;
  verifying: boolean;
}

interface StaffPickerOptions {
  excludeUids: string[];
  enabled: boolean;
}

/**
 * 一次表單開啟共用一個 scope，避免三個 picker 各自載入及重複提示。
 * scope 身分改變後，舊載入／驗證結果不得提交。
 */
export interface StaffDirectoryScope {
  active: boolean;
  users: readonly DirectoryUser[];
  ready: boolean;
}

export function useStaffDirectory(
  enabled: boolean,
  identity: string,
): StaffDirectoryScope {
  const scope = useMemo<StaffDirectoryScope>(() => ({
    active: false,
    users: enabled ? getUserDirectory() : [],
    ready: false,
  }), [enabled, identity]);
  const [, redraw] = useState(0);

  useLayoutEffect(() => {
    scope.active = enabled;
    if (!enabled) return;

    let current = true;
    const load = async (): Promise<void> => {
      let loaded = false;
      try {
        loaded = await loadUserDirectory();
      } catch {
        loaded = false;
      }
      if (!current || !scope.active) return;
      scope.users = getUserDirectory();
      scope.ready = true;
      if (!loaded) {
        toast.show({
          message: '用戶資料載入失敗；表單仍可編輯，若搜尋不到請關閉後重試',
          tone: 'error',
        });
      }
      redraw(value => value + 1);
    };
    // load 已自行處理 loader 的拒絕；保留最後防線，避免事件外未處理拒絕。
    load().catch(() => undefined);

    return () => {
      current = false;
      scope.active = false;
    };
  }, [enabled, scope]);

  return scope;
}

/** 表單內部共用目錄；公開獨立 picker 請使用 useStaffPicker。 */
export function useScopedStaffPicker(
  opts: StaffPickerOptions,
  scope: StaffDirectoryScope,
): StaffPickerApi {
  const [query, setQueryState] = useState('');
  const [verifying, setVerifying] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const latest = useRef({ opts, scope });
  latest.current = { opts, scope };

  useLayoutEffect(() => {
    mounted.current = true;
    sequence.current += 1;
    setQueryState('');
    setVerifying(false);
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, [scope, opts.enabled]);

  const setQuery = (value: string): void => {
    if (mounted.current && scope.active) setQueryState(value);
  };

  const pick = async (rawUid: string): Promise<{ uid: string; name: string } | null> => {
    const uid = rawUid.trim();
    if (
      !uid || !mounted.current || !scope.active || !latest.current.opts.enabled
      || latest.current.scope !== scope || latest.current.opts.excludeUids.includes(uid)
    ) return null;

    const request = ++sequence.current;
    const current = (): boolean =>
      mounted.current
      && scope.active
      && latest.current.scope === scope
      && latest.current.opts.enabled
      && request === sequence.current;

    setVerifying(true);
    try {
      const result = await verifyUserDirectorySelection([uid]);
      if (!current()) return null;
      const user = result.users.find(item => item.uid === uid);
      if (!result.ok || result.missingUids.includes(uid) || !user) {
        toast.show({
          message: '無法確認此使用者，請重新搜尋後再試',
          tone: 'error',
        });
        return null;
      }
      if (latest.current.opts.excludeUids.includes(uid)) return null;
      scope.users = getUserDirectory();
      return { uid, name: user.name || user.displayName };
    } catch {
      if (current()) {
        toast.show({
          message: '無法確認此使用者，請重新搜尋後再試',
          tone: 'error',
        });
      }
      return null;
    } finally {
      if (current()) setVerifying(false);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  // B searchUserDirectory 另比對 displayName，比 A 寬；先依 A 過濾，
  // 再交由 B 截取前五筆，避免 displayName-only 命中吃掉五筆名額。
  const candidates = scope.users.filter(user =>
    user.name.toLowerCase().includes(normalizedQuery)
    || user.uid.toLowerCase().includes(normalizedQuery),
  );

  return {
    query,
    setQuery,
    suggestions: opts.enabled && normalizedQuery
      ? searchUserDirectory(candidates, normalizedQuery, opts.excludeUids)
      : [],
    pick,
    verifying,
  };
}

export function useStaffPicker(opts: {
  excludeUids: string[];
  enabled: boolean;
}): StaffPickerApi {
  const scope = useStaffDirectory(opts.enabled, 'standalone');
  return useScopedStaffPicker(opts, scope);
}
