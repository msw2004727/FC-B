/**
 * V 階段的可見性純函式。
 *
 * UID 比對保留原值，不 trim；leaderUids 為陣列時優先於 leaderUid，
 * 包含空陣列情況，不得將兩者聯集。
 *
 * R-ID-002：不移植 A 依 name 比對 adminUsers 的行為。
 * 本函式不讀 adminUsers；資料層僅可補入 UID 精確相符文件的隊伍。
 */
export interface VisibilityUserDoc {
  uid?: unknown;
  teamIds?: unknown;
  teamId?: unknown;
}

export interface VisibilityTeamDoc {
  id?: unknown;
  captainUid?: unknown;
  leaderUids?: unknown;
  leaderUid?: unknown;
  coachUids?: unknown;
}

/**
 * 對應 oracle 載入的 A _getVisibleTeamIdsForLimitedEvents。
 * 該 bundle 未載入 _getUserTeamIds，使用 user.teamIds / user.teamId fallback。
 *
 * uid 為 currentUser 的原始 UID。沒有 currentUser 時不推算幹部身分。
 * Team ID 的輸出契約為字串；不以文件名稱或使用者名稱判定身分。
 */
export function computeVisibleTeamIds(
  uid: string | null | undefined,
  userDoc: VisibilityUserDoc | null | undefined,
  teams: readonly (VisibilityTeamDoc | null | undefined)[] | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!userDoc) return ids;

  if (Array.isArray(userDoc.teamIds)) {
    for (const id of userDoc.teamIds) {
      if (id) ids.add(String(id));
    }
  }
  if (userDoc.teamId) ids.add(String(userDoc.teamId));

  const myUid = uid || '';
  for (const team of teams ?? []) {
    if (!team || !team.id) continue;

    const leaderUids: readonly unknown[] = Array.isArray(team.leaderUids)
      ? team.leaderUids
      : team.leaderUid
        ? [team.leaderUid]
        : [];

    const isManager = !!team.captainUid && team.captainUid === myUid;
    const isLeader = !!myUid && leaderUids.includes(myUid);
    const isCoach = !!myUid
      && Array.isArray(team.coachUids)
      && team.coachUids.includes(myUid);

    if (isManager || isLeader || isCoach) ids.add(String(team.id));
  }

  return ids;
}

/**
 * 私密活動列表僅使用內建 ROLE_LEVEL_MAP。
 * 不使用 customRoles 插值，不推導任何 permission。
 * switch 避免以任意角色字串命中 Object.prototype 屬性。
 */
export function getPrivateListRoleLevel(role: string | null | undefined): number {
  switch (role) {
    case 'coach': return 1;
    case 'captain': return 2;
    case 'venue_owner': return 3;
    case 'admin': return 4;
    case 'super_admin': return 5;
    default: return 0;
  }
}
