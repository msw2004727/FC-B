/**
 * QR 簽到頁的唯讀資料：可簽到活動、活動報名、掃到的使用者。
 *
 * - 活動沿用 events-repo（有筆數上限），不另外讀整個 events 集合。
 * - 報名只讀 `events/{docId}/registrations`（R-REG-014、R-ID-010），沿用 event-detail。
 * - 寫入一律經 attendance.ts。
 */

import { getFirebase } from '@/data/firebase';
import { users } from '@/data/paths';
import { loadEventRegistrations } from '@/features/events/data/event-detail';
import { getEventsRepo } from '@/features/events/data/events-repo';
import type { EventDoc } from '@/features/events/data/types';

import type { ScanRegistration } from './attendance';

/** 進行中活動＋最近結束的預覽批（對應 A 掃碼頁讀 ApiService.getEvents() 的快取範圍）。 */
export async function loadScanEventDocuments(): Promise<EventDoc[]> {
  const repo = getEventsRepo();
  await repo.loadEventsStatic({ terminalMode: 'preview' });
  const { active, terminal } = repo.getSnapshot();
  return [...active, ...terminal];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** `eventDocId` 為 Firestore docId，不是 public id。 */
export async function loadScanRegistrations(eventDocId: string): Promise<ScanRegistration[]> {
  const docs = await loadEventRegistrations(eventDocId);
  return docs.map((doc) => {
    const raw = doc as Record<string, unknown>;
    return {
      userId: doc.userId,
      uid: doc.uid,
      userName: optionalString(raw.userName),
      status: doc.status,
      companionId: optionalString(raw.companionId) ?? null,
      companionName: optionalString(raw.companionName) ?? null,
    };
  });
}

export interface ScanUser {
  uid: string;
  name: string;
}

/**
 * 對應 A `_findUserByUid`：先以 uid 找使用者（R-ID-002，不以名稱比對）；
 * 找不到時，只允許掃到的是操作者自己的 lineUserId（A 的 currentUser fallback）。
 */
export async function findScanUser(uid: string, operatorUid: string): Promise<ScanUser | null> {
  if (!uid || uid.includes('/')) return null;

  const [{ doc, getDoc }, firebase] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);

  // 名稱優先序照 A：使用者清單用 name，currentUser fallback 用 displayName。
  const pick = (value: Record<string, unknown>, first: string, second: string): string | undefined =>
    optionalString(value[first]) || optionalString(value[second]) || undefined;

  const target = await getDoc(doc(firebase.db, users, uid));
  if (target.exists()) {
    return { uid: target.id, name: pick(target.data(), 'name', 'displayName') ?? target.id };
  }
  if (!operatorUid || operatorUid === uid) return null;

  const current = await getDoc(doc(firebase.db, users, operatorUid));
  if (!current.exists() || current.data().lineUserId !== uid) return null;
  return { uid: current.id, name: pick(current.data(), 'displayName', 'name') ?? current.id };
}
