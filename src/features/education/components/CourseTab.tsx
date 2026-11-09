// 俱樂部「課程」頁籤（K1-1）。由 TeamDetailPage 在課程開關打開時按需載入，不進首頁主程式。
import './course.css';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import type { TeamDoc } from '@/features/clubs/data/types';
import type { ViewerView } from '@/features/profile/data/viewer';
import { useCourseT, type CourseT } from '../i18n';
import { getCardState, visiblePlans } from '../data/course-model';
import { courseRepo as defaultRepo, toCourseTeam, type CourseRepo } from '../data/course-repo';
import {
  coursePath,
  effectiveCountFor,
  isCourseStaff,
  lessonsPath,
  loadViewerCourses,
  managePath,
  stateFor,
  type ViewerCourses,
} from '../data/viewer-courses';
import { CourseCard } from './CourseCard';
import { MyCourses } from './MyCourses';
import { WhoSheet } from './WhoSheet';
import { cancelPendingFlow } from './course-actions';
import { IconPlus } from './icons';

export interface CourseTabProps {
  team: TeamDoc;
  viewer: ViewerView;
  repo?: CourseRepo;
  now?: () => number;
  onLogin?: () => void;
  /** 測試／harness 用：不經路由時攔截導覽。 */
  navigate?: (path: string) => void;
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: ViewerCourses };

export function CourseTabBody({
  ct,
  team: teamDoc,
  viewer,
  repo = defaultRepo,
  now = Date.now,
  onLogin,
  navigate,
}: CourseTabProps & { ct: CourseT }): JSX.Element {
  const t = useT();
  const location = useLocation();
  const go = navigate ?? ((path: string) => location.route(path));
  const team = useMemo(() => toCourseTeam(teamDoc), [teamDoc]);
  const staff = isCourseStaff(teamDoc, viewer);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [sheetPlanId, setSheetPlanId] = useState<string | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const seq = useRef(0);
  // 取消申請的同步鎖：busyPlanId 重繪前的連點不會開兩個確認框（DeepSeek 審查 P3）。
  const cancelLock = useRef(false);

  useEffect(() => {
    const current = ++seq.current;
    setLoad((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    (async () => {
      const plans = visiblePlans(await repo.listPlans(team), staff, now());
      const data = await loadViewerCourses(repo, team, viewer.uid, plans);
      if (current === seq.current) setLoad({ status: 'ready', data });
    })().catch((error: unknown) => {
      console.error('[course.tab]', error);
      if (current === seq.current) setLoad({ status: 'error' });
    });
  }, [team, viewer.uid, attempt]);

  const reload = (): void => setAttempt((n) => n + 1);

  if (load.status === 'loading') return <div class="ck-empty">{t('common.loading')}</div>;
  if (load.status === 'error') {
    return (
      <div class="ck-empty" role="alert">
        <div>{t('common.error')}</div>
        <button type="button" class="ck-btn ck-btn-o" onClick={reload}>{t('common.retry')}</button>
      </div>
    );
  }

  const data = load.data;
  const sheetPlan = sheetPlanId ? data.plans.find((p) => p.id === sheetPlanId) ?? null : null;

  async function cancelPending(planId: string): Promise<void> {
    const plan = data.plans.find((p) => p.id === planId);
    if (!plan || cancelLock.current) return;
    cancelLock.current = true;
    setBusyPlanId(planId);
    try {
      const changed = await cancelPendingFlow({ ct, repo, team, plan, myStudents: data.myStudents, state: stateFor(data, planId) });
      if (changed) reload();
    } finally {
      cancelLock.current = false;
      setBusyPlanId(null);
    }
  }

  function signup(planId: string): void {
    if (!viewer.uid) {
      onLogin?.();
      return;
    }
    setSheetPlanId(planId);
  }

  return (
    <div class="ck" data-course-tab>
      <MyCourses
        ct={ct}
        repo={repo}
        team={team}
        data={data}
        now={now}
        onOpenLessons={(planId) => go(lessonsPath(team.apiId, planId))}
        onOpenDetail={(planId) => go(coursePath(team.apiId, planId))}
      />
      {staff && data.plans.length > 0 ? (
        <button type="button" class="ck-ghost" data-action="create" onClick={() => go(managePath(team.apiId))}>
          <IconPlus />
          {ct('btn.create')}
        </button>
      ) : null}
      {data.plans.length === 0 ? (
        <div class="ck-empty" data-empty="courses">
          <div>{ct('empty.courses')}</div>
          {staff ? (
            <button type="button" class="ck-btn" data-action="create" onClick={() => go(managePath(team.apiId))}>
              <IconPlus />
              {ct('btn.create')}
            </button>
          ) : null}
        </div>
      ) : (
        data.plans.map((plan) => {
          const state = stateFor(data, plan.id);
          const count = effectiveCountFor(data, plan.id);
          return (
            <CourseCard
              key={plan.id}
              ct={ct}
              plan={plan}
              state={getCardState(plan, count, viewer.uid ? state : null)}
              effectiveCount={count}
              staff={staff ? { pendingReview: data.summaries[plan.id]?.pendingReviewCount ?? 0 } : null}
              busy={busyPlanId === plan.id}
              onOpen={() => go(coursePath(team.apiId, plan.id))}
              onSignup={() => signup(plan.id)}
              onCancelPending={() => {
                void cancelPending(plan.id);
              }}
              onLessons={() => go(lessonsPath(team.apiId, plan.id))}
              onManage={() => go(managePath(team.apiId, plan.id))}
            />
          );
        })
      )}
      {sheetPlan && viewer.uid ? (
        <WhoSheet
          ct={ct}
          repo={repo}
          team={team}
          plan={sheetPlan}
          uid={viewer.uid}
          displayName={viewer.displayName ?? ''}
          myStudents={data.myStudents}
          inactiveSelf={data.inactiveSelf}
          state={stateFor(data, sheetPlan.id)}
          onClose={() => setSheetPlanId(null)}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}

export function CourseTab(props: CourseTabProps): JSX.Element {
  const t = useT();
  const { ct, failed, retry } = useCourseT();
  if (!ct) {
    return failed ? (
      <div class="ck ck-empty" role="alert">
        <div>{t('common.error')}</div>
        <button type="button" class="ck-btn ck-btn-o" onClick={retry}>{t('common.retry')}</button>
      </div>
    ) : (
      <div class="ck ck-empty">{t('common.loading')}</div>
    );
  }
  return <CourseTabBody {...props} ct={ct} />;
}

export default CourseTab;
