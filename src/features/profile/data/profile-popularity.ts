/**
 * 讀 `profilePopularity/{uid}` 的 `views`。做法對齊 attendance-summary：
 * `getFirebase()`（SDK 在那裡動態載入，並帶持久化離線快取）＋單次 `getDoc`。
 * 進行中的同一 UID 只讀一次；完成即移除，不是長期快取。
 * 讀取失敗（含後端尚未部署的 permission-denied）靜默回 null，不 toast、不 throw。
 */
import type { Firestore } from 'firebase/firestore';
import { doc, getDoc } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';

export const PROFILE_POPULARITY_COLLECTION = 'profilePopularity' as const;

interface DirectSnapLike {
  exists: () => boolean;
  data: () => unknown;
}

const inflight = new Map<string, Promise<number | null>>();

/** 文件存在且 views 為有限非負數才取整；否則（欄位非法）回 null，畫面維持現況。 */
function viewsFromDoc(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const views = (data as Record<string, unknown>)['views'];
  if (typeof views !== 'number' || !Number.isFinite(views) || views < 0) return null;
  return Math.trunc(views);
}

async function fetchProfilePopularityViews(targetUid: string): Promise<number | null> {
  try {
    const { db } = await getFirebase();
    const firestore = db as unknown as Firestore;
    const snap = (await getDoc(
      doc(firestore, PROFILE_POPULARITY_COLLECTION, targetUid),
    )) as unknown as DirectSnapLike;
    if (!snap.exists()) return 0;
    return viewsFromDoc(snap.data());
  } catch {
    // 後端規則還沒部署時會 permission-denied。靜默，不 toast、不 throw。
    return null;
  }
}

/**
 * 看自己的人氣瀏覽人數。
 * 文件存在且 `views` 為有限非負數 → 取整；文件不存在（讀取成功）→ 0；任何讀取失敗 → null。
 */
export function loadProfilePopularityViews(uid: string): Promise<number | null> {
  const targetUid = String(uid || '').trim();
  if (!targetUid || targetUid.includes('/')) return Promise.resolve(null);

  const pending = inflight.get(targetUid);
  if (pending) return pending;
  const request = fetchProfilePopularityViews(targetUid).finally(() => {
    if (inflight.get(targetUid) === request) inflight.delete(targetUid);
  });
  inflight.set(targetUid, request);
  return request;
}
