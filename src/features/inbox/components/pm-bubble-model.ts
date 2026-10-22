// 私訊即時泡泡的純函式模型。
// 照 A `js/modules/message/pm-listener.js#_resolvePmThreadPeerUid`、
// `_pmConversationKey`、`_findPmUnreadIncrease` / `_findPmInitialUnread`
// 的精簡版：只負責「哪些 thread 變化要提醒」與「對方 UID 解析」。

import type { PmThread } from '../data/pm-repo';

/** 照 A `_showPmIncomingBubble` 的最終 6.5 秒收起時間。 */
export const PM_INCOMING_BUBBLE_DURATION_MS = 6500;

/**
 * 照 A `_queuePmIncomingBubble`：先等 350ms 讓 Firestore 快照穩定，
 * 檢查當下沒有開著同一對話浮層，才顯示泡泡。
 */
export const PM_INCOMING_BUBBLE_DELAY_MS = 350;

/** 照 A `_pmConversationKey`：優先用 conversationId，其次 id，最後 _docId。 */
export function pmConversationKey(
  value: PmThread | string | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  const cId = value.conversationId || value.id || value._docId;
  return String(cId ?? '').trim();
}

/**
 * 照 A `_resolvePmThreadPeerUid`：
 *   1. 先讀 `peerUid`，不等於 myUid 就直接回傳。
 *   2. 否則從 `participants` 找唯一非 myUid 成員。
 *   3. A 有 `_pmParseConversationId` 的第三層 fallback，該函式未在附件內，
 *      本單以 peerUid／participants 兩層為限，其餘回空字串。
 * ASSUMPTION: A 的 `_pmParseConversationId` 未在附件，以兩層 fallback 實作。
 */
export function resolvePeerUid(thread: PmThread, myUid: string): string {
  const safeMyUid = String(myUid ?? '').trim();
  if (!safeMyUid) return '';
  const direct = String(thread.peerUid ?? '').trim();
  if (direct && direct !== safeMyUid) return direct;
  const participants = Array.isArray(thread.participants) ? thread.participants : [];
  const fromParticipants = participants
    .map((p) => String(p ?? '').trim())
    .find((uid) => uid && uid !== safeMyUid);
  if (fromParticipants) return fromParticipants;
  return '';
}

/**
 * 照 A `_findPmUnreadIncrease`：
 *   - `previous === null` 代表首次快照（`_pmThreadsReady === false`），不提醒。
 *   - 對每個 conversation，只有 `next.unreadCount > prev.unreadCount` 才算「新進、未讀」。
 *   - 對方發的訊息才會增加 unread；自己送出的訊息不動 unread，因此自然被排除。
 *   - 「目前浮層已開著同一對話」由元件在顯示前檢查（照 A `_queuePmIncomingBubble`）。
 *   - 同一快照多筆增加時回傳第一筆，A 的 `Array.find` 語意一致。
 */
export function findNewUnreadThread(
  previous: PmThread[] | null,
  next: PmThread[],
): PmThread | null {
  if (previous === null) return null;
  const prevMap = new Map<string, PmThread>();
  for (const thread of previous) {
    const key = pmConversationKey(thread);
    if (key) prevMap.set(key, thread);
  }
  for (const thread of next) {
    const key = pmConversationKey(thread);
    if (!key) continue;
    const prev = prevMap.get(key);
    const nextUnread = Math.max(0, Number(thread.unreadCount ?? 0));
    const prevUnread = prev ? Math.max(0, Number(prev.unreadCount ?? 0)) : 0;
    if (nextUnread > prevUnread) return thread;
  }
  return null;
}
