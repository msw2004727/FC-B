import type { DetailRegistration } from './detail-model';

export interface SplitTeam {
  key: string;
  color: string;
  name?: string;
}

export interface TeamSplitConfig {
  enabled?: boolean;
  mode?: string;
  balanceCap?: boolean;
  teams?: SplitTeam[];
}

export interface TeamRegistration extends DetailRegistration {
  teamKey?: string | null;
}

export interface TeamAssignment {
  reg: TeamRegistration;
  teamKey: string | null;
}

export type TeamBatchAction = 'random' | 'fill' | 'reset';

export interface TeamKeyPayload<T> {
  teamKey: string | null;
  updatedAt?: T;
}

// 照 A teamSplit 讀取；局部擴充，不改共用文件型別。
export function getTeamSplit(event: object | null | undefined): TeamSplitConfig | undefined {
  return (event as { teamSplit?: TeamSplitConfig } | null | undefined)?.teamSplit;
}

export function getSplitTeams(event: object | null | undefined): readonly SplitTeam[] {
  const teams = getTeamSplit(event)?.teams;
  return Array.isArray(teams) ? teams : [];
}

// 照 A _tsRenderTeamInfoCards；只計正取與有效隊伍。
export function countTeamRegistrations(
  teams: readonly SplitTeam[],
  registrations: readonly TeamRegistration[],
): Record<string, number> {
  const counts: Record<string, number> = Object.create(null);
  const validKeys = new Set(teams.map(team => team.key));
  teams.forEach(team => { counts[team.key] = 0; });
  registrations.forEach(reg => {
    if (reg.status === 'confirmed' && reg.teamKey && validKeys.has(reg.teamKey)) {
      counts[reg.teamKey] = (counts[reg.teamKey] || 0) + 1;
    }
  });
  return counts;
}

// 照 A _tsRenderTeamInfoCards；cap=0 時 UI 不顯示上限也不視為滿隊。
export function getTeamCap(event: object): number | null {
  const split = getTeamSplit(event);
  const teams = getSplitTeams(event);
  if (!split?.balanceCap || teams.length === 0) return null;
  const max = (event as { max?: number }).max;
  return Math.ceil((max || 0) / teams.length);
}

// 照 A _tsBatchRandom／_tsBatchFill／_tsBatchReset，包含候補且排除取消。
export function buildTeamAssignments(
  action: TeamBatchAction,
  teams: readonly SplitTeam[],
  registrations: readonly TeamRegistration[],
  random: () => number = Math.random,
): TeamAssignment[] {
  const regs = registrations.filter(reg =>
    reg.status === 'confirmed' || reg.status === 'waitlisted');
  if (action === 'reset') {
    return regs.filter(reg => reg.teamKey).map(reg => ({ reg, teamKey: null }));
  }
  const first = teams[0];
  if (!first) return [];

  if (action === 'random') {
    const shuffled = [...regs].sort(() => random() - 0.5);
    const assign = (offset: number): TeamAssignment[] =>
      shuffled.map((reg, index) => ({
        reg,
        teamKey: (teams[(index + offset) % teams.length] ?? first).key,
      }));
    const assignments = assign(0);
    const unchanged = assignments.length > 1
      && assignments.every(item => (item.reg.teamKey || null) === item.teamKey);
    return unchanged && teams.length > 1 ? assign(1) : assignments;
  }

  const validKeys = new Set(teams.map(team => team.key));
  const counts: Record<string, number> = Object.create(null);
  teams.forEach(team => { counts[team.key] = 0; });
  regs.forEach(reg => {
    if (reg.teamKey && validKeys.has(reg.teamKey)) {
      counts[reg.teamKey] = (counts[reg.teamKey] || 0) + 1;
    }
  });
  return regs.filter(reg => !reg.teamKey || !validKeys.has(reg.teamKey)).map(reg => {
    const minimum = teams.reduce((min, team) =>
      (counts[team.key] || 0) < (counts[min.key] || 0) ? team : min, first);
    counts[minimum.key] = (counts[minimum.key] || 0) + 1;
    return { reg, teamKey: minimum.key };
  });
}

// 照 A _tsNormalizeTeamAssignment；不拿 public registration id 猜文件 ID。
export function writableTeamAssignments(
  assignments: readonly TeamAssignment[],
): TeamAssignment[] {
  return assignments.filter(item => Boolean(String(item.reg._docId || '').trim()));
}

// 照 A _tsTeamKeyUpdatePayload。
export function teamKeyUpdatePayload<T>(
  teamKey: string | null | undefined,
  updatedAt?: T,
): TeamKeyPayload<T> {
  return {
    teamKey: teamKey || null,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

// 照 A _tsApplyTeamAssignments；不可變更新供 Preact 重繪。
export function applyTeamAssignments(
  registrations: readonly TeamRegistration[],
  assignments: readonly TeamAssignment[],
): TeamRegistration[] {
  const keys = new Map(writableTeamAssignments(assignments).map(item => [
    String(item.reg._docId || '').trim(),
    item.teamKey || null,
  ]));
  return registrations.map(reg => {
    const id = String(reg._docId || '').trim();
    return keys.has(id) ? { ...reg, teamKey: keys.get(id) ?? null } : reg;
  });
}
