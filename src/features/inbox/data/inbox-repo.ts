// 收件匣資料層。
//
// 對應 A `js/modules/message/message-inbox.js` / `message-render.js` /
// `message-actions.js` / `js/firebase-crud.js` 中讀取／已讀／刪除的邏輯。
//
// 路徑：`users/{uid}/inbox/{msgId}`（由 `@/data/paths` 的 `userInbox(uid)` 提供）。
// Rules 僅允許本人讀、更新 `read`/`readAt`、刪除；本層不得寫其他欄位。
// Firestore 一律動態 import；訂閱回傳 unsubscribe；錯誤往外拋，不吞。

import { getFirebase } from '@/data/firebase';
import { userInbox } from '@/data/paths';

export interface InboxMessage {
  id: string;
  _docId?: string;
  type?: string;
  typeName?: string;
  title?: string;
  preview?: string;
  body?: string;
  time?: string;
  read?: boolean;
  unread?: boolean;
  readBy?: string[];
  hiddenBy?: string[];
  senderName?: string;
  actionType?: string;
  actionStatus?: string;
  meta?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export type InboxUnsubscribe = () => void;

/** 批次上限（Firestore 每次 batch 至多 500 次寫入）。 */
const BATCH_LIMIT = 500;

/** 清空訊息分批上限（照 A `clearAllMessages`：每次 450 筆）。 */
const CLEAR_CHUNK = 450;

// ── 純函式 ─────────────────────────────────────────

/**
 * 照 A `_isMessageUnread`：
 *   1. `read` 為 boolean → `!read`（per-user inbox，現行格式）。
 *   2. `readBy` 為陣列 → 不包含本人 uid 為未讀（legacy）。
 *   3. 否則視 `unread` 是否為真。
 */
export function isUnread(msg: InboxMessage | null | undefined, uid?: string): boolean {
  if (!msg) return false;
  if (typeof msg.read === 'boolean') return !msg.read;
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) return false;
  if (Array.isArray(msg.readBy)) return !msg.readBy.includes(safeUid);
  return !!msg.unread;
}

/** 計算目前未讀訊息數（照 A `updateNotifBadge` 的 `_isMessageUnread` 過濾）。 */
export function countUnread(messages: InboxMessage[], uid?: string): number {
  if (!Array.isArray(messages)) return 0;
  return messages.filter((m) => isUnread(m, uid)).length;
}

/**
 * 分類：`type` 為分類鍵；`'all'`（或空字串）不過濾。
 * 照 A `renderMessageList` 的 `f === 'all' ? allMessages : allMessages.filter(m => m.type === f)`。
 */
export function filterByType(messages: InboxMessage[], type: string): InboxMessage[] {
  const arr = Array.isArray(messages) ? messages : [];
  const key = String(type ?? '').trim();
  if (!key || key === 'all') return arr;
  return arr.filter((m) => m.type === key);
}

/**
 * 排序：`time` 字串（`YYYY/MM/DD HH:MM`）降冪。
 * 照 A `renderMessageList`：`(b.time || '').localeCompare(a.time || '')`。
 */
export function sortByTimeDesc(messages: InboxMessage[]): InboxMessage[] {
  return [...(Array.isArray(messages) ? messages : [])].sort((a, b) => {
    const ta = a.time || '';
    const tb = b.time || '';
    return tb.localeCompare(ta);
  });
}

/** 分類＋排序；對應 A 收件匣畫面「先篩分類、再依 time 降冪」的雙步驟。 */
export function applyInboxView(
  messages: InboxMessage[],
  type: string,
): InboxMessage[] {
  return sortByTimeDesc(filterByType(messages, type));
}

/** 照 A `_isPendingActionMessage`：`actionType` 存在且 `actionStatus === 'pending'`。 */
export function isPendingActionMessage(msg: InboxMessage | null | undefined): boolean {
  if (!msg) return false;
  if (!msg.actionType) return false;
  return String(msg.actionStatus ?? '').trim().toLowerCase() === 'pending';
}

/** Firestore 文件 → 正規化訊息（補上 `_docId` 與 `id`）。 */
export function normalizeInboxMessage(
  docId: string,
  data: Record<string, unknown>,
): InboxMessage {
  const safeDocId = String(docId ?? '');
  const dataAny = (data ?? {}) as InboxMessage;
  return {
    ...dataAny,
    _docId: safeDocId,
    id: typeof dataAny.id === 'string' && dataAny.id ? dataAny.id : safeDocId,
  };
}

// ── 訂閱 ───────────────────────────────────────────

/**
 * 訂閱本人收件匣。
 * 照 A：不依賴查詢排序，仍以 `sortByTimeDesc` 於觸發時排序（等價於 A 於
 * `renderMessageList` 內的 client-side 排序）。
 */
export function subscribeInbox(
  uid: string,
  onChange: (messages: InboxMessage[]) => void,
  onError: (err: unknown) => void,
): InboxUnsubscribe {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) {
    throw new Error('subscribeInbox: uid is required');
  }

  let cancelled = false;
  let unsubscribe: (() => void) | null = null;

  void (async () => {
    const [fs, ctx] = await Promise.all([
      import('firebase/firestore'),
      getFirebase(),
    ]);
    if (cancelled) return;
    const q = fs.collection(ctx.db, userInbox(safeUid));
    unsubscribe = fs.onSnapshot(
      q,
      (snap) => {
        const messages = snap.docs.map((d) =>
          normalizeInboxMessage(d.id, d.data() as Record<string, unknown>),
        );
        onChange(sortByTimeDesc(messages));
      },
      (err) => onError(err),
    );
  })().catch((err) => {
    onError(err);
  });

  return () => {
    cancelled = true;
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch {
        // unsubscribe 例外不應影響呼叫端；吞掉（與 A 慣例一致）。
      }
    }
  };
}

// ── 已讀／刪除寫入 ─────────────────────────────────

/** 照 A `updateMessageRead` / `readMessage`：路徑 `users/{uid}/inbox/{msg._docId}`，payload 僅 read/readAt。 */
export async function markRead(uid: string, msg: InboxMessage): Promise<void> {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) throw new Error('markRead: uid is required');
  const docId = String(msg?._docId ?? '').trim();
  if (!docId) throw new Error('markRead: message._docId is required');

  const [fs, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const ref = fs.doc(ctx.db, userInbox(safeUid), docId);
  await fs.updateDoc(ref, {
    read: true,
    readAt: fs.serverTimestamp(),
  });
}

/**
 * 照 A `markAllMessagesRead` / `markAllRead`：只處理目前未讀且有 `_docId` 的訊息，
 * 每批最多 500 筆（Firestore batch 上限）。
 * ASSUMPTION: A 為單一 batch（>500 會失敗）；本層按 Firestore 上限分 500 筆批次，
 * 與 spec「批次上限照 Firestore 500 分批」一致。
 */
export async function markAllRead(uid: string, msgs: InboxMessage[]): Promise<void> {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) throw new Error('markAllRead: uid is required');

  const targets = (Array.isArray(msgs) ? msgs : []).filter(
    (m) => isUnread(m, safeUid) && String(m?._docId ?? '').trim(),
  );
  if (targets.length === 0) return;

  const [fs, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);

  for (let i = 0; i < targets.length; i += BATCH_LIMIT) {
    const chunk = targets.slice(i, i + BATCH_LIMIT);
    const batch = fs.writeBatch(ctx.db);
    for (const m of chunk) {
      const docId = String(m._docId ?? '');
      batch.update(fs.doc(ctx.db, userInbox(safeUid), docId), {
        read: true,
        readAt: fs.serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

/** 照 A `removeInboxMessage`：刪除本人 inbox 文件。 */
export async function deleteMessage(uid: string, msg: InboxMessage): Promise<void> {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) throw new Error('deleteMessage: uid is required');
  const docId = String(msg?._docId ?? '').trim();
  if (!docId) return;

  const [fs, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  await fs.deleteDoc(fs.doc(ctx.db, userInbox(safeUid), docId));
}

/**
 * 照 A `clearAllMessages`：
 *   - 排除 `actionStatus === 'pending'` 的審核訊息；
 *   - 僅刪除有 `_docId` 者；
 *   - 每批 450 筆（A 的分批大小）。
 * 回傳實際刪除筆數供呼叫端顯示。
 */
export async function clearAll(uid: string, msgs: InboxMessage[]): Promise<number> {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) throw new Error('clearAll: uid is required');

  const deletable = (Array.isArray(msgs) ? msgs : []).filter(
    (m) => !isPendingActionMessage(m),
  );
  const targets = deletable.filter((m) => String(m?._docId ?? '').trim());
  if (targets.length === 0) return 0;

  const [fs, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);

  let deleted = 0;
  for (let i = 0; i < targets.length; i += CLEAR_CHUNK) {
    const chunk = targets.slice(i, i + CLEAR_CHUNK);
    const batch = fs.writeBatch(ctx.db);
    for (const m of chunk) {
      const docId = String(m._docId ?? '');
      batch.delete(fs.doc(ctx.db, userInbox(safeUid), docId));
      deleted += 1;
    }
    await batch.commit();
  }
  return deleted;
}
