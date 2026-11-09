// 「取消申請」：只對審核中的報名，走 cancelCourseEnrollment（伺服器只取消 pending）。
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import type { CourseT } from '../i18n';
import { courseErrorCode, type CoursePlan, type CourseStudent, type ViewerPlanState } from '../data/course-model';
import type { CourseRepo, CourseTeam } from '../data/course-repo';

export async function cancelPendingFlow(input: {
  ct: CourseT;
  repo: CourseRepo;
  team: CourseTeam;
  plan: CoursePlan;
  myStudents: readonly CourseStudent[];
  state: ViewerPlanState;
}): Promise<boolean> {
  const { ct, repo, team, plan, myStudents, state } = input;
  const targets = myStudents.filter((s) => state.pendingIds.has(s.id));
  if (!targets.length) return false;
  const names = targets.map((s) => s.name).join('、');
  const ok = await appConfirm(ct('confirm.cancelApply', { names }), { okText: ct('btn.cancelApply'), danger: true });
  if (!ok) return false;
  try {
    await repo.cancelPending(team, plan.id, targets.map((s) => s.id));
    toast.show({ message: ct('toast.cancelled'), tone: 'success' });
    return true;
  } catch (error) {
    const code = courseErrorCode(error);
    if (code === 'UNKNOWN') console.error('[course.cancelPending]', error);
    toast.show({ message: ct(`err.${code}`), tone: 'error' });
    // 已不在審核中（被核准或已取消）也要重讀，畫面才會對。
    return code === 'NO_PENDING_ENROLLMENTS' || code === 'ENROLLMENT_NOT_PENDING';
  }
}
