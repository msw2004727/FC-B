import type { UserRole } from '@/ui/Avatar';
import { isTeamDetailSectionVisible } from '../../data/team-detail-model';
import type { TeamDoc, TeamRosterRow } from '../../data/types';

export type LegacyMemberFilterKey = 'all' | 'manager' | 'leader' | 'coach' | 'student';

export interface LegacyMemberFilterOption {
  key: LegacyMemberFilterKey;
  label: string;
  count: number;
}

export interface LegacyMemberMatchData {
  count: number | null;
  jerseyNumber: string;
  position: string;
  notes: string;
}

export interface LegacyMemberCourseData {
  group: string;
  payment: string;
  count: number | null;
  notes: string;
}

export interface LegacyMemberActivityData {
  count: number | null;
  notes: string;
}

export interface LegacyMetaPrimaryItem {
  text: string;
  className: string;
}

export interface LegacyMetaNoteItem {
  label: string;
  text: string;
}

export interface LegacyIntegratedMeta {
  primaryItems: LegacyMetaPrimaryItem[];
  noteItems: LegacyMetaNoteItem[];
}

const KNOWN_USER_ROLES: ReadonlySet<string> = new Set<UserRole>([
  'user',
  'coach',
  'captain',
  'team_leader',
  'venue_owner',
  'admin',
  'super_admin',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && KNOWN_USER_ROLES.has(value);
}

/**
 * 將 B `TeamRosterRow.roles`（i18n key）對應到 A 的 manager / leader / coach。
 */
export function mapRosterRolesToLegacyFilterKeys(
  roles: readonly string[],
): ReadonlySet<'manager' | 'leader' | 'coach'> {
  const result = new Set<'manager' | 'leader' | 'coach'>();
  for (const role of roles) {
    if (role === 'clubs.role.captain' || role === '球經') result.add('manager');
    if (role === 'clubs.role.leader' || role === '領隊') result.add('leader');
    if (role === 'clubs.role.coach' || role === '教練') result.add('coach');
  }
  return result;
}

/** A `_teamMemberMatchesFilter`（team-detail-render.js:1695-1704）。 */
export function teamMemberMatchesFilter(
  row: TeamRosterRow,
  filter: LegacyMemberFilterKey,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'student') {
    // B 尚無教育學員資料，student 固定為 false。
    return false;
  }
  const roles = mapRosterRolesToLegacyFilterKeys(row.roles);
  return roles.has(filter);
}

/** A `_getTeamMemberFilterOptions`（team-detail-render.js:1706-1716）。 */
export function getTeamMemberFilterOptions(
  roster: readonly TeamRosterRow[],
): LegacyMemberFilterOption[] {
  const count = (key: LegacyMemberFilterKey): number =>
    roster.filter((row) => teamMemberMatchesFilter(row, key)).length;
  const allOptions: LegacyMemberFilterOption[] = [
    { key: 'all', label: '全部', count: roster.length },
    { key: 'manager', label: '球經', count: count('manager') },
    { key: 'leader', label: '領隊', count: count('leader') },
    { key: 'coach', label: '教練', count: count('coach') },
    { key: 'student', label: '學員', count: count('student') },
  ];
  return allOptions.filter((item) => item.key === 'all' || item.count > 0);
}

/** A `_getTeamDetailMemberUserRoleClass` 對應到 `UserTag` 的 `UserRole`。 */
export function getMemberUserTagRole(row: TeamRosterRow): UserRole {
  const roles = mapRosterRolesToLegacyFilterKeys(row.roles);
  if (roles.has('manager')) return 'captain';
  if (roles.has('leader')) return 'team_leader';
  if (roles.has('coach')) return 'coach';

  const user = isRecord(row.user) ? row.user : undefined;
  const rawRole = typeof user?.role === 'string' ? user.role.trim() : 'user';
  let effectiveRole: string = rawRole || 'user';
  if ((effectiveRole === 'admin' || effectiveRole === 'super_admin') && user?.stealth === true) {
    effectiveRole = 'user';
  }
  if (effectiveRole === 'team-leader') return 'team_leader';
  return isUserRole(effectiveRole) ? effectiveRole : 'user';
}

/** A `_getTeamDetailPersonName` 在缺名時的 fallback 為「未設定暱稱」。 */
export function getMemberDisplayName(row: TeamRosterRow): string {
  if (row.isMissingName) return '未設定暱稱';
  const trimmed = String(row.name ?? '').trim();
  return trimmed || '未設定暱稱';
}

/** A `row.key`（UID-only，R-ID-002）。 */
export function getMemberRowKey(row: TeamRosterRow): string {
  const uid = String(row.uid ?? '').trim();
  return uid ? `uid:${uid}` : '';
}

/** A `_readTeamDetailTextValue`。 */
export function readTextValue(source: unknown, keys: readonly string[]): string {
  if (!isRecord(source)) return '';
  for (const key of keys) {
    const value = source[key];
    if (value == null) continue;
    if (Array.isArray(value)) {
      const joined = value
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
        .join(' / ');
      if (joined) return joined;
      continue;
    }
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/** A `_readTeamDetailScopedObject`。 */
export function readScopedObject(
  source: unknown,
  teamId: string,
  mapKeys: readonly string[],
): Record<string, unknown> | null {
  if (!isRecord(source) || !teamId) return null;
  for (const key of mapKeys) {
    const map = source[key];
    if (!isRecord(map)) continue;
    const value = map[teamId];
    if (isRecord(value)) return value;
  }
  return null;
}

/** A `_readTeamDetailScopedText`。 */
export function readScopedText(
  source: unknown,
  teamId: string,
  mapKeys: readonly string[],
  valueKeys: readonly string[],
): string {
  const scoped = readScopedObject(source, teamId, mapKeys);
  return scoped ? readTextValue(scoped, valueKeys) : '';
}

/** A `_readTeamDetailMemberData`（僅以 UID 索引，遵守 R-ID-002）。 */
export function readTeamMemberData(
  team: TeamDoc,
  row: TeamRosterRow,
  fieldNames: readonly string[],
): Record<string, unknown> {
  const user = isRecord(row.user) ? row.user : undefined;
  const memberKeys = [row.uid, user?.uid, user?._docId]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .map((v) => v.replace(/^uid:/, '').replace(/^doc:/, ''));

  for (const fieldName of fieldNames) {
    const map = team[fieldName];
    if (!isRecord(map)) continue;
    for (const key of memberKeys) {
      const value = map[key];
      if (isRecord(value)) return value;
    }
  }
  return {};
}

/** A `_readTeamDetailCountValue`：讀直接存在文件上的非負數統計欄。 */
export function readDirectCountValue(
  source: unknown,
  keys: readonly string[],
): number | null {
  if (!isRecord(source)) return null;
  for (const key of keys) {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const num = Number(raw);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return null;
}

/** A `_formatTeamDetailPaymentStatus`（team-detail-render.js）。 */
function formatPaymentStatus(value: unknown): string {
  if (value == null || value === '') return '-';
  if (value === true) return '已繳';
  if (value === false) return '未繳';
  const text = String(value).trim();
  if (!text) return '-';
  const lower = text.toLowerCase();
  if (['paid', 'complete', 'completed', 'yes', 'true'].includes(lower)) return '已繳';
  if (['unpaid', 'pending', 'no', 'false'].includes(lower)) return '未繳';
  return text;
}

function formatYmd(date: Date): string {
  if (Number.isNaN(date.getTime())) return '-';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/** A `_formatTeamDetailDateValue`：無值回 '-'。 */
function formatDateValue(value: unknown): string {
  if (!value) return '-';
  if (value instanceof Date) return formatYmd(value);
  if (isRecord(value) && typeof value.toDate === 'function') {
    const d = (value.toDate as () => unknown)();
    return d instanceof Date ? formatYmd(d) : '-';
  }
  if (isRecord(value) && typeof value.seconds === 'number') {
    return formatYmd(new Date(value.seconds * 1000));
  }
  const raw = String(value).trim();
  if (!raw) return '-';
  const normalized = raw.replace(/\./g, '/').replace(/-/g, '/');
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (match) return `${match[1]}/${match[2]!.padStart(2, '0')}/${match[3]!.padStart(2, '0')}`;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return formatYmd(new Date(parsed));
  return raw.slice(0, 10);
}

/** A `_readTeamDetailDateValue`：跳過非日期物件；格式化成功才回傳。 */
function readDateFromKeys(source: unknown, keys: readonly string[]): string {
  if (!isRecord(source)) return '';
  for (const key of keys) {
    const value = source[key];
    if (!value) continue;
    if (isRecord(value)
      && !(value instanceof Date)
      && typeof value.toDate !== 'function'
      && typeof value.seconds !== 'number') {
      continue;
    }
    const formatted = formatDateValue(value);
    if (formatted && formatted !== '-') return formatted;
  }
  return '';
}

/** A `_readTeamDetailMappedJoinDate`。 */
function readMappedJoinDate(source: unknown, teamId: string): string {
  if (!isRecord(source) || !teamId) return '';
  for (const key of ['teamJoinedAtByTeam', 'teamJoinDates', 'teamJoinedAtMap', 'teamMemberSince']) {
    const map = source[key];
    if (!isRecord(map)) continue;
    const formatted = formatDateValue(map[teamId]);
    if (formatted && formatted !== '-') return formatted;
  }
  return '';
}

/** A `_getTeamDetailMemberJoinTime`（team-detail-render.js:654-663）。 */
export function getMemberJoinTime(team: TeamDoc, row: TeamRosterRow): string {
  const teamId = String(team.id ?? '').trim();
  const user = row.user;
  return (
    readMappedJoinDate(user, teamId) ||
    readDateFromKeys(user, ['teamJoinedAt', 'memberJoinedAt', 'joinedAt', 'joinAt', 'memberSince']) ||
    '-'
  );
}

/** A `_getTeamDetailMemberMatchData`（team-detail-render.js:1400-1412）。 */
export function getMemberMatchData(team: TeamDoc, row: TeamRosterRow): LegacyMemberMatchData {
  const teamId = String(team.id ?? '').trim();
  const teamScoped = readTeamMemberData(team, row, ['memberMatchData']);
  const userScoped =
    readScopedObject(row.user, teamId, [
      'teamMatchData',
      'clubMatchData',
      'matchDataByTeam',
      'teamMemberMatchData',
    ]) ?? {};
  const userObj = isRecord(row.user) ? row.user : {};
  const source: Record<string, unknown> = {
    ...userObj,
    ...userScoped,
    ...teamScoped,
  };
  // 下一批補：從 team.history 計算出賽次數（A `_getTeamDetailMatchParticipationCount` 快取計算）。
  const directCount = readDirectCountValue(row.user, [
    'clubMatchParticipationCount',
    'matchParticipationCount',
    'matchCount',
  ]);
  return {
    count: directCount,
    jerseyNumber: readTextValue(source, ['jerseyNumber', 'jerseyNo', 'shirtNumber', 'number']) || '-',
    position: readTextValue(source, ['matchPosition', 'teamPosition', 'position', 'positionTag']) || '-',
    notes: readTextValue(source, ['matchNotes', 'matchNote', 'matchRemark', 'notes']) || '-',
  };
}

/** A `_getTeamDetailMemberCourseData`（team-detail-render.js:1374-1398）。 */
export function getMemberCourseData(team: TeamDoc, row: TeamRosterRow): LegacyMemberCourseData {
  const teamId = String(team.id ?? '').trim();
  const source = isRecord(row.user) ? row.user : {};
  const teamScoped = readTeamMemberData(team, row, ['memberCourseData']);
  const group =
    readTextValue(source, ['groupNames', 'groupName', 'group', 'className', 'courseGroup']) ||
    readTextValue(teamScoped, ['groupName', 'group', 'className']) ||
    readScopedText(row.user, teamId, ['teamCourseData', 'clubCourseData'], ['groupName', 'group', 'className']) ||
    '-';
  const payment = source.paidAt
    ? '已繳'
    : formatPaymentStatus(
        source.paymentStatus ?? source.feeStatus ?? source.tuitionStatus ?? source.paid ?? source.feePaid,
      );
  const notes =
    readTextValue(teamScoped, ['notes', 'note', 'remark', 'courseNotes']) ||
    readScopedText(row.user, teamId, ['teamCourseData', 'clubCourseData'], ['notes', 'note', 'remark', 'courseNotes']) ||
    readTextValue(source, ['coachNotes', 'courseNotes', 'courseNote', 'notes']) ||
    '-';
  // 下一批補：從 eduAttendance 快取計算課程出席次數（A `_getTeamDetailCourseParticipationCount`）。
  const directCount = readDirectCountValue(row.user, [
    'courseParticipationCount',
    'courseAttendanceCount',
    'attendedLessonCount',
    'lessonCount',
  ]);
  return {
    group,
    payment,
    count: directCount,
    notes,
  };
}

/** A `_getTeamDetailMemberActivityData`（team-detail-render.js:1360-1372）。 */
export function getMemberActivityData(team: TeamDoc, row: TeamRosterRow): LegacyMemberActivityData {
  const teamId = String(team.id ?? '').trim();
  const teamScoped = readTeamMemberData(team, row, ['memberActivityData']);
  const note =
    readTextValue(teamScoped, ['notes', 'note', 'remark', 'activityNotes']) ||
    readScopedText(row.user, teamId, ['teamActivityData', 'clubActivityData'], [
      'notes',
      'note',
      'remark',
      'activityNotes',
    ]) ||
    readTextValue(row.user, ['activityNotes', 'activityNote', 'teamActivityNotes']);
  // 下一批補：從活動與簽到紀錄快取計算活動出席次數（A `_getTeamDetailActivityAttendanceCount`）。
  const directCount = readDirectCountValue(row.user, [
    'clubActivityAttendanceCount',
    'activityAttendanceCount',
    'attendanceCount',
    'checkinCount',
  ]);
  return {
    count: directCount,
    notes: note || '-',
  };
}

/** A `_shouldShowTeamMemberCourseSummary`（team-detail-render.js:1605-1613）。 */
export function shouldShowCourseSummary(
  course: LegacyMemberCourseData,
  showCourseSection: boolean,
): boolean {
  if (showCourseSection) return true;
  return Boolean(
    (course.group && course.group !== '-') ||
      (course.payment && course.payment !== '-') ||
      (course.count !== null && course.count > 0) ||
      (course.notes && course.notes !== '-'),
  );
}

/** A `_formatTeamMemberRosterJersey`（team-detail-render.js:1559-1563）。 */
export function formatRosterJersey(value: string | undefined): string {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return '--';
  return text.startsWith('#') ? text : `#${text}`;
}

/** A `_formatTeamMemberRosterPosition`（team-detail-render.js:1565-1569）。 */
export function formatRosterPosition(value: string | undefined): string {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return '--';
  return text;
}

/** A `_buildTeamMemberIntegratedMeta`（team-detail-render.js:1615-1652）。 */
export function buildMemberIntegratedMeta(
  team: TeamDoc,
  row: TeamRosterRow,
  options: {
    showCourseSection?: boolean;
    showPrivateNotes: boolean;
    matchData?: LegacyMemberMatchData;
  },
): LegacyIntegratedMeta {
  const showCourseSection =
    options.showCourseSection ?? isTeamDetailSectionVisible(team, 'courses');
  const course = getMemberCourseData(team, row);
  const match = options.matchData ?? getMemberMatchData(team, row);
  const activity = getMemberActivityData(team, row);
  const showCourse = shouldShowCourseSummary(course, showCourseSection);

  const primaryItems: LegacyMetaPrimaryItem[] = [];
  const noteItems: LegacyMetaNoteItem[] = [];

  const pushPrimary = (value: string, className: string): void => {
    const text = String(value ?? '').trim();
    if (!text || text === '-') return;
    primaryItems.push({ text, className });
  };

  const pushNote = (value: string, label: string): void => {
    const text = String(value ?? '').trim();
    if (!text || text === '-') return;
    noteItems.push({ label, text });
  };

  if (showCourse) {
    pushPrimary(
      course.group === '-' ? '未分組' : course.group,
      'td-member-compact td-member-group',
    );
  }
  // 下一批補：B 無活動與賽事出席快取，match.count / course.count / activity.count 讀不到時不輸出該項，不編造 0。
  if (match.count !== null) {
    pushPrimary(`出賽 ${match.count} 次`, 'td-member-num td-member-match-count');
  }
  if (showCourse) {
    if (course.count !== null) {
      pushPrimary(`課程 ${course.count} 次`, 'td-member-num td-member-course-count');
    }
    pushPrimary(course.payment, 'td-member-compact td-member-payment');
  }
  if (activity.count !== null) {
    pushPrimary(`活動 ${activity.count} 次`, 'td-member-num td-member-activity-count');
  }

  const joinTime = getMemberJoinTime(team, row);
  if (joinTime && joinTime !== '-') {
    pushPrimary(`加入 ${joinTime}`, 'td-member-joined');
  }

  if (options.showPrivateNotes) {
    pushNote(activity.notes, '活動');
    if (showCourse) pushNote(course.notes, '課程');
    pushNote(match.notes, '賽事');
  }

  return { primaryItems, noteItems };
}
