// 學員端一次載入：方案 → 伺服器人數（effectiveApprovedCount）→ 我名下學員 → 有關的方案才讀我的報名 → 聯集狀態。
import type { ViewerView } from '@/features/profile/data/viewer';
import type { TeamDoc } from '@/features/clubs/data/types';
import {
  getViewerPlanState,
  ownedStudents,
  type CourseEnrollment,
  type CoursePlan,
  type CourseStudent,
  type CourseSummary,
  type ViewerPlanState,
} from './course-model';
import type { CourseRepo, CourseTeam, SummaryResult } from './course-repo';

export interface ViewerCourses {
  plans: CoursePlan[];
  summaries: Record<string, CourseSummary | null>;
  migrationCompleted: boolean;
  /** 我名下、非 inactive 的學員（本人與孩子）。 */
  myStudents: CourseStudent[];
  enrollmentsByPlan: Map<string, CourseEnrollment[]>;
  states: Map<string, ViewerPlanState>;
}

const EMPTY_STATE: ViewerPlanState = { approvedIds: new Set(), pendingIds: new Set(), approvedEnrollment: new Map() };

export function stateFor(data: ViewerCourses, planId: string): ViewerPlanState {
  return data.states.get(planId) ?? EMPTY_STATE;
}

export function effectiveCountFor(data: ViewerCourses, planId: string): number | null {
  return data.summaries[planId]?.effectiveApprovedCount ?? null;
}

/**
 * 只有 summary.viewerStatuses 有我的學員的方案才讀報名（伺服器已把分組名冊算進 viewerStatuses，
 * 聯集內的學員一定有一筆），其餘方案不多讀。
 */
export async function loadViewerCourses(
  repo: CourseRepo,
  team: CourseTeam,
  uid: string | null,
  plans: CoursePlan[],
): Promise<ViewerCourses> {
  const empty: ViewerCourses = {
    plans,
    summaries: {},
    migrationCompleted: false,
    myStudents: [],
    enrollmentsByPlan: new Map(),
    states: new Map(),
  };
  if (!uid) return empty;
  const noSummaries: SummaryResult = { migrationCompleted: false, summaries: {} };
  const [summaryResult, students] = await Promise.all([
    plans.length ? repo.listSummaries(team, plans.map((p) => p.id)) : Promise.resolve(noSummaries),
    repo.listMyStudents(team, uid),
  ]);
  const myStudents = ownedStudents(students, uid);
  const myIds = myStudents.map((s) => s.id);
  const relevant = plans.filter((p) => {
    const statuses = summaryResult.summaries[p.id]?.viewerStatuses ?? {};
    return myIds.some((id) => statuses[id] !== undefined);
  });
  const settled = await Promise.allSettled(relevant.map((p) => repo.listMyEnrollments(team, p.id, myIds)));
  const enrollmentsByPlan = new Map<string, CourseEnrollment[]>();
  const states = new Map<string, ViewerPlanState>();
  relevant.forEach((plan, index) => {
    const result = settled[index];
    if (result && result.status === 'fulfilled') {
      enrollmentsByPlan.set(plan.id, result.value);
      states.set(plan.id, getViewerPlanState(plan, myStudents, result.value, summaryResult.migrationCompleted));
      return;
    }
    // 審查 P2-2：單一方案的報名讀不到時，不讓整頁報錯，退回伺服器算好的 viewerStatuses
    // （已含分組舊制的 approved）；這時不知道繳費狀態，未繳費不顯示。
    console.warn('[course.enrollments] fallback to viewerStatuses', plan.id, result?.status === 'rejected' ? result.reason : null);
    const statuses = summaryResult.summaries[plan.id]?.viewerStatuses ?? {};
    const pseudo: CourseEnrollment[] = Object.entries(statuses).map(([studentId, status]) => ({ id: `vs_${studentId}`, studentId, status, paidAt: '' }));
    states.set(plan.id, { ...getViewerPlanState(plan, myStudents, pseudo, true), paymentUnknown: true });
  });
  return {
    plans,
    summaries: summaryResult.summaries,
    migrationCompleted: summaryResult.migrationCompleted,
    myStudents,
    enrollmentsByPlan,
    states,
  };
}

/**
 * 「管理」入口顯示條件：照伺服器 isTeamStaffForData（經理、建立者、擁有者、領隊、教練），
 * 加上 super_admin 與 team.manage_all。只控制按鈕顯示，實際權限由 Callable 判斷。
 */
export function isCourseStaff(team: TeamDoc, viewer: Pick<ViewerView, 'uid' | 'role' | 'hasPermission'>): boolean {
  const uid = viewer.uid;
  if (!uid) return false;
  if (viewer.role === 'super_admin' || viewer.hasPermission('team.manage_all')) return true;
  const t = team as Record<string, unknown>;
  const same = (v: unknown): boolean => String(v ?? '').trim() === uid;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()) : []);
  const leaderUids = Array.isArray(t.leaderUids) ? list(t.leaderUids) : t.leaderUid ? [String(t.leaderUid).trim()] : [];
  return same(t.captainUid)
    || same(t.creatorUid)
    || same(t.ownerUid)
    || same(t.leaderUid)
    || leaderUids.includes(uid)
    || list(t.coachUids).includes(uid);
}

export function coursePath(teamId: string, planId: string): string {
  return `/courses/${encodeURIComponent(teamId)}/${encodeURIComponent(planId)}`;
}

export function lessonsPath(teamId: string, planId: string): string {
  return `${coursePath(teamId, planId)}/lessons`;
}

/** K2／K3 才做的管理頁；K1 只放入口。 */
export function managePath(teamId: string, planId?: string): string {
  const base = `/course-manage/${encodeURIComponent(teamId)}`;
  return planId ? `${base}/${encodeURIComponent(planId)}` : base;
}
