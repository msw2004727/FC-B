import { ROSTER_STATUS_CALLABLES_DEPLOYED } from '@/data/roster-status-deployed';
import type { RosterEventInput, RosterRegistrationInput } from './attendance-roster-model';
import {
  canOperateEventSite, canRemoveConfirmedParticipant,
  type OperateContext, type OperateEvent,
} from './operate-permissions';

export type RosterStatusAction = 'demote' | 'promote';
export type RosterStatusEvent = RosterEventInput & OperateEvent & { title?: unknown };
/** 對齊伺服器 sanitizeStr，僅用於連動標記。 */
function sanitize(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
/** 名單狀態調整；對照 FC index.js#isCourseLinkedEventData。 */
export function isRosterStatusCourseEvent(event: RosterEventInput | null | undefined): boolean {
  return !!event && event.courseLinked === true
    && sanitize(event.courseLinkSource, 80) === 'eduCourseLesson';
}
/** 對照 FC index.js#isCourseLinkedRegistrationData，source 優先。 */
export function isRosterStatusCourseRegistration(reg: RosterRegistrationInput): boolean {
  const source = sanitize(reg.source, 80) || sanitize(reg.courseLinkSource, 80);
  const state = sanitize(reg.courseLinkState, 80);
  return source === 'eduCourseLesson'
    || state === 'created_by_course'
    || state === 'priority_overlay'
    || reg.coursePriority === true
    || !!sanitize(reg.courseLinkId, 128)
    || !!sanitize(reg.courseStudentId, 100);
}
export function rosterStatusTargets(
  action: RosterStatusAction, registrations: readonly RosterRegistrationInput[], userId: string,
): RosterRegistrationInput[] {
  return registrations.filter(reg => reg.userId === userId
    && reg.status === (action === 'demote' ? 'confirmed' : 'waitlisted'));
}
export function isRosterStatusCourseTarget(
  action: RosterStatusAction, registrations: readonly RosterRegistrationInput[], userId: string,
): boolean {
  return rosterStatusTargets(action, registrations, userId).some(isRosterStatusCourseRegistration);
}
/** 按鈕與 handler 共用同一入口；不依活動狀態收窄。 */
export function canAdjustRosterStatus(
  action: RosterStatusAction, context: OperateContext, event: RosterStatusEvent | null | undefined,
): boolean {
  if (!ROSTER_STATUS_CALLABLES_DEPLOYED || !context.uid || !event
    || isRosterStatusCourseEvent(event)) return false;
  return action === 'demote'
    ? canRemoveConfirmedParticipant(context, event) && Number(event.max || 0) > 0
    : canOperateEventSite(context, event);
}
