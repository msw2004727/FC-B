/**
 * 站內信投遞（對應 A `js/modules/message/message-notify.js` 的 `_deliverMessageToInbox`
 * ＋ `_buildInboxDeliveryDedupeKey`，以及 `js/firebase-crud.js#_deliverToInboxCF`）。
 *
 * - 訊息物件欄位與 A 完全相同（A 的收件匣依 unread／readBy／hiddenBy／targetType 等欄位顯示與計數）。
 * - 只走 `deliverToInbox` Callable（per-user inbox，伺服器強制 fromUid = 呼叫者），不直寫 inbox。
 * - 不移植 A 的本機樂觀插入與 5 秒重複投遞守衛（屬收件匣 UI 快取；B 由收件匣模組自行處理）。
 */

import { callFn } from '@/data/callables';

export interface InboxDeliveryExtra {
  targetTeamId?: string | null;
  targetRoles?: string[] | null;
  targetType?: string | null;
  dedupeKey?: string | null;
  actionType?: string | null;
  actionStatus?: string | null;
  meta?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface InboxDeliveryInput {
  title: string;
  body: string;
  /** A 的 category（例如 'system'）。 */
  category: string;
  /** A 的 categoryName（例如 '系統'）。 */
  categoryName: string;
  /** 點對點收件人；廣播時為 null。 */
  targetUid: string | null;
  senderName: string;
  /** 寄件者 UID（目前登入者）；伺服器仍會強制覆寫 fromUid。 */
  senderUid: string | null;
  extra?: InboxDeliveryExtra | null;
  /** 測試注入。 */
  now?: Date;
  random?: () => number;
}

/** A `_buildInboxDeliveryDedupeKey`。 */
export function buildInboxDeliveryDedupeKey(
  category: string,
  title: string,
  body: string,
  targetUid: string | null,
  senderName: string,
  extra?: InboxDeliveryExtra | null,
): string {
  const explicitKey = typeof extra?.dedupeKey === 'string' ? extra.dedupeKey.trim() : '';
  if (explicitKey) return explicitKey;
  const normalizedRoles = Array.isArray(extra?.targetRoles)
    ? [...extra.targetRoles].map((v) => String(v || '').trim()).filter(Boolean).sort().join(',')
    : '';
  return [
    String(category || '').trim(),
    String(title || '').trim(),
    String(body || '').trim(),
    String(targetUid || '').trim(),
    String(extra?.targetTeamId || '').trim(),
    normalizedRoles,
    String(extra?.targetType || '').trim(),
    String(senderName || '').trim(),
  ].join('||');
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** A `_deliverMessageToInbox` 的 newMsg（不含寫入）。 */
export function buildInboxMessage(input: InboxDeliveryInput): Record<string, unknown> {
  const { title, body, category, categoryName, senderName, extra } = input;
  const now = input.now ?? new Date();
  const random = input.random ?? Math.random;
  const nowMs = now.getTime();
  const preview = body.length > 40 ? `${body.slice(0, 40)}...` : body;
  const timeStr = `${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const directTargetUid = input.targetUid || null;
  const targetTeamId = extra?.targetTeamId || null;
  const targetRoles = extra?.targetRoles || null;
  const targetType = extra?.targetType
    || (directTargetUid
      ? 'individual'
      : (targetTeamId ? 'team' : ((Array.isArray(targetRoles) && targetRoles.length) ? 'role' : 'all')));
  const dedupeKey = buildInboxDeliveryDedupeKey(category, title, body, directTargetUid, senderName, extra);
  return {
    id: `msg_${nowMs}_${random().toString(36).slice(2, 6)}`,
    type: category,
    typeName: categoryName,
    title,
    preview,
    body,
    time: timeStr,
    unread: true,
    readBy: [],
    hiddenBy: [],
    senderName,
    fromUid: input.senderUid || null,
    toUid: directTargetUid,
    targetUid: directTargetUid,
    targetTeamId,
    targetRoles,
    targetType,
    dedupeKey,
    ...(extra || {}),
  };
}

export function isAlreadyExistsError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code.replace(/^functions\//, '') === 'already-exists';
}

/**
 * 投遞站內信（A `_deliverToInboxCF` 的 request 形狀）。回傳送出的訊息物件；
 * 同一把 dedupeKey 5 秒內重複送出時回傳 null（A `_claimRecentInboxDeliveryKey`），呼叫端應略過後續（例如 LINE）。
 * Callable 回 already-exists 視為已送達，保留 dedupe 鍵並回傳訊息；其他失敗會釋放這把鍵（A `_releaseRecentInboxDeliveryKey`）並往外拋，由呼叫端決定是否屬 best-effort。
 */
export async function deliverInboxMessage(input: InboxDeliveryInput): Promise<Record<string, unknown> | null> {
  const message = buildInboxMessage(input);
  // 內測模式：收件人必須在白名單內；廣播（targetUid 為 null）對象不明，一律擋。
  const dedupeKey = typeof message['dedupeKey'] === 'string' ? message['dedupeKey'] : '';
  const nowMs = (input.now ?? new Date()).getTime();
  if (!claimRecentInboxDeliveryKey(dedupeKey, nowMs)) {
    console.warn('[inbox-delivery] skip recent duplicate');
    return null;
  }
  try {
    await callFn('deliverToInbox', {
      message,
      targetUid: message['targetUid'],
      targetTeamId: message['targetTeamId'],
      targetRoles: message['targetRoles'],
      targetType: message['targetType'],
    } as never);
  } catch (err) {
    if (isAlreadyExistsError(err)) return message;
    releaseRecentInboxDeliveryKey(dedupeKey);
    throw err;
  }
  return message;
}

// ── A `_claimRecentInboxDeliveryKey`／`_releaseRecentInboxDeliveryKey`：5 秒內同一把鍵只送一次 ──
const RECENT_DELIVERY_WINDOW_MS = 5000;
const recentDeliveryKeys = new Map<string, number>();

function claimRecentInboxDeliveryKey(dedupeKey: string, nowMs: number): boolean {
  if (!dedupeKey) return true;
  for (const [key, sentAt] of recentDeliveryKeys) {
    if (nowMs - sentAt > RECENT_DELIVERY_WINDOW_MS) recentDeliveryKeys.delete(key);
  }
  const lastSentAt = recentDeliveryKeys.get(dedupeKey) ?? 0;
  if (lastSentAt && nowMs - lastSentAt < RECENT_DELIVERY_WINDOW_MS) return false;
  recentDeliveryKeys.set(dedupeKey, nowMs);
  return true;
}

function releaseRecentInboxDeliveryKey(dedupeKey: string): void {
  if (dedupeKey) recentDeliveryKeys.delete(dedupeKey);
}

/** 測試用：清空 5 秒重複守衛。 */
export function _resetRecentInboxDeliveryForTest(): void {
  recentDeliveryKeys.clear();
}
