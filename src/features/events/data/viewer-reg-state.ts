import type { RegistrationDoc } from './types';

export interface ViewerEventRegState { signedUp: boolean; onWaitlist: boolean; }

/** 擴充 RegistrationDoc 讀取範圍：A 也會讀 courseOwnerUids／companionId，型別尚未升級到 types.ts。 */
type RegistrationWithExtras = RegistrationDoc & {
  courseOwnerUids?: unknown;
  companionId?: string;
  participantType?: string;
};

/** 活動端可能的備援欄位（僅讀取）。 */
type EventWithNameLists = {
  id?: string;
  waitlistWithUid?: unknown;
  participantsWithUid?: unknown;
};

function normalizeUid(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isActiveReg(r: RegistrationDoc | undefined): boolean {
  if (!r) return false;
  return r.status !== 'cancelled' && r.status !== 'removed';
}

/** 照 A `_isRegistrationOwnedByUser`（只認 UID；不認 ownerUid）。 */
function isMine(r: RegistrationWithExtras, uid: string): boolean {
  if (normalizeUid(r.userId) === uid) return true;
  if (normalizeUid(r.uid) === uid) return true;
  if (Array.isArray(r.courseOwnerUids)
    && r.courseOwnerUids.some((o) => normalizeUid(o) === uid)) return true;
  return false;
}

/** 照 A：participantType === 'companion' 或 companionId 非空一律排除（同行者不算本人）。 */
function isSelf(r: RegistrationWithExtras): boolean {
  if (normalizeUid(r.participantType) === 'companion') return false;
  if (normalizeUid(r.companionId)) return false;
  return true;
}

function hasMatchingUid(list: unknown, uid: string): boolean {
  if (!Array.isArray(list)) return false;
  return list.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const it = item as Record<string, unknown>;
    if (normalizeUid(it.uid) === uid) return true;
    if (normalizeUid(it.userId) === uid) return true;
    return false;
  });
}

/**
 * 照 A `event-list-stats.js#_getCurrentUserEventRegistrationState`（含 participantsWithUid／waitlistWithUid 備援）。
 * - 只認 UID（R-ID-002）；不認 ownerUid。
 * - 排除同行者（participantType=companion 或 companionId 非空）。
 * - 有效狀態 = 非 cancelled／removed。
 * - 報名紀錄 eventId 需等於活動 public id（R-ID-009）。
 */
export function getViewerEventRegState(
  event: EventWithNameLists,
  viewerUid: string | null,
  viewerRegistrations: readonly RegistrationDoc[],
): ViewerEventRegState {
  const uid = normalizeUid(viewerUid);
  const eventId = normalizeUid(event?.id);
  if (!uid || !eventId) return { signedUp: false, onWaitlist: false };

  const regs = viewerRegistrations.filter((r) => normalizeUid(r.eventId) === eventId);
  const myRegs = regs.filter((r) => {
    const rr = r as RegistrationWithExtras;
    return isActiveReg(r) && isMine(rr, uid) && isSelf(rr);
  });

  if (myRegs.length > 0) {
    return { signedUp: true, onWaitlist: myRegs.some((r) => r.status === 'waitlisted') };
  }

  if (hasMatchingUid(event.waitlistWithUid, uid)) return { signedUp: true, onWaitlist: true };
  if (hasMatchingUid(event.participantsWithUid, uid)) return { signedUp: true, onWaitlist: false };
  return { signedUp: false, onWaitlist: false };
}
