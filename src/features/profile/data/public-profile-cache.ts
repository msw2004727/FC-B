import { collection, getDocs } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import type { CustomRoleInput } from '@/ui/drawer-menu';

import { loadUserStats, type UserStatsSnapshot } from './activity-records';
import { loadUserAttendanceSummary, type UserAttendanceSummary } from './attendance-summary';

/**
 * 11-06 他人公開個人頁（名片型）：同一工作階段內，同一 uid 幾分鐘內不重讀。
 * - 三格統計（userAttendanceStats 1 次讀取）開頁自動讀；活動明細（loadUserStats）點開才讀。
 * - 只存記憶體（不進 localStorage）；重新整理鈕用 force 強制重讀。
 * - 讀取失敗不寫快取，下次照常重讀。
 */
export const PUBLIC_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

interface Entry<T> {
  value: T;
  at: number;
}

const summaryCache = new Map<string, Entry<UserAttendanceSummary>>();
const statsCache = new Map<string, Entry<UserStatsSnapshot>>();

function fresh<T>(map: Map<string, Entry<T>>, uid: string): T | null {
  const hit = map.get(uid);
  if (!hit) return null;
  if (Date.now() - hit.at >= PUBLIC_PROFILE_CACHE_TTL_MS) {
    map.delete(uid);
    return null;
  }
  return hit.value;
}

/** 快取中的三格統計（同步讀，給第一次 render 用；過期回 null）。 */
export function peekPublicSummary(uid: string): UserAttendanceSummary | null {
  return fresh(summaryCache, uid);
}

/** 快取中的活動明細（同步讀；過期回 null）。 */
export function peekPublicStats(uid: string): UserStatsSnapshot | null {
  return fresh(statsCache, uid);
}

export async function getPublicSummary(
  uid: string,
  options: { force?: boolean } = {},
): Promise<UserAttendanceSummary | null> {
  if (!options.force) {
    const hit = fresh(summaryCache, uid);
    if (hit) return hit;
  }
  const value = await loadUserAttendanceSummary(uid, options.force ? { fresh: true } : {});
  if (value) summaryCache.set(uid, { value, at: Date.now() });
  return value;
}

export async function getPublicStats(
  uid: string,
  options: { force?: boolean } = {},
): Promise<UserStatsSnapshot> {
  if (!options.force) {
    const hit = fresh(statsCache, uid);
    if (hit) return hit;
  }
  const value = await loadUserStats(uid);
  statsCache.set(uid, { value, at: Date.now() });
  return value;
}

// 自訂角色（照 A `ROLES` Proxy → getRuntimeRoleInfo）：只有對方角色不是內建角色時才讀，整個工作階段讀一次。
let customRolesPromise: Promise<CustomRoleInput[]> | null = null;

export function loadCustomRolesCached(): Promise<CustomRoleInput[]> {
  if (customRolesPromise) return customRolesPromise;
  const request = (async (): Promise<CustomRoleInput[]> => {
    const { db } = await getFirebase();
    const snap = await getDocs(collection(db, 'customRoles'));
    const roles: CustomRoleInput[] = [];
    for (const docSnap of snap.docs) {
      const data = (docSnap.data() as Record<string, unknown> | undefined) ?? {};
      const rawKey = data['key'] ?? data['roleKey'] ?? docSnap.id;
      const key = typeof rawKey === 'string' ? rawKey.trim() : '';
      if (!key) continue;
      roles.push({
        key,
        label: typeof data['label'] === 'string' ? data['label'] : undefined,
        color: typeof data['color'] === 'string' ? data['color'] : undefined,
        afterRole: typeof data['afterRole'] === 'string' ? data['afterRole'] : undefined,
      });
    }
    return roles;
  })().catch((err: unknown) => {
    // 失敗不留快取，下次再試；這次退回內建角色顯示。
    customRolesPromise = null;
    // eslint-disable-next-line no-console
    console.warn('[public-profile] customRoles load failed', err);
    return [];
  });
  customRolesPromise = request;
  return request;
}

/** 測試用。 */
export function _resetPublicProfileCacheForTest(): void {
  summaryCache.clear();
  statsCache.clear();
  customRolesPromise = null;
}
