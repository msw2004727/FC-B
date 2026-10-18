/**
 * 活動可見性純函式。逐條移植 A 的：
 *   - event-blocklist.js::_isEventVisibleToUser / _userHasRegistrationForEvent / _filterVisibleEvents
 *   - event-list-helpers.js::_getVisibleEvents / _canViewEventByTeamScope / _canListPrivateEvent
 *     / _isEventOwner / _isEventDelegate / _getEventLimitedTeamIds
 *
 * P0-5：不共用 UID 正規化。
 *  - owner：trim 後排除空值與 'unknown'。
 *  - delegate：trim 後只排除空值，不排除 'unknown'。
 *  - 黑名單：strict includes(uid)，不 trim。
 *  - 報名歷史入口：!eventId || !uid 回 false。
 *
 * 本檔不讀 Firestore；viewer 的所有輸入由呼叫端注入。
 */

import type { EventDoc, RegistrationDoc, ViewerContext } from './types';

/** 等價於 A 的 ROLE_LEVEL_MAP.admin（A 預設 fallback 為 4） */
export const ADMIN_ROLE_LEVEL = 4;

/** A 的 _getEventLimitedTeamIds：creatorTeamIds 僅在陣列時展開；creatorTeamId 一律 push */
export function getEventLimitedTeamIds(e: EventDoc | null | undefined): string[] {
  if (!e) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    const v = String(raw ?? '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    ids.push(v);
  };
  if (Array.isArray(e.creatorTeamIds)) {
    e.creatorTeamIds.forEach(push);
  }
  push(e.creatorTeamId);
  return ids;
}

/** A 的 _isEventOwner：僅信任 uid 欄位（creatorUid / ownerUid / captainUid），不看名稱 */
export function isEventOwner(e: EventDoc | null | undefined, uid: string | null | undefined): boolean {
  if (!e) return false;
  const myUid = String(uid || 'unknown').trim();
  if (!myUid || myUid === 'unknown') return false;
  const ownerIds = [e.creatorUid, e.ownerUid, e.captainUid]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (ownerIds.length === 0) return false;
  return ownerIds.includes(myUid);
}

/** A 的 _isEventDelegate：僅信任 canonical delegateUids，不看 delegates metadata */
export function isEventDelegate(e: EventDoc | null | undefined, uid: string | null | undefined): boolean {
  if (!e) return false;
  const myUid = String(uid || 'unknown').trim();
  if (!myUid) return false;
  if (!Array.isArray(e.delegateUids)) return false;
  return e.delegateUids.some((d) => String(d || '').trim() === myUid);
}

/** A 的 _canViewEventByTeamScope */
export function canViewEventByTeamScope(e: EventDoc | null | undefined, viewer: ViewerContext): boolean {
  if (!e) return false;
  if (!e.teamOnly) return true;
  if (isEventOwner(e, viewer.uid)) return true;
  if (viewer.hasPermission('event.edit_all')) return true;
  const eventTeamIds = getEventLimitedTeamIds(e);
  if (eventTeamIds.some((id) => viewer.teamIds.has(id))) return true;
  return !!e.isPublic;
}

/** A 的 _canListPrivateEvent */
export function canListPrivateEvent(e: EventDoc | null | undefined, viewer: ViewerContext): boolean {
  if (!e || !e.privateEvent) return true;
  if (viewer.roleLevel >= ADMIN_ROLE_LEVEL) return true;
  return isEventOwner(e, viewer.uid) || isEventDelegate(e, viewer.uid);
}

/**
 * A 的 _userHasRegistrationForEvent：
 *   if (!eventId || !uid) return false;
 *   以 registration history 是否非空判斷。
 * B 由呼叫端注入 registrationsOfViewer；canonical 身分欄位為 userId（R-STAT-002）。
 */
export function userHasRegistrationForEvent(
  eventId: string | null | undefined,
  uid: string | null | undefined,
  registrationsOfViewer: readonly RegistrationDoc[] | null | undefined,
): boolean {
  if (!eventId || !uid) return false;
  const regs = Array.isArray(registrationsOfViewer) ? registrationsOfViewer : [];
  return regs.some(
    (r) => r != null && r.eventId === eventId && r.userId === uid,
  );
}

/**
 * A 的 _isEventVisibleToUser（R-EVT-010／011 黑名單四態）：
 *   - 訪客（uid 空）→ 可見
 *   - 未在 blockedUids → 可見
 *   - 在 blockedUids 但曾有任一報名（含 cancelled / removed）→ 可見
 *   - 在 blockedUids 且無任何報名 → 不可見
 *
 * P0-5：blockedUids 使用 strict includes(uid)，不 trim；'unknown' 不當訪客。
 */
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

/**
 * A 的 _filterVisibleEvents：只做黑名單過濾。
 * 訪客回傳淺拷貝，避免呼叫端誤改來源陣列。
 */
export function filterVisibleEventsByBlocklist(
  events: readonly EventDoc[] | null | undefined,
  viewer: ViewerContext,
  registrationsOfViewer: readonly RegistrationDoc[] | null | undefined,
): EventDoc[] {
  if (!Array.isArray(events)) return [];
  if (!viewer.uid) return events.slice();
  return events.filter((e) => isEventVisibleToUser(e, viewer, registrationsOfViewer));
}

/**
 * A 的 _getVisibleEvents：俱樂部限定 + 私密活動 + 黑名單三層過濾。
 * 注意：A 對訪客也走同樣三層（_canViewEventByTeamScope / _canListPrivateEvent 不以 uid 直接放行）。
 */
export function getVisibleEvents(
  events: readonly EventDoc[] | null | undefined,
  viewer: ViewerContext,
  registrationsOfViewer: readonly RegistrationDoc[] | null | undefined,
): EventDoc[] {
  if (!Array.isArray(events)) return [];
  return events.filter((e) => {
    if (!canViewEventByTeamScope(e, viewer)) return false;
    if (!canListPrivateEvent(e, viewer)) return false;
    if (!isEventVisibleToUser(e, viewer, registrationsOfViewer)) return false;
    return true;
  });
}
