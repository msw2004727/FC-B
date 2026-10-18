/**
 * 活動詳情與報名名單的讀取層。
 *
 * 契約重點：
 *  - R-ID-010：先 `resolveEventDocId(publicId)` 取得 Firestore docId，子集合一律以 docId 為父路徑。
 *  - `id`（public eventId）與 `_docId`（Firestore docId）可能不同（R-ID-008 舊資料），
 *    本層同時回傳兩者，顯示與比對用 `event.id`，路徑用 `eventDocId`。
 *  - 只讀 `events/{docId}` 與 `events/{docId}/registrations`；不做 collectionGroup、不 fallback root。
 */

import { getFirebase } from '@/data/firebase';
import { eventDoc, registrations, resolveEventDocId } from '@/data/paths';

import type { EventDoc, RegistrationDoc } from './types';

export interface LoadedEventDetail {
  /** Firestore 文件內容；`_docId` 已補上實際 docId。 */
  event: EventDoc;
  /** Firestore 實際 docId（子集合父路徑用）。 */
  eventDocId: string;
}

/**
 * 依 public eventId 載入活動詳情。
 *
 * @returns `null` 表示 publicId 無法解析、或 docId 對應文件不存在。
 */
export async function loadEventDetail(publicId: string): Promise<LoadedEventDetail | null> {
  const resolved = await resolveEventDocId(publicId);
  if (resolved === null) return null;

  const [{ doc, getDoc }, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);

  const snap = await getDoc(doc(ctx.db, eventDoc(resolved)));
  if (!snap.exists()) return null;

  const data = snap.data() as EventDoc;
  return {
    event: { ...data, _docId: resolved },
    eventDocId: resolved,
  };
}

/**
 * 讀取 `events/{docId}/registrations` 子集合。
 *
 * 只讀子集合，不做 root fallback（R-REG-014）。
 */
export async function loadEventRegistrations(eventDocId: string): Promise<RegistrationDoc[]> {
  const [{ collection, getDocs, query }, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);

  const snap = await getDocs(query(collection(ctx.db, registrations(eventDocId))));
  const out: RegistrationDoc[] = [];
  snap.forEach((child) => {
    const data = child.data() as RegistrationDoc;
    out.push({ ...data, _docId: child.id });
  });
  return out;
}
