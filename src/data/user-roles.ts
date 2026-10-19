// 依 UID 批次載入使用者角色（R-ID-002：不以名字查身分）。
//
// - 以 `where(documentId(), 'in', chunk)` 每次最多 30 個 UID 分批讀 `users/{uid}`。
// - 只取 `role` 欄位；值屬於 `UserRole` 才採用，否則 'user'；查不到的 UID 也是 'user'（照 A）。
// - 模組層 5 分鐘快取；同一批進行中的請求共用 Promise，避免重複讀。
// - 讀取失敗：記一次 console.warn，回傳目前快取＋其餘 'user'，不丟例外。

import { useEffect, useState } from 'preact/hooks';
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from 'firebase/firestore';

import { getFirebase } from './firebase';
import type { UserRole } from '@/ui/Avatar';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_UIDS_PER_QUERY = 30;
const USERS_COLLECTION = 'users';
const DEFAULT_ROLE: UserRole = 'user';

const KNOWN_ROLES: ReadonlySet<string> = new Set<UserRole>([
  'user',
  'coach',
  'captain',
  'team_leader',
  'venue_owner',
  'admin',
  'super_admin',
]);

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && KNOWN_ROLES.has(value);
}

interface CacheEntry {
  role: UserRole;
  expiresAt: number;
}

interface FetchOutcome {
  failed: boolean;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<FetchOutcome>>();
let warned = false;

function normalizeUids(uids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of uids) {
    if (typeof raw !== 'string') continue;
    const uid = raw.trim();
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function readRole(data: Record<string, unknown> | undefined): UserRole {
  return isUserRole(data?.role) ? data.role : DEFAULT_ROLE;
}

async function fetchRoles(uids: readonly string[]): Promise<Record<string, UserRole>> {
  const { db } = await getFirebase();
  const result: Record<string, UserRole> = {};

  for (const batch of chunk(uids, MAX_UIDS_PER_QUERY)) {
    // 只依 UID 精確匹配（R-ID-002），不依名字。
    const ref = query(
      collection(db, USERS_COLLECTION),
      where(documentId(), 'in', batch),
    );
    const snapshot = await getDocs(ref);
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as Record<string, unknown> | undefined;
      result[docSnap.id] = readRole(data);
    }
  }

  return result;
}

function startFetch(uidsToFetch: readonly string[]): Promise<FetchOutcome> {
  const key = [...uidsToFetch].sort().join('\n');
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<FetchOutcome> => {
    try {
      const fetched = await fetchRoles(uidsToFetch);
      const expiresAt = Date.now() + CACHE_TTL_MS;
      for (const uid of uidsToFetch) {
        cache.set(uid, { role: fetched[uid] ?? DEFAULT_ROLE, expiresAt });
      }
      return { failed: false };
    } catch (error) {
      if (!warned) {
        warned = true;
        // eslint-disable-next-line no-console
        console.warn('[user-roles] 讀取使用者角色失敗，回退為預設角色', error);
      }
      return { failed: true };
    } finally {
      // L-08：成功與失敗兩條路徑都清除 inflight。
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/**
 * 依 UID 取角色。查不到的 UID 回 'user'。
 * 讀取失敗時回傳目前快取＋其餘 'user'，永不 reject。
 */
export async function loadUserRoles(
  uids: readonly string[],
): Promise<Record<string, UserRole>> {
  const normalized = normalizeUids(uids);
  const now = Date.now();
  const result: Record<string, UserRole> = {};
  const toFetch: string[] = [];

  for (const uid of normalized) {
    const cached = cache.get(uid);
    if (cached && cached.expiresAt > now) {
      result[uid] = cached.role;
    } else {
      toFetch.push(uid);
    }
  }

  if (toFetch.length === 0) return result;

  await startFetch(toFetch);

  // 成功時 cache 已被填上；失敗時 cache 保持現狀（可能含舊的 stale 值）。
  for (const uid of toFetch) {
    result[uid] = cache.get(uid)?.role ?? DEFAULT_ROLE;
  }
  return result;
}

function uidsKey(uids: readonly string[]): string {
  return normalizeUids(uids).sort().join('\n');
}

/** uids 內容改變才重查；元件卸載後不 setState。 */
export function useUserRoles(uids: readonly string[]): Record<string, UserRole> {
  const [roles, setRoles] = useState<Record<string, UserRole>>({});
  const key = uidsKey(uids);

  useEffect(() => {
    let cancelled = false;
    // 以內容 key 作為 dep：陣列身分改變但內容相同不會重查。
    loadUserRoles(uids)
      .then((next) => {
        if (cancelled) return;
        setRoles(next);
      })
      .catch(() => {
        // loadUserRoles 內部已處理錯誤；此處僅作為安全網。
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return roles;
}

/** 測試用：清空快取、inflight 與 warn 狀態。 */
export function _resetUserRolesCacheForTest(): void {
  cache.clear();
  inflight.clear();
  warned = false;
}
