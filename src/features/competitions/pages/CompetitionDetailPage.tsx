// 賽事詳情。報隊鈕只給代表且在報名期間；檢舉在右上選單。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { emit } from '@/core/events';
import { openHttpAnchor } from '@/core/open-external';
import { openPmDialog } from '@/features/inbox/components/pm-dialog-store';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { Badge } from '@/ui/Badge';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { toast } from '@/ui/Toast';
import { canHostOrCo, canManageCompetition, canRegisterClubEntry, canRestoreCompetition, isCpAdmin } from '../access';
import { representativeClubs } from '../rep-clubs';
import { liveCpActions } from '../actions';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { HOST_NOTICE_MAX, hostNoticeCount, noticeTextProblem } from '../data/flex-schedule';
import { boundedReason } from '../data/host-write';
import { formatTaipeiDate, formatTaipeiShort, taipeiParts, venueMapUrl } from '../format';
import { LiveBoundary } from '../live';
import { buildRegisterInput, buildReportInput } from '../payload';
import { competitionPhase, type CompetitionPhase } from '../data/present';
import { loadFullSchedule, loadScheduleDetail } from '../data/schedule-load';
import type { CompetitionDoc, DivisionDoc, EntryDoc, ReportReason, StandingDoc, SummaryEntry } from '../data/types';
import { CpError, errorOf, reasonText } from '../ui/feedback';
import { FeeLine } from '../ui/fields';
import { CategoryCover, categoryText, DetailPhaseBody, type ScheduleClock } from '../ui/schedule-board';
import { TieWorkspace } from '../ui/tie-panel';
import { PublicBoard } from '../ui/public-board';
import { CpCard, CpFrame, CpI18nPending, CpRow, MoreIcon } from '../ui/shell';
import { TeamCrest } from '../ui/TeamCrest';

const REPORTS: ReportReason[] = ['impersonation', 'fake', 'inappropriate', 'privacy', 'other'];

/** 回前景重讀的最短間隔。未滿這段不讀。已結束不重讀。 */
export const FOREGROUND_RELOAD_MIN_MS = 60_000;

function statusBadge(
  ct: CompetitionsT,
  competition: CompetitionDoc,
  now: number,
): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (competition.status === 'draft') return { label: ct('draft'), tone: 'warning' };
  if (competition.status === 'postponed') return { label: ct('compPostponed'), tone: 'warning' };
  if (competition.status === 'cancelled') return { label: ct('cancelled'), tone: 'danger' };
  if (now < competition.regOpenAt) return { label: ct('reason.REG_NOT_OPEN'), tone: 'neutral' };
  if (now > competition.regCloseAt) return { label: ct('reason.REG_CLOSED'), tone: 'neutral' };
  return { label: ct('recruiting'), tone: 'success' };
}

function phaseBadge(
  ct: CompetitionsT,
  competition: CompetitionDoc,
  phase: Exclude<CompetitionPhase, 'recruit'>,
): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' } {
  if (competition.status === 'draft') return { label: ct('draft'), tone: 'warning' };
  if (competition.status === 'postponed') return { label: ct('compPostponed'), tone: 'warning' };
  if (competition.status === 'cancelled') return { label: ct('cancelled'), tone: 'danger' };
  if (phase === 'warm') return { label: ct('phaseWarm'), tone: 'info' };
  if (phase === 'live') return { label: ct('phaseLive'), tone: 'warning' };
  return { label: ct('phaseDone'), tone: 'neutral' };
}

function hostName(competition: CompetitionDoc, env: CpInjectedEnv): string {
  if (competition.hostDisplay) return competition.hostDisplay;
  // 俱樂部 id 一律用文件路徑 id 的 repClubs（顧問 §3.254：不再混用 viewer.staffTeams 的欄位 id）
  const known = env.actor.repClubs.find((club) => club.id === competition.hostTeamId);
  return known?.name ?? '';
}

interface DetailData {
  bundle: CpBundle;
  summary: SummaryEntry[];
  standings: StandingDoc[];
}

async function loadDetail(env: CpInjectedEnv, cid: string): Promise<DetailData> {
  // 隊徽走 listEntriesForCrest（repo 頁內快取，不監聽）。摘要每次呼叫都重讀。
  // ASSUMPTION: 詳情的隊伍圖示用隊徽查詢（上限 32），不用 listEntries（上限 100）。
  // ASSUMPTION: 內部期 3 筆由列表閘門負責，詳情頁不重讀。
  // 不傳 internal，所以這裡不會打 getLaunch、getLaunchTester、listMine。
  const view = await loadScheduleDetail(env.repo, {
    cid,
    uid: env.actor.uid,
    now: env.now ?? Date.now(),
  });
  return {
    bundle: {
      competition: view.competition,
      divisions: view.divisions,
      entries: view.crests,
      roster: [],
      privates: [],
      staff: view.staff,
    },
    summary: view.summary,
    standings: view.standings,
  };
}

function applyDetail(
  next: DetailData,
  setBundle: (value: CpBundle | null) => void,
  setSummary: (value: SummaryEntry[]) => void,
  setStandings: (value: StandingDoc[]) => void,
  setLoadState: (value: 'loading' | 'ready' | 'error') => void,
): void {
  setBundle(next.bundle);
  setSummary(next.summary);
  setStandings(next.standings);
  setLoadState(next.bundle.competition ? 'ready' : 'error');
}

function DetailView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [summary, setSummary] = useState<SummaryEntry[]>(env.schedule?.summary ?? []);
  const [standings, setStandings] = useState<StandingDoc[]>(env.schedule?.standings ?? []);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(env.bundle ? 'ready' : 'loading');
  const [menuOpen, setMenuOpen] = useState(env.preview?.menuOpen === true);
  const [reportOpen, setReportOpen] = useState(env.preview?.reportOpen === true);
  const [reportReason, setReportReason] = useState<ReportReason>('fake');
  const [reportDetail, setReportDetail] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [teamId, setTeamId] = useState(representativeClubs(env.actor)[0]?.id ?? '');
  const [dvId, setDvId] = useState('');
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [registerError, setRegisterError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [reportError, setReportError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  // 全部賽程只在按下後讀，結果留在這一頁。換賽事 id 才清掉。
  const [fullSchedule, setFullSchedule] = useState<SummaryEntry[] | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreReason, setRestoreReason] = useState('');
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const fullCache = useRef<SummaryEntry[] | null>(null);
  const fullInflight = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);
  const pageCid = useRef(cid);
  pageCid.current = cid;
  const now = env.now ?? Date.now();
  const clubs = representativeClubs(env.actor);

  useEffect(() => {
    if (teamId) return;
    const first = clubs[0]?.id ?? '';
    if (first) setTeamId(first);
  }, [clubs, teamId]);

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  useEffect(() => {
    fullCache.current = null;
    fullInflight.current = null;
    setFullSchedule(null);
  }, [cid]);

  // 排序說明：積分文件有 ranking 就用；沒有才看組別 schedule.ranking；都沒有用對戰優先。
  // 進行中首屏不讀組別。已結束會補讀一次。進行中改在切到積分頁時讀。
  useEffect(() => {
    if (env.bundle) return undefined;
    const doc = bundle?.competition;
    if (!doc || (bundle?.divisions.length ?? 0) > 0) return undefined;
    if (competitionPhase(doc, now) !== 'done') return undefined;
    if (standings.length > 0 && standings.every((row) => row.ranking)) return undefined;
    let alive = true;
    void env.repo.listDivisions(cid).then((rows) => {
      if (!alive) return;
      setBundle((current) => (current ? { ...current, divisions: rows } : current));
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
    // now 來自這次渲染。已結束的補讀只在賽事或積分文件變了才重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.bundle, env.repo, bundle?.competition?.id, bundle?.competition?.endedAt, bundle?.divisions.length, standings]);

  function requestFullSchedule(): boolean | Promise<boolean> {
    if (fullCache.current) {
      setFullSchedule(fullCache.current);
      return true;
    }
    if (fullInflight.current) return fullInflight.current;
    // 注入的賽程（harness、畫面測試）不打網路。正式頁按下才讀全集。
    if (env.bundle && env.schedule) {
      const rows = [...env.schedule.summary];
      fullCache.current = rows;
      setFullSchedule(rows);
      return true;
    }
    const requested = cid;
    const task = loadFullSchedule(env.repo, requested).then((rows) => {
      if (!mounted.current || pageCid.current !== requested) return false;
      fullCache.current = rows;
      setFullSchedule(rows);
      return true;
    }).catch(() => {
      if (pageCid.current === requested) fullInflight.current = null;
      return false;
    });
    fullInflight.current = task;
    return task;
  }

  useEffect(() => {
    if (env.bundle) return;
    // ASSUMPTION: 審核在管理頁，詳情頁沒有審核成功處可呼叫 invalidateCrests。
    // 進入詳情頁先讓這個 cid 的隊徽快取失效，這次讀到新的。同頁回前景不走這裡。
    // 主辦在別頁核准後，要再進一次詳情才看得到新隊徽。
    env.repo.invalidateCrests(cid);
    let alive = true;
    setLoadState('loading');
    void loadDetail(env, cid).then((next) => {
      if (!alive) return;
      applyDetail(next, setBundle, setSummary, setStandings, setLoadState);
    }).catch(() => {
      if (alive) setLoadState('error');
    });
    return () => {
      alive = false;
    };
    // 注入的 bundle 是首屏快照。正式頁只在賽事 id 或帳號變了才重讀。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.actor.uid, env.bundle]);

  const phaseNow = bundle?.competition ? competitionPhase(bundle.competition, now) : null;
  const phaseRef = useRef(phaseNow);
  phaseRef.current = phaseNow;
  const lastForegroundAt = useRef(0);

  useEffect(() => {
    if (env.bundle) return undefined;
    let alive = true;
    // 進頁這次讀取算一次。未滿 60 秒回到前景不再讀。
    lastForegroundAt.current = Date.now();
    const reload = () => {
      if (!alive || document.visibilityState === 'hidden') return;
      if (phaseRef.current === 'done') return;
      const at = Date.now();
      if (at - lastForegroundAt.current < FOREGROUND_RELOAD_MIN_MS) return;
      lastForegroundAt.current = at;
      void loadDetail(env, cid).then((next) => {
        if (!alive || !next.bundle.competition) return;
        applyDetail(next, setBundle, setSummary, setStandings, setLoadState);
      }).catch(() => {
        // 回前景重讀失敗就留著目前畫面，不把詳情打成錯誤頁。
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reload();
    };
    const onPageShow = (event: Event) => {
      if ((event as PageTransitionEvent).persisted === true) reload();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
    // 回前景重讀摘要。隊徽快取不在這裡失效。已結束不重讀。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.actor.uid, env.bundle]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const competition = bundle?.competition ?? null;
  if (loadState === 'loading') {
    return <div class="cps-root"><PageSpinner /></div>;
  }
  if (!competition || loadState === 'error') {
    return (
      <CpFrame title={ct('detailTitle')}>
        <p class="cps-note" role="alert">{ct('loadFailed')}</p>
        <Button variant="secondary" onClick={() => {
          setLoadState('loading');
          void loadDetail(env, cid).then((next) => {
            applyDetail(next, setBundle, setSummary, setStandings, setLoadState);
          }).catch(() => setLoadState('error'));
        }}
        >{ct('retry')}</Button>
      </CpFrame>
    );
  }

  const manage = canManageCompetition({
    staffRoles: bundle?.staff?.roles ?? [],
    hostType: competition.hostType,
    hostTeamId: competition.hostTeamId,
    repClubIds: clubs.map((club) => club.id),
    isAdmin: isCpAdmin(env.actor.role),
  });
  const hostOps = canHostOrCo({
    staffRoles: bundle?.staff?.roles ?? [],
    isAdmin: isCpAdmin(env.actor.role),
  });
  const showRegister = canRegisterClubEntry({
    repClubIds: clubs.map((club) => club.id),
    status: competition.status,
    hidden: competition.hidden,
    regOpenAt: competition.regOpenAt,
    regCloseAt: competition.regCloseAt,
    now,
  });
  const phase: CompetitionPhase = competitionPhase(competition, now);
  const badge = phase === 'recruit' ? statusBadge(ct, competition, now) : phaseBadge(ct, competition, phase);
  const clock: ScheduleClock = competition.status === 'cancelled'
    ? 'cancelled'
    : competition.status === 'postponed'
      ? 'tbd'
      : 'keep';
  // 手動結束與自動結束都顯示結束狀態卡（Flash 初審 P3：自動結束時管理員要看得到結束來源）
  const showHostEnd = competition.endedAt != null && (competition.endedBy === 'host' || competition.endedBy === 'auto');
  const allowRestore = canRestoreCompetition(competition, isCpAdmin(env.actor.role));
  const divisions = bundle?.divisions ?? [];
  const entries = bundle?.entries ?? [];
  const sameYear = taipeiParts(competition.regOpenAt).year === taipeiParts(competition.regCloseAt).year;

  async function publish(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.publish({ cid });
      const next = await loadDetail(env, cid);
      if (next.bundle.competition) {
        applyDetail(next, setBundle, setSummary, setStandings, setLoadState);
      } else {
        setBundle((prev) => {
          if (!prev?.competition) return next.bundle;
          return { ...prev, competition: { ...prev.competition, status: 'published' } };
        });
      }
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendReport(): Promise<void> {
    if (reportReason === 'other' && reportDetail.trim().length < 1) {
      setReportError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    setBusy(true);
    setReportError(null);
    try {
      await env.actions.report(buildReportInput({ cid, reason: reportReason, detail: reportDetail }));
      setReportOpen(false);
      setReportError(null);
    } catch (err) {
      setReportError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  function needRanking(): void {
    if (env.bundle || (bundle?.divisions.length ?? 0) > 0) return;
    if (standings.length > 0 && standings.every((row) => row.ranking)) return;
    void env.repo.listDivisions(cid).then((rows) => {
      setBundle((current) => (current ? { ...current, divisions: rows } : current));
    }).catch(() => undefined);
  }

  async function sendRestore(): Promise<void> {
    const problem = boundedReason(restoreReason, 2, 100);
    if (problem) {
      const params = problem === 'FIELD_LENGTH' ? { min: 2, max: 100 } : undefined;
      const text = reasonText(ct, problem, params);
      toast.show({ message: text, tone: 'error' });
      setRestoreMessage(text);
      return;
    }
    if (busy) return;
    setBusy(true);
    setRestoreMessage(null);
    try {
      const reason = restoreReason.trim();
      await env.actions.restoreCompetition({ cid, reason });
      if (env.bundle) {
        setBundle((current) => {
          if (!current?.competition) return current;
          return {
            ...current,
            competition: { ...current.competition, endedAt: null, endedBy: null, endReason: null },
          };
        });
      } else {
        const next = await loadDetail(env, cid);
        applyDetail(next, setBundle, setSummary, setStandings, setLoadState);
      }
      setRestoreOpen(false);
      setRestoreReason('');
    } catch (err) {
      const info = errorOf(err);
      const text = reasonText(ct, info.reason, info.params);
      toast.show({ message: text, tone: 'error' });
      setRestoreMessage(text);
    } finally {
      setBusy(false);
    }
  }

  async function publishNotice(text: string): Promise<boolean> {
    const problem = noticeTextProblem(text);
    if (problem) {
      const params = problem === 'FIELD_LENGTH' ? { min: 1, max: 300 } : undefined;
      toast.show({ message: reasonText(ct, problem, params), tone: 'error' });
      return false;
    }
    if (hostNoticeCount(competition.notices) >= HOST_NOTICE_MAX) {
      toast.show({ message: reasonText(ct, 'NOTICE_LIMIT', { max: HOST_NOTICE_MAX }), tone: 'error' });
      return false;
    }
    setBusy(true);
    try {
      const result = await env.actions.postNotice({ cid, text: text.trim() });
      const notice = {
        id: result.noticeId,
        text: text.trim(),
        kind: 'host' as const,
        at: now,
        by: null,
      };
      setBundle((current) => (current?.competition ? {
        ...current,
        competition: { ...current.competition, notices: [...current.competition.notices, notice] },
      } : current));
      return true;
    } catch (err) {
      const info = errorOf(err);
      toast.show({ message: reasonText(ct, info.reason, info.params), tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeNotice(noticeId: string): Promise<void> {
    setBusy(true);
    try {
      await env.actions.deleteNotice({ cid, noticeId });
      setBundle((current) => (current?.competition ? {
        ...current,
        competition: {
          ...current.competition,
          notices: current.competition.notices.filter((notice) => notice.id !== noticeId),
        },
      } : current));
    } catch (err) {
      const info = errorOf(err);
      toast.show({ message: reasonText(ct, info.reason, info.params), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function messageHost(): Promise<void> {
    if (!env.actor.uid) {
      emit('auth:login-request', {});
      return;
    }
    const uid = await env.repo.findHostUid(cid);
    if (!uid) {
      toast.show({ message: ct('hostMissing'), tone: 'error' });
      return;
    }
    const name = hostName(competition, env);
    openPmDialog(name ? { uid, name } : { uid });
  }

  async function sendRegister(): Promise<void> {
    const chosenTeam = teamId || clubs[0]?.id || '';
    if (!chosenTeam || !dvId) {
      setRegisterError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    setBusy(true);
    setRegisterError(null);
    try {
      await env.actions.registerEntry(buildRegisterInput({ cid, dvId, teamId: chosenTeam }));
      setRegisterOpen(false);
      setRegisterError(null);
      const next = await loadDetail(env, cid);
      applyDetail(next, setBundle, setSummary, setStandings, setLoadState);
    } catch (err) {
      setRegisterError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  const reportLabels: Record<ReportReason, string> = {
    impersonation: ct('reportImpersonation'),
    fake: ct('reportFake'),
    inappropriate: ct('reportInappropriate'),
    privacy: ct('reportPrivacy'),
    other: ct('reportOther'),
  };

  const manageActions = (
    <>
      {error ? <CpError reason={error.reason} params={error.params} /> : null}
      {showRegister ? (
        <div class="cps-actions">
          <Button variant="primary" onClick={() => { setDvId(divisions[0]?.dvId ?? ''); setRegisterError(null); setRegisterOpen(true); }}>
            {ct('registerClub')}
          </Button>
        </div>
      ) : null}
      {manage ? (
        <div class="cps-actions">
          {competition.status === 'draft' ? (
            <Button variant="primary" loading={busy} onClick={() => { void publish(); }}>
              {ct('publish')}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => route(`/competitions/${cid}/manage`)}>{ct('manageLink')}</Button>
        </div>
      ) : null}
      {hostOps ? (
        <div class="cps-actions">
          <Button variant="secondary" onClick={() => route(`/competitions/${cid}/schedule`)}>{ct('hostSchedTitle')}</Button>
          <Button variant="secondary" onClick={() => route(`/competitions/${cid}/matches`)}>{ct('hostListTitle')}</Button>
        </div>
      ) : null}
    </>
  );

  return (
    <CpFrame
      title={phase === 'recruit' ? ct('detailTitle') : competition.name}
      menu={(
        <>
          <button
            type="button"
            class="cps-iconbtn"
            aria-label={ct('more')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreIcon />
          </button>
          {menuOpen ? (
            <div class="cps-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setReportError(null); setReportOpen(true); }}>
                {ct('report')}
              </button>
            </div>
          ) : null}
        </>
      )}
    >
      <CategoryCover category={competition.category} label={categoryText(ct, competition.category)} />
      {showHostEnd ? (
        <CpCard>
          <p class="cpm-ended">{ct(competition.endedBy === 'auto' ? 'endedAutoLine' : 'endedLine', { date: formatTaipeiDate(competition.endedAt ?? now) })}</p>
          {competition.endReason ? <p class="cpm-reason"><b>{ct('reasonPrefix')}</b>　{competition.endReason}</p> : null}
          {allowRestore ? (
            <div class="cpm-endact">
              <Button variant="secondary" disabled={busy} onClick={() => { setRestoreReason(''); setRestoreMessage(null); setRestoreOpen(true); }}>
                {ct('restore')}
              </Button>
            </div>
          ) : null}
        </CpCard>
      ) : null}
      {restoreOpen ? (
        <CpCard>
          <h2 class="cpm-h">{ct('restore')}</h2>
          <div class="cps-sheet-body">
            <Textarea
              label={ct('restoreReason')}
              required
              value={restoreReason}
              maxLength={100}
              rows={2}
              variant="fixed"
              onValueChange={setRestoreReason}
            />
            {restoreMessage ? <p class="cps-note cps-warn" role="alert">{restoreMessage}</p> : null}
            <div class="cps-footer">
              <Button variant="secondary" disabled={busy} onClick={() => setRestoreOpen(false)}>{ct('cancel')}</Button>
              <Button variant="primary" disabled={busy} onClick={() => { void sendRestore(); }}>{ct('restore')}</Button>
            </div>
          </div>
        </CpCard>
      ) : null}
      {(competition.status === 'postponed' || competition.status === 'cancelled') && competition.statusReason ? (
        <CpCard>
          <div class="cp3-row">
            <p class="cpm-reason"><b>{ct('reasonPrefix')}</b>　{competition.statusReason}</p>
            <Badge
              tone={competition.status === 'cancelled' ? 'danger' : 'warning'}
              label={competition.status === 'cancelled' ? ct('cancelled') : ct('compPostponed')}
              size="sm"
            />
          </div>
        </CpCard>
      ) : null}
      <PublicBoard
        ct={ct}
        notices={competition.notices}
        contactNote={competition.contactNote}
        hostName={hostName(competition, env)}
        hostOps={hostOps}
        busy={busy}
        onPost={publishNotice}
        onDelete={removeNotice}
        onMessage={messageHost}
      />
      {phase === 'recruit' ? (
      <>
      <CpCard>
        <div class="cps-badges" style="margin-bottom:8px">
          <Badge tone={badge.tone} label={badge.label} size="sm" />
          <Badge
            tone={competition.hostType === 'club' ? 'info' : 'neutral'}
            label={competition.hostType === 'club' ? ct('hostClub') : ct('hostPersonal')}
            size="sm"
          />
        </div>
        <h2 class="cps-title" style="margin-bottom:12px">{competition.name}</h2>
        <dl class="cps-rows">
          <CpRow k={ct('host')}>{hostName(competition, env)}</CpRow>
          <CpRow k={ct('regPeriod')}>
            <span class="cps-line">
              {sameYear ? formatTaipeiShort(competition.regOpenAt) : formatTaipeiDate(competition.regOpenAt)}
              {' '}{ct('until')}{' '}
              {sameYear ? formatTaipeiShort(competition.regCloseAt) : formatTaipeiDate(competition.regCloseAt)}
            </span>
          </CpRow>
          <CpRow k={ct('matchPeriod')}>
            <span class="cps-line">
              {formatTaipeiDate(competition.firstMatchAt)} {ct('until')} {formatTaipeiDate(competition.lastMatchAt)}
            </span>
          </CpRow>
          <CpRow k={ct('venue')}>
            {competition.venues.map((venue) => {
              const mapUrl = venueMapUrl(venue);
              return (
                <a
                  key={`${venue.name}-${venue.lat ?? ''}`}
                  class="cps-line cps-link"
                  href={mapUrl}
                  rel="noopener"
                  onClick={(event) => openHttpAnchor(event, mapUrl)}
                >
                  {venue.name}
                </a>
              );
            })}
          </CpRow>
          {competition.hostType === 'club' && competition.feeNote ? (
            <CpRow k={ct('feeNote')}>
              <span class="cps-pre">{competition.feeNote}</span>
              <span class="cps-cap" style="display:block;margin-top:4px">
                <span class="cps-line">{ct('feeHandledByHost')}</span>
                <span class="cps-line">{ct('feeSiteDoesNotHandle')}</span>
              </span>
            </CpRow>
          ) : null}
        </dl>
        {manageActions}
      </CpCard>

      {divisions.map((division) => (
        <DivisionBlock key={division.dvId} division={division} entries={entries} cid={cid} competition={competition} now={now} />
      ))}
      </>
      ) : (
        <>
          <DetailPhaseBody
            ct={ct}
            phase={phase}
            firstMatchAt={competition.firstMatchAt}
            divisions={divisions}
            crests={entries}
            summary={summary}
            standings={standings}
            now={now}
            badge={badge}
            fullSchedule={fullSchedule}
            onRequestFull={requestFullSchedule}
            clock={clock}
            onOpenStandings={needRanking}
            renderStandings={(docs) => (
              <TieWorkspace
                ct={ct}
                docs={docs}
                crests={entries}
                divisions={divisions}
                canHost={hostOps}
                cid={cid}
                actions={env.actions}
                summary={fullSchedule ?? summary}
                injected={env.bundle != null}
                now={now}
                onStandings={setStandings}
                reload={async () => {
                  setStandings(await env.repo.listStandings(cid));
                }}
              />
            )}
          />
          {manageActions}
        </>
      )}

      {registerOpen ? (
        <BottomSheet
          open
          title={ct('registerClub')}
          onClose={() => { setRegisterOpen(false); setRegisterError(null); }}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => { setRegisterOpen(false); setRegisterError(null); }}>{ct('cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => { void sendRegister(); }}>{ct('submitRegister')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            {clubs.length > 1 ? (
              <Select
                label={ct('club')}
                value={teamId}
                onValueChange={setTeamId}
                options={clubs.map((club) => ({ value: club.id, label: club.name }))}
              />
            ) : null}
            <RadioGroup
              label={ct('pickDivision')}
              value={dvId}
              onValueChange={setDvId}
              options={divisions.map((division) => ({ value: division.dvId, label: division.name }))}
            />
            {registerError ? <CpError reason={registerError.reason} params={registerError.params} /> : null}
          </div>
        </BottomSheet>
      ) : null}

      {reportOpen ? (
        <BottomSheet
          open
          title={ct('reportTitle')}
          onClose={() => { setReportOpen(false); setReportError(null); }}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => { setReportOpen(false); setReportError(null); }}>{ct('cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => { void sendReport(); }}>{ct('reportSubmit')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <RadioGroup
              label={ct('reportReason')}
              value={reportReason}
              onValueChange={(value) => setReportReason(value as ReportReason)}
              options={REPORTS.map((reason) => ({ value: reason, label: reportLabels[reason] }))}
            />
            <Textarea
              label={ct('reportDetail')}
              required={reportReason === 'other'}
              value={reportDetail}
              maxLength={300}
              placeholder={ct('reportDetailPlaceholder')}
              onValueChange={setReportDetail}
            />
            {reportError ? <CpError reason={reportError.reason} params={reportError.params} /> : null}
          </div>
        </BottomSheet>
      ) : null}
    </CpFrame>
  );
}

function DivisionBlock({
  division,
  entries,
  cid,
  competition,
  now,
}: {
  division: DivisionDoc;
  entries: EntryDoc[];
  cid: string;
  competition: CompetitionDoc;
  now: number;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const approved = entries.filter((entry) => entry.dvId === division.dvId && entry.status === 'approved');
  const meta = [
    ct('rosterLine', {
      format: ct('formatN', { n: division.playersOnField }),
      min: division.rosterMin,
      max: division.rosterMax,
    }),
    division.minAge != null && division.maxAge != null
      ? ct('ageLimit', { min: division.minAge, max: division.maxAge })
      : '',
  ].filter(Boolean).join('　');
  const width = division.maxTeams > 0 ? Math.min(100, (division.approvedCount / division.maxTeams) * 100) : 0;
  return (
    <CpCard>
      <div class="cps-head-row">
        <h3 class="cps-h">{division.name}</h3>
        <Badge tone={statusBadge(ct, competition, now).tone} label={statusBadge(ct, competition, now).label} size="sm" />
      </div>
      <p class="cps-sub cps-nowrap" style="margin-top:4px">{meta}</p>
      {/* 報名費與停用的線上支付鈕只限俱樂部主辦（顧問 §3.257） */}
      {competition.hostType === 'club' ? <FeeLine amount={division.feePerTeam} /> : null}
      <div class="cps-bar" aria-hidden="true"><i style={`width:${width}%`} /></div>
      <p class="cps-cap" style="margin-bottom:8px">{ct('approvedTeams', { teams: division.approvedCount, max: division.maxTeams })}</p>
      <ul class="cps-list">
        {approved.map((entry) => (
          <li class="cps-li" key={entry.id}>
            <div class="cps-li__main">
              <a class="cps-li__name cps-link" href={`/competitions/${cid}/entries/${entry.id}`} onClick={(event) => { event.preventDefault(); route(`/competitions/${cid}/entries/${entry.id}`); }}>
                <span class="cp3-tn">
                  <TeamCrest teamId={entry.teamId} name={entry.name} teamLogo={entry.teamLogo} size={48} />
                  <em>{entry.name}</em>
                </span>
              </a>
            </div>
            <Badge tone="success" label={ct('approved')} size="sm" />
          </li>
        ))}
      </ul>
    </CpCard>
  );
}

export default function CompetitionDetailPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  if (injected) return <DetailView env={injected} cid={cid} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <DetailView env={{ actor, repo, actions: liveCpActions, route: { cid } }} cid={cid} />}
    </LiveBoundary>
  );
}
