// 課程（K1 學員端）純函式：方案／課堂正規化、卡片狀態、出缺席判斷、錯誤碼對應。
// 讀取契約（K0 報告 §4.1）：
//   - 方案人數只用 listEduCourseEnrollmentSummaries 的 effectiveApprovedCount。
//   - 課堂名冊、請假、自主簽到只看 sessions.studentIds。
//   - 我的課程與未繳費用 roster-union 的聯集。
import { formatTaipei, parseTaipei } from '@/core/taipei-time';
import { getApprovedStudentIdSet } from './roster-union';

export type PlanType = 'weekly' | 'session';

export interface SessionSchedule {
  date: string;
  startTime: string;
  endTime: string;
}

export interface CoursePlan {
  id: string;
  name: string;
  planType: PlanType;
  weekdays: number[];
  timeSlot: string;
  sessionSchedules: SessionSchedule[];
  totalSessions: number | null;
  startDate: string;
  endDate: string;
  location: string;
  coachName: string;
  description: string;
  price: number | null;
  perSessionBilling: boolean;
  maxCapacity: number;
  allowSignup: boolean;
  visibleOnTeamPage: boolean;
  active: boolean;
  groupId: string;
  pinned: boolean;
  sortOrder: number;
}

export interface CourseStudent {
  id: string;
  docId: string;
  name: string;
  selfUid: string;
  parentUid: string;
  enrollStatus: string;
  groupIds: string[];
}

export interface CourseEnrollment {
  id: string;
  studentId: string;
  status: string;
  paidAt: string;
}

export interface CourseSession {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  studentIds: string[];
  sessionNumber: number | null;
  /** 開始時間（台北）；解析不出時為 null。 */
  startMs: number | null;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  sessionId: string;
  date: string;
  kind: string;
  status: string;
}

export type AttendanceKind = 'signin' | 'leave' | 'registered';

export interface CourseSummary {
  effectiveApprovedCount: number | null;
  pendingReviewCount: number;
  viewerStatuses: Record<string, string>;
}

function str(value: unknown, max = 200): string {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizePlan(id: string, data: Record<string, unknown>): CoursePlan {
  const schedules = Array.isArray(data.sessionSchedules) ? data.sessionSchedules : [];
  return {
    id: str(data.id || id, 100) || id,
    name: str(data.name, 120),
    planType: str(data.planType, 32) === 'weekly' ? 'weekly' : 'session',
    weekdays: Array.isArray(data.weekdays)
      ? data.weekdays.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [],
    timeSlot: str(data.timeSlot, 40),
    sessionSchedules: schedules
      .map((item) => {
        const row = (item ?? {}) as Record<string, unknown>;
        return { date: str(row.date, 20), startTime: str(row.startTime, 10), endTime: str(row.endTime, 10) };
      })
      .filter((item) => item.date),
    totalSessions: num(data.totalSessions),
    startDate: str(data.startDate, 20),
    endDate: str(data.endDate, 20),
    location: str(data.location, 160),
    coachName: str(data.coachName || data.coach, 60),
    description: str(data.description || data.courseContent, 900),
    price: num(data.price),
    perSessionBilling: data.perSessionBilling === true,
    maxCapacity: num(data.maxCapacity) ?? 0,
    allowSignup: data.allowSignup === true,
    visibleOnTeamPage: data.visibleOnTeamPage !== false,
    active: data.active !== false,
    groupId: str(data.groupId, 100),
    pinned: data.pinned === true,
    sortOrder: num(data.sortOrder) ?? 0,
  };
}

export function normalizeStudent(docId: string, data: Record<string, unknown>): CourseStudent {
  return {
    id: str(data.id || docId, 100),
    docId,
    name: str(data.name || data.displayName || data.studentName, 80),
    selfUid: str(data.selfUid, 128),
    parentUid: str(data.parentUid, 128),
    enrollStatus: str(data.enrollStatus, 32),
    groupIds: Array.isArray(data.groupIds) ? data.groupIds.map((g) => str(g, 100)).filter(Boolean) : [],
  };
}

export function normalizeEnrollment(docId: string, data: Record<string, unknown>): CourseEnrollment {
  return {
    id: docId,
    studentId: str(data.studentId, 100),
    status: str(data.status, 32),
    paidAt: str(data.paidAt, 40),
  };
}

/** 課堂開始時間：`YYYY-MM-DD` 加 `HH:mm`（台北）。 */
export function sessionStartMs(date: string, startTime: string): number | null {
  if (!date) return null;
  const day = date.replace(/-/g, '/');
  return parseTaipei(startTime ? `${day} ${startTime}` : day);
}

export function normalizeSession(id: string, data: Record<string, unknown>): CourseSession {
  const date = str(data.date, 20);
  const startTime = str(data.startTime, 10);
  return {
    id,
    date,
    startTime,
    endTime: str(data.endTime, 10),
    status: str(data.status, 32).toLowerCase(),
    studentIds: Array.isArray(data.studentIds) ? data.studentIds.map((v) => str(v, 100)).filter(Boolean) : [],
    sessionNumber: num(data.sessionNumber),
    startMs: sessionStartMs(date, startTime),
  };
}

export function normalizeAttendance(id: string, data: Record<string, unknown>): AttendanceRecord {
  return {
    id,
    studentId: str(data.studentId, 100),
    sessionId: str(data.sessionId, 100),
    date: str(data.date, 20),
    kind: str(data.kind, 20),
    status: str(data.status, 32).toLowerCase(),
  };
}

export function normalizeSummary(raw: unknown): CourseSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const statuses: Record<string, string> = {};
  if (data.viewerStatuses && typeof data.viewerStatuses === 'object') {
    for (const [key, value] of Object.entries(data.viewerStatuses as Record<string, unknown>)) {
      const sid = str(key, 100);
      if (sid) statuses[sid] = str(value, 32);
    }
  }
  return {
    effectiveApprovedCount: num(data.effectiveApprovedCount),
    pendingReviewCount: num(data.pendingReviewCount) ?? 0,
    viewerStatuses: statuses,
  };
}

/** 台北今天 `YYYY-MM-DD`（方案起訖日的格式）。 */
export function todayKey(nowMs: number): string {
  return formatTaipei(nowMs, 'YYYY-MM-DD');
}

/** 照伺服器 isCoursePlanEnded：結束日早於台北今天。 */
export function isPlanEnded(plan: CoursePlan, nowMs: number): boolean {
  return !!plan.endDate && plan.endDate < todayKey(nowMs);
}

/** 學員端看得到的方案：未停用、未結束；非幹部另外要「公開顯示」。排序照 A（置頂優先、sortOrder 升冪）。 */
export function visiblePlans(plans: readonly CoursePlan[], isStaff: boolean, nowMs: number): CoursePlan[] {
  return plans
    .filter((p) => p.active && !isPlanEnded(p, nowMs) && (isStaff || p.visibleOnTeamPage))
    .sort((a, b) => (a.pinned === b.pinned ? a.sortOrder - b.sortOrder : a.pinned ? -1 : 1));
}

/** 我名下、仍在籍（非 inactive）的學員（照 A `_getMyEduStudents`）。 */
export function ownedStudents(students: readonly CourseStudent[], uid: string | null): CourseStudent[] {
  if (!uid) return [];
  return students.filter(
    (s) => s.enrollStatus !== 'inactive' && (s.selfUid === uid || s.parentUid === uid),
  );
}

export interface ViewerPlanState {
  /** 聯集（approved 報名 ∪ 分組 active）裡屬於我的學員。 */
  approvedIds: Set<string>;
  /** 報名還在審核中的我的學員。 */
  pendingIds: Set<string>;
  /** studentId → approved 報名（繳費判斷用）。 */
  approvedEnrollment: Map<string, CourseEnrollment>;
  /** 報名讀取失敗、改用 viewerStatuses 時為 true：不知道繳費狀態，不顯示未繳費。 */
  paymentUnknown?: boolean;
}

export function getViewerPlanState(
  plan: CoursePlan,
  myStudents: readonly CourseStudent[],
  myEnrollments: readonly CourseEnrollment[],
  migrationCompleted: boolean,
): ViewerPlanState {
  const mine = new Set(myStudents.map((s) => s.id));
  const union = getApprovedStudentIdSet({ plan, enrollments: myEnrollments, students: myStudents, migrationCompleted });
  const approvedIds = new Set([...union].filter((id) => mine.has(id)));
  const pendingIds = new Set<string>();
  const approvedEnrollment = new Map<string, CourseEnrollment>();
  for (const e of myEnrollments) {
    if (!mine.has(e.studentId)) continue;
    // 照 A：分組名冊內但另有 pending 報名（K0 的 P09 情況）仍算審核中。
    if (e.status === 'pending') pendingIds.add(e.studentId);
    if (e.status === 'approved') approvedEnrollment.set(e.studentId, e);
  }
  return { approvedIds, pendingIds, approvedEnrollment };
}

export type CardState = 'open' | 'full' | 'closed' | 'pending' | 'enrolled';

/** 課程卡狀態（順序照 A 方案卡：審核中 → 已報名 → 未開放 → 額滿 → 可報名）。 */
export function getCardState(
  plan: CoursePlan,
  effectiveCount: number | null,
  viewer: Pick<ViewerPlanState, 'approvedIds' | 'pendingIds'> | null,
): CardState {
  if (viewer && viewer.pendingIds.size > 0) return 'pending';
  if (viewer && viewer.approvedIds.size > 0) return 'enrolled';
  if (!plan.allowSignup) return 'closed';
  if (isPlanFull(plan, effectiveCount)) return 'full';
  return 'open';
}

export function isPlanFull(plan: CoursePlan, effectiveCount: number | null): boolean {
  return plan.maxCapacity > 0 && effectiveCount !== null && effectiveCount >= plan.maxCapacity;
}

/** 方案是否記錄整期繳費（照 A `_shouldTrackCoursePlanPayment`：非隨堂收費且價格 > 0）。 */
export function tracksPayment(plan: CoursePlan): boolean {
  return !plan.perSessionBilling && (plan.price ?? 0) > 0;
}

/** 在名冊（聯集）內但沒有已繳費的 approved 報名，就是未繳費（分組舊制學員沒有報名文件，一律算未繳）。 */
export function isUnpaid(plan: CoursePlan, studentId: string, state: ViewerPlanState): boolean {
  if (state.paymentUnknown || !tracksPayment(plan) || !state.approvedIds.has(studentId)) return false;
  return !state.approvedEnrollment.get(studentId)?.paidAt;
}

// ── 課堂與出缺席 ─────────────────────────────────────

const CLOSED_SESSION_STATUSES = new Set(['cancelled', 'canceled', 'done', 'removed', 'completed', 'ended', 'closed', 'rescheduled']);
const SIX_HOURS = 6 * 60 * 60 * 1000;

/** 學員端列出的課堂：排除已移除；依開始時間排序。 */
export function sortSessions(sessions: readonly CourseSession[]): CourseSession[] {
  return sessions
    .filter((s) => s.status !== 'removed')
    .slice()
    .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity) || a.id.localeCompare(b.id));
}

/** 已結束（照 A `_getCourseSessionStatusMeta`：開始超過 6 小時算已完成）或已關閉的課堂，不再提供操作。 */
export function isSessionOpenForSelf(session: CourseSession, nowMs: number): boolean {
  if (CLOSED_SESSION_STATUSES.has(session.status)) return false;
  if (session.startMs === null) return true;
  return session.startMs >= nowMs - SIX_HOURS;
}

export function isSessionPast(session: CourseSession, nowMs: number): boolean {
  return session.startMs !== null && session.startMs < nowMs - SIX_HOURS;
}

function kindOf(record: AttendanceRecord): AttendanceKind {
  if (record.kind === 'leave') return 'leave';
  if (record.kind === 'registered') return 'registered';
  return 'signin';
}

const KIND_PRIORITY: Record<AttendanceKind, number> = { signin: 3, leave: 2, registered: 1 };

/**
 * 某學員在某堂的出缺席（照伺服器 listEduCoursePublicRoster：同堂 sessionId 的紀錄，
 * 加上沒有 sessionId、日期相同的舊紀錄；removed／cancelled 不算；簽到 > 請假 > 已報名）。
 */
export function attendanceKindForSession(
  records: readonly AttendanceRecord[],
  session: CourseSession,
  studentId: string,
): AttendanceKind | null {
  let best: AttendanceKind | null = null;
  for (const record of records) {
    if (record.studentId !== studentId) continue;
    if (record.status === 'removed' || record.status === 'cancelled' || record.status === 'canceled') continue;
    const sameSession = record.sessionId
      ? record.sessionId === session.id
      : !!record.date && record.date === session.date;
    if (!sameSession) continue;
    const kind = kindOf(record);
    if (!best || KIND_PRIORITY[kind] >= KIND_PRIORITY[best]) best = kind;
  }
  return best;
}

export type LessonDisplay = 'signin' | 'leave' | 'registered' | 'unregistered' | 'none';
export type LessonAction = 'register' | 'leave' | 'cancelLeave' | null;

/**
 * 學員端每一堂的顯示與按鈕（預覽 K1-3、顧問 §3.41 (a)）。
 * - 固定週期：沒有紀錄顯示「未報名」（統計照 A 仍算請假，後端不變）；未報名→報名、已報名→請假、請假→取消。
 * - 堂數制：預設要來，未請假→請假、請假→取消；沒有紀錄不顯示狀態。
 * - 已簽到、已結束或已關閉的課堂不給按鈕。
 */
export function lessonView(
  planType: PlanType,
  kind: AttendanceKind | null,
  open: boolean,
): { display: LessonDisplay; action: LessonAction } {
  const display: LessonDisplay = kind ?? (planType === 'weekly' ? 'unregistered' : 'none');
  if (!open || kind === 'signin') return { display, action: null };
  if (kind === 'leave') return { display, action: 'cancelLeave' };
  if (planType === 'weekly') return { display, action: kind === 'registered' ? 'leave' : 'register' };
  return { display, action: 'leave' };
}

// ── 錯誤碼 ───────────────────────────────────────────

const KNOWN_ERROR_CODES = new Set([
  'COURSE_FULL',
  'SIGNUP_CLOSED',
  'PLAN_ENDED',
  'PLAN_INACTIVE',
  'PLAN_HIDDEN',
  'PLAN_NOT_FOUND',
  'TEAM_NOT_FOUND',
  'ALREADY_ENROLLED',
  'NO_STUDENTS',
  'NO_ELIGIBLE_STUDENTS',
  'STUDENT_NOT_FOUND',
  'STUDENT_FORBIDDEN',
  'STUDENT_INACTIVE',
  'NO_PENDING_ENROLLMENTS',
  'ENROLLMENT_NOT_PENDING',
  'STUDENT_NOT_IN_ROSTER',
  'SELF_ATTENDANCE_SESSION_CLOSED',
  'ONLY_WEEKLY_COURSE_SELF_ATTENDANCE',
  'COURSE_EVENT_ATTENDANCE_SYNC_FAILED',
  'SESSION_NOT_FOUND',
  'PERMISSION_DENIED',
]);

/**
 * Callable 錯誤 → 課程錯誤碼。伺服器把業務碼放在 details.code（createEduCourseHttpsError）或 message；
 * 未登入等 Firebase 通用錯誤以 code 判斷。認不得的一律 'UNKNOWN'，畫面不露技術碼。
 */
export function courseErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  const details = e.details && typeof e.details === 'object' ? (e.details as { code?: unknown }) : null;
  const candidates = [details?.code, e.message];
  for (const candidate of candidates) {
    const code = str(candidate, 80);
    if (KNOWN_ERROR_CODES.has(code)) return code;
  }
  const fbCode = str(e.code, 80).replace(/^functions\//, '');
  if (fbCode === 'unauthenticated') return 'UNAUTHENTICATED';
  if (fbCode === 'resource-exhausted') return 'COURSE_FULL';
  if (fbCode === 'already-exists') return 'ALREADY_ENROLLED';
  return 'UNKNOWN';
}
