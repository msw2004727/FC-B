/**
 * `adminMessages` 讀寫（站內信管理後台）。對應 A：
 * - `js/firebase-service.js` 的 adminMessages 載入（A 是 `limit(200)` 不排序、整批進快取）
 * - `js/firebase-crud.js#addAdminMessage`／`#updateAdminMessage`
 * - `js/modules/message/message-admin.js#_claimScheduledMessageForSend`／`#_markScheduledMessageSent`／`#_releaseScheduledMessageClaim`
 * - `js/modules/message/message-admin-list.js#recallMsg`（刪自己信箱的副本）
 *
 * 讀取預算（顧問方案 W2-A，測試斷言在 admin-messages-repo.test.ts／AdminMessagesPage.test.tsx）：
 * - 進頁：`orderBy createdAt desc limit 50`（≤ 50）＋四個狀態 `count()`（4）＝ ≤ 54；「載入更多」每次 ≤ 50。
 * - 改狀態：0 讀 1 寫。排程檢查：`where status == 'scheduled'`（單欄位索引）limit 20。
 * - 不讀 `users` 全集合、不用 collectionGroup。Rules：`adminMessages` 讀寫＝isAdmin ∨ admin.messages.*（不改 Rules）。
 */

import type { QueryDocumentSnapshot } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { loadFirestoreSdk } from '@/data/firestore-sdk';
import { userInbox } from '@/data/paths';

import type { AdminMessage, MsgCounts } from './admin-message-model';

const COLLECTION = 'adminMessages';
export const ADMIN_MESSAGES_PAGE_SIZE = 50;
/** 每輪排程檢查最多處理的筆數（A 沒有上限；B 限制單輪讀取量）。 */
export const SCHEDULED_SCAN_LIMIT = 20;
/** 回收時找自己信箱副本的上限（A 從快取比對；B 用條件查詢）。 */
export const OWN_INBOX_COPY_LIMIT = 10;

export interface AdminMessagesPage {
  items: AdminMessage[];
  /** 下一頁游標（最後一份文件）；沒有更多時為 null。 */
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

function toAdminMessage(id: string, data: Record<string, unknown>): AdminMessage {
  return {
    ...data,
    _docId: id,
    id: String(data['id'] ?? id),
    title: String(data['title'] ?? ''),
    body: String(data['body'] ?? ''),
    status: String(data['status'] ?? ''),
  } as AdminMessage;
}

/** 依建立時間新到舊一次讀 50 份；`cursor` 是上一頁回傳的游標。 */
export async function loadAdminMessagesPage(cursor: QueryDocumentSnapshot | null = null): Promise<AdminMessagesPage> {
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  const base = fs.collection(db, COLLECTION);
  const q = cursor
    ? fs.query(base, fs.orderBy('createdAt', 'desc'), fs.startAfter(cursor), fs.limit(ADMIN_MESSAGES_PAGE_SIZE))
    : fs.query(base, fs.orderBy('createdAt', 'desc'), fs.limit(ADMIN_MESSAGES_PAGE_SIZE));
  const snap = await fs.getDocs(q);
  const items = snap.docs.map((d) => toAdminMessage(d.id, d.data() as Record<string, unknown>));
  const last = snap.docs[snap.docs.length - 1] ?? null;
  return {
    items,
    cursor: last,
    hasMore: snap.docs.length === ADMIN_MESSAGES_PAGE_SIZE,
  };
}

/** 計數列：四個 `count()` 聚合（各算 1 讀起跳），不整批讀文件。 */
export async function countAdminMessages(): Promise<MsgCounts> {
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  const base = fs.collection(db, COLLECTION);
  const countOf = async (q: ReturnType<typeof fs.query>): Promise<number> =>
    (await fs.getCountFromServer(q)).data().count;
  const [sent, scheduled, recalled, deleted] = await Promise.all([
    countOf(fs.query(base, fs.where('status', '==', 'sent'))),
    countOf(fs.query(base, fs.where('status', 'in', ['scheduled', 'processing']))),
    countOf(fs.query(base, fs.where('status', '==', 'recalled'))),
    countOf(fs.query(base, fs.where('status', '==', 'deleted'))),
  ]);
  return { sent, scheduled, recalled, deleted };
}

/**
 * A `addAdminMessage`：寫入並補 `createdAt`。
 * 與 A 差異：文件 ID 用紀錄自己的 `id`（A 用 add() 隨機 ID）；B 讀取一律帶 `_docId`，兩種文件可並存。
 */
export async function createAdminMessage(record: Omit<AdminMessage, '_docId'>): Promise<AdminMessage> {
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  await fs.setDoc(fs.doc(db, COLLECTION, record.id), { ...record, createdAt: fs.serverTimestamp() });
  return { ...record, _docId: record.id } as AdminMessage;
}

/** A `updateAdminMessage(id, { status })`：0 讀 1 寫。 */
export async function updateAdminMessageStatus(docId: string, status: string): Promise<void> {
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  await fs.updateDoc(fs.doc(db, COLLECTION, docId), { status });
}

/** 排程檢查：只讀 status == 'scheduled'（單欄位索引），到期與否由呼叫端判斷。 */
export async function loadScheduledAdminMessages(): Promise<AdminMessage[]> {
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  const snap = await fs.getDocs(
    fs.query(fs.collection(db, COLLECTION), fs.where('status', '==', 'scheduled'), fs.limit(SCHEDULED_SCAN_LIMIT)),
  );
  return snap.docs.map((d) => toAdminMessage(d.id, d.data() as Record<string, unknown>));
}

/**
 * A `_claimScheduledMessageForSend`：transaction 內確認仍是 scheduled 且已到期才改 processing。
 * `isDue` 由呼叫端提供（同一份到期判斷）。
 */
export async function claimScheduledMessage(
  docId: string,
  processorId: string,
  isDue: (data: Record<string, unknown>) => boolean,
): Promise<boolean> {
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  const ref = fs.doc(db, COLLECTION, docId);
  let claimed = false;
  await fs.runTransaction(db, async (tx) => {
    claimed = false;
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    if (data['status'] !== 'scheduled' || !isDue(data)) return;
    tx.update(ref, {
      status: 'processing',
      processingBy: processorId,
      processingAt: fs.serverTimestamp(),
    });
    claimed = true;
  });
  return claimed;
}

/** A `_markScheduledMessageSent`。 */
export async function markScheduledMessageSent(docId: string): Promise<void> {
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  await fs.updateDoc(fs.doc(db, COLLECTION, docId), {
    status: 'sent',
    sentAt: fs.serverTimestamp(),
    processingAt: fs.deleteField(),
    processingBy: fs.deleteField(),
    lastError: fs.deleteField(),
  });
}

/** A `_releaseScheduledMessageClaim`：退回 scheduled 並記錄錯誤（下一輪再試）。 */
export async function releaseScheduledMessageClaim(docId: string, err: unknown): Promise<void> {
  const message = err instanceof Error && err.message ? err.message : '';
  const errorText = message ? message.slice(0, 300) : 'schedule_send_failed';
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  await fs.updateDoc(fs.doc(db, COLLECTION, docId), {
    status: 'scheduled',
    lastError: errorText,
    processingAt: fs.deleteField(),
    processingBy: fs.deleteField(),
  });
}

/**
 * A `recallMsg` 的後半：刪除「自己」信箱裡這封信的副本（A 只刪自己的，收件人副本不動）。
 * 以 `adminMsgId` 條件查詢（≤ 10 讀），回傳刪除筆數；失敗不往外拋（A 同樣只 warn）。
 */
export async function removeOwnInboxCopies(uid: string, adminMsgId: string): Promise<number> {
  if (!uid || !adminMsgId) return 0;
  try {
    const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
    const snap = await fs.getDocs(
      fs.query(fs.collection(db, userInbox(uid)), fs.where('adminMsgId', '==', adminMsgId), fs.limit(OWN_INBOX_COPY_LIMIT)),
    );
    const results = await Promise.allSettled(snap.docs.map((d) => fs.deleteDoc(d.ref)));
    let removed = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') removed += 1;
      // eslint-disable-next-line no-console
      else console.warn('[recallMsg] inbox delete:', r.reason);
    }
    return removed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[recallMsg] inbox lookup:', err);
    return 0;
  }
}
