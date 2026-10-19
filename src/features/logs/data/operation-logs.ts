import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';

export const OPERATION_LOGS_COLLECTION = 'operationLogs' as const;
export const OPERATION_LOGS_FETCH_LIMIT = 200;

export interface FirestoreTimestampLike {
  toDate?: () => Date;
  seconds?: number;
  nanoseconds?: number;
}

export interface OperationLogDoc {
  _docId?: string;
  id?: string;
  actorUid?: string | null;
  operator?: string;
  type?: string;
  typeName?: string;
  content?: string;
  eventId?: string;
  time?: string;
  createdAt?: FirestoreTimestampLike | Date | number | string | null;
}

export type OperationLogTone =
  | 'log-tone-blue'
  | 'log-tone-violet'
  | 'log-tone-purple'
  | 'log-tone-green'
  | 'log-tone-teal'
  | 'log-tone-orange'
  | 'log-tone-indigo'
  | 'log-tone-sky'
  | 'log-tone-pink'
  | 'log-tone-amber'
  | 'log-tone-cyan'
  | 'log-tone-rose'
  | 'log-tone-red'
  | 'log-tone-gray';

export interface DiagnosticTextLabels {
  header?: string;
  timeLabel?: string;
  typeLabel?: string;
  operatorLabel?: string;
  contentLabel?: string;
  eventIdLabel?: string;
  docIdLabel?: string;
  uncategorized?: string;
  unmarked?: string;
  none?: string;
}

/** 照 A `_buildCollectionQuery('operationLogs')`：collection('operationLogs') + orderBy('createdAt','desc') + limit(200) 一次讀取。 */
export async function fetchOperationLogs(): Promise<OperationLogDoc[]> {
  const { db } = await getFirebase();
  const q = query(
    collection(db, OPERATION_LOGS_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(OPERATION_LOGS_FETCH_LIMIT),
  );
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => {
    const data = (docSnap.data() as Record<string, unknown> | undefined) ?? {};
    return {
      ...data,
      _docId: docSnap.id,
      id: typeof data.id === 'string' && data.id.trim() ? data.id : docSnap.id,
    } as OperationLogDoc;
  });
}

/** A `_getOperationLogDocId` */
export function getOperationLogDocId(log: OperationLogDoc | null | undefined): string {
  return String(log?._docId || log?.id || '').trim();
}

function parseCreatedAtDate(createdAt: OperationLogDoc['createdAt']): Date | null {
  if (!createdAt) return null;
  if (createdAt instanceof Date) {
    return Number.isNaN(createdAt.getTime()) ? null : createdAt;
  }
  if (typeof createdAt === 'object') {
    if (typeof createdAt.toDate === 'function') {
      const d = createdAt.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (typeof createdAt.seconds === 'number') {
      const ms = createdAt.seconds * 1000 + Math.floor((createdAt.nanoseconds || 0) / 1000000);
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

/** A `_formatOperationLogCreatedAt` */
export function formatOperationLogCreatedAt(
  log: OperationLogDoc | null | undefined,
  fallbackLabel = '未標示',
): string {
  const date = parseCreatedAtDate(log?.createdAt);
  if (!date) {
    return String(log?.time || '').trim() || fallbackLabel;
  }
  return date.toLocaleString('zh-TW', { hour12: false });
}

/** A `user-admin-exp.js#_getOperationLogSortMs`：文件 ID 的 13 位時間戳 → createdAt → `MM/DD HH:mm`（跨年修正）。 */
export function getOperationLogSortMs(log: OperationLogDoc | null | undefined, now: Date = new Date()): number {
  const docId = String(log?._docId || '');
  const docIdMatch = docId.match(/^op_(\d{13})_/);
  if (docIdMatch) return Number(docIdMatch[1]);

  const date = parseCreatedAtDate(log?.createdAt);
  if (date) return date.getTime();

  const time = String(log?.time || '').trim();
  const match = time.match(/^(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return 0;
  const parsed = new Date(
    now.getFullYear(),
    Number(match[1]) - 1,
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    0,
    0,
  );
  // A：只存月日時，避免把去年的紀錄當成未來。
  if (parsed.getTime() > now.getTime() + (31 * 24 * 60 * 60 * 1000)) {
    parsed.setFullYear(parsed.getFullYear() - 1);
  }
  return parsed.getTime();
}

/** A `user-admin-exp.js#_shouldHideDuplicatedOperationLog`：與其他日誌重複的類型不顯示。 */
export function shouldHideDuplicatedOperationLog(log: OperationLogDoc | null | undefined): boolean {
  const type = String(log?.type || '').trim();
  const content = String(log?.content || '');
  if (!type) return false;
  if (type === 'cancel_signup') return true;
  if (type === 'team_join_request') return true;
  if (type === 'user_restriction') return true;
  if (type === 'team_approve') return content.includes('同意') || content.includes('拒絕');
  if (type === 'role') return content.includes('→') || content.startsWith('編輯「');
  return false;
}

export function getVisibleOperationLogs(
  logs: readonly OperationLogDoc[] | null | undefined,
): OperationLogDoc[] {
  return (logs || []).filter((log) => !shouldHideDuplicatedOperationLog(log));
}

/** A `user-admin-exp.js#_getOperationLogSearchText`（欄位順序照 A）。 */
export function getOperationLogSearchText(log: OperationLogDoc | null | undefined): string {
  const parts = [
    log?.time,
    formatOperationLogCreatedAt(log),
    log?.operator,
    log?.actorUid,
    log?.type,
    log?.typeName,
    log?.content,
    log?.eventId,
    getOperationLogDocId(log),
  ];
  return parts
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

/** A `_matchesOperationLogKeyword` */
export function matchesOperationLogKeyword(
  log: OperationLogDoc | null | undefined,
  keyword: string,
): boolean {
  const normalized = String(keyword || '').trim().toLowerCase();
  return !normalized || getOperationLogSearchText(log).includes(normalized);
}

/** A `user-admin-exp.js#_getOperationLogToneClass`：類型對照表，找不到時依前綴，再不然灰色。 */
const TYPE_TONE_MAP: Readonly<Record<string, OperationLogTone>> = {
  exp: 'log-tone-blue',
  team_exp: 'log-tone-violet',
  role: 'log-tone-purple',
  system_clear: 'log-tone-red',
  audit_backfill: 'log-tone-rose',
  manual_attendance: 'log-tone-cyan',
  participant_removed: 'log-tone-orange',
  unreg_removed: 'log-tone-amber',
  event_create: 'log-tone-green',
  event_edit: 'log-tone-sky',
  event_end: 'log-tone-amber',
  event_cancel: 'log-tone-red',
  event_reopen: 'log-tone-teal',
  event_relist: 'log-tone-indigo',
  event_delete: 'log-tone-red',
  team_create: 'log-tone-orange',
  team_edit: 'log-tone-amber',
  team_delete: 'log-tone-red',
  team_position: 'log-tone-purple',
  team_leave: 'log-tone-gray',
  team_member_remove: 'log-tone-rose',
  team_approve: 'log-tone-indigo',
  tourn_create: 'log-tone-indigo',
  tourn_edit: 'log-tone-violet',
  tourn_end: 'log-tone-amber',
  tourn_reopen: 'log-tone-cyan',
  tourn_delete: 'log-tone-red',
  tourn_approve: 'log-tone-green',
  ann_create: 'log-tone-sky',
  ann_edit: 'log-tone-blue',
  ann_toggle: 'log-tone-amber',
  ann_delete: 'log-tone-red',
  ach_create: 'log-tone-pink',
  ach_edit: 'log-tone-purple',
  ach_toggle: 'log-tone-amber',
  ach_delete: 'log-tone-red',
  shop_create: 'log-tone-amber',
  shop_edit: 'log-tone-orange',
  shop_delist: 'log-tone-gray',
  shop_relist: 'log-tone-cyan',
  shop_delete: 'log-tone-red',
  game_config: 'log-tone-cyan',
};

const TYPE_PREFIX_TONES: ReadonlyArray<readonly [string, OperationLogTone]> = [
  ['event_', 'log-tone-green'],
  ['team_', 'log-tone-orange'],
  ['tourn_', 'log-tone-indigo'],
  ['audit_', 'log-tone-rose'],
  ['ann_', 'log-tone-sky'],
  ['ach_', 'log-tone-pink'],
  ['shop_', 'log-tone-amber'],
  ['game_', 'log-tone-cyan'],
];

export function getOperationLogToneClass(type: string | null | undefined): OperationLogTone {
  const key = String(type || '').trim();
  if (!key) return 'log-tone-gray';
  const direct = TYPE_TONE_MAP[key];
  if (direct) return direct;
  for (const [prefix, tone] of TYPE_PREFIX_TONES) {
    if (key.startsWith(prefix)) return tone;
  }
  return 'log-tone-gray';
}

/** A `_buildOperationLogDiagnosticText` */
export function buildOperationLogDiagnosticText(
  log: OperationLogDoc | null | undefined,
  labels?: DiagnosticTextLabels,
): string {
  const header = labels?.header ?? 'ToosterX 操作日誌診斷包';
  const timeLabel = labels?.timeLabel ?? '時間';
  const typeLabel = labels?.typeLabel ?? '類型';
  const operatorLabel = labels?.operatorLabel ?? '操作者';
  const contentLabel = labels?.contentLabel ?? '內容';
  const eventIdLabel = labels?.eventIdLabel ?? '活動 ID';
  const docIdLabel = labels?.docIdLabel ?? '文件 ID';
  const uncategorized = labels?.uncategorized ?? '未分類';
  const unmarked = labels?.unmarked ?? '未標示';
  const none = labels?.none ?? '無';

  return [
    header,
    `${timeLabel}：${formatOperationLogCreatedAt(log, unmarked)}`,
    `${typeLabel}：${log?.typeName || uncategorized} (${log?.type || 'unknown'})`,
    `${operatorLabel}：${log?.operator || unmarked} / ${log?.actorUid || unmarked}`,
    `${contentLabel}：${log?.content || unmarked}`,
    `${eventIdLabel}：${log?.eventId || none}`,
    `${docIdLabel}：${getOperationLogDocId(log) || unmarked}`,
  ].join('\n');
}

/** A `copyOperationLogDiagnostic` 複製邏輯（支援 navigator.clipboard 與 textarea 降級）。 */
export async function copyDiagnosticTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === 'undefined') {
    throw new Error('Clipboard API unavailable');
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
  textarea.remove();
  if (!ok) {
    throw new Error('execCommand copy failed');
  }
}
