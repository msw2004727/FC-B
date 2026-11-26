// 賽事詳情。報隊鈕只給代表且在報名期間；檢舉在右上選單。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { openHttpAnchor } from '@/core/open-external';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { dangerConfirm } from '../ui/danger-confirm';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { toast } from '@/ui/Toast';
import { canEditCompetition, canHostOrCo, canManageCompetition, canRegisterClubEntry, canRestoreCompetition, isCpAdmin } from '../access';
import { canDeleteCompetition, isPrimaryHostView } from '../delete-access';
import { representativeClubs } from '../rep-clubs';
import { liveCpActions } from '../actions';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { HOST_NOTICE_MAX, hostNoticeCount, noticeTextProblem } from '../data/flex-schedule';
import { boundedReason } from '../data/host-write';
import { formatTaipeiDate, formatTaipeiShort, taipeiParts, venueMapUrl } from '../format';
import { LiveBoundary } from '../live';
import { cpSignIn } from '../sign-in';
import { buildRegisterInput, buildReportInput } from '../payload';
import { competitionPhase, type CompetitionPhase } from '../data/present';
import { detailHero, nextUp } from '../data/schedule-present';
import { firstVenueName, formatInAppDates } from '../data/list-cards';
import { hasPendingTie } from '../data/tie-present';
import { hasScoreRole } from '../data/staff-assign';
import {
  bindVisible,
  hasLiveOnMatchDay,
  mergeSummaryShard,
  scorerTables,
  teamNameByEnId,
  type ScorerTables,
} from '../data/audience';
import { createAudiencePorts } from '../data/audience-watch';
import { matchDayOf } from '../data/match-day';
import { loadFullSchedule, loadScheduleDetail } from '../data/schedule-load';
import type { CompetitionDoc, DivisionDoc, EntryDoc, ReportReason, StaffAssignment, StandingDoc, SummaryEntry } from '../data/types';
import { CpError, CpLoadFailed, errorOf, loadFailOf, reasonText, type CpLoadFail } from '../ui/feedback';
import { FeeLine } from '../ui/fields';
import { categoryText, DetailPhaseBody, type ScheduleClock } from '../ui/schedule-board';
import { DetailHero } from '../ui/detail-hero';
import { shownCover } from '../data/cover';
import { TieWorkspace } from '../ui/tie-panel';
import { AdminPanel, HiddenNotice } from '../ui/admin-moderation';
import { DeleteCompetition, teamCountOf } from '../ui/delete-competition';
import { HostLine, hostLineShown, PublicBoard } from '../ui/public-board';
import { StatusTag, type StatusKind } from '../ui/status-tag';
import { CpCard, CpFrame, CpI18nPending, CpRow, AlertIcon, MoreIcon, NextIcon } from '../ui/shell';
import { TeamCrest } from '../ui/TeamCrest';

const REPORTS: ReportReason[] = ['impersonation', 'fake', 'inappropriate', 'privacy', 'other'];

/** 回前景重讀的最短間隔。未滿這段不讀。已結束不重讀。 */
export const FOREGROUND_RELOAD_MIN_MS = 60_000;

function statusBadge(
  ct: CompetitionsT,
  competition: CompetitionDoc,
  now: number,
): { label: string; kind: StatusKind } {
  if (competition.status === 'draft') return { label: ct('draft'), kind: 'neutral' };
  if (competition.status === 'postponed') return { label: ct('compPostponed'), kind: 'neutral' };
  if (competition.status === 'cancelled') return { label: ct('cancelled'), kind: 'cancelled' };
  if (now < competition.regOpenAt) return { label: ct('reason.REG_NOT_OPEN'), kind: 'neutral' };
  if (now > competition.regCloseAt) return { label: ct('reason.REG_CLOSED'), kind: 'neutral' };
  return { label: ct('recruiting'), kind: 'neutral' };
}

function phaseBadge(
  ct: CompetitionsT,
  competition: CompetitionDoc,
  phase: Exclude<CompetitionPhase, 'recruit'>,
): { label: string; kind: StatusKind } {
  if (competition.status === 'draft') return { label: ct('draft'), kind: 'neutral' };
  if (competition.status === 'postponed') return { label: ct('compPostponed'), kind: 'neutral' };
  if (competition.status === 'cancelled') return { label: ct('cancelled'), kind: 'cancelled' };
  if (phase === 'warm') return { label: ct('phaseWarm'), kind: 'neutral' };
  if (phase === 'live') return { label: ct('phaseLive'), kind: 'live' };
  return { label: ct('phaseDone'), kind: 'neutral' };
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
  /** 登入者自己的指派。未登入是 null，而且不讀。 */
  myAssignment: StaffAssignment | null;
}

/**
 * 自己的 staff 指派。同一個 cid＋uid 在這次開頁只打一次 getStaffAssignment。
 * 重新渲染、切分頁、回前景、重試都不重讀。換賽事或換登入者才再讀。
 */
interface MineReadCache {
  readyKey: string;
  value: StaffAssignment | null;
  flight: { key: string; task: Promise<StaffAssignment | null> } | null;
  token: number;
}

/** 只代表一個俱樂部才自動帶入；兩個以上要自己選。 */
function soleClubId(clubs: readonly { id: string }[]): string {
  return clubs.length === 1 ? clubs[0]?.id ?? '' : '';
}

function mineKey(cid: string, uid: string): string {
  return `${cid}\0${uid}`;
}

async function readMyAssignment(
  env: CpInjectedEnv,
  cid: string,
  cache: MineReadCache,
): Promise<StaffAssignment | null> {
  const uid = env.actor.uid;
  if (!uid) return null;
  const key = mineKey(cid, uid);
  if (cache.readyKey === key) {
    // 作廢還在飛的另一個 cid／uid，避免晚到的結果蓋掉目前這筆。
    cache.token += 1;
    cache.flight = null;
    return cache.value;
  }
  if (cache.flight?.key === key) return cache.flight.task;
  const token = cache.token + 1;
  cache.token = token;
  const task = env.repo.getStaffAssignment(cid, uid).then((row) => {
    if (cache.token === token) {
      cache.readyKey = key;
      cache.value = row;
      cache.flight = null;
    }
    return row;
  }, (err: unknown) => {
    if (cache.flight?.task === task) cache.flight = null;
    throw err;
  });
  cache.flight = { key, task };
  return task;
}

async function loadDetail(env: CpInjectedEnv, cid: string, mine: MineReadCache): Promise<DetailData> {
  // 隊徽走 listEntriesForCrest（repo 頁內快取，不監聽）。摘要每次呼叫都重讀。
  // ASSUMPTION: 詳情的隊伍圖示用隊徽查詢（上限 32），不用 listEntries（上限 100）。
  // ASSUMPTION: 內部期 3 筆由列表閘門負責，詳情頁不重讀。
  // 不傳 internal，所以這裡不會打 getLaunch、getLaunchTester、listMine。
  const view = await loadScheduleDetail(env.repo, {
    cid,
    uid: env.actor.uid,
    now: env.now ?? Date.now(),
  });
  // 登入才多讀自己的 staff（保留 scorer／referee）。未登入不讀。同一次開頁只讀一次。
  const myAssignment = await readMyAssignment(env, cid, mine);
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
    myAssignment,
  };
}

type LoadState = 'loading' | 'ready' | CpLoadFail;

function applyDetail(
  next: DetailData,
  setBundle: (value: CpBundle | null) => void,
  setSummary: (value: SummaryEntry[]) => void,
  setStandings: (value: StandingDoc[]) => void,
  setLoadState: (value: LoadState) => void,
  setMine: (value: StaffAssignment | null) => void,
): void {
  setBundle(next.bundle);
  setSummary(next.summary);
  setStandings(next.standings);
  setMine(next.myAssignment);
  setLoadState(next.bundle.competition ? 'ready' : 'missing');
}

function DetailView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [summary, setSummary] = useState<SummaryEntry[]>(env.schedule?.summary ?? []);
  const [standings, setStandings] = useState<StandingDoc[]>(env.schedule?.standings ?? []);
  // 代表自己俱樂部的報隊（CP-PO-14）：詳情頁組別卡要看得到自己待審的隊。
  const [myEntries, setMyEntries] = useState<EntryDoc[]>([]);
  const [myAssignment, setMyAssignment] = useState<StaffAssignment | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(env.bundle ? 'ready' : 'loading');
  const [menuOpen, setMenuOpen] = useState(env.preview?.menuOpen === true);
  const [reportOpen, setReportOpen] = useState(env.preview?.reportOpen === true);
  const [reportReason, setReportReason] = useState<ReportReason>('fake');
  const [reportDetail, setReportDetail] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  // 代表兩個以上俱樂部時不預選，避免手快報錯隊；只有一個才自動帶入。
  const [teamId, setTeamId] = useState(soleClubId(representativeClubs(env.actor)));
  const [clubMissing, setClubMissing] = useState(false);
  const [dvId, setDvId] = useState('');
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [registerError, setRegisterError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [reportError, setReportError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  // 全部賽程只在按下後讀，結果留在這一頁。換賽事 id 才清掉。
  const [fullSchedule, setFullSchedule] = useState<SummaryEntry[] | null>(null);
  const [scorerState, setScorerState] = useState<{ dvId: string; tables: ScorerTables | null } | null>(null);
  const scorerToken = useRef(0);
  const [restoreOpen, setRestoreOpen] = useState(false);
  // 管理員下架對話框（K12）。右上選單與管理員區共用。
  const [hideOpen, setHideOpen] = useState(env.preview?.moderateOpen === true);
  const [restoreReason, setRestoreReason] = useState('');
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const fullCache = useRef<SummaryEntry[] | null>(null);
  const fullInflight = useRef<Promise<boolean> | null>(null);
  const mineCache = useRef<MineReadCache>({ readyKey: '', value: null, flight: null, token: 0 });
  const mounted = useRef(true);
  // 公告發送與刪除共用這把鎖。busy 要等重繪才擋得住，連點會在那之前重入。
  const noticeLock = useRef(false);
  const pageCid = useRef(cid);
  pageCid.current = cid;
  const now = env.now ?? Date.now();
  const clubs = representativeClubs(env.actor);
  const mineClubKey = clubs.map((club) => club.id).join('\0');
  // 只有招募中畫組別卡隊伍清單；其他階段不多讀。
  const recruitNow = bundle?.competition ? competitionPhase(bundle.competition, now) === 'recruit' : false;

  async function reloadMine(shouldApply: () => boolean = () => true): Promise<void> {
    const ids = clubs.map((club) => club.id);
    if (env.bundle || !env.actor.uid || ids.length === 0 || !recruitNow) {
      if (shouldApply()) setMyEntries([]);
      return;
    }
    try {
      const rows = await env.repo.listEntriesByTeams(cid, ids);
      if (shouldApply()) setMyEntries(rows);
    } catch {
      if (shouldApply()) setMyEntries([]);
    }
  }

  useEffect(() => {
    if (teamId) return;
    const sole = soleClubId(clubs);
    if (sole) setTeamId(sole);
  }, [clubs, teamId]);

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  // 伺服器回要先登入後，在原頁登入成功（沒有整頁導向）：清掉錯誤，檢舉面板回到表單。
  useEffect(() => {
    if (env.actor.uid) setReportError(null);
  }, [env.actor.uid]);

  useEffect(() => {
    let alive = true;
    void reloadMine(() => alive);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.actor.uid, env.bundle, mineClubKey, recruitNow]);

  // 只在換賽事時清全部賽程快取。首次掛載不清：effect 晚於第一次繪製，
  // 使用者若在那之前就按展開，剛讀到的全集會被清掉、展開後一片空白（截圖驗收抓到）。
  const fullCid = useRef(cid);
  useEffect(() => {
    if (fullCid.current === cid) return;
    fullCid.current = cid;
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
    void loadDetail(env, cid, mineCache.current).then((next) => {
      if (!alive) return;
      applyDetail(next, setBundle, setSummary, setStandings, setLoadState, setMyAssignment);
    }).catch((err: unknown) => {
      if (alive) setLoadState(loadFailOf(err));
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
      void loadDetail(env, cid, mineCache.current).then((next) => {
        if (!alive || !next.bundle.competition) return;
        applyDetail(next, setBundle, setSummary, setStandings, setLoadState, setMyAssignment);
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

  // 今天比賽日有 live／halftime 才監聽當日摘要片。隱藏時解除，回前景重掛。
  // 依賴用布林與片 id，摘要內容更新不會拆掉監聽。注入 bundle 不打網路。
  const liveToday = hasLiveOnMatchDay(summary, now);
  const liveShard = matchDayOf(now).shardId;
  useEffect(() => {
    if (env.bundle || !liveToday) return undefined;
    const nowMs = env.now ?? Date.now();
    const ports = env.audience ?? createAudiencePorts();
    return bindVisible(() => ports.watchSummary({ cid, shardId: liveShard }, (rows) => {
      if (!mounted.current || pageCid.current !== cid) return;
      setSummary((current) => mergeSummaryShard(current, rows, nowMs));
      setFullSchedule((current) => {
        if (!current) return current;
        const next = mergeSummaryShard(current, rows, nowMs);
        fullCache.current = next;
        return next;
      });
    }));
  }, [cid, env.audience, env.bundle, env.now, liveShard, liveToday]);

  function openScorers(dvId: string): void {
    if (!dvId) return;
    const token = scorerToken.current + 1;
    scorerToken.current = token;
    setScorerState({ dvId, tables: null });
    if (env.bundle && !env.audience) {
      setScorerState({
        dvId,
        tables: { scorers: [], cards: [], empty: true, capped: false, stalled: false },
      });
      return;
    }
    const ports = env.audience ?? createAudiencePorts();
    const entries = bundle?.entries ?? [];
    void ports.getStats(cid, dvId).then((stats) => {
      if (!mounted.current || scorerToken.current !== token || pageCid.current !== cid) return;
      setScorerState({
        dvId,
        tables: scorerTables(stats, (enId) => teamNameByEnId(enId, entries)),
      });
    }).catch(() => {
      if (!mounted.current || scorerToken.current !== token) return;
      setScorerState({
        dvId,
        tables: { scorers: [], cards: [], empty: true, capped: false, stalled: false },
      });
    });
  }

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const competition = bundle?.competition ?? null;
  // 登入還在確認時先轉圈：主辦從深連結進來，uid 到之前會被拒，不先閃「不公開」（uid 到了 effect 會重讀）。
  if (loadState === 'loading' || (loadState === 'hidden' && env.actor.authPending)) {
    return <div class="cps-root"><PageSpinner /></div>;
  }
  if (!competition || loadState === 'error' || loadState === 'hidden' || loadState === 'missing') {
    // 權限被拒＝不公開：不放重試，也不說是下架、草稿還是內部期。網路或其他錯誤才給重試。
    return (
      <CpLoadFailed
        title={ct('detailTitle')}
        fail={loadState === 'hidden' || loadState === 'missing' ? loadState : 'error'}
        onRetry={() => {
          setLoadState('loading');
          void loadDetail(env, cid, mineCache.current).then((next) => {
            applyDetail(next, setBundle, setSummary, setStandings, setLoadState, setMyAssignment);
          }).catch((err: unknown) => setLoadState(loadFailOf(err)));
        }}
      />
    );
  }

  const hostInput = {
    staffRoles: bundle?.staff?.roles ?? [],
    hostType: competition.hostType,
    hostTeamId: competition.hostTeamId,
    repClubIds: clubs.map((club) => club.id),
    isAdmin: isCpAdmin(env.actor.role),
  };
  const manage = canManageCompetition(hostInput);
  // 俱樂部目前代表也算（後端 hostAccess）：排賽程、賽程管理、公告、同分裁定。
  const hostOps = canHostOrCo(hostInput);
  const showMyMatches = hasScoreRole(myAssignment?.roles ?? []);
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
  const isAdmin = isCpAdmin(env.actor.role);
  const divisions = bundle?.divisions ?? [];
  // 刪除：只給後端會放行的人（delete-access.ts）。deletingAt 有值＝上次刪到一半，同一顆鈕改成續刪。
  const deletingAt = competition.deletingAt ?? null;
  const showDelete = canDeleteCompetition({
    uid: env.actor.uid,
    role: env.actor.role,
    hostType: competition.hostType,
    hostTeamId: competition.hostTeamId,
    staffRoles: bundle?.staff?.roles ?? [],
    repClubIds: clubs.map((club) => club.id),
    hidden: competition.hidden,
    deletingAt,
    firstMatchAt: competition.firstMatchAt,
    now,
  });
  // 刪到一半：只留續刪入口與返回，其他主辦操作一律藏起來（後端也會回 COMPETITION_DELETING）。
  const frozen = deletingAt != null;
  // 卡住時的說明：能續刪的人按下方；主辦但首場已過（只剩管理員能續刪）請聯絡管理員；共同主辦只看到刪除中。
  const stuckText = showDelete
    ? ct('deleteStuck')
    : isPrimaryHostView({
      hostType: competition.hostType,
      hostTeamId: competition.hostTeamId,
      staffRoles: bundle?.staff?.roles ?? [],
      repClubIds: clubs.map((club) => club.id),
    })
      ? ct('deleteStuckAdmin')
      : reasonText(ct, 'COMPETITION_DELETING');
  const entries = bundle?.entries ?? [];
  // 頂部一律用首屏的摘要（當日或首場日那一片），不用「全部賽程」。不增加讀取。
  const hero = detailHero({
    phase,
    status: competition.status,
    statusReason: competition.statusReason,
    regCloseAt: competition.regCloseAt,
    firstMatchAt: competition.firstMatchAt,
    summary,
    divisions,
    standings,
    venues: competition.venues,
    now,
  });
  const clubTeamId = competition.hostType === 'club' ? competition.hostTeamId : null;
  const sameYear = taipeiParts(competition.regOpenAt).year === taipeiParts(competition.regCloseAt).year;

  async function publish(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.publish({ cid });
      const next = await loadDetail(env, cid, mineCache.current);
      if (next.bundle.competition) {
        applyDetail(next, setBundle, setSummary, setStandings, setLoadState, setMyAssignment);
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
      toast.show({ message: ct('reportDone'), tone: 'success' });
    } catch (err) {
      setReportError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function reportLogin(): Promise<void> {
    if (loginBusy) return;
    setLoginBusy(true);
    try {
      await (env.signIn ?? cpSignIn)();
    } catch {
      toast.show({ message: reasonText(ct, 'UNKNOWN'), tone: 'error' });
    } finally {
      if (mounted.current) setLoginBusy(false);
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
        const next = await loadDetail(env, cid, mineCache.current);
        applyDetail(next, setBundle, setSummary, setStandings, setLoadState, setMyAssignment);
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
    // 閉包抓不到外層的縮小，這裡再確認一次賽事還在。
    if (!competition) return false;
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
    if (noticeLock.current) return false;
    noticeLock.current = true;
    setBusy(true);
    try {
      const trimmed = text.trim();
      const result = await env.actions.postNotice({ cid, text: trimmed });
      // 成功當下再取時間。渲染時的 now 可能較舊，新公告會被排到舊公告後面。
      const at = env.now ?? Date.now();
      const notice = {
        id: result.noticeId,
        text: trimmed,
        kind: 'host' as const,
        at,
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
      noticeLock.current = false;
      setBusy(false);
    }
  }

  async function removeNotice(noticeId: string): Promise<void> {
    if (noticeLock.current) return;
    noticeLock.current = true;
    setBusy(true);
    try {
      // 系統公告後端也允許刪。確認文字要讓主辦知道這則是系統發的。
      const kind = competition?.notices.find((notice) => notice.id === noticeId)?.kind;
      const ok = await dangerConfirm(
        kind === 'system' ? ct('noticeDeleteSystem') : ct('noticeDeleteConfirm'),
        { okText: ct('noticeDelete'), danger: true },
      );
      if (!ok) return;
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
      noticeLock.current = false;
      setBusy(false);
    }
  }

  function openClub(teamId: string): void {
    route(`/teams/${encodeURIComponent(teamId)}`);
  }

  function openRegister(): void {
    setDvId(divisions[0]?.dvId ?? '');
    // 每次打開都重設，不沿用上次的選擇。
    setTeamId(soleClubId(clubs));
    setClubMissing(false);
    setRegisterError(null);
    setRegisterOpen(true);
  }

  async function sendRegister(): Promise<void> {
    const multi = clubs.length > 1;
    const chosenTeam = multi
      ? (clubs.some((club) => club.id === teamId) ? teamId : '')
      : soleClubId(clubs);
    if (multi && !chosenTeam) {
      setClubMissing(true);
      return;
    }
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
      toast.show({ message: ct('registerDone'), tone: 'success' });
      const next = await loadDetail(env, cid, mineCache.current);
      applyDetail(next, setBundle, setSummary, setStandings, setLoadState, setMyAssignment);
      void reloadMine(() => mounted.current);
    } catch (err) {
      const info = errorOf(err);
      // 後端鏡像未建好時先判代表會回 NOT_CLUB_REP（第二輪模擬 C-04），前端已知是代表就顯示同步中。
      setRegisterError(info.reason === 'NOT_CLUB_REP' && clubs.some((club) => club.id === chosenTeam)
        ? { ...info, reason: 'CLUB_SYNC_PENDING' }
        : info);
    } finally {
      setBusy(false);
    }
  }

  // 未登入（登入狀態已確定）或伺服器回要先登入：面板只放「請先登入再檢舉」與登入鈕，不給填表。
  const reportGuest = (!env.actor.uid && !env.actor.authPending) || reportError?.reason === 'SIGN_IN_REQUIRED';

  const reportLabels: Record<ReportReason, string> = {
    impersonation: ct('reportImpersonation'),
    fake: ct('reportFake'),
    inappropriate: ct('reportInappropriate'),
    privacy: ct('reportPrivacy'),
    other: ct('reportOther'),
  };

  // 頂部正下方的入口卡（新外觀卡 1b-5）：「我的場次」自成一張；主辦專用卡第一行小字「主辦專用」、
  // 草稿時右邊是「發布」，下面一列一個入口。刪到一半（frozen）時整組不畫（現況行為）。「以俱樂部報隊」留在招募資訊卡。
  const entryRow = (label: string, path: string): JSX.Element => (
    <Button variant="ghost" trailing={<NextIcon />} onClick={() => route(`/competitions/${cid}/${path}`)}>{label}</Button>
  );
  const hostCards = frozen ? null : (
    <>
      {showMyMatches ? (
        <nav class="cps-card d2-rows d2-lines d2-lines--48">{entryRow(ct('myMatches'), 'my-matches')}</nav>
      ) : null}
      {manage || hostOps ? (
        <nav class="cps-card d2-rows d2-manage d2-lines d2-lines--48" aria-label={ct('hostOnly')}>
          <div class="d2-manage__k">
            <span>{ct('hostOnly')}</span>
            {manage && competition.status === 'draft' ? (
              <Button variant="primary" size="sm" loading={busy} onClick={() => { void publish(); }}>
                {ct('publish')}
              </Button>
            ) : null}
          </div>
          {manage ? entryRow(ct('manageLink'), 'manage') : null}
          {hostOps ? entryRow(ct('hostSchedTitle'), 'schedule') : null}
          {hostOps ? entryRow(ct('hostListTitle'), 'matches') : null}
          {/* 編輯賽事：建賽精靈同一份表單（/competitions/new?edit=…，不另加路由） */}
          {canEditCompetition(competition, { canHost: hostOps, isAdmin: hostInput.isAdmin }) ? (
            <Button variant="ghost" trailing={<NextIcon />} onClick={() => route(`/competitions/new?edit=${cid}`)}>{ct('editTitle')}</Button>
          ) : null}
        </nav>
      ) : null}
      {error ? <CpError reason={error.reason} params={error.params} /> : null}
    </>
  );
  // 刪除賽事（新外觀卡 1b-7）：從主辦按鈕拆出來，固定畫在頁面內容最後、管理員區之前（各階段同一個位置）。
  // 卡住前後是同一個位置，確認框不會被重掛關掉。
  const deleteBlock = showDelete ? (
    <DeleteCompetition
      ct={ct}
      cid={cid}
      name={competition.name}
      teams={divisions.length > 0 ? teamCountOf(divisions) : null}
      loadTeams={async () => teamCountOf(await env.repo.listDivisions(cid))}
      resume={deletingAt != null}
      actions={env.actions}
      reload={() => env.repo.getCompetition(cid)}
      onDeleted={() => {
        toast.show({ message: ct('deleteDone') });
        env.repo.invalidateCrests(cid);
        // 取代目前這筆歷史：返回不會回到已刪除的賽事。列表每次進入都重讀公開清單與 cpMine。
        route('/tournaments', true);
      }}
      onStuck={(doc) => {
        setBundle((current) => (current ? { ...current, competition: doc } : current));
      }}
      previewOpen={env.preview?.deleteDialog}
    />
  ) : null;

  return (
    <CpFrame
      title={ct('detailTitle')}
      crumb={ct('title')}
      menu={frozen ? undefined : (
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
              {isAdmin && !competition.hidden ? (
                <button type="button" role="menuitem" class="cps-menu__danger" onClick={() => { setMenuOpen(false); setHideOpen(true); }}>
                  {ct('moderateHide')}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    >
      {/* 下架後一般人讀不到根文件（走不公開畫面）；Rules 只放行管理員與主辦／共同主辦（俱樂部主辦的賽事，俱樂部代表算主辦）。 */}
      {competition.hidden && deletingAt == null ? <HiddenNotice ct={ct} reason={competition.hiddenReason} /> : null}
      {/* 刪到一半：後端也寫了 hidden，但不是管理員下架。能續刪的人看到續刪提示，其他人（共同主辦）只看到刪除中。 */}
      {deletingAt != null ? (
        <p class="cpa-hidden" role="status"><AlertIcon /><span>{stuckText}</span></p>
      ) : null}
      <DetailHero
        ct={ct}
        hero={hero}
        status={badge.label}
        danger={competition.status === 'cancelled'}
        category={categoryText(ct, competition.category)}
        name={competition.name}
        date={formatInAppDates(competition)}
        venue={firstVenueName(competition)}
        now={now}
        cover={shownCover(competition, isAdmin)?.url}
        foot={hostLineShown(clubTeamId, competition.contactNote) ? (
          <HostLine
            ct={ct}
            hostName={hostName(competition, env)}
            hostType={phase === 'recruit' ? (competition.hostType === 'club' ? ct('hostClub') : ct('hostPersonal')) : undefined}
            contactNote={competition.contactNote}
            clubTeamId={clubTeamId}
            onOpenClub={openClub}
          />
        ) : undefined}
      />
      {hostCards}
      {showHostEnd ? (
        // 主辦結束賽事的說明卡（新外觀卡 1b-5）：第一行結論跨兩欄，第二行左原因、右「恢復賽事」小鈕
        <CpCard class="d2-note">
          <p class="cpm-ended">{ct(competition.endedBy === 'auto' ? 'endedAutoLine' : 'endedLine', { date: formatTaipeiDate(competition.endedAt ?? now) })}</p>
          {competition.endReason ? <p class="cpm-reason"><b>{ct('reasonPrefix')}</b>　{competition.endReason}</p> : null}
          {hasPendingTie(standings) ? <p class="cpm-hint">{ct('endTieHint')}</p> : null}
          {allowRestore && !frozen ? (
            <div class="cpm-endact">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setRestoreReason(''); setRestoreMessage(null); setRestoreOpen(true); }}>
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
      <PublicBoard
        ct={ct}
        notices={competition.notices}
        hostOps={hostOps && !frozen}
        busy={busy}
        onPost={publishNotice}
        onDelete={removeNotice}
      />
      {phase === 'recruit' ? (
      <>
      <CpCard>
        <dl class="cps-rows">
          {/* 主辦列已經在頂部時不重複；頂部沒有主辦列（個人主辦沒留聯絡）才留這一列，主辦類型標籤接在名稱後面 */}
          {hostLineShown(clubTeamId, competition.contactNote) ? null : (
            <CpRow k={ct('host')}>
              {hostName(competition, env)}
              <StatusTag kind="neutral" label={competition.hostType === 'club' ? ct('hostClub') : ct('hostPersonal')} />
            </CpRow>
          )}
          <CpRow k={ct('regPeriod')}>
            <span class="cps-line">
              {sameYear ? formatTaipeiShort(competition.regOpenAt) : formatTaipeiDate(competition.regOpenAt)}
              {' '}{ct('until')}{' '}
              {sameYear ? formatTaipeiShort(competition.regCloseAt) : formatTaipeiDate(competition.regCloseAt)}
            </span>
          </CpRow>
          <CpRow k={ct('matchPeriod')}>
            <span class="cps-line">
              {/* 與抬頭同一支：同一天只寫一次，分隔符也一致。 */}
              {formatInAppDates(competition)}
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
              <span class="cps-cap">
                <span class="cps-line">{ct('feeHandledByHost')}</span>
                <span class="cps-line">{ct('feeSiteDoesNotHandle')}</span>
              </span>
            </CpRow>
          ) : null}
        </dl>
        {showRegister && !frozen ? (
          <div class="cps-actions">
            <Button variant="primary" onClick={openRegister}>
              {ct('registerClub')}
            </Button>
          </div>
        ) : null}
      </CpCard>

      {divisions.map((division) => (
        <DivisionBlock key={division.dvId} division={division} entries={entries} pendingMine={myEntries.filter((entry) => entry.status === 'pending')} cid={cid} competition={competition} now={now} />
      ))}
      </>
      ) : (
        <>
          <DetailPhaseBody
            ct={ct}
            phase={phase}
            divisions={divisions}
            crests={entries}
            summary={summary}
            standings={standings}
            now={now}
            fullSchedule={fullSchedule}
            onRequestFull={requestFullSchedule}
            clock={clock}
            nextIds={phase === 'live' && clock === 'keep' ? new Set((nextUp(summary, now)?.rows ?? []).map((row) => row.id)) : undefined}
            onOpenStandings={needRanking}
            venues={competition.venues}
            onOpenMatch={(mtId) => route(`/competitions/${cid}/matches/${mtId}/live`)}
            scorerState={scorerState}
            onOpenScorers={openScorers}
            renderStandings={(docs) => (
              <TieWorkspace
                ct={ct}
                docs={docs}
                crests={entries}
                divisions={divisions}
                canHost={hostOps && !frozen}
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
        </>
      )}

      {deleteBlock}

      {isAdmin && !frozen ? (
        <AdminPanel
          ct={ct}
          cid={cid}
          hidden={competition.hidden}
          actions={env.actions}
          repo={env.repo}
          hideOpen={hideOpen}
          setHideOpen={setHideOpen}
          initialReportsOpen={env.preview?.reportsOpen === true}
          onHiddenChange={(hidden, reason) => {
            setBundle((current) => (current?.competition ? {
              ...current,
              competition: { ...current.competition, hidden, hiddenReason: reason, hiddenAt: hidden ? (env.now ?? Date.now()) : null },
            } : current));
          }}
        />
      ) : null}

      {registerOpen ? (
        <BottomSheet
          open
          class="d2-panel"
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
                onValueChange={(next) => { setTeamId(next); setClubMissing(false); }}
                error={clubMissing ? reasonText(ct, 'FIELD_REQUIRED') : undefined}
                options={[
                  { value: '', label: ct('pickClub'), disabled: true },
                  ...clubs.map((club) => ({ value: club.id, label: club.name })),
                ]}
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
          class="d2-panel"
          title={ct('reportTitle')}
          onClose={() => { setReportOpen(false); setReportError(null); }}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => { setReportOpen(false); setReportError(null); }}>{ct('cancel')}</Button>
              {reportGuest
                ? <Button variant="primary" loading={loginBusy} onClick={() => { void reportLogin(); }}>{ct('createLogin')}</Button>
                : <Button variant="primary" loading={busy} onClick={() => { void sendReport(); }}>{ct('reportSubmit')}</Button>}
            </div>
          )}
        >
          {reportGuest ? (
            <div class="cps-sheet-body">
              <p class="cps-lead" data-cp-report="login">{ct('reportLoginHint')}</p>
            </div>
          ) : (
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
          )}
        </BottomSheet>
      ) : null}
    </CpFrame>
  );
}

function DivisionBlock({
  division,
  entries,
  pendingMine,
  cid,
  competition,
  now,
}: {
  division: DivisionDoc;
  entries: EntryDoc[];
  pendingMine: EntryDoc[];
  cid: string;
  competition: CompetitionDoc;
  now: number;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const approved = entries.filter((entry) => entry.dvId === division.dvId && entry.status === 'approved');
  const pendingRows = pendingMine.filter((entry) => entry.dvId === division.dvId && !approved.some((row) => row.id === entry.id));
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
  const rowOf = (entry: EntryDoc, pending: boolean): JSX.Element => (
    <li class="cps-li" key={entry.id}>
      <a class="d2-div__team" href={`/competitions/${cid}/entries/${entry.id}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); route(`/competitions/${cid}/entries/${entry.id}`); }}>
        <span class="cps-li__main">
          <span class="cp3-tn">
            <TeamCrest teamId={entry.teamId} name={entry.name} teamLogo={entry.teamLogo} size={28} />
            <em>{entry.name}</em>
          </span>
        </span>
        {/* 顧問 §3.463：長隊名時「已核准」被擠成兩行。只在這一列讓標籤不縮、不換行，隊名讓位省略；不動共用 Badge。 */}
        <StatusTag kind="neutral" label={pending ? ct('pending') : ct('approved')} class="cps-li__tag" />
        <NextIcon />
      </a>
    </li>
  );
  return (
    // 組別卡（新外觀卡 1b-5）：隊伍列整列是連結（最小高 48），不靠外擴點擊區（原本只有名字那一條 232×26 可點）
    <CpCard class="d2-div">
      <div class="cps-head-row">
        <h3 class="cps-h">{division.name}</h3>
        <StatusTag kind={statusBadge(ct, competition, now).kind} label={statusBadge(ct, competition, now).label} />
      </div>
      <p class="cps-sub cps-nowrap">{meta}</p>
      {/* 報名費與停用的線上支付鈕只限俱樂部主辦（顧問 §3.257） */}
      {competition.hostType === 'club' ? <FeeLine amount={division.feePerTeam} /> : null}
      <div class="cps-bar" aria-hidden="true"><i style={`width:${width}%`} /></div>
      <p class="cps-cap">{ct('approvedTeams', { teams: division.approvedCount, max: division.maxTeams })}</p>
      <ul class="cps-list">
        {approved.map((entry) => rowOf(entry, false))}
        {pendingRows.map((entry) => rowOf(entry, true))}
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
