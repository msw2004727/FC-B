// 依 UID 批次載入使用者角色（R-ID-002：不以名字查身分）。
//
// - 以 `where(documentId(), 'in', chunk)` 每次最多 30 個 UID 分批讀 `users/{uid}`。
// - 同次讀取快取 role、exp、放鴿子統計與臨時取消 5 欄，不另開 users 查詢。
// - role 屬於 UserRole 才採用，否則 'user'；查不到的 UID 也是 'user'（照 A）。
// - 模組層 5 分鐘快取；依 UID 共用進行中的請求 Promise，避免重複讀。
// - 讀取失敗：記一次 console.warn；角色回傳目前快取＋其餘 'user'，統計 reject。

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

/** Functions 寫回 users 的統計；只讀，不在前端重算或寫回。 */
export interface UserNoShowStats {
  noShowCount: number;
  endedRegCount: number;
  lastEventWasNoShow: boolean;
}

/** 臨時取消（FC 契約 late-cancel-contract §5，只由 Functions 寫）；時間已轉毫秒。 */
export interface UserLateCancelInfo {
  level: 'black' | 'red' | null;
  untilMs: number | null;
  releaseAt: number;
  recentMs: number[];
  total: number;
}

/** 只接受 users.gender 的這兩個字；其他值（含缺欄）存空字串。 */
export type UserGender = '男' | '女' | '';

interface CacheEntry extends UserNoShowStats {
  role: UserRole;
  /** users.exp，給使用者膠囊算等級（A `_calcLevelFromExp`）。 */
  exp: number;
  /** 與角色同一份 users 文件；不另開查詢。 */
  gender: UserGender;
  lateCancel: UserLateCancelInfo;
  expiresAt: number;
}

interface UserSummary extends UserNoShowStats {
  role: UserRole;
  exp: number;
  gender: UserGender;
  lateCancel: UserLateCancelInfo;
}

type FetchOutcome = { failed: false } | { failed: true; error: unknown };

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

/**
 * 角色：照 A `profile-core.js#_stealthRole`——管理員／總管開啟隱身（users.stealth === true）時顯示為一般用戶。
 * （2026-10-19 補上：B 原本沒有，會讓隱身管理員的身分外露。）
 */
function readRole(data: Record<string, unknown> | undefined): UserRole {
  const role = isUserRole(data?.role) ? data.role : DEFAULT_ROLE;
  if ((role === 'admin' || role === 'super_admin') && data?.stealth === true) return DEFAULT_ROLE;
  return role;
}

function readExp(data: Record<string, unknown> | undefined): number {
  return Math.max(0, Number(data?.exp || 0) || 0);
}

function readGender(data: Record<string, unknown> | undefined): UserGender {
  const value = data?.gender;
  return value === '男' || value === '女' ? value : '';
}

/** Timestamp／{seconds}／毫秒數字 → 毫秒；其餘 null。 */
function readTimeMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value || typeof value !== 'object') return null;
  const record = value as { toMillis?: unknown; seconds?: unknown };
  if (typeof record.toMillis === 'function') {
    const ms = Number((record.toMillis as () => unknown)());
    return Number.isFinite(ms) ? ms : null;
  }
  return typeof record.seconds === 'number' && Number.isFinite(record.seconds) ? record.seconds * 1000 : null;
}

function readLateCancel(data: Record<string, unknown> | undefined): UserLateCancelInfo {
  const level = data?.lateCancelLevel;
  const recent = Array.isArray(data?.lateCancelRecent) ? data.lateCancelRecent : [];
  return {
    level: level === 'black' || level === 'red' ? level : null,
    untilMs: readTimeMs(data?.lateCancelUntil),
    releaseAt: Number(data?.lateCancelReleaseAt || 0) || 0,
    recentMs: recent.map(readTimeMs).filter((ms): ms is number => ms !== null),
    total: Number(data?.lateCancelTotal || 0) || 0,
  };
}

const EMPTY_LATE_CANCEL: UserLateCancelInfo = { level: null, untilMs: null, releaseAt: 0, recentMs: [], total: 0 };

function readNoShowStats(data: Record<string, unknown> | undefined): UserNoShowStats {
  return {
    noShowCount: Number(data?.noShowCount || 0) || 0,
    endedRegCount: Number(data?.endedRegCount || 0) || 0,
    lastEventWasNoShow: Boolean(data?.lastEventWasNoShow),
  };
}

function copyNoShowStats(entry: UserNoShowStats | undefined): UserNoShowStats {
  return {
    noShowCount: entry?.noShowCount ?? 0,
    endedRegCount: entry?.endedRegCount ?? 0,
    lastEventWasNoShow: entry?.lastEventWasNoShow ?? false,
  };
}

/** A `profile-core.js#_calcLevelFromExp` 的等級。 */
export function userLevelFromExp(totalExp: number): number {
  if (!(totalExp > 0)) return 0;
  let level = Math.floor((-1 + Math.sqrt(1 + (4 * totalExp) / 50)) / 2);
  if (level < 0) level = 0;
  if (level > 999) level = 999;
  return level;
}

/** 已載入（未過期）的使用者等級；沒有快取回 undefined。 */
export function getCachedUserLevel(uid: string): number | undefined {
  const entry = cache.get(String(uid || '').trim());
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return userLevelFromExp(entry.exp);
}

/**
 * 已載入（未過期）的性別。沒有快取或過期回 undefined，絕不觸發查詢。
 * 文件已讀但性別不是「男」「女」時回空字串。
 */
export function getCachedUserGender(uid: string): UserGender | undefined {
  const entry = cache.get(String(uid || '').trim());
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.gender;
}

/** 未過期的臨時取消欄位；未載入或過期回 undefined，絕不觸發查詢。 */
export function getCachedUserLateCancel(uid: string): UserLateCancelInfo | undefined {
  const entry = cache.get(String(uid || '').trim());
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.lateCancel;
}

/** 未過期的統計副本；未載入或過期回 undefined，絕不觸發查詢。 */
export function getCachedUserNoShowStats(uid: string): UserNoShowStats | undefined {
  const entry = cache.get(String(uid || '').trim());
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return copyNoShowStats(entry);
}

async function fetchRoles(uids: readonly string[]): Promise<void> {
  const { db } = await getFirebase();

  for (const batch of chunk(uids, MAX_UIDS_PER_QUERY)) {
    // 只依 UID 精確匹配（R-ID-002），不依名字。
    const ref = query(
      collection(db, USERS_COLLECTION),
      where(documentId(), 'in', batch),
    );
    const snapshot = await getDocs(ref);
    const result: Record<string, UserSummary> = {};
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as Record<string, unknown> | undefined;
      result[docSnap.id] = {
        role: readRole(data),
        exp: readExp(data),
        gender: readGender(data),
        lateCancel: readLateCancel(data),
        ...readNoShowStats(data),
      };
    }
    // 每批成功後才寫入快取；後續批次失敗不丟棄已取得的資料。
    const expiresAt = Date.now() + CACHE_TTL_MS;
    for (const uid of batch) {
      cache.set(uid, {
        role: result[uid]?.role ?? DEFAULT_ROLE,
        exp: result[uid]?.exp ?? 0,
        gender: result[uid]?.gender ?? '',
        lateCancel: result[uid]?.lateCancel ?? EMPTY_LATE_CANCEL,
        ...copyNoShowStats(result[uid]),
        expiresAt,
      });
    }
  }
}

async function startFetch(uidsToFetch: readonly string[]): Promise<FetchOutcome> {
  const pending = new Set<Promise<FetchOutcome>>();
  const newUids: string[] = [];
  for (const uid of uidsToFetch) {
    const existing = inflight.get(uid);
    if (existing) pending.add(existing);
    else newUids.push(uid);
  }

  if (newUids.length > 0) {
    const promise = (async (): Promise<FetchOutcome> => {
      try {
        await fetchRoles(newUids);
        return { failed: false };
      } catch (error) {
        if (!warned) {
          warned = true;
          // eslint-disable-next-line no-console
          console.warn('[user-roles] 讀取使用者角色失敗，回退為預設角色', error);
        }
        return { failed: true, error };
      } finally {
        // L-08：成功與失敗兩條路徑都清除 inflight。
        for (const uid of newUids) inflight.delete(uid);
      }
    })();

    // 逐 UID 登記整個分批請求，包含尚未開始讀取的後續批次。
    // 前批寫入快取後，縮小的待查集合或重疊名單仍可共用未完成的請求。
    for (const uid of newUids) inflight.set(uid, promise);
    pending.add(promise);
  }

  const outcomes = await Promise.all(pending);
  return outcomes.find((outcome) => outcome.failed) ?? { failed: false };
}

/**
 * 依 UID 取角色。查不到的 UID 回 'user'。
 * 讀取失敗時回傳目前快取＋其餘 'user'，永不 reject。
 */
export async function loadUserRoles(
  uids: readonly string[],
  // 臨時取消確認框用：略過 5 分鐘快取重讀一次（剛記過點的人，快取裡的次數會舊）。
  options?: { force?: boolean },
): Promise<Record<string, UserRole>> {
  const normalized = normalizeUids(uids);
  const now = Date.now();
  const result: Record<string, UserRole> = {};
  const toFetch: string[] = [];

  for (const uid of normalized) {
    const cached = cache.get(uid);
    if (!options?.force && cached && cached.expiresAt > now) {
      result[uid] = cached.role;
    } else {
      toFetch.push(uid);
    }
  }

  if (toFetch.length === 0) return result;

  await startFetch(toFetch);

  // 成功批次已寫入 cache；失敗批次沿用舊值（可能 stale）或預設角色。
  for (const uid of toFetch) {
    result[uid] = cache.get(uid)?.role ?? DEFAULT_ROLE;
  }
  return result;
}

/**
 * 與 loadUserRoles 共用同一個快取及逐 UID inflight，沒有另一條 users 查詢。
 * 呼叫端傳入與 useUserRoles 相同的名單 UID，即使同時載入也只讀一次。
 * 任一批讀取失敗就 reject，保留成功批次快取；新鮮度同為 5 分鐘。
 */
export async function loadUserNoShowStats(
  uids: readonly string[],
): Promise<Record<string, UserNoShowStats>> {
  const normalized = normalizeUids(uids);
  const now = Date.now();
  const toFetch = normalized.filter((uid) => {
    const cached = cache.get(uid);
    return !cached || cached.expiresAt <= now;
  });
  if (toFetch.length > 0) {
    const outcome = await startFetch(toFetch);
    if (outcome.failed) throw outcome.error;
  }
  const result: Record<string, UserNoShowStats> = {};
  for (const uid of normalized) result[uid] = copyNoShowStats(cache.get(uid));
  return result;
}

function uidsKey(uids: readonly string[]): string {
  return normalizeUids(uids).sort().join('\n');
}

/** UID 或 refreshKey 改變時重驗快取；沿用 TTL／inflight，卸載後不 setState。 */
export function useUserRoles(
  uids: readonly string[],
  refreshKey?: boolean,
): Record<string, UserRole> {
  const [roles, setRoles] = useState<Record<string, UserRole>>({});
  const key = uidsKey(uids);

  useEffect(() => {
    let cancelled = false;
    // 名單啟用狀態改變也重驗快取，避免 UID 未變但統計已過期；一般重繪不重查。
    async function refresh(): Promise<void> {
      try {
        const next = await loadUserRoles(uids);
        if (cancelled) return;
        setRoles(next);
      } catch {
        // loadUserRoles 內部已處理錯誤；此處僅作為安全網。
      }
    }
    void refresh();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey]);

  return roles;
}

/** 測試用：清空快取、inflight 與 warn 狀態。 */
export function _resetUserRolesCacheForTest(): void {
  cache.clear();
  inflight.clear();
  warned = false;
}
