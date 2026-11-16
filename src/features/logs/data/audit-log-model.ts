/**
 * 稽核日誌的純函式（2026-11-16 日誌中心第二批）。標籤照搬舊站 A `js/modules/audit-log.js`
 * （動作、結果、來源、對象類型），meta 改成「欄位：值」逐項（A 是原始 key=value 串）。
 */
export interface AuditEntry {
  _docId: string;
  action: string;
  actorUid: string;
  actorName: string;
  result: string;
  source: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  meta: Record<string, unknown>;
  createdAtMs: number;
}

/** A `_getAuditActionOptions`（「全部行為」由下拉自己提供）。 */
export const AUDIT_ACTIONS: ReadonlyArray<readonly [string, string]> = [
  ['login_success', '登入成功'],
  ['login_failure', '登入失敗'],
  ['logout', '登出'],
  ['event_signup', '活動報名'],
  ['event_cancel_signup', '取消報名'],
  ['team_join_request', '申請入隊'],
  ['team_join_approve', '同意入隊'],
  ['team_join_reject', '拒絕入隊'],
  ['role_change', '角色變更'],
  ['admin_user_edit', '管理員編輯用戶資料'],
];

export function auditActionLabel(action: string): string {
  return AUDIT_ACTIONS.find(([k]) => k === action)?.[1] || action || '未知行為';
}

export function auditResultLabel(result: string): string {
  if (result === 'success') return '成功';
  if (result === 'failure') return '失敗';
  return result || '未標示';
}

const SOURCE: Record<string, string> = { web: '網頁', liff: 'LINE', system: '系統', cloud_function: '後端' };
export function auditSourceLabel(source: string): string {
  return SOURCE[source] || source || '未標示';
}

const TARGET: Record<string, string> = { system: '系統', user: '用戶', event: '活動', team: '俱樂部', message: '訊息' };
export function auditTargetLabel(e: Pick<AuditEntry, 'targetType' | 'targetLabel' | 'targetId'>): string {
  const main = e.targetLabel || e.targetId;
  if (!main && !e.targetType) return '';
  return `${TARGET[e.targetType] || e.targetType || '目標'}：${main || '未命名'}`;
}

/** meta 逐項（A `_getAuditMetaPairs`）；值為物件時轉 JSON 一行。 */
export function auditMetaPairs(meta: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(meta || {})
    .map(([k, v]): [string, string] => {
      if (v == null) return [k, ''];
      if (typeof v === 'object') {
        try {
          return [k, JSON.stringify(v)];
        } catch {
          return [k, String(v)];
        }
      }
      return [k, String(v)];
    })
    .filter(([k, v]) => k.trim() && v.trim());
}

/** 搜尋文字（A `_getAuditSearchText` 欄位）。 */
export function auditSearchText(e: AuditEntry, displayName: string): string {
  return [
    displayName, e.actorUid, e.action, auditActionLabel(e.action), e.result, auditResultLabel(e.result),
    e.source, auditSourceLabel(e.source), e.targetType, e.targetId, e.targetLabel, e._docId,
    auditMetaPairs(e.meta).map(([k, v]) => `${k}=${v}`).join(' '),
  ].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean).join(' ');
}

/** Firestore 文件 → AuditEntry。Functions 寫 `actorId`，A 讀 `actorUid`，兩者都收。 */
export function toAuditEntry(id: string, d: Record<string, unknown>): AuditEntry {
  const ts = d['createdAt'] as { toMillis?: () => number; seconds?: number } | undefined;
  const ms = typeof ts?.toMillis === 'function' ? ts.toMillis() : typeof ts?.seconds === 'number' ? ts.seconds * 1000 : 0;
  const s = (k: string) => String(d[k] ?? '').trim();
  const actorUid = s('actorUid') || s('actorId');
  const actorName = s('actorName');
  return {
    _docId: id,
    action: s('action'),
    actorUid,
    actorName: actorName && actorName !== actorUid ? actorName : '',
    result: s('result'),
    source: s('source'),
    targetType: s('targetType'),
    targetId: s('targetId'),
    targetLabel: s('targetLabel'),
    meta: d['meta'] && typeof d['meta'] === 'object' ? (d['meta'] as Record<string, unknown>) : {},
    createdAtMs: ms,
  };
}

/** 台北日鍵 `yyyymmdd`（auditLogsByDay 的文件 ID）。 */
export function taipeiDayKey(ms: number): string {
  const t = new Date(ms + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}`;
}

/** 區間內由新到舊的日鍵（不超過現在）。 */
export function dayKeysDesc(startMs: number, endMs: number, nowMs: number): string[] {
  const keys: string[] = [];
  const DAY = 24 * 60 * 60 * 1000;
  let t = Math.min(endMs, nowMs + 1) - 1;
  while (t >= startMs) {
    const k = taipeiDayKey(t);
    if (keys[keys.length - 1] !== k) keys.push(k);
    t -= DAY;
  }
  const first = taipeiDayKey(startMs);
  if (keys[keys.length - 1] !== first && startMs <= Math.min(endMs, nowMs)) keys.push(first);
  return keys;
}
