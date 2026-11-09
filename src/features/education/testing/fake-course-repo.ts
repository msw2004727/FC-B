// 測試與截圖 harness 用的記憶體版課程資料（不連 Firestore、不呼叫 Functions）。
// 人數照伺服器 buildCourseEnrollmentSummary：用同一個聯集 helper 算 effectiveApprovedCount 與 viewerStatuses。
import type { TeamDoc } from '@/features/clubs/data/types';
import { getApprovedStudentIdSet } from '../data/roster-union';
import {
  normalizePlan,
  normalizeSession,
  normalizeStudent,
  type AttendanceRecord,
  type CourseEnrollment,
  type CourseSession,
  type CourseStudent,
} from '../data/course-model';
import { buildPendingStudentPayload, type CourseRepo } from '../data/course-repo';

export interface FakeCourseData {
  team: TeamDoc;
  plans: Record<string, Record<string, unknown>>;
  sessions: Record<string, Array<Record<string, unknown> & { id: string }>>;
  students: Array<Record<string, unknown> & { id: string }>;
  enrollments: Record<string, CourseEnrollment[]>;
  attendance: Array<AttendanceRecord & { planId: string }>;
  migrationCompleted?: boolean;
}

export interface FakeCourseRepo extends CourseRepo {
  data: FakeCourseData;
  calls: Array<{ method: string; args: unknown[] }>;
  /** 下一次呼叫某方法時丟這個錯誤（模擬 Callable 錯誤碼）。 */
  failNext: (method: keyof CourseRepo, error: unknown) => void;
}

export function callableError(code: string): Error & { code: string; details: { code: string } } {
  return Object.assign(new Error(code), { code: 'functions/failed-precondition', details: { code } });
}

export function createFakeCourseRepo(data: FakeCourseData, options: { uid?: string; delayMs?: number } = {}): FakeCourseRepo {
  const calls: FakeCourseRepo['calls'] = [];
  const failures = new Map<string, unknown>();
  let seq = 0;
  const wait = (): Promise<void> => new Promise((r) => setTimeout(r, options.delayMs ?? 0));

  async function track<T>(method: string, args: unknown[], fn: () => T): Promise<T> {
    calls.push({ method, args });
    await wait();
    const failure = failures.get(method);
    if (failure !== undefined) {
      failures.delete(method);
      throw failure;
    }
    return fn();
  }

  const students = (): CourseStudent[] => data.students.map((s) => normalizeStudent(s.id, s));

  const repo: FakeCourseRepo = {
    data,
    calls,
    failNext(method, error) {
      failures.set(method, error);
    },
    loadTeam: (teamId) => track('loadTeam', [teamId], () => data.team),
    listPlans: (team) => track('listPlans', [team.apiId], () => Object.entries(data.plans).map(([id, p]) => normalizePlan(id, p))),
    loadPlan: (team, planId) =>
      track('loadPlan', [team.apiId, planId], () => (data.plans[planId] ? normalizePlan(planId, data.plans[planId]) : null)),
    listSummaries: (team, planIds) =>
      track('listSummaries', [team.apiId, [...planIds]], () => {
        const uid = options.uid ?? '';
        const all = students();
        const mine = new Set(all.filter((s) => s.selfUid === uid || s.parentUid === uid).map((s) => s.id));
        const summaries: Record<string, ReturnType<typeof Object>> = {};
        for (const planId of planIds) {
          const raw = data.plans[planId];
          if (!raw) {
            summaries[planId] = null;
            continue;
          }
          const plan = normalizePlan(planId, raw);
          const enrollments = data.enrollments[planId] ?? [];
          const ids = getApprovedStudentIdSet({ plan, enrollments, students: all, migrationCompleted: data.migrationCompleted });
          const viewerStatuses: Record<string, string> = {};
          for (const e of enrollments) if (mine.has(e.studentId)) viewerStatuses[e.studentId] = e.status;
          if (!data.migrationCompleted && plan.groupId) {
            for (const s of all) {
              if (mine.has(s.id) && s.enrollStatus === 'active' && s.groupIds.includes(plan.groupId) && !viewerStatuses[s.id]) {
                viewerStatuses[s.id] = 'approved';
              }
            }
          }
          summaries[planId] = {
            effectiveApprovedCount: ids.size,
            pendingReviewCount: enrollments.filter((e) => e.status === 'pending').length,
            viewerStatuses,
          };
        }
        return { migrationCompleted: data.migrationCompleted === true, summaries: summaries as never };
      }),
    listMyStudents: (team, uid) =>
      track('listMyStudents', [team.apiId, uid], () => students().filter((s) => s.selfUid === uid || s.parentUid === uid)),
    listMyEnrollments: (team, planId, studentIds) =>
      track('listMyEnrollments', [team.apiId, planId, [...studentIds]], () =>
        (data.enrollments[planId] ?? []).filter((e) => studentIds.includes(e.studentId)),
      ),
    listSessions: (team, planId) =>
      track('listSessions', [team.apiId, planId], (): CourseSession[] =>
        (data.sessions[planId] ?? []).map((s) => normalizeSession(s.id, s)),
      ),
    listMyAttendance: (team, planId, studentId) =>
      track('listMyAttendance', [team.apiId, planId, studentId], () =>
        data.attendance.filter((r) => r.planId === planId && r.studentId === studentId),
      ),
    register: (team, planId, studentIds) =>
      track('register', [team.apiId, planId, [...studentIds]], () => {
        const list = (data.enrollments[planId] ??= []);
        for (const sid of studentIds) list.push({ id: `enr_${++seq}`, studentId: sid, status: 'pending', paidAt: '' });
      }),
    cancelPending: (team, planId, studentIds) =>
      track('cancelPending', [team.apiId, planId, [...studentIds]], () => {
        for (const e of data.enrollments[planId] ?? []) {
          if (studentIds.includes(e.studentId) && e.status === 'pending') e.status = 'cancelled';
        }
      }),
    saveSelfAttendance: ({ planId, session, student, kind }) =>
      track('saveSelfAttendance', [planId, session.id, student.id, kind], () => {
        const mine = data.attendance.filter((r) => r.planId === planId && r.sessionId === session.id && r.studentId === student.id && r.status !== 'removed');
        if (mine.some((r) => r.kind === '' || r.kind === 'signin')) return { signedIn: true };
        for (const r of mine) if (r.kind !== kind) r.status = 'removed';
        if (!mine.some((r) => r.kind === kind && r.status !== 'removed')) {
          data.attendance.push({ id: `att_${++seq}`, planId, studentId: student.id, sessionId: session.id, date: session.date, kind, status: 'active' });
        }
        return { signedIn: false };
      }),
    saveSelfLeave: ({ planId, session, student, leave }) =>
      track('saveSelfLeave', [planId, session.id, student.id, leave], () => {
        const active = data.attendance.filter((r) => r.planId === planId && r.sessionId === session.id && r.studentId === student.id && r.kind === 'leave' && r.status !== 'removed');
        if (leave && !active.length) {
          data.attendance.push({ id: `att_${++seq}`, planId, studentId: student.id, sessionId: session.id, date: session.date, kind: 'leave', status: 'active' });
        }
        if (!leave) for (const r of active) r.status = 'removed';
      }),
    createPendingStudent: (team, input) =>
      track('createPendingStudent', [team.apiId, { ...input }], () => {
        const id = `stu_new${++seq}`;
        const payload = { ...buildPendingStudentPayload({ ...input, id }), id };
        data.students.push(payload as Record<string, unknown> & { id: string });
        return normalizeStudent(id, payload);
      }),
  };
  return repo;
}
