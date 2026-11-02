/**
 * 聊天室稽核（日誌中心「聊天室稽核」頁籤）資料層。對應 A `js/modules/message/pm-audit.js`。
 * 全部走既有 Callable（伺服器 `pmAssertSuperAdmin`），前端 Firestore 讀取 0。
 * `_legacyLoadPmAuditLogs` 在 A 沒有呼叫端（死碼），不搬。
 */

import { callFn } from '@/data/callables';

export const PM_AUDIT_LOG_PAGE_SIZE = 50;
export const PM_AUDIT_CONVERSATION_LIMIT = 100;

/** A `pm-audit.js` 的 Log 篩選選項順序。 */
export const PM_AUDIT_ACTIONS = [
  'send',
  'read',
  'edit',
  'recall',
  'search_user',
  'audit_view_thread',
  'audit_view_conversation',
  'audit_search_logs',
  'settings_update',
] as const;

/** A `_pmAuditActionLabel`：Log 列的短標籤（A 原樣為英文代號）。 */
export function pmAuditActionLabel(action: unknown): string {
  const labels: Record<string, string> = {
    send: 'send',
    read: 'read',
    edit: 'edit',
    recall: 'recall',
    search_user: 'search',
    audit_view_thread: 'threads',
    audit_view_conversation: 'view',
    audit_search_logs: 'logs',
    settings_update: 'settings',
  };
  const key = String(action || '');
  return labels[key] || key || '-';
}

/** A `_pmAuditShortUid`。 */
export function pmAuditShortUid(uid: unknown): string {
  const text = String(uid || '').trim();
  if (!text) return '-';
  return text.length > 14 ? `${text.slice(0, 6)}...${text.slice(-4)}` : text;
}

function toMillis(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'object') {
    const v = value as { toDate?: () => Date; seconds?: unknown; _seconds?: unknown };
    if (typeof v.toDate === 'function') {
      const ms = v.toDate().getTime();
      return Number.isNaN(ms) ? null : ms;
    }
    const seconds = typeof v.seconds === 'number' ? v.seconds : typeof v._seconds === 'number' ? v._seconds : null;
    if (seconds !== null) return seconds * 1000;
  }
  return null;
}

const ZH_TW_SHORT: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Taipei',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * A `_pmFormatTime`／`_pmAuditShortTime`：`MM/DD 上午hh:mm`（zh-TW 慣例）。
 * 與 A 差異：固定台北時區；也認得 Callable 回傳的 `{ _seconds }`（A 會顯示空白）。
 */
export function pmFormatTime(value: unknown): string {
  const ms = toMillis(value);
  if (ms === null) return typeof value === 'string' ? value.slice(0, 16) : '';
  return new Date(ms).toLocaleString('zh-TW', ZH_TW_SHORT);
}

export interface PmAuditUser {
  uid: string;
  name: string;
  pictureUrl: string;
  role: string;
}

export interface PmAuditThread {
  id: string;
  title: string;
  lastMessageBody: string;
  lastMessageAt: unknown;
}

export interface PmAuditMessage {
  key: string;
  senderLabel: string;
  createdAt: unknown;
  body: string;
  recalled: boolean;
}

export interface PmAuditLog {
  key: string;
  action: string;
  actorUid: string;
  targetUid: string;
  createdAtIso: string;
  createdAt: unknown;
}

export async function loadPmSettings(): Promise<boolean> {
  const resp = await callFn('getPrivateMessageSettings', {});
  const settings = resp?.settings as { allowUserToUserPm?: unknown } | undefined;
  return settings?.allowUserToUserPm === true;
}

export async function savePmSettings(allowUserToUserPm: boolean): Promise<boolean> {
  const resp = await callFn('updatePrivateMessageSettings', { allowUserToUserPm: allowUserToUserPm === true });
  const settings = resp?.settings as { allowUserToUserPm?: unknown } | undefined;
  return settings?.allowUserToUserPm === true;
}

export async function searchPmUsers(query: string): Promise<PmAuditUser[]> {
  const resp = await callFn('searchPmAuditUsers', { query });
  const users = Array.isArray(resp?.users) ? resp.users : [];
  return users.map((u) => ({
    uid: String(u?.uid ?? ''),
    name: String(u?.name ?? ''),
    pictureUrl: typeof u?.pictureUrl === 'string' ? u.pictureUrl : '',
    role: typeof u?.role === 'string' && u.role ? u.role : 'user',
  }));
}

export async function listPmThreads(uid: string): Promise<PmAuditThread[]> {
  const resp = await callFn('listPmAuditThreads', { uid });
  const threads = Array.isArray(resp?.threads) ? (resp.threads as Record<string, unknown>[]) : [];
  return threads.map((thread) => {
    const names = (thread['participantNames'] && typeof thread['participantNames'] === 'object'
      ? thread['participantNames']
      : {}) as Record<string, unknown>;
    const participants = Array.isArray(thread['participants']) ? (thread['participants'] as unknown[]) : [];
    const id = String(thread['conversationId'] || thread['id'] || '');
    const title = participants.map((pid) => String(names[String(pid)] || pid)).join(' / ');
    return {
      id,
      title: title || String(thread['id'] || ''),
      lastMessageBody: String(thread['lastMessageBody'] || ''),
      lastMessageAt: thread['lastMessageAt'],
    };
  });
}

export async function loadPmConversation(conversationId: string): Promise<PmAuditMessage[]> {
  const resp = await callFn('getPmAuditConversation', { conversationId, limit: PM_AUDIT_CONVERSATION_LIMIT });
  const messages = Array.isArray(resp?.messages) ? (resp.messages as Record<string, unknown>[]) : [];
  return messages.map((m, index) => ({
    key: String(m['id'] || index),
    senderLabel: String(m['senderName'] || m['fromUid'] || ''),
    createdAt: m['createdAt'],
    body: String(m['body'] || ''),
    recalled: m['status'] === 'recalled',
  }));
}

export interface PmAuditLogPage {
  logs: PmAuditLog[];
  nextCursorMs: number | null;
  hasMore: boolean;
}

export async function loadPmAuditLogs(action: string, cursorMs: number | null): Promise<PmAuditLogPage> {
  const payload: { action: string; limit: number; cursorCreatedAtMs?: number } = {
    action,
    limit: PM_AUDIT_LOG_PAGE_SIZE,
  };
  if (cursorMs) payload.cursorCreatedAtMs = cursorMs;
  const resp = await callFn('getPmAuditLogs', payload);
  const logs = Array.isArray(resp?.logs) ? resp.logs : [];
  const cursor = resp?.nextCursor as { createdAtMs?: unknown } | null | undefined;
  const nextCursorMs = cursor && Number(cursor.createdAtMs) ? Number(cursor.createdAtMs) : null;
  return {
    logs: logs.map((log, index) => {
      const row = log as Record<string, unknown>;
      return {
        key: String(row['id'] || `${index}`),
        action: String(row['action'] || ''),
        actorUid: String(row['actorUid'] || ''),
        targetUid: String(row['targetUid'] || ''),
        createdAtIso: String(row['createdAtIso'] || ''),
        createdAt: row['createdAt'],
      };
    }),
    nextCursorMs,
    hasMore: resp?.hasMore === true && nextCursorMs !== null,
  };
}
