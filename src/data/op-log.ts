// 操作日誌（對應 A `ApiService._writeOpLog`＋`FirebaseService.addOperationLog`）。
//
// - 一次性寫 `operationLogs/{op_時間_6碼亂數}`，欄位照 A：actorUid／time／operator／type／typeName／
//   content／eventId?；另加 `createdAt: serverTimestamp()`（B 明確契約）。
// - `set(..., { merge: true })`；失敗只記錄、不往外拋（A 為 fire-and-forget）。
// - Rules 要求 `actorUid` 是自己；呼叫端負責填入目前登入者 uid。

import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { taipeiParts } from '@/core/taipei-time';
import { getFirebase } from '@/data/firebase';

const OPERATION_LOGS_COLLECTION = 'operationLogs' as const;

/** A `_writeOpLog` 的時間字串：`MM/DD HH:mm`（台北牆鐘）。 */
export function opLogTimeString(date: Date): string {
  // helper 沒有 MM/DD HH:mm，用 taipeiParts 組成。取代 getMonth／getHours，避免非 UTC+8 寫出偏移的 time。
  const parts = taipeiParts(date.getTime());
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  const hh = String(parts.hour).padStart(2, '0');
  const mi = String(parts.minute).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

/** A `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`。 */
function generateOpLogDocId(now: Date): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `op_${now.getTime()}_${suffix}`;
}

export interface WriteOpLogInput {
  type: string;
  typeName: string;
  content: string;
  /** A 只在有值時才寫入 eventId。 */
  eventId?: string;
  /** Rules 要求 `actorUid` 是自己；未登入時為 null。 */
  actorUid: string | null;
  /** 顯示名稱 → 角色中文名 → '系統'（由呼叫端組裝）。 */
  operator: string;
  /** 測試注入；預設 `new Date()`。 */
  now?: Date;
}

export async function writeOpLog(input: WriteOpLogInput): Promise<void> {
  const now = input.now ?? new Date();
  const docId = generateOpLogDocId(now);

  const payload: Record<string, unknown> = {
    actorUid: input.actorUid,
    time: opLogTimeString(now),
    operator: input.operator,
    type: input.type,
    typeName: input.typeName,
    content: input.content,
    createdAt: serverTimestamp(),
  };
  if (input.eventId) payload.eventId = input.eventId;

  try {
    const { db } = await getFirebase();
    await setDoc(doc(db, OPERATION_LOGS_COLLECTION, docId), payload, { merge: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[opLog]', err);
  }
}
