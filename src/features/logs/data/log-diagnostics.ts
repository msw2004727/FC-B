/**
 * 稽核／錯誤／用戶提示的「複製診斷包」文字（2026-11-16 日誌中心第二批）。
 * 欄位與順序照舊站 A：`error-log-insights.js#_buildErrorLogDiagnosticText`、`_buildErrorGroupDiagnosticText`、
 * `audit-log.js#_buildAuditLogDiagnosticText`。時間一律台北 `YYYY/MM/DD HH:mm`。
 */
import { auditActionLabel, auditMetaPairs, auditResultLabel, auditSourceLabel, auditTargetLabel, type AuditEntry } from './audit-log-model';
import {
  chineseMessage,
  codeLabel,
  deviceLabel,
  displayCode,
  errorContext,
  errorMs,
  errorWhere,
  isUserPrompt,
  promptCategory,
  promptMessage,
  promptSurface,
  severityOf,
  type ErrorGroup,
  type ErrorLogDoc,
} from './error-log-model';

const SEVERITY_LABEL = { critical: '嚴重', warn: '警告', info: '一般', prompt: '提示' } as const;

export function taipeiDateTime(ms: number): string {
  if (!ms) return '';
  const t = new Date(ms + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

function contextSummary(log: ErrorLogDoc): string {
  const obj = errorContext(log);
  if (!obj) return typeof log.context === 'string' ? log.context : '';
  const parts: string[] = [];
  if (obj['fn']) parts.push(String(obj['fn']));
  for (const [k, v] of Object.entries(obj)) if (k !== 'fn' && v != null && v !== '') parts.push(`${k}=${String(v)}`);
  return parts.join(', ');
}

export function buildErrorDiagnostic(log: ErrorLogDoc): string {
  const head = [
    `用戶：${log.userName || ''} / ${log.uid || ''}`,
    `頁面/功能：${String(log.page || 'unknown')} / ${errorWhere(log)}`,
    `版本/裝置：${log.appVersion || ''} / ${deviceLabel(log)}`,
    `URL：${log.url || ''}`,
    `Context：${contextSummary(log)}`,
  ];
  if (isUserPrompt(log)) {
    return [
      'ToosterX 用戶提示診斷包',
      `時間：${taipeiDateTime(errorMs(log)) || log.time || ''}`,
      `提示來源：${promptSurface(log).label}`,
      `提示分類：${promptCategory(log).label}`,
      `提示內容：${promptMessage(log) || chineseMessage(log)}`,
      ...head,
      `原始訊息：${log.errorMessage || ''}`,
      `文件 ID：${log._docId || ''}`,
    ].join('\n');
  }
  return [
    'ToosterX 錯誤診斷包',
    `時間：${taipeiDateTime(errorMs(log)) || log.time || ''}`,
    `嚴重度：${SEVERITY_LABEL[severityOf(log)]}`,
    `白話錯誤：${chineseMessage(log)}`,
    `錯誤類型：${codeLabel(log)} (${displayCode(log) || 'no-code'})`,
    ...head,
    `原始錯誤：${log.errorMessage || ''}`,
    `Stack：${String(log.errorStack || '').slice(0, 1200)}`,
    ...(log.diag ? [`載入診斷：${log.diag}`] : []),
    `文件 ID：${log._docId || ''}`,
  ].join('\n');
}

export function buildErrorGroupDiagnostic(group: ErrorGroup): string {
  const versions = [...new Set(group.logs.map((l) => String(l.appVersion || '').trim()).filter(Boolean))];
  const devices = [...new Set(group.logs.map(deviceLabel).filter(Boolean))];
  const times = group.logs.map(errorMs).filter(Boolean);
  const first = times.length ? Math.min(...times) : 0;
  return [
    'ToosterX 同類錯誤診斷包',
    `筆數：${group.logs.length}`,
    `嚴重度：${SEVERITY_LABEL[group.severity]}`,
    `白話錯誤：${group.message}`,
    `錯誤類型：${group.label}`,
    `頁面/功能：${group.page} / ${group.where}`,
    `受影響用戶數：${group.users}`,
    `版本：${versions.join(', ')}`,
    `裝置：${devices.join(', ')}`,
    `最早/最近：${taipeiDateTime(first)} / ${taipeiDateTime(group.lastMs)}`,
    '',
    group.logs[0] ? buildErrorDiagnostic(group.logs[0]) : '',
  ].join('\n');
}

export function buildAuditDiagnostic(e: AuditEntry, displayName: string): string {
  return [
    'ToosterX 稽核日誌診斷包',
    `時間：${taipeiDateTime(e.createdAtMs) || '未標示'}`,
    `結果：${auditResultLabel(e.result)} (${e.result || 'unknown'})`,
    `動作：${auditActionLabel(e.action)} (${e.action || 'unknown'})`,
    `操作者：${displayName || '未知用戶'} / ${e.actorUid || '未標示'}`,
    `目標：${auditTargetLabel(e) || '未標示'}`,
    `來源：${auditSourceLabel(e.source)}${e.source ? ` (${e.source})` : ''}`,
    `Meta：${auditMetaPairs(e.meta).map(([k, v]) => `${k}=${v}`).join(' · ') || '無'}`,
    `文件 ID：${e._docId || '未標示'}`,
  ].join('\n');
}
