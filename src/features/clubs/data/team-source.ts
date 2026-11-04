/** T-090：自建俱樂部標記（伺服器 createUserTeam 寫入 createdVia）。本檔不得有其他相依，供元件直接引用。 */
export const USER_CAPABILITY_TEAM_SOURCE = 'user_capability';

/** 俱樂部是否為一般用戶以能力開關自建（createdVia === 'user_capability'）。 */
export function isUserCapabilityTeam(
  team: { createdVia?: unknown } | null | undefined,
): boolean {
  return String(team?.createdVia ?? '').trim() === USER_CAPABILITY_TEAM_SOURCE;
}
