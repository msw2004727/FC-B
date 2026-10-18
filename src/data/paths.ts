// Firestore 路徑的 canonical 表示。
//
// - 一律回傳「不含開頭斜線」的路徑字串（避免 `/events/x` vs `events/x` 兩套）。
// - `isSubcollectionDoc` / `filterSubcollectionDocs` 為 R-REG-014 的前端 predicate：
//   collectionGroup 查詢結果一律先過濾，以排除 legacy root 文件。
//   回傳陣列，不偽裝成 QuerySnapshot。

import { getFirebase } from './firebase';

// ── 集合常數 ──────────────────────────────────────────

export const events = 'events' as const;
export const users = 'users' as const;
export const teams = 'teams' as const;

// ── 路徑函式 ──────────────────────────────────────────

export function eventDoc(eventDocId: string): string {
  return `events/${eventDocId}`;
}

export function registrations(eventDocId: string): string {
  return `events/${eventDocId}/registrations`;
}

export function attendanceRecords(eventDocId: string): string {
  return `events/${eventDocId}/attendanceRecords`;
}

export function activityRecords(eventDocId: string): string {
  return `events/${eventDocId}/activityRecords`;
}

export function userInbox(uid: string): string {
  return `users/${uid}/inbox`;
}

export function coursePlans(teamId: string): string {
  return `teams/${teamId}/coursePlans`;
}

export function coursePlanSessions(teamId: string, planId: string): string {
  return `teams/${teamId}/coursePlans/${planId}/sessions`;
}

export function coursePlanEnrollments(teamId: string, planId: string): string {
  return `teams/${teamId}/coursePlans/${planId}/enrollments`;
}

// ── subcollection predicate（R-REG-014） ──────────────

interface DocRefLike {
  parent: { parent: unknown | null };
}

/**
 * 只有真正位於子集合底下的文件才會 `ref.parent.parent !== null`。
 * collectionGroup 查詢會同時命中 root 與子集合，使用本 predicate 排除 root 文件。
 */
export function isSubcollectionDoc(ref: DocRefLike): boolean {
  return ref.parent.parent !== null;
}

/**
 * 過濾出真正位於子集合的 Snapshot（排除 legacy root）。
 * 注意：回傳型別為一般陣列，不是 QuerySnapshot——呼叫端不得假設它具有 `forEach` / `docs` 等 API。
 */
export function filterSubcollectionDocs<T extends { ref: DocRefLike }>(docs: T[]): T[] {
  return docs.filter((d) => isSubcollectionDoc(d.ref));
}

// ── 解析 public eventId → Firestore docId（R-ID-010） ──

/**
 * 依 public eventId 解析 `events/{docId}`：
 *  1. 若 `events/{eventId}` 存在，回傳 `eventId`。
 *  2. 否則以 `where('id', '==', eventId)` 取第一筆 doc id。
 *  3. 都沒有回 `null`。
 */
export async function resolveEventDocId(eventId: string): Promise<string | null> {
  const [{ doc, getDoc, collection, query, where, limit, getDocs }, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);

  const directRef = doc(ctx.db, events, eventId);
  const directSnap = await getDoc(directRef);
  if (directSnap.exists()) return eventId;

  const q = query(collection(ctx.db, events), where('id', '==', eventId), limit(1));
  const result = await getDocs(q);
  const first = result.docs[0];
  if (!first) return null;
  return first.id;
}
