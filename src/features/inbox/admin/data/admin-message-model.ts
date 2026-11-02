/**
 * 站內信管理（後台）的純資料規則，對應 A：
 * - `js/modules/message/message-admin-list.js#renderMsgManage`（頁籤分組、計數、狀態標籤、卡片按鈕）
 * - `js/modules/message/message-admin-compose.js#sendMessage`（對象對照、角色清單、驗證、admin 紀錄欄位）
 * - `js/modules/message/message-admin.js#_processScheduledMessages`（到期判斷）
 *
 * 權限照 A（不新增權限碼）：
 * - 進頁：`admin.messages.entry`（A DRAWER_MENUS／Rules canReadAdminMessages）。
 * - 發送：`admin.messages.compose ∨ admin.messages.entry`（A `sendMessage`）。
 * - 刪除：`admin.messages.delete ∨ admin.messages.entry`（A `deleteMsg`）。
 * - 回收、取消／恢復排程：頁面可進即可（A 沒有另外的判斷）。
 * 按鈕顯示與 handler 都呼叫這裡同一個函式（R-IAM-011）。
 */

import { formatTaipei, parseTaipei } from '@/core/taipei-time';
import { generateId } from '@/data/ids';

export type AdminMessageStatus = 'sent' | 'scheduled' | 'processing' | 'recalled' | 'cancelled' | 'deleted';
export type MsgTab = 'sent' | 'scheduled' | 'recalled' | 'deleted';
export type MsgCategory = 'system' | 'activity' | 'private';
export type MsgTargetType =
  | 'all'
  | 'coach'
  | 'captain'
  | 'venue_owner'
  | 'coach_up'
  | 'admin'
  | 'team'
  | 'individual';

/** `adminMessages` 文件（欄位照 A `sendMessage` 的 adminMsg）。 */
export interface AdminMessage {
  _docId: string;
  id: string;
  title: string;
  body: string;
  category?: string;
  categoryName?: string;
  target?: string;
  targetUid?: string | null;
  targetName?: string | null;
  targetTeamId?: string | null;
  targetRoles?: string[] | null;
  targetType?: string;
  senderName?: string;
  readRate?: string;
  time?: string;
  status: string;
  scheduledAt?: string | null;
  [key: string]: unknown;
}

export interface MessageViewer {
  uid: string | null;
  role: string;
  hasPermission: (code: string) => boolean;
}

export const MSG_TABS: readonly MsgTab[] = ['sent', 'scheduled', 'recalled', 'deleted'];

/** A `catNames`：寫進資料的類別名稱（資料值，不隨語系變）。 */
export const CATEGORY_NAMES: Readonly<Record<MsgCategory, string>> = {
  system: '系統',
  activity: '活動',
  private: '私訊',
};

export const MSG_CATEGORIES: readonly MsgCategory[] = ['system', 'activity', 'private'];

/** A `#msg-target` 的選項順序。 */
export const MSG_TARGET_TYPES: readonly MsgTargetType[] = [
  'all',
  'coach',
  'captain',
  'venue_owner',
  'coach_up',
  'admin',
  'team',
  'individual',
];

/** A `targetLabelMap`：寫進資料的對象名稱（資料值，不隨語系變）。 */
export const TARGET_LABELS: Readonly<Partial<Record<MsgTargetType, string>>> = {
  all: '全體用戶',
  coach_up: '教練以上',
  admin: '管理員',
  coach: '全體教練',
  captain: '全體領隊',
  venue_owner: '全體場主',
};

/** A `roleTargetMap`（與 `_queueLinePushByTarget` 的 roleFilter 一致）。 */
export const ROLE_TARGETS: Readonly<Partial<Record<MsgTargetType, readonly string[]>>> = {
  coach: ['coach', 'admin', 'super_admin'],
  captain: ['captain', 'admin', 'super_admin'],
  venue_owner: ['venue_owner', 'admin', 'super_admin'],
  coach_up: ['coach', 'captain', 'venue_owner', 'admin', 'super_admin'],
  admin: ['admin', 'super_admin'],
};

export const MSG_TITLE_MAX = 12;
export const MSG_BODY_MAX = 300;

export function canAccessMessagesPage(viewer: MessageViewer): boolean {
  return viewer.hasPermission('admin.messages.entry');
}

/** A `sendMessage` 開頭的權限判斷。 */
export function canComposeMessage(viewer: MessageViewer): boolean {
  return viewer.hasPermission('admin.messages.compose') || viewer.hasPermission('admin.messages.entry');
}

/** A `deleteMsg` 開頭的權限判斷。 */
export function canDeleteMessage(viewer: MessageViewer): boolean {
  return viewer.hasPermission('admin.messages.delete') || viewer.hasPermission('admin.messages.entry');
}

/**
 * 排程執行者：照顧問方案「只對 admin 以上身分」。伺服器 `deliverToInbox` 群發只放行角色 admin／super_admin，
 * 其他身分搶到排程信也送不出去，所以不讓他們搶。
 */
export function canRunScheduledMessages(viewer: MessageViewer): boolean {
  if (!viewer.uid) return false;
  if (viewer.role !== 'admin' && viewer.role !== 'super_admin') return false;
  return viewer.hasPermission('admin.messages.entry');
}

/** A `renderMsgManage`：排程頁籤同時顯示 scheduled＋processing＋cancelled。 */
export function filterMessagesForTab(items: readonly AdminMessage[], tab: MsgTab): AdminMessage[] {
  if (tab === 'scheduled') {
    return items.filter((m) => m.status === 'scheduled' || m.status === 'processing' || m.status === 'cancelled');
  }
  return items.filter((m) => m.status === tab);
}

export interface MsgCounts {
  sent: number;
  scheduled: number;
  recalled: number;
  deleted: number;
}

/** 計數列分組（A：排程計數＝scheduled＋processing，不含 cancelled）。 */
export function countBucketOf(status: string): keyof MsgCounts | null {
  if (status === 'sent') return 'sent';
  if (status === 'scheduled' || status === 'processing') return 'scheduled';
  if (status === 'recalled') return 'recalled';
  if (status === 'deleted') return 'deleted';
  return null;
}

/** 狀態改變後就地調整計數（0 讀）。 */
export function shiftCounts(counts: MsgCounts, fromStatus: string | null, toStatus: string): MsgCounts {
  const next = { ...counts };
  const from = fromStatus ? countBucketOf(fromStatus) : null;
  const to = countBucketOf(toStatus);
  if (from === to) return next;
  if (from) next[from] = Math.max(0, next[from] - 1);
  if (to) next[to] += 1;
  return next;
}

/** A statusMap：[class, 文案 key]。 */
export function statusBadgeOf(status: string): { cls: string; known: boolean } {
  switch (status) {
    case 'sent':
      return { cls: 'active', known: true };
    case 'scheduled':
    case 'processing':
      return { cls: 'scheduled', known: true };
    case 'recalled':
    case 'deleted':
      return { cls: 'expired', known: true };
    case 'cancelled':
      return { cls: 'empty', known: true };
    default:
      return { cls: 'empty', known: false };
  }
}

export type MsgCardAction = 'view' | 'recall' | 'delete' | 'cancelSchedule' | 'restoreSchedule';

/** A `renderMsgManage` 各狀態的卡片按鈕；刪除另依 `canDeleteMessage`（同一判斷控制 handler）。 */
export function cardActionsOf(status: string, viewer: MessageViewer): MsgCardAction[] {
  const canDelete = canDeleteMessage(viewer);
  const withDelete = (list: MsgCardAction[]): MsgCardAction[] => (canDelete ? [...list, 'delete'] : list);
  switch (status) {
    case 'sent':
      return withDelete(['view', 'recall']);
    case 'scheduled':
      return withDelete(['view', 'cancelSchedule']);
    case 'processing':
      return ['view'];
    case 'recalled':
      return withDelete(['view']);
    case 'cancelled':
      return withDelete(['view', 'restoreSchedule']);
    case 'deleted':
      return ['view'];
    default:
      return [];
  }
}

/** A 卡片／詳情的對象文字：`暱稱（UID）` 或對象名稱。 */
export function targetLabelOf(m: Pick<AdminMessage, 'target' | 'targetUid' | 'targetName'>): string {
  if (m.targetUid) return `${m.targetName || m.targetUid}（${m.targetUid}）`;
  return String(m.target ?? '');
}

/** 排程時間（A 存 datetime-local 字串）→ 毫秒；以台北牆鐘解讀。 */
export function scheduledAtMs(value: unknown): number | null {
  return parseTaipei(value);
}

/** A 卡片的排程時間 `YYYY/MM/DD HH:mm`；無法解析回空字串。 */
export function formatScheduleText(value: unknown): string {
  const ms = scheduledAtMs(value);
  return ms === null ? '' : formatTaipei(ms);
}

/** A `_processScheduledMessages` 的到期判斷。 */
export function isScheduledDue(m: Pick<AdminMessage, 'status' | 'scheduledAt'>, nowMs: number): boolean {
  if (m.status !== 'scheduled' || !m.scheduledAt) return false;
  const ms = scheduledAtMs(m.scheduledAt);
  return ms !== null && ms <= nowMs;
}

export type ComposeError =
  | 'titleRequired'
  | 'titleTooLong'
  | 'bodyRequired'
  | 'bodyTooLong'
  | 'teamRequired'
  | 'userRequired';

export interface ComposeInput {
  category: MsgCategory;
  title: string;
  body: string;
  targetType: MsgTargetType;
  schedule: string;
  team: { id: string; name: string } | null;
  user: { uid: string; name: string } | null;
}

/** A `sendMessage` 的檢查順序：標題 → 內容 → 指定俱樂部／用戶。 */
export function validateCompose(input: ComposeInput): ComposeError | null {
  const title = input.title.trim();
  if (!title) return 'titleRequired';
  if (title.length > MSG_TITLE_MAX) return 'titleTooLong';
  const body = input.body.trim();
  if (!body) return 'bodyRequired';
  if (body.length > MSG_BODY_MAX) return 'bodyTooLong';
  if (input.targetType === 'team' && !input.team) return 'teamRequired';
  if (input.targetType === 'individual' && !input.user) return 'userRequired';
  return null;
}

/** A `_getMsgSenderName`：暱稱優先，否則「系統」。 */
export function senderNameOf(displayName: string | null | undefined): string {
  return displayName ? displayName : '系統';
}

/** A `sendMessage` 建立的 admin 紀錄（不含 createdAt；寫入時由伺服器時間補上）。 */
export function buildAdminMessageRecord(
  input: ComposeInput,
  senderName: string,
  now: Date = new Date(),
): Omit<AdminMessage, '_docId'> {
  const title = input.title.trim();
  const body = input.body.trim();
  const schedule = input.schedule.trim();
  const isScheduled = schedule.length > 0;
  let target = TARGET_LABELS[input.targetType] ?? TARGET_LABELS.all ?? '全體用戶';
  let targetUid: string | null = null;
  let targetName: string | null = null;
  let targetTeamId: string | null = null;
  const roles = ROLE_TARGETS[input.targetType];
  if (input.targetType === 'team' && input.team) {
    target = input.team.name;
    targetTeamId = input.team.id;
  } else if (input.targetType === 'individual' && input.user) {
    target = input.user.name;
    targetUid = input.user.uid;
    targetName = input.user.name;
  }
  return {
    id: generateId('mg_'),
    title,
    category: input.category,
    categoryName: CATEGORY_NAMES[input.category] ?? '系統',
    target,
    targetUid,
    targetName,
    targetTeamId,
    targetRoles: roles ? [...roles] : null,
    targetType: input.targetType,
    senderName,
    readRate: '-',
    time: formatTaipei(now.getTime()),
    status: isScheduled ? 'scheduled' : 'sent',
    body,
    scheduledAt: isScheduled ? schedule : null,
  };
}
