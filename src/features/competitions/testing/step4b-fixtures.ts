// 賽事第 4 步預覽（U0b）假資料。人名、隊名都是示範。
// 不改 step4-fixtures.ts。畫面文案在 step4b/copy.ts，這裡只放形狀與可對帳的數字。
// 比賽日：台北時間 05:00 前算前一天（跨午夜場次仍歸在前一個比賽日）。

import { taipeiMs, taipeiParts } from '../format';

const DAY_MS = 24 * 60 * 60 * 1000;

export const S4B_NOW = taipeiMs(2027, 1, 9, 9, 34);
export const S4B_YEAR = 2027;
export const S4B_COMP_NAME = '週末足球聯賽';
export const S4B_JOIN_LINE_NAME = '小雷';
export const S4B_CLAIM_TEAM = '雷霆隊';
export const S4B_CLAIM_NUMBER = 9;
// 不寫死網域（R-CTX-009）；一次性代碼放網址 # 片段（顧問 §3.300 附帶條件 2）
export const S4B_LINK_PATH = '…/?competition=cp_demo#join=k7m2…';
export const S4B_INVITE_PATH = '…/?competition=cp_demo#invite=s4b9…';

export const STEP4B_SCREENS = [
  'staff-list',
  'staff-assign',
  'staff-invite',
  'invite-accept',
  'scorer-my-matches',
  'link-rep',
  'link-join',
  'link-join-birthday',
  'claim',
  'addition-request',
  'addition-review',
  'rules-template',
  'rules-advanced',
  'rules-public',
  'checkin-print',
  'audit-log',
  'schedule-midnight',
] as const;
export type Step4bScreen = (typeof STEP4B_SCREENS)[number];

export type S4bMatchStatus = 'scheduled' | 'live' | 'done';
export interface S4bMatch {
  id: string;
  kickoffAt: number;
  venue: string;
  home: string;
  away: string;
  status: S4bMatchStatus;
}

export const S4B_MATCHES: readonly S4bMatch[] = [
  { id: 'm_live', kickoffAt: taipeiMs(2027, 1, 9, 9, 0), venue: '1號場', home: '雷霆隊', away: '海風隊', status: 'live' },
  { id: 'm_1400', kickoffAt: taipeiMs(2027, 1, 9, 14, 0), venue: '2號場', home: '山貓隊', away: '藍鯨隊', status: 'scheduled' },
  { id: 'm_2200', kickoffAt: taipeiMs(2027, 1, 9, 22, 0), venue: '1號場', home: '雷霆隊', away: '山貓隊', status: 'scheduled' },
  { id: 'm_2310', kickoffAt: taipeiMs(2027, 1, 9, 23, 10), venue: '2號場', home: '海風隊', away: '藍鯨隊', status: 'scheduled' },
  { id: 'm_0020', kickoffAt: taipeiMs(2027, 1, 10, 0, 20), venue: '1號場', home: '雷霆隊', away: '藍鯨隊', status: 'scheduled' },
  { id: 'm_1600', kickoffAt: taipeiMs(2027, 1, 10, 16, 0), venue: '2號場', home: '海風隊', away: '山貓隊', status: 'scheduled' },
];

export const S4B_MIDNIGHT_IDS = ['m_2200', 'm_2310', 'm_0020'] as const;
export const S4B_SCORER_ID = 'st_sc';

export type StaffRole = 'host' | 'coHost' | 'scorer' | 'referee';
export interface S4bStaff {
  id: string;
  name: string;
  role: StaffRole;
  matchIds: readonly string[];
}

export const S4B_STAFF: readonly S4bStaff[] = [
  { id: 'st_host', name: '王主辦', role: 'host', matchIds: [] },
  { id: 'st_co', name: '李共同', role: 'coHost', matchIds: [] },
  { id: 'st_sc', name: '林記分', role: 'scorer', matchIds: ['m_live', 'm_1400', 'm_0020', 'm_1600'] },
  { id: 'st_ref', name: '陳裁判', role: 'referee', matchIds: ['m_2200'] },
];

export const S4B_ASSIGN_PEOPLE = [
  { id: 'me', name: '我自己' },
  { id: 'st_sc', name: '林記分' },
  { id: 'st_new', name: '周新人' },
] as const;

export type AssignRole = 'scorer' | 'referee';

export interface DayKey {
  year: number;
  month: number;
  day: number;
  key: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 台北 05:00 前算前一個比賽日。05:00 整點算當天。 */
export function competitionDay(ms: number): DayKey {
  const p = taipeiParts(ms);
  if (p.hour >= 5) {
    return { year: p.year, month: p.month, day: p.day, key: iso(p.year, p.month, p.day) };
  }
  const prev = taipeiParts(taipeiMs(p.year, p.month, p.day, 12, 0) - DAY_MS);
  return { year: prev.year, month: prev.month, day: prev.day, key: iso(prev.year, prev.month, prev.day) };
}

export function weekdayIndex(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return probe.getUTCDay();
}

export interface ClockLabel {
  time: string;
  nextDay: boolean;
}

/** 同一比賽日的場次只寫時刻；日曆日已經跨過比賽日則寫 M/D HH:mm。 */
export function clockLabel(ms: number): ClockLabel {
  const p = taipeiParts(ms);
  const day = competitionDay(ms);
  const hm = `${pad2(p.hour)}:${pad2(p.minute)}`;
  const nextDay = iso(p.year, p.month, p.day) !== day.key;
  if (nextDay) return { time: `${p.month}/${p.day} ${hm}`, nextDay: true };
  return { time: hm, nextDay: false };
}

export function formatMd(ms: number): string {
  const p = taipeiParts(ms);
  return `${p.month}/${p.day}`;
}

export function formatMdHm(ms: number): string {
  const p = taipeiParts(ms);
  return `${p.month}/${p.day} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

export interface MatchGroup {
  key: string;
  month: number;
  day: number;
  weekday: number;
  matches: S4bMatch[];
}

export function groupMatches(matches: readonly S4bMatch[]): MatchGroup[] {
  const order: string[] = [];
  const map = new Map<string, S4bMatch[]>();
  const sorted = [...matches].sort((a, b) => a.kickoffAt - b.kickoffAt);
  for (const match of sorted) {
    const day = competitionDay(match.kickoffAt);
    const list = map.get(day.key);
    if (list) list.push(match);
    else {
      order.push(day.key);
      map.set(day.key, [match]);
    }
  }
  return order.map((key) => {
    const list = map.get(key) ?? [];
    const day = competitionDay(list[0]?.kickoffAt ?? 0);
    return {
      key,
      month: day.month,
      day: day.day,
      weekday: weekdayIndex(key) ?? 0,
      matches: list,
    };
  });
}

/** 今天（以現在的比賽日）排前面，同一天再依開賽時間。 */
export function scorerMatchOrder(matches: readonly S4bMatch[], now: number): S4bMatch[] {
  const today = competitionDay(now).key;
  return [...matches].sort((a, b) => {
    const aToday = competitionDay(a.kickoffAt).key === today ? 0 : 1;
    const bToday = competitionDay(b.kickoffAt).key === today ? 0 : 1;
    if (aToday !== bToday) return aToday - bToday;
    return a.kickoffAt - b.kickoffAt;
  });
}

export function matchById(id: string): S4bMatch | null {
  return S4B_MATCHES.find((match) => match.id === id) ?? null;
}

export function matchesByIds(ids: readonly string[]): S4bMatch[] {
  return ids.map((id) => matchById(id)).filter((match): match is S4bMatch => match != null);
}

export function staffAssignmentCount(staff: S4bStaff): number {
  const ids = new Set(S4B_MATCHES.map((match) => match.id));
  return staff.matchIds.filter((id) => ids.has(id)).length;
}

export function lastKickoff(matches: readonly { kickoffAt: number }[]): number {
  return matches.reduce((max, match) => Math.max(max, match.kickoffAt), 0);
}

/** 邀請預設到期：賽事末場開賽後 7 天。 */
export function defaultInviteExpires(matches: readonly { kickoffAt: number }[]): number {
  return lastKickoff(matches) + 7 * DAY_MS;
}

export const S4B_INVITE_EXPIRES = defaultInviteExpires(S4B_MATCHES);

export type InviteLife = 'active' | 'used' | 'revoked' | 'expired';
export interface S4bInvite {
  id: string;
  role: AssignRole;
  matchIds: readonly string[];
  expiresAt: number;
  used: boolean;
  revoked: boolean;
}

export const S4B_INVITES: readonly S4bInvite[] = [
  { id: 'iv_active', role: 'scorer', matchIds: ['m_1400'], expiresAt: S4B_INVITE_EXPIRES, used: false, revoked: false },
  { id: 'iv_used', role: 'referee', matchIds: ['m_2200'], expiresAt: S4B_INVITE_EXPIRES, used: true, revoked: false },
  { id: 'iv_revoked', role: 'scorer', matchIds: ['m_2310'], expiresAt: S4B_INVITE_EXPIRES, used: false, revoked: true },
  { id: 'iv_expired', role: 'referee', matchIds: ['m_live'], expiresAt: taipeiMs(2027, 1, 8, 18, 0), used: false, revoked: false },
];

/** 已撤銷優先於已使用，已使用優先於到期。 */
export function inviteLife(row: Pick<S4bInvite, 'used' | 'revoked' | 'expiresAt'>, now: number): InviteLife {
  if (row.revoked) return 'revoked';
  if (row.used) return 'used';
  if (row.expiresAt <= now) return 'expired';
  return 'active';
}

export function canRevokeInvite(life: InviteLife): boolean {
  return life === 'active';
}

export const S4B_ROSTER_LOCK_AT = taipeiMs(2027, 1, 16, 18, 0);
export const S4B_LINK_MAX_USES = 30;
export const S4B_LINK_USED = 4;
export const S4B_LINK_DAYS_MIN = 1;
export const S4B_LINK_DAYS_MAX = 30;
export const S4B_LINK_USES_MIN = 1;
export const S4B_LINK_USES_MAX = 60;

/** 名單鎖定與「現在加 N 天」取較早的那個。沒有鎖定日就用 N 天。 */
export function rosterLinkExpires(now: number, lockAt: number | null, days = 14): number {
  const byDays = now + days * DAY_MS;
  if (lockAt == null) return byDays;
  return Math.min(lockAt, byDays);
}

export const S4B_ROSTER_LINK_EXPIRES = rosterLinkExpires(S4B_NOW, S4B_ROSTER_LOCK_AT, 14);

export type CheckinViewer = 'host' | 'rep' | 'other';
export type PlayerPos = 'GK' | 'DF' | 'MF' | 'FW';
export interface S4bPlayer {
  id: string;
  teamId: string;
  teamName: string;
  number: number;
  realName: string;
  displayName: string;
  position: PlayerPos;
}

export const S4B_TEAM_THUNDER = 'team_thunder';
export const S4B_TEAM_WIND = 'team_wind';

export const S4B_PLAYERS: readonly S4bPlayer[] = [
  { id: 'p1', teamId: S4B_TEAM_THUNDER, teamName: '雷霆隊', number: 1, realName: '陳大明', displayName: '阿明', position: 'GK' },
  { id: 'p4', teamId: S4B_TEAM_THUNDER, teamName: '雷霆隊', number: 4, realName: '林志遠', displayName: '志遠', position: 'DF' },
  { id: 'p9', teamId: S4B_TEAM_THUNDER, teamName: '雷霆隊', number: 9, realName: '劉冠廷', displayName: '冠廷', position: 'FW' },
  { id: 'p10', teamId: S4B_TEAM_THUNDER, teamName: '雷霆隊', number: 10, realName: '蔡明哲', displayName: '明哲', position: 'MF' },
  { id: 'h1', teamId: S4B_TEAM_WIND, teamName: '海風隊', number: 1, realName: '王大同', displayName: '大同', position: 'GK' },
  { id: 'h3', teamId: S4B_TEAM_WIND, teamName: '海風隊', number: 3, realName: '李俊傑', displayName: '俊傑', position: 'DF' },
  { id: 'h11', teamId: S4B_TEAM_WIND, teamName: '海風隊', number: 11, realName: '謝東霖', displayName: '東霖', position: 'FW' },
  { id: 'h14', teamId: S4B_TEAM_WIND, teamName: '海風隊', number: 14, realName: '洪立群', displayName: '立群', position: 'MF' },
];

export const S4B_NUMBER_MIN = 1;
export const S4B_NUMBER_MAX = 30;

export function usedNumbers(teamId: string, players: readonly S4bPlayer[] = S4B_PLAYERS): Set<number> {
  return new Set(players.filter((player) => player.teamId === teamId).map((player) => player.number));
}

export function canSeeRealName(viewer: CheckinViewer, teamId: string, repTeamId: string | null): boolean {
  if (viewer === 'host') return true;
  if (viewer === 'rep') return repTeamId != null && repTeamId === teamId;
  return false;
}

export interface PlayerTeam {
  teamId: string;
  teamName: string;
  players: S4bPlayer[];
}

export function playersByTeam(players: readonly S4bPlayer[]): PlayerTeam[] {
  const order: string[] = [];
  const map = new Map<string, S4bPlayer[]>();
  for (const player of players) {
    const list = map.get(player.teamId);
    if (list) list.push(player);
    else {
      order.push(player.teamId);
      map.set(player.teamId, [player]);
    }
  }
  return order.map((teamId) => {
    const list = map.get(teamId) ?? [];
    return { teamId, teamName: list[0]?.teamName ?? '', players: list };
  });
}

export const S4B_ADDITION_CAP = 3;
export const S4B_ADDITION_APPROVED = 1;

export function additionRemaining(cap: number, approved: number): number {
  return cap - approved;
}

export const S4B_ADDITION_LEFT = additionRemaining(S4B_ADDITION_CAP, S4B_ADDITION_APPROVED);

export interface S4bAddition {
  id: string;
  teamName: string;
  displayName: string;
  number: number;
  at: number;
}

export const S4B_ADDITIONS: readonly S4bAddition[] = [
  { id: 'ad1', teamName: '雷霆隊', displayName: '新手', number: 15, at: taipeiMs(2027, 1, 9, 8, 20) },
  { id: 'ad2', teamName: '海風隊', displayName: '阿海', number: 8, at: taipeiMs(2027, 1, 9, 8, 41) },
];

export const S4B_ADDITION_SENT = {
  displayName: '阿凱',
  number: 16,
} as const;

export type AuditAction = 'score' | 'reset' | 'rules';
export interface S4bAudit {
  id: string;
  at: number;
  action: AuditAction;
  target: string;
  reason: string;
  before?: string;
  after?: string;
  actorUid: string;
}

export const S4B_AUDIT: readonly S4bAudit[] = [
  { id: 'au1', at: taipeiMs(2027, 1, 9, 9, 12), action: 'score', target: '1/9 09:00 雷霆隊對海風隊', reason: '記錯邊', before: '1:0', after: '2:0', actorUid: 'uid_host_9f3a' },
  { id: 'au2', at: taipeiMs(2027, 1, 9, 9, 20), action: 'reset', target: '1/9 14:00 山貓隊對藍鯨隊', reason: '裁判未到', actorUid: 'uid_host_9f3a' },
  { id: 'au3', at: taipeiMs(2027, 1, 9, 8, 5), action: 'rules', target: '成人組', reason: '勝分改 2', actorUid: 'uid_admin_22c1' },
];

export const S4B_TEMPLATES = [
  { id: 'five', players: 5, half: 20, halftime: 5 },
  { id: 'seven', players: 7, half: 25, halftime: 5 },
  { id: 'eleven', players: 11, half: 35, halftime: 10 },
] as const;
export type TemplateId = (typeof S4B_TEMPLATES)[number]['id'];

export const S4B_PUBLISHED = {
  win: 3,
  draw: 1,
  loss: 0,
  woFor: 2,
  woAgainst: 0,
  award: 3,
  penalty: 0,
  fair: { yellow: -1, secondYellow: -3, directRed: -4, yellowThenRed: -5 },
} as const;

export const S4B_TIEBREAK = [
  'points',
  'headToHeadPoints',
  'headToHeadGoalDiff',
  'headToHeadGoalsFor',
  'goalDiff',
  'goalsFor',
  'goalsAgainstAsc',
  'fairPlay',
  'manual',
] as const;
export type TieKey = (typeof S4B_TIEBREAK)[number];

export const S4B_DRAFT_POINTS = { win: 1, draw: 2, loss: 0 } as const;

export function pointsWarn(win: number, draw: number, loss: number): { winLow: boolean; lossHigh: boolean } {
  return { winLow: win < draw, lossHigh: loss > draw };
}

export function formatSigned(n: number): string {
  if (n < 0) return `−${Math.abs(n)}`;
  return String(n);
}

/** 開賽已到的場次不應仍是未開賽；未到的場次不標進行中。 */
export function scheduleStatusIssues(matches: readonly S4bMatch[], now: number): string[] {
  const issues: string[] = [];
  for (const match of matches) {
    if (match.kickoffAt <= now && match.status === 'scheduled') issues.push(`${match.id} 已開賽仍是未開賽`);
    if (match.kickoffAt > now && match.status === 'live') issues.push(`${match.id} 未開賽卻標進行中`);
  }
  return issues;
}
