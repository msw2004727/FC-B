import type { RegistrationDoc } from '../../data/types';
import type { TeamReservationPromotion } from '../../data/team-reservation';

interface ReservationTeam {
  teamReservationTeamId: string;
  teamReservationTeamName: string;
}

/** occupancy 投影沒有報名 ID；重複 UID 或不完整欄位不能拿來推測團隊。 */
function uniqueReservationTeams(participants: readonly unknown[]): Map<string, ReservationTeam | null> {
  const teams = new Map<string, ReservationTeam | null>();
  for (const raw of participants) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const uid = typeof entry.uid === 'string' ? entry.uid.trim() : '';
    if (!uid) continue;
    const teamId = typeof entry.teamReservationTeamId === 'string' ? entry.teamReservationTeamId.trim() : '';
    const teamName = typeof entry.teamReservationTeamName === 'string' ? entry.teamReservationTeamName.trim() : '';
    teams.set(uid, !teams.has(uid) && teamId && teamName
      ? { teamReservationTeamId: teamId, teamReservationTeamName: teamName }
      : null);
  }
  return teams;
}

/** Callable 的報名 ID 才能識別遞補列；同名／同 UID 的同行者不可一起改。 */
export function applyReservationPromotions<T extends RegistrationDoc>(
  rows: readonly T[],
  promoted: readonly TeamReservationPromotion[],
  eventId: string,
  participantsWithUid: readonly unknown[] = [],
): T[] {
  const teams = uniqueReservationTeams(participantsWithUid);
  return rows.map(row => {
    if (row.eventId && row.eventId !== eventId) return row;
    const promotion = promoted.find(item =>
      (item.docId && row._docId === item.docId)
      || (item.id && row.id === item.id));
    if (!promotion) return row;
    // UID 只用於已確定遞補的本人補歸屬；同行者共用 userId，不能沿用本人的團隊。
    const team = row.participantType === 'self' && row.userId
      ? teams.get(row.userId.trim()) : null;
    return {
      ...row,
      status: 'confirmed',
      ...team,
      ...(promotion.teamSeatSource ? { teamSeatSource: promotion.teamSeatSource } : {}),
    };
  });
}
