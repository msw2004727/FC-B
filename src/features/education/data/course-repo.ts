// 課程資料存取（K1 學員端）。寫入一律走既有 Callable；唯一的直寫是 Rules 已允許的「新增 pending 學員」
// （teams/{t}/students：create 需 isAuth、name 字串、enrollStatus=='pending'，照 A edu-student-join）。
// 學員與報名的讀取一律帶 selfUid／parentUid／studentId 等條件，與「課程資料讀取權限收斂」後的 Rules 相容。
import { callFn } from '@/data/callables';
import { generateId } from '@/data/ids';
import { coursePlans, coursePlanEnrollments, coursePlanSessions } from '@/data/paths';
import { assertAllowedFields } from '@/data/write-guard';
import type { TeamDoc } from '@/features/clubs/data/types';
import {
  normalizeAttendance,
  normalizeEnrollment,
  normalizePlan,
  normalizeSession,
  normalizeStudent,
  normalizeSummary,
  type AttendanceRecord,
  type CourseEnrollment,
  type CoursePlan,
  type CourseSession,
  type CourseStudent,
  type CourseSummary,
} from './course-model';

/** 課程用的俱樂部識別：Firestore 子集合用文件 ID；Callable 與 eduAttendance.teamId 照 A 用 team.id。 */
export interface CourseTeam {
  fsId: string;
  apiId: string;
  name: string;
  doc: TeamDoc;
}

export function toCourseTeam(team: TeamDoc): CourseTeam {
  const docId = String(team._docId ?? '').trim();
  const id = String(team.id ?? '').trim();
  return { fsId: docId || id, apiId: id || docId, name: String(team.name ?? ''), doc: team };
}

export interface SummaryResult {
  migrationCompleted: boolean;
  summaries: Record<string, CourseSummary | null>;
}

export interface SelfAttendanceInput {
  team: CourseTeam;
  planId: string;
  session: CourseSession;
  student: CourseStudent;
}

export interface CourseRepo {
  loadTeam(teamId: string): Promise<TeamDoc | null>;
  listPlans(team: CourseTeam): Promise<CoursePlan[]>;
  loadPlan(team: CourseTeam, planId: string): Promise<CoursePlan | null>;
  listSummaries(team: CourseTeam, planIds: readonly string[]): Promise<SummaryResult>;
  listMyStudents(team: CourseTeam, uid: string): Promise<CourseStudent[]>;
  listMyEnrollments(team: CourseTeam, planId: string, studentIds: readonly string[]): Promise<CourseEnrollment[]>;
  listSessions(team: CourseTeam, planId: string): Promise<CourseSession[]>;
  listMyAttendance(team: CourseTeam, planId: string, studentId: string): Promise<AttendanceRecord[]>;
  register(team: CourseTeam, planId: string, studentIds: readonly string[]): Promise<void>;
  cancelPending(team: CourseTeam, planId: string, studentIds: readonly string[]): Promise<void>;
  /** 固定週期單堂報名（registered）或取消報名改請假（leave）；回傳是否已簽到而保留。 */
  saveSelfAttendance(input: SelfAttendanceInput & { kind: 'registered' | 'leave' }): Promise<{ signedIn: boolean }>;
  saveSelfLeave(input: SelfAttendanceInput & { leave: boolean }): Promise<void>;
  createPendingStudent(team: CourseTeam, input: { name: string; uid: string; relation: 'self' | 'parent' }): Promise<CourseStudent>;
}

async function fs() {
  const [{ getFirebase }, sdk] = await Promise.all([import('@/data/firebase'), import('firebase/firestore')]);
  const ctx = await getFirebase();
  return { db: ctx.db, sdk };
}

/** A edu-student-join／報名自動建本人學員的欄位（Rules 只要求 name 與 pending；欄位以 A 為準）。 */
export const PENDING_STUDENT_FIELDS = [
  'id',
  'name',
  'birthday',
  'gender',
  'parentUid',
  'selfUid',
  'groupIds',
  'groupNames',
  'coachNotes',
  'positionTags',
  'enrollStatus',
  'enrolledAt',
  'createdAt',
  'updatedAt',
] as const;

export function buildPendingStudentPayload(input: {
  id: string;
  name: string;
  uid: string;
  relation: 'self' | 'parent';
}): Record<string, unknown> {
  return {
    id: input.id,
    name: input.name.trim(),
    // K1 只填姓名；A 的生日與性別在 B 先留空，教練審核時補（A 讀取端可接受 null／空字串）。
    birthday: null,
    gender: '',
    parentUid: input.relation === 'parent' ? input.uid : null,
    selfUid: input.relation === 'self' ? input.uid : null,
    groupIds: [],
    groupNames: [],
    coachNotes: '',
    positionTags: [],
    enrollStatus: 'pending',
    enrolledAt: null,
  };
}

export const courseRepo: CourseRepo = {
  async loadTeam(teamId) {
    const { loadTeam } = await import('@/features/clubs/data/teams-repo');
    return loadTeam(teamId);
  },

  async listPlans(team) {
    const { db, sdk } = await fs();
    const snap = await sdk.getDocs(sdk.collection(db, coursePlans(team.fsId)));
    return snap.docs.map((d) => normalizePlan(d.id, d.data() as Record<string, unknown>));
  },

  async loadPlan(team, planId) {
    const { db, sdk } = await fs();
    const snap = await sdk.getDoc(sdk.doc(db, coursePlans(team.fsId), planId));
    return snap.exists() ? normalizePlan(snap.id, snap.data() as Record<string, unknown>) : null;
  },

  async listSummaries(team, planIds) {
    const ids = [...new Set(planIds.filter(Boolean))];
    const out: SummaryResult = { migrationCompleted: false, summaries: {} };
    // 伺服器一次最多 50 個方案。
    for (let i = 0; i < ids.length; i += 50) {
      const res = await callFn('listEduCourseEnrollmentSummaries', { teamId: team.apiId, planIds: ids.slice(i, i + 50) });
      out.migrationCompleted = out.migrationCompleted || res.migrationCompleted === true;
      const raw = (res.summaries ?? {}) as Record<string, unknown>;
      for (const [planId, summary] of Object.entries(raw)) out.summaries[planId] = normalizeSummary(summary);
    }
    return out;
  },

  async listMyStudents(team, uid) {
    const { db, sdk } = await fs();
    const ref = sdk.collection(db, `teams/${team.fsId}/students`);
    const [bySelf, byParent] = await Promise.all([
      sdk.getDocs(sdk.query(ref, sdk.where('selfUid', '==', uid))),
      sdk.getDocs(sdk.query(ref, sdk.where('parentUid', '==', uid))),
    ]);
    const byDoc = new Map<string, CourseStudent>();
    for (const d of [...bySelf.docs, ...byParent.docs]) {
      if (!byDoc.has(d.id)) byDoc.set(d.id, normalizeStudent(d.id, d.data() as Record<string, unknown>));
    }
    return [...byDoc.values()];
  },

  async listMyEnrollments(team, planId, studentIds) {
    const ids = [...new Set(studentIds.filter(Boolean))];
    if (!ids.length) return [];
    const { db, sdk } = await fs();
    const ref = sdk.collection(db, coursePlanEnrollments(team.fsId, planId));
    // 每位學員一個等值查詢：Rules 以 studentId 對應的學員本人／家長判斷可讀。
    const snaps = await Promise.all(ids.map((sid) => sdk.getDocs(sdk.query(ref, sdk.where('studentId', '==', sid)))));
    return snaps.flatMap((snap) => snap.docs.map((d) => normalizeEnrollment(d.id, d.data() as Record<string, unknown>)));
  },

  async listSessions(team, planId) {
    const { db, sdk } = await fs();
    const snap = await sdk.getDocs(sdk.collection(db, coursePlanSessions(team.fsId, planId)));
    return snap.docs.map((d) => normalizeSession(d.id, d.data() as Record<string, unknown>));
  },

  async listMyAttendance(team, planId, studentId) {
    const { db, sdk } = await fs();
    const snap = await sdk.getDocs(
      sdk.query(
        sdk.collection(db, 'eduAttendance'),
        sdk.where('teamId', '==', team.apiId),
        sdk.where('coursePlanId', '==', planId),
        sdk.where('studentId', '==', studentId),
      ),
    );
    return snap.docs.map((d) => normalizeAttendance(d.id, d.data() as Record<string, unknown>));
  },

  async register(team, planId, studentIds) {
    await callFn('registerForEduCoursePlan', { teamId: team.apiId, planId, studentIds: [...studentIds] });
  },

  async cancelPending(team, planId, studentIds) {
    await callFn('cancelCourseEnrollment', { teamId: team.apiId, planId, studentIds: [...studentIds] });
  },

  async saveSelfAttendance({ team, planId, session, student, kind }) {
    const res = await callFn('saveEduCourseSelfAttendance', {
      teamId: team.apiId,
      planId,
      sessionId: session.id,
      date: session.date,
      studentId: student.id,
      studentName: student.name,
      kind,
    });
    return { signedIn: res.signedIn === true || res.kind === 'signin' };
  },

  async saveSelfLeave({ team, planId, session, student, leave }) {
    await callFn('saveEduCourseSelfLeave', {
      teamId: team.apiId,
      planId,
      sessionId: session.id,
      date: session.date,
      studentId: student.id,
      studentName: student.name,
      leave,
    });
  },

  async createPendingStudent(team, input) {
    const { db, sdk } = await fs();
    const id = generateId('stu_');
    const payload = {
      ...buildPendingStudentPayload({ ...input, id }),
      createdAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    };
    assertAllowedFields('createPendingStudent', payload, PENDING_STUDENT_FIELDS);
    await sdk.setDoc(sdk.doc(db, `teams/${team.fsId}/students`, id), payload);
    return normalizeStudent(id, payload as Record<string, unknown>);
  },
};
