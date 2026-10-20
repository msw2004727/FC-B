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

export function canEditOwnActivityBasic(context: OperateContext, event: EventInput): boolean {
  if (!ready(context) || !event || !canOperatePrivate(context, event)) return false;
  if (canManageAll(context)) return true;
  if (!isScoped(context, event)) return false;
  if (hasActivityManageEntry(context) || permissionChecker(context)('event.edit_self')) return true;
  return hasUserActivityCapability(context, 'user.activity.own_edit_basic');
}

export function canCancelOwnActivity(context: OperateContext, event: EventInput): boolean {
  if (!ready(context) || !event || !canOperatePrivate(context, event)) return false;
  if (canManageAll(context)) return true;
  if (!isScoped(context, event)) return false;
  if (hasActivityManageEntry(context)) return true;
  return hasUserActivityCapability(context, 'user.activity.own_cancel');
}

export function canReopenOrRelistActivity(context: OperateContext, event: EventInput): boolean {
  if (!ready(context) || !event || !canOperatePrivate(context, event)) return false;
  const all = canManageAll(context);
  return (all || hasActivityManageEntry(context))
    && (isOwner(context, event) || isDelegate(context, event) || all);
}

export function canDeleteActivity(context: OperateContext, event: EventInput): boolean {
  if (!ready(context) || !event || !canOperatePrivate(context, event)) return false;
  const check = permissionChecker(context);
  return check('event.delete')
    || check('event.edit_all')
    || (check('event.delete_self') && isOwner(context, event));
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
  if (canManageAll(context) || hasActivityManageEntry(context)) return true;
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
