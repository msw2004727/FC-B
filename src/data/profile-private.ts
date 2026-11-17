// 會員資料讀取強化：私密子文件。過渡期根文件為準、私密文件為鏡像；讀取逐欄合併，失敗靜默退回根。

import type { DocumentReference, Firestore, WriteBatch } from 'firebase/firestore';
import { doc, getDoc, serverTimestamp } from 'firebase/firestore';

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

export async function loadPrivateProfile(uid: string): Promise<ProfilePrivateData | null> {
  try {
    const firebase = await getFirebase();
    const db = firebase.db as unknown as Firestore;
    const snap = await getDoc(profilePrivateDocRef(db, uid));
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, unknown>;
    const out: ProfilePrivateData = {};
    for (const field of PROFILE_PRIVATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        out[field] = data[field];
      }
    }
    return out;
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
