/**
 * O 階段：A 前端 action helpers 的純函式移植。
 * 不依 event.status、teamOnly、blockedUids 額外收窄；這些不是 A 操作 helper 條件。
 * R-IAM-004：依本次移植要求保留 A 前端 coach+ / entry fallback，
 * 不複製 Functions 的跨活動 scope drift。
 */

import {
  createPermissionChecker,
  getActivityRoleLevel,
  sanitizeRoleActivityCapabilities,
  sanitizeUserPermissionGrantCodeList,
  type CustomRole,
} from '../../profile/data/permissions';

export interface OperateUserGrant {
  uid?: unknown;
  enabled?: unknown;
  permissions?: unknown;
}

export interface OperateContext {
  uid: string | null;
  /** null 為未就緒／訪客，所有 helper 均拒絕，包括純 scope 判定。 */
  role: string | null;
  /** null 表示文件缺失；[] 表示文件存在、權限全關。 */
  rolePermissions: readonly string[] | null;
  userGrants: OperateUserGrant | null;
  /** A roleActivityCapabilities.user 的已解析值；[] 必須保留。 */
  capabilities: readonly string[];
  customRoles: readonly CustomRole[];
}

/** 接受 A 的 nullable／legacy 欄位，不要求修改 V 階段 EventDoc。 */
export interface OperateEvent {
  creatorUid?: unknown;
  ownerUid?: unknown;
  captainUid?: unknown;
  delegateUids?: unknown;
  privateEvent?: unknown;
  /** P2-13：Rules 課程連結活動分支只看 `courseLinked == true`。 */
  courseLinked?: unknown;
}

type EventInput = OperateEvent | null | undefined;

function ready(context: OperateContext): boolean {
  return context.role !== null;
}

function roleKey(context: OperateContext): string {
  return context.role || 'user';
}

function creatorUid(context: OperateContext): string {
  return String(context.uid || 'unknown').trim();
}

function isOwner(context: OperateContext, event: EventInput): boolean {
  if (!event) return false;
  const uid = creatorUid(context);
  if (!uid || uid === 'unknown') return false;
  return [event.creatorUid, event.ownerUid, event.captainUid]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .includes(uid);
}

function isDelegate(context: OperateContext, event: EventInput): boolean {
  const uid = creatorUid(context);
  if (!uid || !event || !Array.isArray(event.delegateUids)) return false;
  // A 明確未排除 'unknown' delegate；不可套用 owner 的 unknown guard。
  return event.delegateUids.some(value => String(value || '').trim() === uid);
}

function isScoped(context: OperateContext, event: EventInput): boolean {
  return !!event && (isOwner(context, event) || isDelegate(context, event));
}

function permissionChecker(context: OperateContext): (code: string) => boolean {
  const role = context.role === null ? null : String(roleKey(context)).trim() || 'user';
  const grant = context.userGrants;
  const uid = String(context.uid || '').trim();
  const validGrant = !!uid
    && !!grant
    && grant.enabled !== false
    && String(grant.uid || '').trim() === uid;

  return createPermissionChecker({
    role,
    rolePermissions: role !== null && context.rolePermissions !== null
      ? { [role]: context.rolePermissions }
      : {},
    userGrants: validGrant
      ? sanitizeUserPermissionGrantCodeList(grant?.permissions)
      : [],
    customRoles: context.customRoles,
  });
}

function canManageAll(context: OperateContext): boolean {
  return permissionChecker(context)('event.edit_all');
}

function canOperatePrivate(context: OperateContext, event: EventInput): boolean {
  if (!event || !event.privateEvent) return true;
  const level = getActivityRoleLevel(roleKey(context), context.customRoles);
  const admin = getActivityRoleLevel('admin', context.customRoles) || 4;
  return level >= admin || isOwner(context, event) || isDelegate(context, event);
}

export function hasUserActivityCapability(context: OperateContext, code: string): boolean {
  return ready(context)
    && roleKey(context) === 'user'
    && sanitizeRoleActivityCapabilities(context.capabilities).includes(code);
}

export function hasActivityManageEntry(context: OperateContext): boolean {
  if (!ready(context)) return false;
  const check = permissionChecker(context);
  // R-IAM-004：保留 A 的已知 coach+ fallback；rolePermissions: [] 不會關閉它。
  return check('activity.manage.entry')
    || getActivityRoleLevel(roleKey(context), context.customRoles)
      >= (getActivityRoleLevel('coach', context.customRoles) || 1)
    || check('event.edit_all');
}

/**
 * 健康檢查 2026-11-23 P2-13（顧問 §3.614，只修新站）：一般用戶的 `activity.manage.entry`（只可能來自個別授權）
 * 在直寫 Firestore 的編輯、取消、設委託人不算數——Rules 的 scoped 路徑 `isScopedRoleBasicUpdate` 要求 `authRole() != 'user'`，
 * 一般用戶只走 `isUserOwnerBasicUpdate`（要前台能力）。課程連結活動（`courseLinked == true`）的 Rules 分支
 * `isCourseLinkedManagerCancelUpdate` 接受 `canScopedManageEventData`（含個別授權入口），維持原判斷。
 * 取代原本「入口授權對一般用戶一律算數」：前端放行、送出卻被 Rules 拒絕（模擬器重現見 user-entry-grant.rules.test.ts）。
 * 舊站 A 有同樣缺口，依站長 11-06「舊站非必要 bug 不修」刻意不改、列待辦。
 * 例外：owner 同時有 `event.edit_self`（角色或個別授權）時，Rules 的 owner＋edit_self 分支可改 status／delegateUids，
 * 照原判斷放行（A oracle case-0007／0019／0031 即此組合）。
 */
function entryCountsForDirectWrite(context: OperateContext, event: EventInput): boolean {
  return roleKey(context) !== 'user'
    || event?.courseLinked === true
    || (isOwner(context, event) && permissionChecker(context)('event.edit_self'));
}

export function canEditOwnActivityBasic(context: OperateContext, event: EventInput): boolean {
  if (!ready(context) || !event || !canOperatePrivate(context, event)) return false;
  if (canManageAll(context)) return true;
  if (!isScoped(context, event)) return false;
  if ((hasActivityManageEntry(context) && entryCountsForDirectWrite(context, event))
    || permissionChecker(context)('event.edit_self')) return true;
  return hasUserActivityCapability(context, 'user.activity.own_edit_basic');
}

export function canCancelOwnActivity(context: OperateContext, event: EventInput): boolean {
  if (!ready(context) || !event || !canOperatePrivate(context, event)) return false;
  if (canManageAll(context)) return true;
  if (!isScoped(context, event)) return false;
  if (hasActivityManageEntry(context) && entryCountsForDirectWrite(context, event)) return true;
  return hasUserActivityCapability(context, 'user.activity.own_cancel');
}

export function canReopenOrRelistActivity(context: OperateContext, event: EventInput): boolean {
  if (!ready(context) || !event || !canOperatePrivate(context, event)) return false;
  const all = canManageAll(context);
  return (all || hasActivityManageEntry(context))
    && (isOwner(context, event) || isDelegate(context, event) || all);
}

/**
 * Rules hasEffectivePerm 語意：角色層只看 rolePermissions 文件（user 角色沒有、文件缺失不套預設），
 * 加上啟用中的個別授權；不含 INHERENT_ROLE_PERMISSIONS 與預設權限。
 */
function hasRulesEffectivePerm(context: OperateContext, code: string): boolean {
  const role = roleKey(context);
  if (role !== 'user' && Array.isArray(context.rolePermissions)
    && context.rolePermissions.includes(code)) return true;
  const grant = context.userGrants;
  const uid = String(context.uid || '').trim();
  return !!uid && !!grant
    && (grant.enabled === undefined || grant.enabled === true)
    && String(grant.uid || '').trim() === uid
    && Array.isArray(grant.permissions)
    && grant.permissions.includes(code);
}

/**
 * 刪除鈕與刪除流程共用（R-IAM-011），對齊 Callable deleteEvent（FC functions/event-deletion.js）
 * 與 Rules events delete：admin／super_admin、有效 event.delete，或擁有者且有效 event.delete_self；
 * 私密活動再限 admin 以上或擁有者（不含 delegate）。不認 event.edit_all。
 * 取代原 A `_canDeleteActivity` 的照搬版（認 event.edit_all、套預設權限、私密含 delegate），
 * 那是 A 前端比伺服器寬的既有 bug（T-076 Q-1，兩站同修，B 先修）。
 */
export function canDeleteActivity(context: OperateContext, event: EventInput): boolean {
  if (!ready(context) || !event) return false;
  const uid = String(context.uid || '');
  // 'unknown' 是 A 缺 uid 時的佔位字（見 creatorUid），不是真實帳號；保守一律不顯示。
  if (!uid || uid === 'unknown') return false;
  const role = roleKey(context);
  const admin = role === 'admin' || role === 'super_admin';
  const owner = [event.captainUid, event.creatorUid, event.ownerUid]
    .some(value => typeof value === 'string' && value === uid);
  const allowed = admin
    || hasRulesEffectivePerm(context, 'event.delete')
    || (owner && hasRulesEffectivePerm(context, 'event.delete_self'));
  if (!allowed) return false;
  return !(event.privateEvent === true && !admin && !owner);
}

export function canOperateEventSite(context: OperateContext, event: EventInput): boolean {
  if (!ready(context) || !event || !canOperatePrivate(context, event)) return false;
  if (canManageAll(context)) return true;
  const scoped = isScoped(context, event);
  if (hasActivityManageEntry(context) && scoped) return true;
  const check = permissionChecker(context);
  if ((check('event.scan') || check('event.manual_checkin')) && scoped) return true;
  // R-IAM-013：一般 user delegate 的現場操作不要求 site_operate。
  if (roleKey(context) === 'user' && isDelegate(context, event)) return true;
  return scoped && hasUserActivityCapability(context, 'user.activity.site_operate');
}

/** A `_canRemoveWaitlistedParticipant(e)`：直接等同 `_canOperateEventSite(e)`。 */
export function canRemoveWaitlistedParticipant(
  context: OperateContext,
  event: EventInput,
): boolean {
  return canOperateEventSite(context, event);
}

export function canRemoveConfirmedParticipant(
  context: OperateContext,
  event: EventInput,
): boolean {
  if (!ready(context) || !event || !canOperatePrivate(context, event)) return false;
  return canManageAll(context)
    || (hasActivityManageEntry(context) && isScoped(context, event))
    || (
      roleKey(context) === 'user'
      && isDelegate(context, event)
      && hasUserActivityCapability(context, 'user.activity.site_operate')
    )
    || (
      roleKey(context) === 'user'
      && isOwner(context, event)
      && hasUserActivityCapability(context, 'user.activity.site_operate')
    );
}

/** A 泛用 scope helper；不得取代任何 action-specific guard。 */
export function canManageEvent(context: OperateContext, event: EventInput): boolean {
  if (!ready(context) || !canOperatePrivate(context, event)) return false;
  // A 在 event 為空時仍可能因 edit_all 回 true，刻意保留。
  return canManageAll(context) || isScoped(context, event);
}

/** A `_canManageAllActivities`：跨全活動總開關（R-IAM-004）。 */
export function canManageAllActivities(context: OperateContext): boolean {
  return ready(context) && canManageAll(context);
}

/** A `_canManageEventDelegates(e)`；event 為 null 代表建立中的新活動。 */
export function canManageEventDelegates(context: OperateContext, event: EventInput): boolean {
  if (!ready(context)) return false;
  if (event && !canOperatePrivate(context, event)) return false;
  if (event && !isOwner(context, event) && !canManageAll(context)) return false;
  // P2-13：建立中（event 為 null）的一般用戶同樣以前台能力為準（Rules create 帶委託人要 delegate_assign）。
  if (canManageAll(context) || (hasActivityManageEntry(context) && entryCountsForDirectWrite(context, event))) return true;
  return roleKey(context) === 'user'
    && (!event || isOwner(context, event))
    && hasUserActivityCapability(context, 'user.activity.delegate_assign');
}

/** A `_canUseActivityAddons(e)`；event 為 null 代表建立中的新活動。 */
export function canUseActivityAddons(context: OperateContext, event: EventInput): boolean {
  if (!ready(context)) return false;
  if (event && !canOperatePrivate(context, event)) return false;
  if (canManageAll(context)) return true;
  const entryOrTeamCreate = hasActivityManageEntry(context)
    || permissionChecker(context)('team.create_event');
  if (event && entryOrTeamCreate) return isScoped(context, event);
  if (!event && entryOrTeamCreate) return true;
  if (roleKey(context) !== 'user') return false;
  if (!hasUserActivityCapability(context, 'user.activity.addons_use')) return false;
  return !event || isOwner(context, event);
}

/** A `_canViewEventOperationLog(e)`（event-list-helpers.js 第 466～469 行）。 */
export function canViewEventOperationLog(context: OperateContext, event: EventInput): boolean {
  if (!ready(context) || !canOperatePrivate(context, event)) return false;
  return !!event && (
    canManageAll(context)
    || (hasActivityManageEntry(context) && isScoped(context, event))
  );
}

/** A `_canManageTeamOnlyVisibility(e)`（＝ `_canToggleEventPublic`，第 455～464 行）。
 * staffTeamIds：本人是 captainUid／leaderUids（無陣列才看 leaderUid）／coachUids 的俱樂部 ID。
 */
export function canManageTeamOnlyVisibility(
  context: OperateContext,
  event: (OperateEvent & {
    teamOnly?: unknown;
    creatorTeamId?: unknown;
    creatorTeamIds?: unknown;
  }) | null | undefined,
  staffTeamIds: ReadonlySet<string>,
): boolean {
  if (!ready(context) || !event || !event.teamOnly) return false;
  if (!canOperatePrivate(context, event)) return false;
  if (canManageAll(context)) return true;
  if (
    (hasActivityManageEntry(context) || permissionChecker(context)('team.toggle_event_visibility'))
    && isScoped(context, event)
  ) return true;
  if (!canUseActivityAddons(context, event)) return false;

  // 照 A `_getEventLimitedTeamIds`。
  const ids = new Set<string>();
  const pushId = (value: unknown): void => {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  };
  if (Array.isArray(event.creatorTeamIds)) event.creatorTeamIds.forEach(pushId);
  pushId(event.creatorTeamId);
  if (ids.size === 0) return isOwner(context, event);
  return isOwner(context, event) || [...ids].some(id => staffTeamIds.has(id));
}

/** 照 A _canManageTeamSplit（event-list-helpers.js 第 451～453 行）。 */
export function canManageTeamSplit(context: OperateContext, event: EventInput): boolean {
  return !!event
    && canUseActivityAddons(context, event)
    && (canManageAllActivities(context) || isScoped(context, event));
}
