// 課程詳情（K1-2）：欄位精簡、長文字省略；介紹收在「更多」；底部報名／課堂／取消申請。
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { useGoBack } from '@/core/back-guard';
import { useT } from '@/i18n/i18n';
import type { TeamDoc } from '@/features/clubs/data/types';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { useCourseT, type CourseT } from '../i18n';
import {
  isPlanEnded,
  isPlanFull,
  sortSessions,
  type CoursePlan,
  type CourseSession,
} from '../data/course-model';
import {
  countText,
  lessonNoText,
  periodText,
  planSessionCount,
  priceText,
  scheduleText,
  sessionWhenText,
} from '../data/course-format';
import { courseRepo as defaultRepo, toCourseTeam, type CourseRepo } from '../data/course-repo';
import {
  effectiveCountFor,
  isCourseStaff,
  lessonsPath,
  loadViewerCourses,
  managePath,
  stateFor,
  type ViewerCourses,
} from '../data/viewer-courses';
import { CoursePageShell, CourseStatus } from '../components/CoursePageShell';
import { WhoSheet } from '../components/WhoSheet';
import { cancelPendingFlow } from '../components/course-actions';
import { IconDown } from '../components/icons';

/** 固定週期的總堂數：起訖日之間符合上課日的天數（同 A generateWeeklyDates；缺起訖回 0）。 */
export function countWeeklyDates(plan: CoursePlan): number {
  const parse = (d: string): number | null => {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(d);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const start = parse(plan.startDate);
  const end = parse(plan.endDate);
  if (start === null || end === null || end < start || !plan.weekdays.length) return 0;
  const days = new Set(plan.weekdays);
  let count = 0;
  for (let ms = start; ms <= end; ms += 86400000) {
    if (days.has(new Date(ms).getUTCDay())) count += 1;
  }
  return count;
}

const CLOSED = new Set(['cancelled', 'canceled', 'removed', 'rescheduled']);

interface DetailData {
  team: TeamDoc;
  plan: CoursePlan;
  sessions: CourseSession[];
  viewer: ViewerCourses;
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; data: DetailData };

export interface CourseDetailProps {
  teamId: string;
  planId: string;
  viewer: ViewerView;
  repo?: CourseRepo;
  now?: () => number;
  navigate?: (path: string) => void;
  onBack?: () => void;
  onLogin?: () => void;
}

export function CourseDetailBody({
  ct,
  teamId,
  planId,
  viewer,
  repo = defaultRepo,
  now = Date.now,
  navigate,
  onBack,
  onLogin,
}: CourseDetailProps & { ct: CourseT }): JSX.Element {
  const t = useT();
  const location = useLocation();
  const goBack = useGoBack('/teams');
  const go = navigate ?? ((path: string) => location.route(path));
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoad((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    (async () => {
      const teamDoc = await repo.loadTeam(teamId);
      if (!teamDoc) return null;
      const team = toCourseTeam(teamDoc);
      const plan = await repo.loadPlan(team, planId);
      if (!plan || !plan.active || (!plan.visibleOnTeamPage && !isCourseStaff(teamDoc, viewer))) return null;
      const [sessions, viewerData] = await Promise.all([
        repo.listSessions(team, planId),
        loadViewerCourses(repo, team, viewer.uid, [plan]),
      ]);
      return { team: teamDoc, plan, sessions, viewer: viewerData };
    })()
      .then((data) => {
        if (alive) setLoad(data ? { status: 'ready', data } : { status: 'missing' });
      })
      .catch((error: unknown) => {
        console.error('[course.detail]', error);
        if (alive) setLoad({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [teamId, planId, viewer.uid, attempt]);

  const team = useMemo(() => (load.status === 'ready' ? toCourseTeam(load.data.team) : null), [load]);
  const back = onBack ?? goBack;
  const reload = (): void => setAttempt((n) => n + 1);

  if (load.status !== 'ready' || !team) {
    return (
      <CoursePageShell title="" backLabel={ct('btn.back')} onBack={back}>
        {load.status === 'error' ? (
          <CourseStatus kind="error" text={t('common.error')} onRetry={reload} retryText={t('common.retry')} />
        ) : load.status === 'missing' ? (
          <CourseStatus kind="empty" text={ct('empty.notFound')} />
        ) : (
          <CourseStatus kind="loading" text={t('common.loading')} />
        )}
      </CoursePageShell>
    );
  }

  const { plan, sessions, viewer: vc } = load.data;
  const nowMs = now();
  const count = effectiveCountFor(vc, plan.id);
  const state = stateFor(vc, plan.id);
  const staff = isCourseStaff(load.data.team, viewer);
  const ordered = sortSessions(sessions);
  const upcoming = ordered
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s.startMs !== null && s.startMs >= nowMs && !CLOSED.has(s.status))
    .slice(0, 3);
  const totalCount = plan.planType === 'weekly' ? countWeeklyDates(plan) : planSessionCount(plan);
  const ended = isPlanEnded(plan, nowMs);
  const full = isPlanFull(plan, count);
  const canSignup = plan.allowSignup && !ended && !full;
  const rows: Array<[string, string]> = [
    [ct('kv.time'), scheduleText(ct, plan)],
    [ct('kv.period'), periodText(ct, plan, totalCount)],
    [ct('kv.place'), plan.location],
    [ct('kv.capacity'), countText(ct, count, plan.maxCapacity)],
    [ct('kv.fee'), priceText(ct, plan)],
    [ct('kv.coach'), plan.coachName],
  ];

  async function cancelPending(): Promise<void> {
    if (busy || !team) return;
    setBusy(true);
    try {
      if (await cancelPendingFlow({ ct, repo, team, plan, myStudents: vc.myStudents, state })) reload();
    } finally {
      setBusy(false);
    }
  }

  const buttons: JSX.Element[] = [];
  if (state.approvedIds.size > 0) {
    buttons.push(
      <button key="lessons" type="button" class="ck-btn ck-btn-o" data-action="lessons" onClick={() => go(lessonsPath(team.apiId, plan.id))}>
        {ct('btn.lessons')}
      </button>,
    );
  }
  if (state.pendingIds.size > 0) {
    buttons.push(
      <button key="cancel" type="button" class="ck-btn ck-btn-red" data-action="cancel-pending" disabled={busy} onClick={() => { void cancelPending(); }}>
        {ct('btn.cancelApply')}
      </button>,
    );
  }
  if (canSignup) {
    buttons.push(
      <button
        key="signup"
        type="button"
        class="ck-btn"
        data-action="signup"
        disabled={busy}
        onClick={() => (viewer.uid ? setSheetOpen(true) : onLogin?.())}
      >
        {ct('btn.signup')}
      </button>,
    );
  } else if (!buttons.length) {
    buttons.push(
      <button key="off" type="button" class="ck-btn ck-btn-dis" data-action={full ? 'full' : 'closed'} disabled>
        {ct(full ? 'btn.full' : 'btn.closed')}
      </button>,
    );
  }
  if (staff) {
    buttons.unshift(
      <button key="manage" type="button" class="ck-btn ck-btn-o" data-action="manage" onClick={() => go(managePath(team.apiId, plan.id))}>
        {ct('btn.manage')}
      </button>,
    );
  }

  return (
    <CoursePageShell title={team.name} backLabel={ct('btn.back')} onBack={back}>
      <div class="ck-card" data-plan-id={plan.id}>
        <h1 class="ck-title">{plan.name}</h1>
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div class="ck-kv" key={label}>
              <span>{label}</span>
              <span>{value}</span>
            </div>
          ))}
        {plan.description ? (
          <>
            <button type="button" class="ck-more" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
              <span>{ct(moreOpen ? 'btn.less' : 'btn.more')}</span>
              <IconDown open={moreOpen} />
            </button>
            {moreOpen ? (
              <div data-section="intro">
                <div class="ck-card-title">{ct('head.intro')}</div>
                <p class="ck-bio">{plan.description}</p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {upcoming.length ? (
        <div class="ck-card" data-section="upcoming">
          <div class="ck-card-title">{ct('head.upcoming')}</div>
          {upcoming.map(({ s, index }) => (
            <div class="ck-line" key={s.id}>
              <span class="ck-line-n">{lessonNoText(ct, s, index)}</span>
              <span class="ck-line-d">{sessionWhenText(ct, s)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div class="ck-btn-row">{buttons}</div>
      {sheetOpen && viewer.uid ? (
        <WhoSheet
          ct={ct}
          repo={repo}
          team={team}
          plan={plan}
          uid={viewer.uid}
          displayName={viewer.displayName ?? ''}
          myStudents={vc.myStudents}
          state={state}
          onClose={() => setSheetOpen(false)}
          onChanged={reload}
        />
      ) : null}
    </CoursePageShell>
  );
}

export function CourseDetail(props: CourseDetailProps): JSX.Element {
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
  return <CourseDetailBody {...props} ct={ct} />;
}

export default function CourseDetailPage(): JSX.Element {
  const { params } = useRoute();
  const viewer = useViewer();
  const teamId = String(params.teamId || '').trim();
  const planId = String(params.planId || '').trim();
  return (
    <CourseDetail
      key={JSON.stringify([teamId, planId, viewer.uid])}
      teamId={teamId}
      planId={planId}
      viewer={viewer}
      onLogin={() => {
        void import('@/features/clubs/pages/clubs-session').then((m) => m.loginForClubs()).catch(() => undefined);
      }}
    />
  );
}
