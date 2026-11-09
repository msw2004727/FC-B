// 課堂列表（K1-3）：每一堂的單堂報名與請假。名冊只看 sessions.studentIds（讀取契約）。
// 固定週期：報名＝saveEduCourseSelfAttendance(registered)；已報名改請假＝saveEduCourseSelfAttendance(leave)（同 A「取消報名」）；
// 取消請假＝saveEduCourseSelfLeave(leave:false)。堂數制：請假／取消請假＝saveEduCourseSelfLeave。
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { useGoBack } from '@/core/back-guard';
import { getLastKnownAuthUid } from '@/data/auth';
import { useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { useCourseT, type CourseT } from '../i18n';
import {
  attendanceKindForSession,
  courseErrorCode,
  isSessionOpenForSelf,
  lessonView,
  ownedStudents,
  sortSessions,
  type AttendanceRecord,
  type CoursePlan,
  type CourseSession,
  type CourseStudent,
  type LessonAction,
} from '../data/course-model';
import { lessonNoText, sessionWhenText } from '../data/course-format';
import { courseRepo as defaultRepo, toCourseTeam, type CourseRepo, type CourseTeam } from '../data/course-repo';
import { CoursePageShell, CourseStatus } from '../components/CoursePageShell';

interface LessonsData {
  team: CourseTeam;
  plan: CoursePlan;
  sessions: CourseSession[];
  students: CourseStudent[];
}

type Load =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'missing' }
  | { status: 'login' }
  | { status: 'ready'; data: LessonsData };

export interface CourseLessonsProps {
  teamId: string;
  planId: string;
  viewer: ViewerView;
  /** 登入狀態：undefined＝尚未確定（顯示載入中，不誤判未登入）。 */
  authUid?: string | null;
  repo?: CourseRepo;
  now?: () => number;
  onBack?: () => void;
  onLogin?: () => void;
}

const DISPLAY_CHIP: Record<string, string> = {
  signin: 'ck-chip ck-chip-acc',
  registered: 'ck-chip ck-chip-acc',
  leave: 'ck-chip ck-chip-warn',
  unregistered: 'ck-chip',
};

export function CourseLessonsBody({
  ct,
  teamId,
  planId,
  viewer,
  authUid,
  repo = defaultRepo,
  now = Date.now,
  onBack,
  onLogin,
}: CourseLessonsProps & { ct: CourseT }): JSX.Element {
  const t = useT();
  const goBack = useGoBack('/teams');
  const back = onBack ?? goBack;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pickedId, setPickedId] = useState<string | null>(null);
  // null＝載入中、'error'＝讀取失敗（審查 P3-3：失敗不能當成「沒有紀錄」顯示未報名）。
  const [records, setRecords] = useState<AttendanceRecord[] | 'error' | null>(null);
  const [recordsAttempt, setRecordsAttempt] = useState(0);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const uid = viewer.uid;

  useEffect(() => {
    if (!uid) {
      // L-43：登入狀態還沒確定就維持載入中；確定未登入才請他登入。
      setLoad(authUid === null ? { status: 'login' } : { status: 'loading' });
      return undefined;
    }
    let alive = true;
    (async () => {
      const teamDoc = await repo.loadTeam(teamId);
      if (!teamDoc) return null;
      const team = toCourseTeam(teamDoc);
      const [plan, sessions, students] = await Promise.all([
        repo.loadPlan(team, planId),
        repo.listSessions(team, planId),
        repo.listMyStudents(team, uid),
      ]);
      if (!plan) return null;
      return { team, plan, sessions: sortSessions(sessions), students: ownedStudents(students, uid) };
    })()
      .then((data) => {
        if (alive) setLoad(data ? { status: 'ready', data } : { status: 'missing' });
      })
      .catch((error: unknown) => {
        console.error('[course.lessons]', error);
        if (alive) setLoad({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [teamId, planId, uid, authUid, attempt]);

  // 名冊有這位學員的課堂才列出（sessions.studentIds）。
  const rosterStudents = useMemo(() => {
    if (load.status !== 'ready') return [];
    const { sessions, students } = load.data;
    return students.filter((s) => sessions.some((x) => x.studentIds.includes(s.id)));
  }, [load]);
  const student = rosterStudents.find((s) => s.id === pickedId) ?? rosterStudents[0] ?? null;

  useEffect(() => {
    if (load.status !== 'ready' || !student) return undefined;
    let alive = true;
    setRecords(null);
    repo
      .listMyAttendance(load.data.team, load.data.plan.id, student.id)
      .then((list) => {
        if (alive) setRecords(list);
      })
      .catch((error: unknown) => {
        console.error('[course.lessons.attendance]', error);
        if (alive) setRecords('error');
      });
    return () => {
      alive = false;
    };
  }, [load, student?.id, recordsAttempt]);

  if (load.status !== 'ready') {
    return (
      <CoursePageShell title="" backLabel={ct('btn.back')} onBack={back}>
        {load.status === 'error' ? (
          <CourseStatus kind="error" text={t('common.error')} onRetry={() => setAttempt((n) => n + 1)} retryText={t('common.retry')} />
        ) : load.status === 'missing' ? (
          <CourseStatus kind="empty" text={ct('empty.notFound')} />
        ) : load.status === 'login' ? (
          <CourseStatus kind="empty" text={ct('err.UNAUTHENTICATED')} onRetry={onLogin} retryText={ct('btn.login')} />
        ) : (
          <CourseStatus kind="loading" text={t('common.loading')} />
        )}
      </CoursePageShell>
    );
  }

  const { team, plan, sessions } = load.data;
  const nowMs = now();
  const mySessions = student ? sessions.filter((s) => s.studentIds.includes(student.id)) : [];

  async function act(session: CourseSession, action: Exclude<LessonAction, null>, index: number): Promise<void> {
    if (!student || busySessionId) return;
    if (action === 'leave') {
      const ok = await appConfirm(
        ct('confirm.leave', { lesson: lessonNoText(ct, session, index), name: student.name }),
        { okText: ct('btn.leave') },
      );
      if (!ok) return;
    }
    setBusySessionId(session.id);
    try {
      const input = { team, planId: plan.id, session, student };
      let message = '';
      if (action === 'register') {
        const res = await repo.saveSelfAttendance({ ...input, kind: 'registered' });
        message = res.signedIn ? ct('toast.signedIn') : ct('toast.registered');
      } else if (action === 'leave' && plan.planType === 'weekly') {
        const res = await repo.saveSelfAttendance({ ...input, kind: 'leave' });
        message = res.signedIn ? ct('toast.signedIn') : ct('toast.leaveDone');
      } else if (action === 'leave') {
        await repo.saveSelfLeave({ ...input, leave: true });
        message = ct('toast.leaveDone');
      } else {
        await repo.saveSelfLeave({ ...input, leave: false });
        message = ct('toast.leaveCancelled');
      }
      toast.show({ message, tone: 'success' });
    } catch (error) {
      const code = courseErrorCode(error);
      if (code === 'UNKNOWN') console.error('[course.lessons.act]', error);
      toast.show({ message: ct(`err.${code}`), tone: 'error' });
    } finally {
      setBusySessionId(null);
      setRecordsAttempt((n) => n + 1);
    }
  }

  return (
    <CoursePageShell title={plan.name} backLabel={ct('btn.back')} onBack={back}>
      {rosterStudents.length > 1 ? (
        <div class="ck-seg" role="group">
          {rosterStudents.map((s) => (
            <button key={s.id} type="button" aria-pressed={s.id === student?.id} onClick={() => setPickedId(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {!mySessions.length ? (
        <CourseStatus kind="empty" text={ct('empty.lessons')} />
      ) : records === null ? (
        <CourseStatus kind="loading" text={t('common.loading')} />
      ) : records === 'error' ? (
        <CourseStatus kind="error" text={t('common.error')} onRetry={() => setRecordsAttempt((n) => n + 1)} retryText={t('common.retry')} />
      ) : (
        <div class="ck-card" data-section="lessons">
          {mySessions.map((session) => {
            const index = sessions.indexOf(session);
            const kind = attendanceKindForSession(records, session, student!.id);
            const open = isSessionOpenForSelf(session, nowMs) && plan.active && plan.visibleOnTeamPage;
            const view = lessonView(plan.planType, kind, open);
            const past = !open;
            const busy = busySessionId === session.id;
            return (
              <div class={past ? 'ck-line ck-line-past' : 'ck-line'} key={session.id} data-session-id={session.id} data-display={view.display}>
                <span class="ck-line-n">{lessonNoText(ct, session, index)}</span>
                <span class="ck-line-d">{sessionWhenText(ct, session)}</span>
                <span class="ck-line-act">
                  {view.display !== 'none' ? (
                    <span class={DISPLAY_CHIP[view.display]}>{ct(`lesson.${view.display}`)}</span>
                  ) : null}
                  {view.action ? (
                    <button
                      type="button"
                      class={view.action === 'register' ? 'ck-btn ck-btn-sm' : 'ck-btn ck-btn-o ck-btn-sm'}
                      data-action={view.action}
                      disabled={busy || busySessionId !== null}
                      onClick={() => {
                        void act(session, view.action as Exclude<LessonAction, null>, index);
                      }}
                    >
                      {ct(view.action === 'register' ? 'btn.signup' : view.action === 'leave' ? 'btn.leave' : 'btn.cancel')}
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </CoursePageShell>
  );
}

export function CourseLessons(props: CourseLessonsProps): JSX.Element {
  const t = useT();
  const { ct, failed, retry } = useCourseT();
  if (!ct) {
    return (
      <section class="ck ck-page">
        {failed ? (
          <CourseStatus kind="error" text={t('common.error')} onRetry={retry} retryText={t('common.retry')} />
        ) : (
          <CourseStatus kind="loading" text={t('common.loading')} />
        )}
      </section>
    );
  }
  return <CourseLessonsBody {...props} ct={ct} />;
}

export default function CourseLessonsPage(): JSX.Element {
  const { params } = useRoute();
  const viewer = useViewer();
  const teamId = String(params.teamId || '').trim();
  const planId = String(params.planId || '').trim();
  return (
    <CourseLessons
      key={JSON.stringify([teamId, planId, viewer.uid])}
      teamId={teamId}
      planId={planId}
      viewer={viewer}
      authUid={getLastKnownAuthUid()}
      onLogin={() => {
        void import('@/features/clubs/pages/clubs-session').then((m) => m.loginForClubs()).catch(() => undefined);
      }}
    />
  );
}
