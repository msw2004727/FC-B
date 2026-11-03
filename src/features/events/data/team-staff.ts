import { getFirebase } from '@/data/firebase';

export interface LimitedTeamEvent {
  teamOnly?: unknown;
  creatorTeamId?: unknown;
  creatorTeamIds?: unknown;
}

export interface TeamStaffFields {
  captainUid?: unknown;
  leaderUids?: unknown;
  leaderUid?: unknown;
  coachUids?: unknown;
}

export interface StaffTeamOption {
  id: string;
  name: string;
}

export interface StaffTeamCandidate extends TeamStaffFields {
  id?: unknown;
  name?: unknown;
  teamName?: unknown;
}

/** T-074：僅投影已載入的職員俱樂部，不查詢、不以角色或名稱補授權。 */
export function getStaffTeams(
  uid: string | null,
  teams: readonly StaffTeamCandidate[],
): StaffTeamOption[] {
  const seen = new Set<string>();
  const options: StaffTeamOption[] = [];
  for (const team of teams) {
    const id = String(team.id || '').trim();
    if (!id || seen.has(id) || !isTeamStaff(uid, team)) continue;
    seen.add(id);
    options.push({ id, name: String(team.name || team.teamName || id).trim() || id });
  }
  return options;
}

/** 照 A `_getEventLimitedTeamIds`。 */
export function getEventLimitedTeamIds(event: LimitedTeamEvent | null | undefined): string[] {
  if (!event) return [];
  const ids = new Set<string>();
  const push = (value: unknown): void => {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  };
  if (Array.isArray(event.creatorTeamIds)) event.creatorTeamIds.forEach(push);
  push(event.creatorTeamId);
  return [...ids];
}

/** 照 A `_isCurrentUserTeamStaff`；空 leaderUids 不回退 leaderUid。 */
export function isTeamStaff(uid: string | null, team: TeamStaffFields | null | undefined): boolean {
  if (!uid || !team) return false;
  const leaders: unknown[] = Array.isArray(team.leaderUids)
    ? team.leaderUids
    : team.leaderUid ? [team.leaderUid] : [];
  return team.captainUid === uid
    || leaders.includes(uid)
    || (Array.isArray(team.coachUids) && team.coachUids.includes(uid));
}

/** 照 A `_isCurrentUserTeamStaff`；任一讀取失敗時保守回空集合。 */
export async function loadEventStaffTeamIds(
  uid: string | null,
  event: LimitedTeamEvent | null | undefined,
): Promise<ReadonlySet<string>> {
  if (!uid || !event?.teamOnly) return new Set<string>();
  const ids = getEventLimitedTeamIds(event);
  if (ids.length === 0) return new Set<string>();

  try {
    const [firebase, fs] = await Promise.all([getFirebase(), import('firebase/firestore')]);
    const matches = await Promise.all(ids.map(async (id): Promise<string | null> => {
      const snapshot = await fs.getDoc(fs.doc(firebase.db, 'teams', id));
      if (!snapshot.exists()) return null;
      const data = snapshot.data();
      // Firestore Web SDK 讀整份文件；只投影 A 判定所需四個欄位。
      const staff: TeamStaffFields = {
        captainUid: data.captainUid,
        leaderUids: data.leaderUids,
        leaderUid: data.leaderUid,
        coachUids: data.coachUids,
      };
      return isTeamStaff(uid, staff) ? id : null;
    }));
    return new Set(matches.filter((id): id is string => id !== null));
  } catch {
    return new Set<string>();
  }
}
