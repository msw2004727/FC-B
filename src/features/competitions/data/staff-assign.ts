// 指派畫面的純規則。staff 文件沒有名字，顯示用角色與 uid 編號。
// 比賽日沿用預覽的 05:00 邊界，避免清單與指派頁分叉。

import { competitionDay, weekdayIndex } from '../testing/step4b-fixtures';

export { clockLabel } from '../testing/step4b-fixtures';
import type { MatchStatus, StaffAssignmentRole } from './types';

export type StaffViewerKind = 'host' | 'coHost';
export type ScoreRole = 'scorer' | 'referee';

/**
 * 已結束後仍可進入記分的窗口。
 * 與 live/clock.ts 的 FINISH_UNDO_MS 相同：剛好滿 180 秒就不顯示按鈕。
 */
export const SCORE_FINISH_WINDOW_MS = 180_000;

const ROLE_ORDER: readonly StaffAssignmentRole[] = ['host', 'coHost', 'scorer', 'referee'];

export interface StaffNameLabels {
  me: string;
  member: string;
  memberN: (n: number) => string;
}

const NAME_LABELS: StaffNameLabels = {
  me: '我自己',
  member: '成員',
  memberN: (n) => `成員 ${n}`,
};

export function viewerKind(roles: readonly string[], isAdmin: boolean): StaffViewerKind | null {
  if (isAdmin || roles.includes('host')) return 'host';
  if (roles.includes('coHost')) return 'coHost';
  return null;
}

/** 一列只掛一個角色標籤。主辦優先於共同主辦，再來記分員、裁判。 */
export function rowRole(roles: readonly string[]): StaffAssignmentRole | null {
  for (const role of ROLE_ORDER) {
    if (roles.includes(role)) return role;
  }
  return null;
}

/**
 * 移除鈕。主辦列不顯示。共同主辦列只有主辦視角顯示。
 * 記分員與裁判兩種視角都顯示。
 */
export function canRemoveStaffRow(viewer: StaffViewerKind, role: StaffAssignmentRole): boolean {
  if (role === 'host') return false;
  if (role === 'coHost') return viewer === 'host';
  return role === 'scorer' || role === 'referee';
}

export function hasScoreRole(roles: readonly string[]): boolean {
  return roles.includes('scorer') || roles.includes('referee');
}

/** 與預覽 dayHeading 相同：M/D（週幾）。 */
export function dayHeadingText(month: number, day: number, weekday: string): string {
  return `${month}/${day}（${weekday}）`;
}

export function vsText(home: string, away: string): string {
  return `${home}對${away}`;
}

export function matchVenueName(
  match: { venueName: string | null; venueIdx: number | null },
  venues: readonly { name: string }[],
): string {
  if (match.venueName) return match.venueName;
  if (match.venueIdx == null) return '';
  return venues[match.venueIdx]?.name ?? '';
}

export interface StaffNameInput {
  uid: string;
  roles: readonly string[];
}

/** 自己是「我自己」。其他人依角色分組，同角色兩人以上才依 uid 編號。 */
export function staffDisplayNames(
  rows: readonly StaffNameInput[],
  selfUid: string,
  labels: StaffNameLabels = NAME_LABELS,
): Map<string, string> {
  const names = new Map<string, string>();
  const groups = new Map<StaffAssignmentRole, string[]>();
  for (const row of rows) {
    if (row.uid === selfUid) {
      names.set(row.uid, labels.me);
      continue;
    }
    const role = rowRole(row.roles);
    if (!role) continue;
    const list = groups.get(role);
    if (list) list.push(row.uid);
    else groups.set(role, [row.uid]);
  }
  for (const uids of groups.values()) {
    const sorted = [...uids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (sorted.length === 1) {
      names.set(sorted[0] ?? '', labels.member);
      continue;
    }
    sorted.forEach((uid, index) => names.set(uid, labels.memberN(index + 1)));
  }
  return names;
}

/** 下拉：我自己在最前，其餘依 uid。自己不重複。 */
export function assignPeople(
  rows: readonly StaffNameInput[],
  selfUid: string,
  labels: StaffNameLabels = NAME_LABELS,
): { uid: string; name: string }[] {
  const names = staffDisplayNames(rows, selfUid, labels);
  const others = rows
    .filter((row) => row.uid !== selfUid && names.has(row.uid))
    .map((row) => ({ uid: row.uid, name: names.get(row.uid) ?? labels.member }))
    .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  return [{ uid: selfUid, name: labels.me }, ...others];
}

/** 儲存只送一個角色，不送 expiresAt。matchIds 維持呼叫端的順序。 */
export function assignStaffFields(input: {
  cid: string;
  uid: string;
  role: ScoreRole;
  matchIds: readonly string[];
}): { cid: string; uid: string; roles: [ScoreRole]; matchIds: string[] } {
  return {
    cid: input.cid,
    uid: input.uid,
    roles: [input.role],
    matchIds: [...input.matchIds],
  };
}

/** 未開賽、進行中、中場一直可進。已結束只在 180 秒內。其餘狀態不顯示按鈕。 */
export function showScoreEntry(status: MatchStatus, finishedAt: number | null, now: number): boolean {
  if (status === 'scheduled' || status === 'live' || status === 'halftime') return true;
  if (status !== 'finished' || finishedAt == null) return false;
  return finishedAt + SCORE_FINISH_WINDOW_MS - now > 0;
}

export interface DayGroup<T> {
  key: string;
  month: number;
  day: number;
  weekday: number;
  items: T[];
}

export interface CompetitionDayGroups<T> {
  days: DayGroup<T>[];
  undated: T[];
}

/** 依比賽日、再依開賽時間。沒有開賽時間的留在 undated，不混進某一天。 */
export function groupByCompetitionDay<T extends { kickoffAt: number | null }>(
  items: readonly T[],
): CompetitionDayGroups<T> {
  const undated: T[] = [];
  const dated: (T & { kickoffAt: number })[] = [];
  for (const item of items) {
    if (item.kickoffAt == null) undated.push(item);
    else dated.push(item as T & { kickoffAt: number });
  }
  const sorted = [...dated].sort((a, b) => a.kickoffAt - b.kickoffAt);
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const item of sorted) {
    const day = competitionDay(item.kickoffAt);
    const list = map.get(day.key);
    if (list) list.push(item);
    else {
      order.push(day.key);
      map.set(day.key, [item]);
    }
  }
  const days = order.map((key) => {
    const list = map.get(key) ?? [];
    const first = list[0] as { kickoffAt: number } | undefined;
    const day = competitionDay(first?.kickoffAt ?? 0);
    return {
      key,
      month: day.month,
      day: day.day,
      weekday: weekdayIndex(key) ?? 0,
      items: list,
    };
  });
  return { days, undated };
}
