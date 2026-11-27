// 會員資料讀取強化：私密子文件。過渡期根文件為準、私密文件為鏡像；讀取逐欄合併，失敗靜默退回根。

import type { DocumentReference, Firestore, WriteBatch } from 'firebase/firestore';
import { doc, getDoc, getDocFromCache, serverTimestamp } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { users } from '@/data/paths';

export const PROFILE_PRIVATE_COLLECTION = 'profilePrivate';
export const PROFILE_PRIVATE_DOC_ID = 'profile';
export const PROFILE_PRIVATE_FIELDS = ['phone', 'email', 'companions', 'eduChildren'] as const;

export type ProfilePrivateField = (typeof PROFILE_PRIVATE_FIELDS)[number];
export type ProfilePrivateData = Partial<Record<ProfilePrivateField, unknown>>;

function assertPrivateUid(uid: string): string {
  const safe = String(uid || '').trim();
  if (!safe || safe.includes('/')) {
    throw new Error('[profile-private] invalid uid');
  }
  return safe;
}

export function profilePrivateDocRef(
  db: Firestore,
  uid: string,
): DocumentReference {
  const safe = assertPrivateUid(uid);
  return doc(
    db,
    users,
    safe,
    PROFILE_PRIVATE_COLLECTION,
    PROFILE_PRIVATE_DOC_ID,
  );
}

function pickPrivateFields(data: Record<string, unknown>): ProfilePrivateData {
  const out: ProfilePrivateData = {};
  for (const field of PROFILE_PRIVATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      out[field] = data[field];
    }
  }
  return out;
}

/**
 * 嚴格版：文件不存在回 null；其他錯誤（斷線、逾時、權限）一律拋出。
 * 本人頁用它，讓畫面走既有的載入失敗＋重試，不拿根文件的過期值當編輯底稿（同行者是整份覆寫，頂替會蓋掉資料）。
 */
export async function loadPrivateProfileStrict(uid: string): Promise<ProfilePrivateData | null> {
  const firebase = await getFirebase();
  const db = firebase.db as unknown as Firestore;
  const snap = await getDoc(profilePrivateDocRef(db, uid));
  if (!snap.exists()) return null;
  return pickPrivateFields(snap.data() as Record<string, unknown>);
}

/** 只讀本機持久化快取（不連伺服器）。hit=false：快取沒有這份文件的紀錄（或任何錯誤）；hit=true 且 data=null：快取記得文件不存在。 */
export async function loadPrivateProfileFromCache(
  uid: string,
): Promise<{ hit: boolean; data: ProfilePrivateData | null }> {
  try {
    const firebase = await getFirebase();
    const db = firebase.db as unknown as Firestore;
    const snap = await getDocFromCache(profilePrivateDocRef(db, uid));
    if (!snap.exists()) return { hit: true, data: null };
    return { hit: true, data: pickPrivateFields(snap.data() as Record<string, unknown>) };
  } catch (err) {
    const code = (err as { code?: string } | null | undefined)?.code ?? 'unknown';
    // PROFILE-SPEED：快取沒有是常態，除錯用一行且不印 uid。
    // eslint-disable-next-line no-console
    console.debug('[profile-private] cache read skipped', code);
    return { hit: false, data: null };
  }
}

/** 靜默版：任何錯誤回 null。只給唯讀、不得擋流程的地方用（他人名片、報名同行者清單）。 */
export async function loadPrivateProfile(uid: string): Promise<ProfilePrivateData | null> {
  try {
    return await loadPrivateProfileStrict(uid);
  } catch (err) {
    const code = (err as { code?: string } | null | undefined)?.code ?? 'unknown';
    // eslint-disable-next-line no-console
    console.debug('[profile-private] read skipped', code);
    return null;
  }
}

export function mergePrivateFields<T extends Record<string, unknown>>(
  root: T,
  priv: ProfilePrivateData | null,
): T {
  if (!priv) return { ...root };
  const out: Record<string, unknown> = { ...root };
  for (const field of PROFILE_PRIVATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(priv, field)) {
      out[field] = priv[field];
    }
  }
  return out as T;
}

export function pickPrivatePatch(patch: Record<string, unknown>): ProfilePrivateData {
  const out: ProfilePrivateData = {};
  for (const field of PROFILE_PRIVATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      const value = patch[field];
      out[field] = value === undefined ? null : value;
    }
  }
  return out;
}

export function addPrivateWrite(
  batch: WriteBatch,
  db: Firestore,
  uid: string,
  privatePatch: ProfilePrivateData,
): void {
  if (Object.keys(privatePatch).length === 0) return;
  batch.set(
    profilePrivateDocRef(db, uid),
    { ...privatePatch, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
