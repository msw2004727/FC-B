// 名單狀態調整：共用投影讀取型別。
export interface TeamReservationSummaryInput {
  teamId?: unknown;
  teamName?: unknown;
  reservedSlots?: unknown;
  usedSlots?: unknown;
  remainingSlots?: unknown;
}

export interface RosterParticipantWithUid {
  uid?: unknown;
  name?: unknown;
  displayName?: unknown;
  teamKey?: unknown;
  teamReservationTeamId?: unknown;
  teamReservationTeamName?: unknown;
  teamSeatSource?: unknown;
}
