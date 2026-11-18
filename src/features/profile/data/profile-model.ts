// 個人頁資料模型。
//
// 資料來源：A `_mapUserProfileDoc` / `_fetchUserProfileByUid`。
// - 只以 UID 查詢使用者（R-ID-002）；不移植 A 的 `_fetchUserProfileByName`。
// - 讀取結果為「讀模型」，B 寫入走 profile-writes 的動作型 payload（L-31／L-32）。

import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { users } from '@/data/paths';

/**
 * 個人頁讀模型：由 A `_mapUserProfileDoc` 落下的正規化結果。
 * 保留原始文件其餘欄位（僅供讀取）。
 */
export interface UserProfile {
  [field: string]: unknown;
  uid: string;
  name: string;
  _docId: string;
  lastActive: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * 對應 A `_mapUserProfileDoc`（a-profile-sources.js）。
 * A 會先呼叫 `FirebaseService._mapUserDoc`，B 沒有該擴充點，直接照 fallback 實作：
 *   name       = displayName || name || 'Unknown'
 *   uid        = uid || lineUserId || docId
 *   lastActive = lastLogin || lastActive || null
 *   _docId     = docId
 */
export function mapUserProfileDoc(
  data: Record<string, unknown> | null | undefined,
  docId: string,
): UserProfile | null {
  if (!data) return null;
  const displayName = asString(data['displayName']);
  const dataName = asString(data['name']);
  const dataUid = asString(data['uid']);
  const dataLineUserId = asString(data['lineUserId']);
  const lastLogin = data['lastLogin'];
  const lastActive = data['lastActive'];

  return {
    ...data,
    name: displayName || dataName || 'Unknown',
    uid: dataUid || dataLineUserId || docId,
    lastActive: lastLogin || lastActive || null,
    _docId: docId,
  };
}

interface DirectSnapLike {
  exists: () => boolean;
  id: string;
  data: () => unknown;
}

interface QuerySnapLike {
  docs: DirectSnapLike[];
}

/**
 * 對應 A `_fetchUserProfileByUid`：
 *  1. 直接以 doc id = uid 讀取。
 *  2. 若無，再以 `uid` / `lineUserId` 欄位精確比對（仍為 UID 查詢，符合 R-ID-002）。
 *  3. 皆失敗回 null（不 fallback 到名稱查詢）。
 */
export async function loadUserProfile(uid: string): Promise<UserProfile | null> {
  const safeUid = String(uid || '').trim();
  if (!safeUid) return null;

  const firebase = await getFirebase();
  const db = firebase.db as unknown as Firestore;

  try {
    const snap = (await getDoc(doc(db, users, safeUid))) as unknown as DirectSnapLike;
    if (snap.exists()) {
      return mapUserProfileDoc(snap.data() as Record<string, unknown>, snap.id || safeUid);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[profile-model] direct fetch failed', err);
  }

  for (const field of ['uid', 'lineUserId'] as const) {
    try {
      const q = query(collection(db, users), where(field, '==', safeUid), limit(1));
      const snap = (await getDocs(q)) as unknown as QuerySnapLike;
      const first = snap.docs[0];
      if (first && first.exists()) {
        return mapUserProfileDoc(
          first.data() as Record<string, unknown>,
          first.id,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[profile-model] query by ${field} failed`, err);
    }
  }

  return null;
}
