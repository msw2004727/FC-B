/**
 * 錯誤日誌／用戶提示的純函式（2026-11-16 日誌中心第二批）。
 * 規則照搬舊站 A `js/modules/error-log-diagnostics.js`（嚴重度、錯誤代碼中文名、中文訊息、用戶提示判斷、裝置）
 * 與 `error-log-insights.js#_getErrorLogGroups`（分組），資料與判斷不改；只改呈現（見 ErrorLogPanel）。
 */
export interface ErrorLogDoc {
  _docId?: string;
  uid?: string;
  userName?: string;
  role?: string;
  context?: unknown;
  errorCode?: string;
  errorMessage?: string;
  errorStack?: string;
  page?: string;
  appVersion?: string;
  url?: string;
  hash?: string;
  userAgent?: string;
  osName?: string;
  browserName?: string;
  time?: string;
  clientTimeIso?: string;
  createdAt?: { seconds?: number; nanoseconds?: number; toMillis?: () => number } | null;
}

export type Severity = 'critical' | 'warn' | 'info' | 'prompt';

function normCode(value: unknown): string {
  return String(value || '').trim().replace(/^functions\//i, '').toLowerCase();
}

export function errorContext(log: ErrorLogDoc): Record<string, unknown> | null {
  const ctx = log.context;
  if (!ctx) return null;
  try {
    const obj = typeof ctx === 'string' ? JSON.parse(ctx) : ctx;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isIndexedDbTransient(log: ErrorLogDoc): boolean {
  return normCode(log.errorCode) === 'firestore-indexeddb-transient'
    || String(log.errorMessage || '').toLowerCase().includes('attempt to get records from database without an in-progress transaction');
}

function isProfileIncomplete(log: ErrorLogDoc): boolean {
  const c = errorContext(log) || {};
  return [log.errorCode, log.errorMessage, c['errCode'], c['reason'], c['action']]
    .map((v) => String(v || '')).join(' ').toUpperCase().includes('PROFILE_INCOMPLETE');
}

/** A `_isUserPromptLog`。 */
export function isUserPrompt(log: ErrorLogDoc): boolean {
  const code = normCode(log.errorCode);
  const c = errorContext(log) || {};
  const t = String(c['logType'] || c['type'] || '').trim().toLowerCase();
  return code === 'user-prompt' || code === 'client-prompt' || t === 'user_prompt' || t === 'user-prompt';
}

export function promptMessage(log: ErrorLogDoc): string {
  const c = errorContext(log) || {};
  return String(c['promptMessage'] || c['message'] || log.errorMessage || '').trim();
}

const SURFACE: Record<string, string> = { toast: '提示訊息', relogin_modal: '重新登入彈窗', manual: '手動紀錄' };
const PROMPT_KEY: Record<string, string> = {
  session_expired: '登入過期／不同步',
  sdk_error: '瀏覽器儲存異常',
  auth_session_prompt: '登入狀態提示',
  reauth_required_prompt: '要求重新登入',
};

/** A `_getUserPromptSurfaceInfo`（A 的「Toast 提示」改為中文「提示訊息」）。 */
export function promptSurface(log: ErrorLogDoc): { key: string; label: string } {
  const key = String((errorContext(log) || {})['surface'] || 'toast').trim() || 'toast';
  return { key, label: SURFACE[key] || key };
}

/** A `_getUserPromptKeyLabel`（「Session 過期」改中文）。 */
export function promptCategory(log: ErrorLogDoc): { key: string; label: string } {
  const key = String((errorContext(log) || {})['promptKey'] || '').trim();
  return { key, label: key ? (PROMPT_KEY[key] || key) : '未分類' };
}

/** A `_getErrorSeverity`。 */
export function severityOf(log: ErrorLogDoc): Severity {
  const code = normCode(log.errorCode);
  const msg = String(log.errorMessage || '').toLowerCase();
  if (isIndexedDbTransient(log)) return 'info';
  if (isUserPrompt(log)) return 'prompt';
  if (isProfileIncomplete(log)) return 'info';
  if (['permission-denied', 'unauthenticated', 'failed-precondition', 'internal', 'unknown', 'data-loss'].includes(code)
    || /permission|forbidden|auth|unauth|rules|insufficient permissions/.test(msg)) return 'critical';
  if (['deadline-exceeded', 'unavailable', 'resource-exhausted', 'aborted', 'cancelled', 'network-request-failed'].includes(code)
    || /timeout|timed out|network|failed to fetch|load failed|quota|too many requests|unavailable/.test(msg)) return 'warn';
  return 'info';
}

const CODE_LABEL: Record<string, string> = {
  'firestore-indexeddb-transient': '本地快取暫態錯誤',
  'permission-denied': '權限不足',
  unauthenticated: '登入失效',
  'not-found': '找不到資料',
  'already-exists': '資料已存在',
  'failed-precondition': '前置條件不符',
  'resource-exhausted': '資源已達上限',
  'deadline-exceeded': '操作逾時',
  cancelled: '操作取消',
  unavailable: '服務不可用',
  'network-request-failed': '網路錯誤',
  'invalid-argument': '參數錯誤',
  profile_incomplete: '個人資料未補齊',
  'user-prompt': '用戶提示',
  'client-prompt': '用戶提示',
  internal: '系統錯誤',
  unknown: '未知錯誤',
  aborted: '流程中止',
};

/** 原始代碼（只放在診斷包與灰字），A `_getErrorDisplayCode`。 */
export function displayCode(log: ErrorLogDoc): string {
  if (isUserPrompt(log)) return 'USER_PROMPT';
  if (isProfileIncomplete(log)) return 'PROFILE_INCOMPLETE';
  return normCode(log.errorCode);
}

/** 中文類型名，A `_getErrorDisplayCodeLabel`。 */
export function codeLabel(log: ErrorLogDoc): string {
  if (isUserPrompt(log)) return '用戶提示';
  if (isProfileIncomplete(log)) return '個人資料未補齊';
  const code = normCode(log.errorCode);
  return CODE_LABEL[code] || code || '未分類';
}

const CODE_MSG: Record<string, string> = {
  'firestore-indexeddb-transient': '瀏覽器本地快取暫時不穩，多半發生在 LINE 內建瀏覽器。這不代表資料壞掉，通常重新整理即可恢復。',
  'permission-denied': '權限不足，這個操作被系統拒絕。可能是登入狀態過期，或目前身分沒有這個權限。',
  unauthenticated: '登入狀態失效，請重新登入後再試。',
  'not-found': '找不到要操作的資料，可能已被刪除或尚未同步。',
  'already-exists': '資料已存在，系統拒絕重複建立。',
  'failed-precondition': '目前資料狀態不符合操作條件，請重新整理後再試。',
  'resource-exhausted': '操作太頻繁或系統資源暫時不足，請稍後再試。',
  'deadline-exceeded': '連線逾時，可能是網路不穩或服務回應較慢。',
  cancelled: '操作已被取消，請重新操作一次。',
  unavailable: '目前連線或服務不穩，請稍後再試。',
  'network-request-failed': '網路連線失敗，請檢查網路後再試。',
  'invalid-argument': '送出的資料格式不正確，系統無法完成操作。',
  internal: '系統發生未預期錯誤，請管理員查看詳細紀錄。',
  unknown: '系統發生未知錯誤，請管理員查看詳細紀錄。',
  aborted: '流程中止，請重新整理後再試。',
};

/** 白話錯誤，A `_getErrorChineseMessage` 原文照搬（診斷包也用這句；畫面單行省略）。 */
export function chineseMessage(log: ErrorLogDoc): string {
  const code = normCode(log.errorCode);
  const raw = String(log.errorMessage || '').trim();
  const lower = raw.toLowerCase();
  if (isIndexedDbTransient(log)) return CODE_MSG['firestore-indexeddb-transient']!;
  if (isUserPrompt(log)) return promptMessage(log) || '用戶看到了系統提示，請展開技術細節確認提示內容。';
  if (isProfileIncomplete(log)) return '請先補齊個人資料（性別、生日、地區）後再報名。';
  if (CODE_MSG[code]) return CODE_MSG[code]!;
  if (/missing or insufficient permissions|the caller does not have permission|permission denied|insufficient permissions/.test(lower)) return CODE_MSG['permission-denied']!;
  if (/authentication required|requires authentication|auth token is expired|id token has expired|user token expired/.test(lower)) return CODE_MSG['unauthenticated']!;
  if (/network request failed|failed to fetch|load failed|networkerror/.test(lower)) return CODE_MSG['network-request-failed']!;
  if (/no document to update|document does not exist|not found/.test(lower)) return CODE_MSG['not-found']!;
  if (/is required|missing required/.test(lower)) return '缺少必要資料，系統無法完成操作。';
  if (/too many requests|quota exceeded|resource exhausted/.test(lower)) return CODE_MSG['resource-exhausted']!;
  if (/timeout|timed out|deadline exceeded/.test(lower)) return CODE_MSG['deadline-exceeded']!;
  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  return '系統發生錯誤，請稍後再試；管理員可展開詳細紀錄追查原因。';
}

export function errorMs(log: ErrorLogDoc): number {
  const c = log.createdAt;
  if (c && typeof c.toMillis === 'function') return c.toMillis();
  if (c && typeof c.seconds === 'number') return c.seconds * 1000 + Math.floor((c.nanoseconds || 0) / 1e6);
  const iso = Date.parse(log.clientTimeIso || '');
  return Number.isFinite(iso) ? iso : 0;
}

/** 發生位置（A `_getErrorFunctionName`）。 */
export function errorWhere(log: ErrorLogDoc): string {
  const c = errorContext(log);
  if (c?.['fn']) return String(c['fn']);
  const raw = typeof log.context === 'string' ? log.context.trim() : '';
  return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
}

/** 裝置短字（A `_getErrorDeviceInfo`／`_getErrorDeviceLabel`），例如「iOS · LINE」。 */
export function deviceLabel(log: ErrorLogDoc): string {
  const os = String(log.osName || '').trim();
  const br = String(log.browserName || '').trim();
  if (os || br) return `${os || '其他'}${br ? ` · ${br}` : ''}`;
  const t = String(log.userAgent || '');
  const osName = /iPhone|iPad|iPod/i.test(t) ? 'iOS' : /Android/i.test(t) ? 'Android' : /Windows/i.test(t) ? 'Windows'
    : /Macintosh|Mac OS X/i.test(t) ? 'macOS' : /Linux/i.test(t) ? 'Linux' : '其他';
  const b = /Line\//i.test(t) ? 'LINE' : /Edg\//i.test(t) ? 'Edge' : /CriOS|Chrome\//i.test(t) ? 'Chrome'
    : /FxiOS|Firefox\//i.test(t) ? 'Firefox' : /Safari\//i.test(t) ? 'Safari' : '';
  return `${osName}${b ? ` · ${b}` : ''}`;
}

export interface ErrorGroup {
  key: string;
  severity: Severity;
  label: string;
  message: string;
  page: string;
  where: string;
  logs: ErrorLogDoc[];
  users: number;
  lastMs: number;
}

/** 同類分組（A `_getErrorLogGroups` 的分組鍵），依次數、最近時間排序。 */
export function groupErrors(logs: readonly ErrorLogDoc[]): ErrorGroup[] {
  const map = new Map<string, ErrorGroup & { uids: Set<string> }>();
  for (const log of logs) {
    const sev = severityOf(log);
    const msg = chineseMessage(log);
    const page = String(log.page || 'unknown').trim();
    const where = errorWhere(log);
    const key = [sev, displayCode(log), page, where, msg].join('||').toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = { key, severity: sev, label: codeLabel(log), message: msg, page, where, logs: [], users: 0, lastMs: 0, uids: new Set() };
      map.set(key, g);
    }
    g.logs.push(log);
    if (log.uid) g.uids.add(String(log.uid));
    g.lastMs = Math.max(g.lastMs, errorMs(log));
  }
  return [...map.values()]
    .map(({ uids, ...g }) => ({ ...g, users: uids.size }))
    .sort((a, b) => (b.logs.length - a.logs.length) || (b.lastMs - a.lastMs));
}
