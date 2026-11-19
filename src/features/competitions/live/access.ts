// 正式記分頁誰看得到記分板。主辦身分看 staff 角色，不看站台管理員。

export interface ScoreAccess {
  /** 有本場、未過期的記分或裁判指派。 */
  pad: boolean;
  /** 主辦或共同主辦，但還沒有本場指派。 */
  hint: boolean;
}

export function scoreAccess(input: {
  roles: readonly string[];
  matchIds: readonly string[];
  expiresAt: number | null;
  mtId: string;
  nowMs: number;
}): ScoreAccess {
  const expired = input.expiresAt != null && input.nowMs >= input.expiresAt;
  const assigned = !expired
    && (input.roles.includes('scorer') || input.roles.includes('referee'))
    && input.matchIds.includes(input.mtId);
  const host = input.roles.includes('host') || input.roles.includes('coHost');
  return { pad: assigned, hint: host && !assigned };
}
