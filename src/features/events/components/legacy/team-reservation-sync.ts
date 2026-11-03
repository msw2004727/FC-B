import type { RegistrationDoc } from '../../data/types';
import type { TeamReservationPromotion } from '../../data/team-reservation';

/** Callable 的報名 ID 才能識別遞補列；同名／同 UID 的同行者不可一起改。 */
export function applyReservationPromotions<T extends RegistrationDoc>(
  rows: readonly T[],
  promoted: readonly TeamReservationPromotion[],
  eventId: string,
): T[] {
  return rows.map(row => {
    if (row.eventId && row.eventId !== eventId) return row;
    const promotion = promoted.find(item =>
      (item.docId && row._docId === item.docId)
      || (item.id && row.id === item.id));
    if (!promotion) return row;
    return {
      ...row,
      status: 'confirmed',
      ...(promotion.teamSeatSource ? { teamSeatSource: promotion.teamSeatSource } : {}),
    };
  });
}
