/**
 * 活動可見性純函式。
 *
 * owner：trim，排除空值與 unknown。
 * delegate：trim，僅排除空值。
 * 黑名單與報名歷史：UID 精確比對，不 trim。
 *
 * event.edit_all 僅用於俱樂部範圍判斷，不能繞過黑名單。
 * 私密列表的 roleLevel 由 getPrivateListRoleLevel 提供。
 */

import type { EventDoc, RegistrationDoc, ViewerContext } from './types';

export const ADMIN_ROLE_LEVEL = 4;

export function getEventLimitedTeamIds(e: EventDoc | null | undefined): string[] {
  if (!e) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown): void => {
    const value = String(raw ?? '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    ids.push(value);
  };
  if (Array.isArray(e.creatorTeamIds)) e.creatorTeamIds.forEach(push);
  push(e.creatorTeamId);
  return ids;
}

export function isEventOwner(
  e: EventDoc | null | undefined,
  uid: string | null | undefined,
): boolean {
  if (!e) return false;
  const myUid = String(uid || 'unknown').trim();
  if (!myUid || myUid === 'unknown') return false;
  return [e.creatorUid, e.ownerUid, e.captainUid]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .includes(myUid);
}

export function isEventDelegate(
  e: EventDoc | null | undefined,
  uid: string | null | undefined,
): boolean {
  if (!e) return false;
  const myUid = String(uid || 'unknown').trim();
  if (!myUid || !Array.isArray(e.delegateUids)) return false;
  return e.delegateUids.some((value) => String(value || '').trim() === myUid);
}

export function canViewEventByTeamScope(
  e: EventDoc | null | undefined,
  viewer: ViewerContext,
): boolean {
  if (!e) return false;
  if (!e.teamOnly) return true;
  if (isEventOwner(e, viewer.uid)) return true;
  if (viewer.hasPermission('event.edit_all')) return true;
  if (getEventLimitedTeamIds(e).some((id) => viewer.teamIds.has(id))) return true;
  return !!e.isPublic;
}

export function canListPrivateEvent(
  e: EventDoc | null | undefined,
  viewer: ViewerContext,
): boolean {
  if (!e || !e.privateEvent) return true;
  if (viewer.roleLevel >= ADMIN_ROLE_LEVEL) return true;
  return isEventOwner(e, viewer.uid) || isEventDelegate(e, viewer.uid);
}

/**
 * B 使用 canonical userId。
 * oracle adapter 將 A stub 的 uid 映射為 userId，保留 UID 原值。
 * 不限制 status：cancelled、removed 也屬於歷史報名。
 */
export function userHasRegistrationForEvent(
  eventId: string | null | undefined,
  uid: string | null | undefined,
  registrationsOfViewer: readonly RegistrationDoc[] | null | undefined,
): boolean {
  if (!eventId || !uid) return false;
  const registrations = Array.isArray(registrationsOfViewer)
    ? registrationsOfViewer
    : [];
  return registrations.some(
    (registration) => registration != null
      && registration.eventId === eventId
      && registration.userId === uid,
  );
}

/** 黑名單四態；角色與其他權限均不構成豁免。 */
export function isEventVisibleToUser(
  e: EventDoc | null | undefined,
  viewer: ViewerContext,
  registrationsOfViewer: readonly RegistrationDoc[] | null | undefined,
): boolean {
  if (!e) return false;
  const uid = viewer.uid;
  if (!uid) return true;
  const blocked = Array.isArray(e.blockedUids) ? e.blockedUids : [];
  if (!blocked.includes(uid)) return true;
  return userHasRegistrationForEvent(e.id, uid, registrationsOfViewer);
}

/** 僅過濾黑名單；訪客仍回傳淺拷貝。 */
export function filterVisibleEventsByBlocklist(
  events: readonly EventDoc[] | null | undefined,
  viewer: ViewerContext,
  registrationsOfViewer: readonly RegistrationDoc[] | null | undefined,
): EventDoc[] {
  if (!Array.isArray(events)) return [];
  if (!viewer.uid) return events.slice();
  return events.filter((event) => (
    isEventVisibleToUser(event, viewer, registrationsOfViewer)
  ));
}

/** 每個事件均須通過俱樂部範圍、私密列表與黑名單檢查。 */
export function getVisibleEvents(
  events: readonly EventDoc[] | null | undefined,
  viewer: ViewerContext,
  registrationsOfViewer: readonly RegistrationDoc[] | null | undefined,
): EventDoc[] {
  if (!Array.isArray(events)) return [];
  return events.filter((event) => (
    canViewEventByTeamScope(event, viewer)
    && canListPrivateEvent(event, viewer)
    && isEventVisibleToUser(event, viewer, registrationsOfViewer)
  ));
}
