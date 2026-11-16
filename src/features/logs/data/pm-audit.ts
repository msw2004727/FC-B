/**
 * 聊天室稽核（日誌中心「聊天室稽核」頁籤）資料層。對應 A `js/modules/message/pm-audit.js`。
 * 全部走既有 Callable（伺服器 `pmAssertSuperAdmin`），前端 Firestore 讀取 0。
 * `_legacyLoadPmAuditLogs` 在 A 沒有呼叫端（死碼），不搬。
 */

import { CallableError, callFn } from '@/data/callables';

import { filterToPayload, shortUid, type PmAuditFilter } from './pm-audit-view';

export const PM_AUDIT_LOG_PAGE_SIZE = 50;
export const PM_AUDIT_CONVERSATION_LIMIT = 100;

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

/** 一筆稽核 log 的時間（毫秒）；`createdAtIso` 優先，退 `createdAt`。 */
export function pmLogMs(log: { createdAtIso?: unknown; createdAt?: unknown }): number | null {
  return toMillis(log.createdAtIso) ?? toMillis(log.createdAt);
}

/** 稽核列與對話的短時間 `MM/DD HH:mm`（台北，24 小時制）；也認得 Callable 回傳的 `{ _seconds }`。2026-11-16 改：取代 A 的 `上午hh:mm`。 */
export function pmFormatTime(value: unknown): string {
  const ms = toMillis(value);
  if (ms === null) return typeof value === 'string' ? value.slice(0, 16) : '';
  // 固定 +8 小時後取 UTC 欄位（台北無日光節約）；不經 toLocaleString，避免瀏覽器差異與不可見字元。
  const t = new Date(ms + 8 * 60 * 60 * 1000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(t.getUTCMonth() + 1)}/${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
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
  participants: string[];
  lastMessageBody: string;
  lastMessageAt: unknown;
}

export interface PmAuditMessage {
  key: string;
  senderLabel: string;
  fromUid: string;
  createdAt: unknown;
  body: string;
  recalled: boolean;
  edited: boolean;
}

export interface PmAuditConversation {
  /** 稽核複本已過保存期（後端回 not-found）。 */
  expired: boolean;
  participants: string[];
  participantNames: Record<string, string>;
  messages: PmAuditMessage[];
}

export interface PmAuditLog {
  key: string;
  action: string;
  actorUid: string;
  targetUid: string;
  conversationId: string;
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
    // 缺暱稱時用 UID 短碼，不在標題露出完整 UID（顧問 §3.196；A 原樣是完整 UID）。
    const title = participants.map((pid) => String(names[String(pid)] || shortUid(String(pid || '')))).join(' / ');
    return {
      id,
      title: title || shortUid(id),
      participants: participants.map((pid) => String(pid || '')).filter(Boolean),
      lastMessageBody: String(thread['lastMessageBody'] || ''),
      lastMessageAt: thread['lastMessageAt'],
    };
  });
}

export async function loadPmConversation(conversationId: string): Promise<PmAuditConversation> {
  let resp;
  try {
    resp = await callFn('getPmAuditConversation', { conversationId, limit: PM_AUDIT_CONVERSATION_LIMIT });
  } catch (err) {
    // 稽核複本由排程依保存期刪除；not-found 是「已超過保存期限」，不是錯誤。
    if (err instanceof CallableError && /not-found/.test(err.code)) {
      return { expired: true, participants: [], participantNames: {}, messages: [] };
    }
    throw err;
  }
  const thread = (resp?.thread ?? {}) as Record<string, unknown>;
  const rawNames = thread['participantNames'] && typeof thread['participantNames'] === 'object'
    ? (thread['participantNames'] as Record<string, unknown>)
    : {};
  const participantNames: Record<string, string> = {};
  for (const [uid, name] of Object.entries(rawNames)) {
    if (typeof name === 'string' && name.trim()) participantNames[uid] = name.trim();
  }
  const participants = Array.isArray(thread['participants'])
    ? (thread['participants'] as unknown[]).map((p) => String(p || '')).filter(Boolean)
    : [];
  const messages = Array.isArray(resp?.messages) ? (resp.messages as Record<string, unknown>[]) : [];
  return {
    expired: false,
    participants,
    participantNames,
    messages: messages.map((m, index) => ({
      key: String(m['id'] || index),
      senderLabel: String(m['senderName'] || ''),
      fromUid: String(m['fromUid'] || ''),
      createdAt: m['createdAt'],
      body: String(m['body'] || ''),
      recalled: m['status'] === 'recalled',
      edited: m['status'] === 'edited',
    })),
  };
}

export interface PmAuditLogPage {
  logs: PmAuditLog[];
  nextCursorMs: number | null;
  hasMore: boolean;
}

/** 篩選一次只送一個鍵（顧問 §3.195 硬條件 1），見 `filterToPayload`。 */
/** 時間區間：`cursorMs` 第一頁傳區間終點（後端 startAfter＝早於該時間），之後傳上一頁的 nextCursor；`limit` 即每頁筆數（1～100）。 */
export async function loadPmAuditLogs(filter: PmAuditFilter, cursorMs: number | null, limit: number = PM_AUDIT_LOG_PAGE_SIZE): Promise<PmAuditLogPage> {
  const payload: { action?: string; actorUid?: string; targetUid?: string; limit: number; cursorCreatedAtMs?: number } = {
    ...filterToPayload(filter),
    limit: Math.min(Math.max(Math.floor(limit), 1), 100),
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
        conversationId: String(row['conversationId'] || ''),
        createdAtIso: String(row['createdAtIso'] || ''),
        createdAt: row['createdAt'],
      };
    }),
    nextCursorMs,
    hasMore: resp?.hasMore === true && nextCursorMs !== null,
  };
}
