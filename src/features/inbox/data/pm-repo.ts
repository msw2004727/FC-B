// 私訊（Private Message）資料層。
//
// 對應 A `js/modules/message/pm-listener.js` / `pm-dialog.js` / `pm-dialog-actions.js` /
// `pm-permission.js` 與 `functions/index.js` 的私訊 Callable。
//
// - 路徑一律為本人副本：`users/{uid}/pmThreads/{cId}` 與其 `messages` 子集合、
//   `users/{uid}/pmMeta`。Rules 明確禁止前端寫入（create/update/delete: if false）。
// - 讀取僅用訂閱；寫入一律呼叫 Callable（`sendPrivateMessage` /
//   `editPrivateMessage` / `recallPrivateMessage` / `markPrivateConversationRead`）。
// - 稽核（`*PmAudit*`）函式不在此層。
// - 常數照 A `pm-permission.js`：
//     PM_MAX_BODY_LENGTH: 300
//     PM_MESSAGE_LIMIT:   50（單一對話訊息上限）
//     PM_THREAD_LIMIT:    50（對話列表上限）

import { callFn } from '@/data/callables';
import { getFirebase } from '@/data/firebase';

// ── 常數（照 A pm-permission.js） ──────────────────

export const PM_MAX_BODY_LENGTH = 300;
export const PM_MESSAGE_LIMIT = 50;
export const PM_THREAD_LIMIT = 50;

const PM_ROLE_LEVELS: Record<string, number> = {
  user: 0,
  coach: 1,
  captain: 2,
  venue_owner: 3,
  admin: 4,
  super_admin: 5,
};

// ── 型別 ──────────────────────────────────────────

export interface PmThread {
  id: string;
  _docId?: string;
  conversationId?: string;
  peerUid?: string;
  peerName?: string;
  peerAvatar?: string;
  participants?: string[];
  lastMessageId?: string;
  lastMessageBody?: string;
  lastMessageStatus?: string;
  lastMessageAt?: unknown;
  unreadCount?: number;
  [key: string]: unknown;
}

export interface PmMessage {
  id: string;
  _docId?: string;
  messageId?: string;
  conversationId?: string;
  fromUid?: string;
  toUid?: string;
  body?: string;
  preview?: string;
  status?: string;
  direction?: 'in' | 'out' | string;
  senderName?: string;
  senderAvatar?: string;
  read?: boolean;
  peerRead?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  [key: string]: unknown;
}

export type PmUnsubscribe = () => void;

// ── 純函式：可否發送 ───────────────────────────────

/** 照 A `normalizeRoleForPM`。 */
export function normalizePmRole(role: unknown): string {
  const safe = String(role ?? '').trim();
  return Object.prototype.hasOwnProperty.call(PM_ROLE_LEVELS, safe) ? safe : 'user';
}

/**
 * 照 A `canSendPMTo`（等同伺服器 `pmCanSendTo`）：
 *   1. 送訊者角色 >= admin → 一律可。
 *   2. 已有既有對話 → 一律可。
 *   3. 站台設定 `allowUserToUserPm === true` → 可。
 *   4. 否則依角色層級：送訊者層級 < 收訊者層級 才可。
 */
export function canSendPMTo(
  fromRole: unknown,
  toRole: unknown,
  hasExistingConvo: boolean = false,
  settings: { allowUserToUserPm?: boolean } = {},
): boolean {
  const from = normalizePmRole(fromRole);
  const to = normalizePmRole(toRole);
  const fromLevel = PM_ROLE_LEVELS[from] ?? 0;
  const toLevel = PM_ROLE_LEVELS[to] ?? 0;
  if (fromLevel >= (PM_ROLE_LEVELS.admin ?? 4)) return true;
  if (hasExistingConvo) return true;
  if (settings?.allowUserToUserPm === true) return true;
  return fromLevel < toLevel;
}

// ── 正規化 ────────────────────────────────────────

export function normalizePmThread(
  docId: string,
  data: Record<string, unknown>,
): PmThread {
  const safeDocId = String(docId ?? '');
  const d = (data ?? {}) as PmThread;
  return {
    ...d,
    _docId: safeDocId,
    id: typeof d.id === 'string' && d.id ? d.id : safeDocId,
  };
}

export function normalizePmMessage(
  docId: string,
  data: Record<string, unknown>,
): PmMessage {
  const safeDocId = String(docId ?? '');
  const d = (data ?? {}) as PmMessage;
  return {
    ...d,
    _docId: safeDocId,
    id: typeof d.id === 'string' && d.id ? d.id : safeDocId,
    messageId: typeof d.messageId === 'string' && d.messageId ? d.messageId : safeDocId,
  };
}

// ── 訂閱 ─────────────────────────────────────────

/**
 * 照 A `startPmThreadListener`：
 *   `users/{uid}/pmThreads` 依 `lastMessageAt` desc、limit 50。
 */
export function subscribeThreads(
  uid: string,
  onChange: (threads: PmThread[]) => void,
  onError: (err: unknown) => void,
): PmUnsubscribe {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) throw new Error('subscribeThreads: uid is required');

  let cancelled = false;
  let unsubscribe: (() => void) | null = null;

  void (async () => {
    const [fs, ctx] = await Promise.all([
      import('firebase/firestore'),
      getFirebase(),
    ]);
    if (cancelled) return;
    const q = fs.query(
      fs.collection(ctx.db, `users/${safeUid}/pmThreads`),
      fs.orderBy('lastMessageAt', 'desc'),
      fs.limit(PM_THREAD_LIMIT),
    );
    unsubscribe = fs.onSnapshot(
      q,
      (snap) => {
        const threads = snap.docs.map((d) =>
          normalizePmThread(d.id, d.data() as Record<string, unknown>),
        );
        onChange(threads);
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
        // 忽略 unsubscribe 例外
      }
    }
  };
}

/**
 * 照 A `_startPmConversationListener`：
 *   `users/{uid}/pmThreads/{cId}/messages` 依 `createdAt` desc、limit 50，然後 `.reverse()`。
 * 回傳的訊息為「舊 → 新」（最後一筆為最新）。
 */
export function subscribeConversation(
  uid: string,
  conversationId: string,
  onChange: (messages: PmMessage[]) => void,
  onError: (err: unknown) => void,
): PmUnsubscribe {
  const safeUid = String(uid ?? '').trim();
  const cId = String(conversationId ?? '').trim();
  if (!safeUid) throw new Error('subscribeConversation: uid is required');
  if (!cId) throw new Error('subscribeConversation: conversationId is required');

  let cancelled = false;
  let unsubscribe: (() => void) | null = null;

  void (async () => {
    const [fs, ctx] = await Promise.all([
      import('firebase/firestore'),
      getFirebase(),
    ]);
    if (cancelled) return;
    const q = fs.query(
      fs.collection(ctx.db, `users/${safeUid}/pmThreads/${cId}/messages`),
      fs.orderBy('createdAt', 'desc'),
      fs.limit(PM_MESSAGE_LIMIT),
    );
    unsubscribe = fs.onSnapshot(
      q,
      (snap) => {
        const messages = snap.docs
          .map((d) => normalizePmMessage(d.id, d.data() as Record<string, unknown>))
          .reverse();
        onChange(messages);
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
        // 忽略 unsubscribe 例外
      }
    }
  };
}

// ── 寫入（一律走 Callable） ────────────────────────

/** 前端字數檢查（照 A `sendPmMessage`：trim 後不可為空、<= PM_MAX_BODY_LENGTH）。 */
export function assertValidPmBody(body: unknown): string {
  const safe = String(body ?? '').trim();
  if (!safe) throw new Error('pm: message body required');
  if (safe.length > PM_MAX_BODY_LENGTH) {
    throw new Error(`pm: message body too long (max ${PM_MAX_BODY_LENGTH})`);
  }
  return safe;
}

/** 照 A `sendPmMessage`：Callable `sendPrivateMessage({ toUid, body })`。 */
export async function sendPrivateMessage(
  toUid: string,
  body: string,
): Promise<{ conversationId: string; messageId: string }> {
  const safeToUid = String(toUid ?? '').trim();
  if (!safeToUid) throw new Error('sendPrivateMessage: toUid is required');
  const trimmed = assertValidPmBody(body);
  const res = await callFn('sendPrivateMessage', { toUid: safeToUid, body: trimmed });
  return { conversationId: String(res?.conversationId ?? ''), messageId: String(res?.messageId ?? '') };
}

/** 照 A `editPmMessage`：Callable `editPrivateMessage({ conversationId, messageId, body })`。 */
export async function editPrivateMessage(
  conversationId: string,
  messageId: string,
  body: string,
): Promise<void> {
  const cId = String(conversationId ?? '').trim();
  const mId = String(messageId ?? '').trim();
  if (!cId) throw new Error('editPrivateMessage: conversationId is required');
  if (!mId) throw new Error('editPrivateMessage: messageId is required');
  const trimmed = assertValidPmBody(body);
  await callFn('editPrivateMessage', {
    conversationId: cId,
    messageId: mId,
    body: trimmed,
  });
}

/** 照 A `recallPmMessage`：Callable `recallPrivateMessage({ conversationId, messageId })`。 */
export async function recallPrivateMessage(
  conversationId: string,
  messageId: string,
): Promise<void> {
  const cId = String(conversationId ?? '').trim();
  const mId = String(messageId ?? '').trim();
  if (!cId) throw new Error('recallPrivateMessage: conversationId is required');
  if (!mId) throw new Error('recallPrivateMessage: messageId is required');
  await callFn('recallPrivateMessage', { conversationId: cId, messageId: mId });
}

/**
 * 照 A `_runPmMarkRead`：Callable `markPrivateConversationRead({ conversationId })`，
 * 回傳伺服器處理筆數與是否還有下一批未讀。
 */
export async function markConversationRead(
  conversationId: string,
): Promise<{ readCount: number; hasMore: boolean }> {
  const cId = String(conversationId ?? '').trim();
  if (!cId) throw new Error('markConversationRead: conversationId is required');
  const res = await callFn('markPrivateConversationRead', { conversationId: cId });
  const readCount = Number((res as { readCount?: unknown })?.readCount ?? 0);
  const hasMore = (res as { hasMore?: unknown })?.hasMore === true;
  return {
    readCount: Number.isFinite(readCount) ? Math.max(0, readCount) : 0,
    hasMore,
  };
}
