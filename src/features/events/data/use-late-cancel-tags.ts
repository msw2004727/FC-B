/**
 * 名單臨時取消標籤（FC 契約 late-cancel-contract §8）。
 * users 的 5 欄已由 useUserRoles 同批讀進快取（零額外讀）；只對「黑標且還沒到解除時間」的人
 * 另讀 userAttendanceStats/{uid}.attendedCount（documentId in，每 30 個一塊），缺文件或缺欄位當 0。
 * 讀取失敗：不新增黑標（壞資料不罰人）；上一次已驗證的黑標沿用，紅標照畫。
 */
import { useEffect, useState } from 'preact/hooks';
import { getFirebase } from '@/data/firebase';
import { getCachedUserLateCancel, loadUserRoles, type UserLateCancelInfo } from '@/data/user-roles';
import { lateCancelTagState, needsLateCancelAttendance, type LateCancelTag } from './late-cancel';

const MAX_UIDS_PER_QUERY = 30;
const CACHE_TTL_MS = 5 * 60 * 1000;
const attendedCache = new Map<string, { count: number; expiresAt: number }>();

/** 依 UID 共用進行中的請求（成功、失敗都會清掉），避免名單重繪時重複讀。 */
const inflight = new Map<string, Promise<Map<string, number>>>();

async function fetchAttendedCounts(uids: readonly string[]): Promise<Map<string, number>> {
  const [{ collection, documentId, getDocs, query, where }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const result = new Map<string, number>();
  for (let i = 0; i < uids.length; i += MAX_UIDS_PER_QUERY) {
    const batch = uids.slice(i, i + MAX_UIDS_PER_QUERY);
    const snapshot = await getDocs(query(collection(db, 'userAttendanceStats'), where(documentId(), 'in', batch)));
    const counts = new Map<string, number>();
    for (const docSnap of snapshot.docs) {
      const raw = Number((docSnap.data() as Record<string, unknown> | undefined)?.attendedCount);
      counts.set(docSnap.id, Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0);
    }
    const expiresAt = Date.now() + CACHE_TTL_MS;
    for (const uid of batch) {
      const count = counts.get(uid) ?? 0;
      attendedCache.set(uid, { count, expiresAt });
      result.set(uid, count);
    }
  }
  return result;
}

/** 只讀傳入 UID 的 attendedCount；5 分鐘內讀過的不重讀、讀取中的共用同一個請求。任一塊失敗即 reject。 */
export async function loadAttendedCounts(uids: readonly string[]): Promise<Map<string, number>> {
  const now = Date.now();
  const result = new Map<string, number>();
  const toFetch: string[] = [];
  const pending = new Set<Promise<Map<string, number>>>();
  for (const uid of new Set(uids.map(item => item.trim()).filter(Boolean))) {
    const cached = attendedCache.get(uid);
    if (cached && cached.expiresAt > now) result.set(uid, cached.count);
    else if (inflight.has(uid)) pending.add(inflight.get(uid) as Promise<Map<string, number>>);
    else toFetch.push(uid);
  }
  if (toFetch.length > 0) {
    const request = fetchAttendedCounts(toFetch);
    for (const uid of toFetch) inflight.set(uid, request);
    const clear = (): void => {
      for (const uid of toFetch) if (inflight.get(uid) === request) inflight.delete(uid);
    };
    request.then(clear, clear);
    pending.add(request);
  }
  for (const counts of await Promise.all(pending)) {
    for (const [uid, count] of counts) result.set(uid, count);
  }
  return result;
}

function sameTags(a: Readonly<Record<string, LateCancelTag>>, b: Readonly<Record<string, LateCancelTag>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

/**
 * refreshKey：useUserRoles 回傳的物件（角色讀完才換新），讓快取裡的 5 欄到齊後重算。
 * 只回有標籤的 UID。
 */
export function useLateCancelTags(
  uids: readonly string[],
  refreshKey: unknown,
): Readonly<Record<string, LateCancelTag>> {
  const [tags, setTags] = useState<Readonly<Record<string, LateCancelTag>>>({});
  const key = [...new Set(uids)].sort().join('\n');

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const next: Record<string, LateCancelTag> = {};
    const blackUids: string[] = [];
    for (const uid of key ? key.split('\n') : []) {
      const info = getCachedUserLateCancel(uid);
      if (info?.level === 'red') next[uid] = 'red';
      else if (needsLateCancelAttendance(info, now)) blackUids.push(uid);
    }
    // 新結果回來前，仍是黑標候選的人沿用上一份黑標，避免重繪時閃掉。
    setTags((prev) => {
      const merged = { ...next };
      for (const uid of blackUids) if (prev[uid] === 'black') merged[uid] = 'black';
      // 內容沒變就沿用同一個物件，不觸發重繪（refreshKey 每次都是新物件時才不會無限重算）。
      return sameTags(prev, merged) ? prev : merged;
    });
    async function addBlack(): Promise<void> {
      try {
        const counts = await loadAttendedCounts(blackUids);
        if (cancelled) return;
        const withBlack = { ...next };
        for (const uid of blackUids) {
          const tag = lateCancelTagState(getCachedUserLateCancel(uid), counts.get(uid) ?? 0, now);
          if (tag) withBlack[uid] = tag;
        }
        setTags(prev => (sameTags(prev, withBlack) ? prev : withBlack));
      } catch {
        // 讀不到出席場數：不新增黑標（不誤標）；上一次已驗證的黑標沿用，紅標已畫。
      }
    }
    if (blackUids.length > 0) void addBlack();
    return () => {
      cancelled = true;
    };
  }, [key, refreshKey]);

  return tags;
}

/**
 * 取消確認框用的操作者臨取欄位：一律重讀一次 users/{uid}（複審 P2-1：剛記過點時快取裡的次數是舊的，
 * 會把「第 3 次變紅標」寫成「7 天後恢復」）。呼叫端只在時限內且有可能記點的報名時才呼叫，平常不多讀。
 * 讀取失敗時 loadUserRoles 不 reject、沿用舊快取；都沒有回 undefined，呼叫端改寫中性文字。
 */
export async function loadLateCancelUser(uid: string): Promise<UserLateCancelInfo | undefined> {
  await loadUserRoles([uid], { force: true });
  return getCachedUserLateCancel(uid);
}

/** 測試用。 */
export function _resetLateCancelAttendedCacheForTest(): void {
  attendedCache.clear();
  inflight.clear();
}
