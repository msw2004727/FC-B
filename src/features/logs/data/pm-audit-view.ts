/**
 * 聊天室稽核 Log 列的純函式（2026-11-16 日誌中心改版，顧問 §3.195 案 A）。
 * - 每列以「暱稱＋UID 短碼」呈現操作者與對象；有對話編號的列可直接開對話。
 * - `audit_view_conversation` 的 `targetUid` 是後端寫的「a,b」字串，拆成兩人。
 * - 篩選一次只送一個鍵（伺服器是 AND 疊加、索引只有單欄＋createdAt，兩鍵同送會缺索引失敗）。
 */
import type { PmAuditLog } from './pm-audit';

/** 管理員自己查詢時寫下的紀錄；「隱藏稽核查詢紀錄」開關會藏這些。 */
export const SELF_AUDIT_ACTIONS: ReadonlySet<string> = new Set([
  'settings_view',
  'audit_search_logs',
  'search_user',
  'audit_view_thread',
]);

/** 會帶對話編號、可直接開對話的動作。 */
const CONVERSATION_ACTIONS: ReadonlySet<string> = new Set([
  'send',
  'read',
  'edit',
  'recall',
  'audit_view_conversation',
]);

export type PmAuditFilter =
  | { kind: 'all' }
  | { kind: 'action'; action: string }
  | { kind: 'actor'; uid: string }
  | { kind: 'target'; uid: string };

/** 給 `getPmAuditLogs` 的篩選參數：永遠最多一個鍵。 */
export function filterToPayload(filter: PmAuditFilter): { action?: string; actorUid?: string; targetUid?: string } {
  if (filter.kind === 'action' && filter.action) return { action: filter.action };
  if (filter.kind === 'actor' && filter.uid) return { actorUid: filter.uid };
  if (filter.kind === 'target' && filter.uid) return { targetUid: filter.uid };
  return {};
}

/** UID 短碼：前 6＋後 4（長度 ≤ 12 原樣）。 */
export function shortUid(uid: string): string {
  const text = String(uid || '').trim();
  if (!text) return '';
  return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

export function splitTargetUids(log: Pick<PmAuditLog, 'action' | 'targetUid'>): string[] {
  const raw = String(log.targetUid || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function canOpenConversation(log: Pick<PmAuditLog, 'action' | 'conversationId'>): boolean {
  return CONVERSATION_ACTIONS.has(log.action) && Boolean(String(log.conversationId || '').trim());
}

export function isSelfAudit(log: Pick<PmAuditLog, 'action'>, hideConversationViews: boolean): boolean {
  if (SELF_AUDIT_ACTIONS.has(log.action)) return true;
  return hideConversationViews && log.action === 'audit_view_conversation';
}

/** 一頁 log 內所有需要查暱稱的 UID（去重、保留順序）。 */
export function collectLogUids(logs: readonly PmAuditLog[]): string[] {
  const seen = new Set<string>();
  for (const log of logs) {
    for (const uid of [log.actorUid, ...splitTargetUids(log)]) {
      const clean = String(uid || '').trim();
      if (clean) seen.add(clean);
    }
  }
  return [...seen];
}

/** 動作標籤色系（只決定 class，不決定文字）。 */
export function actionTone(action: string): 'msg' | 'view' | 'admin' {
  if (action === 'send' || action === 'read' || action === 'edit' || action === 'recall') return 'msg';
  if (action === 'audit_view_conversation') return 'view';
  return 'admin';
}
