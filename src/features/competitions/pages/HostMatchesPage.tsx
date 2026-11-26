// 主辦賽程管理：依狀態給改期、登錄比分、確認、重置。寫入都帶 expectedRev。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { PageSpinner } from '@/ui/PageSpinner';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { toast } from '@/ui/Toast';
import { canEndCompetition, canHostOrCo, canShowFlexSchedule, hostEditsOpen, isCpAdmin } from '../access';
import { representativeClubs } from '../rep-clubs';
import { liveCpActions } from '../actions';
import {
  applyDayShift,
  applySwap,
  clashSentence,
  dateAfterLast,
  extendLastMatchAt,
  parseConflict,
  slashDate,
  type ScheduleClash,
} from '../data/flex-schedule';
import {
  applyWrite,
  boundedReason,
  groupHostMatches,
  hostActions,
  hostBadgeKey,
  scoreEntryOpen,
  hostShowsScore,
  isTransportFailure,
  matchDigest,
  outcomeMatches,
  parseReschedule,
  reasonProblem,
  rescheduleDraft,
  sheetScore,
  stepScore,
  unconfirmedCount,
  type HostBadgeKey,
  type WriteIntent,
} from '../data/host-write';
import { formatKickoffClock } from '../data/schedule-present';
import { rememberCompName } from '../data/comp-name-hint';
import { hostMatchesBoard, splitCount } from '../data/host-board';
import { competitionPhase } from '../data/present';
import { hasPendingTie } from '../data/tie-present';
import { CP_READ_LIMIT, type CompetitionDoc, type EntryDoc, type MatchDoc, type MatchStatus, type StaffDoc } from '../data/types';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { undoClock } from '../live/clock';
import { LiveBoundary } from '../live';
import { CpGate, CpLoadFailed, errorOf, loadFailOf, reasonText } from '../ui/feedback';
import { DateField } from '../ui/fields';
import { scheduleLabels } from '../ui/schedule-board';
import { CpCard, CpFrame, CpI18nPending, LockIcon, NextIcon, ResetIcon } from '../ui/shell';
import { StatusTag, type StatusKind } from '../ui/status-tag';
import { MatchVs, MatchWhen } from '../ui/match-row';
import { HostFlexCards, type FlexWriteResult, type ShiftRequest, type SwapRequest } from './host-flex';

type Panel =
  | { kind: 'score'; mtId: string; home: number; away: number }
  | { kind: 'forfeit'; mtId: string; side: 'home' | 'away'; reason: string }
  | { kind: 'reset'; mtId: string; reason: string }
  | { kind: 'reschedule'; mtId: string; tbd: boolean; date: string; time: string; venueIdx: string }
  | { kind: 'cancel'; mtId: string; reason: string };

interface Hold {
  mtId: string;
  kind: Panel['kind'] | 'confirm';
  rev: number;
  retrying: boolean;
  message: string | null;
  updated: string | null;
  scoreConfirm: boolean;
}

function showScoreEntry(match: MatchDoc, nowMs: number): boolean {
  if (match.status === 'scheduled' || match.status === 'live' || match.status === 'halftime') return true;
  if (match.status === 'finished') return undoClock(match.finishedAt, nowMs) != null;
  return false;
}

function allowedOf(env: CpInjectedEnv, competition: CompetitionDoc | null, staff: StaffDoc | null): boolean {
  return canHostOrCo({
    staffRoles: staff?.roles ?? [],
    hostType: competition?.hostType ?? 'personal',
    hostTeamId: competition?.hostTeamId ?? null,
    repClubIds: representativeClubs(env.actor).map((club) => club.id),
    isAdmin: isCpAdmin(env.actor.role),
  });
}

async function loadBundle(env: CpInjectedEnv, cid: string): Promise<CpBundle | null> {
  const uid = env.actor.uid;
  const [competition, divisions, staff] = await Promise.all([
    env.repo.getCompetition(cid),
    env.repo.listDivisions(cid),
    uid ? env.repo.getStaff(cid, uid) : Promise.resolve(null),
  ]);
  if (!competition) return null;
  // 無權限的人進這頁不讀隊徽。隊徽只在看得到場次時才需要。
  if (!allowedOf(env, competition, staff)) {
    return { competition, divisions, entries: [], roster: [], privates: [], staff };
  }
  const entries = await env.repo.listEntriesForCrest(cid);
  return { competition, divisions, entries, roster: [], privates: [], staff };
}

function holdKind(intent: WriteIntent): Hold['kind'] {
  if (intent.kind === 'record') return 'score';
  if (intent.kind === 'walkover') return 'forfeit';
  return intent.kind;
}

function badgeKind(key: HostBadgeKey): StatusKind {
  if (key === 'live') return 'live';
  if (key === 'cancelled') return 'cancelled';
  return 'neutral';
}

function statusText(ct: CompetitionsT, status: MatchStatus): string {
  const key = hostBadgeKey(status);
  if (key === 'sched') return ct('matchUnplayed');
  if (key === 'pending') return ct('matchPending');
  if (key === 'confirmed') return ct('matchConfirmed');
  if (key === 'forfeit') return ct('matchForfeit');
  if (key === 'moved') return ct('matchMoved');
  if (key === 'cancelled') return ct('matchCancelled');
  if (key === 'live') return ct('phaseLive');
  return '';
}

function HostMatchesView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [matches, setMatches] = useState<MatchDoc[]>(() => (env.matches ? [...env.matches] : []));
  const [phase, setPhase] = useState(env.bundle ? 'ready' : 'loading');
  const [panel, setPanel] = useState<Panel | null>(null);
  // 以最新狀態為基準更新（避免連續輸入時用到舊的 panel 閉包，把前一次修改蓋掉）
  const patchPanel = (fields: Record<string, unknown>): void => {
    setPanel((current) => (current ? ({ ...current, ...fields } as typeof current) : current));
  };
  const [hold, setHold] = useState<Hold | null>(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);
  const [reschedClash, setReschedClash] = useState<ScheduleClash | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [endReason, setEndReason] = useState('');
  const [endMessage, setEndMessage] = useState<string | null>(null);
  const [endTie, setEndTie] = useState(false);
  const endSeq = useRef(0);
  const lock = useRef(false);
  const scoreConfirmRef = useRef(true);
  const now = env.now ?? Date.now();
  const repKey = representativeClubs(env.actor).map((club) => club.id).join('\n');
  const repPending = env.actor.repClubsPending === true;

  useEffect(() => {
    if (env.bundle) {
      if (!env.matches && allowedOf(env, env.bundle.competition, env.bundle.staff)) {
        let alive = true;
        void env.repo.listMatches(cid).then((rows) => {
          if (alive) setMatches(rows);
        }).catch(() => undefined);
        return () => {
          alive = false;
        };
      }
      return undefined;
    }
    // 登入判定中或代表清單還在讀：先等，不用空身分先讀一輪（冷開多讀），也不把代表當成無權限。
    if (env.actor.authPending || repPending) return undefined;
    let alive = true;
    void (async () => {
      const next = await loadBundle(env, cid);
      if (!alive) return;
      if (!next?.competition) {
        setPhase('missing');
        return;
      }
      setBundle(next);
      if (allowedOf(env, next.competition, next.staff)) setMatches(await env.repo.listMatches(cid));
      if (alive) setPhase('ready');
    })().catch((err: unknown) => {
      if (alive) setPhase(loadFailOf(err));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.actor.authPending, env.actor.uid, env.actor.role, env.bundle, env.matches, repKey, repPending]);

  const competition = bundle?.competition ?? null;
  const divisions = bundle?.divisions ?? [];
  const crests = bundle?.entries ?? [];
  const compName = competition?.name;
  useEffect(() => {
    // 頁首賽事名小字：記下來給人員、指派頁用（不為名稱多讀）。
    if (compName) rememberCompName(cid, compName);
  }, [cid, compName]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  if (env.actor.authPending || phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  if (phase === 'error' || phase === 'hidden' || !competition) {
    return <CpLoadFailed title={ct('hostListTitle')} fail={phase === 'hidden' ? 'hidden' : 'error'} />;
  }
  if (!allowedOf(env, competition, bundle?.staff ?? null)) {
    return (
      <CpFrame title={ct('hostListTitle')}>
        <CpGate icon={<LockIcon />} text={ct('reason.NOT_HOST')} />
      </CpFrame>
    );
  }

  const comp: CompetitionDoc = competition;

  function digest(match: MatchDoc): string {
    return matchDigest(match, { tbd: ct('timeTbd'), status: statusText(ct, match.status) });
  }

  function replaceMatch(next: MatchDoc): void {
    setMatches((rows) => rows.map((row) => (row.id === next.id ? next : row)));
  }

  function withVenue(next: MatchDoc, venueIdx: number | null): MatchDoc {
    if (venueIdx == null) return { ...next, venueName: null };
    return { ...next, venueName: comp.venues[venueIdx]?.name ?? null };
  }

  async function reread(mtId: string): Promise<MatchDoc | null> {
    try {
      const rows = await env.repo.listMatches(cid);
      return rows.find((row) => row.id === mtId) ?? null;
    } catch {
      return null;
    }
  }

  async function dispatch(intent: WriteIntent, mtId: string, rev: number): Promise<void> {
    if (intent.kind === 'record') {
      await env.actions.recordResult({
        cid, mtId, expectedRev: rev, score: intent.score, confirm: intent.confirm,
      });
      return;
    }
    if (intent.kind === 'confirm') {
      await env.actions.confirmMatchResult({ cid, mtId, expectedRev: rev });
      return;
    }
    if (intent.kind === 'walkover') {
      await env.actions.setWalkover({
        cid, mtId, expectedRev: rev, forfeitSide: intent.forfeitSide, reason: intent.reason,
      });
      return;
    }
    if (intent.kind === 'reset') {
      await env.actions.resetMatch({ cid, mtId, expectedRev: rev, reason: intent.reason });
      return;
    }
    if (intent.kind === 'cancel') {
      await env.actions.cancelMatch({ cid, mtId, expectedRev: rev, reason: intent.reason });
      return;
    }
    await env.actions.rescheduleMatch({
      cid,
      mtId,
      expectedRev: rev,
      kickoffAt: intent.kickoffAt,
      venueIdx: intent.venueIdx,
      ...(intent.force ? { force: true } : {}),
    });
  }

  function remember(intent: WriteIntent, mtId: string, rev: number, retrying: boolean, message: string | null, updated: string | null): void {
    setHold({
      mtId,
      kind: holdKind(intent),
      rev,
      retrying,
      message,
      updated,
      scoreConfirm: intent.kind === 'record' ? intent.confirm : scoreConfirmRef.current,
    });
  }

  async function commit(mtId: string, rev: number, intent: WriteIntent): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const wasRetry = hold?.retrying === true && hold.mtId === mtId;
    try {
      await dispatch(intent, mtId, rev);
      const current = matches.find((row) => row.id === mtId);
      if (current) {
        let next = applyWrite(current, intent);
        if (intent.kind === 'reschedule') next = withVenue(next, intent.venueIdx);
        replaceMatch(next);
      }
      if (intent.kind === 'reschedule') {
        setPosted(true);
        setReschedClash(null);
      }
      setPanel(null);
      setHold(null);
    } catch (err) {
      const info = errorOf(err);
      if (info.reason === 'SCHEDULE_CONFLICT' && intent.kind === 'reschedule') {
        const clash = parseConflict(info.params);
        if (clash) {
          // 撞期只留警示框。不要同時 toast，也不要把同一句放進 hold.message。
          setReschedClash(clash);
          remember(intent, mtId, rev, false, null, null);
          return;
        }
      }
      if (info.reason === 'REV_CONFLICT') {
        const latest = await reread(mtId);
        if (wasRetry && latest && outcomeMatches(intent, latest)) {
          replaceMatch(latest);
          if (intent.kind === 'reschedule') {
            setPosted(true);
            setReschedClash(null);
          }
          setPanel(null);
          setHold(null);
          toast.show({ message: digest(latest), tone: 'success' });
          return;
        }
        const lead = intent.kind === 'confirm' ? ct('matchUpdatedShort') : ct('matchUpdated');
        toast.show({ message: lead, tone: 'error' });
        if (latest) replaceMatch(latest);
        remember(intent, mtId, latest?.rev ?? rev, false, null, latest ? digest(latest) : lead);
        return;
      }
      const message = reasonText(ct, info.reason, info.params);
      toast.show({ message, tone: 'error' });
      remember(intent, mtId, rev, isTransportFailure(info.reason), message, null);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function openScore(match: MatchDoc): void {
    if (lock.current) return;
    const score = sheetScore(match);
    setPanel({ kind: 'score', mtId: match.id, home: score.home, away: score.away });
    setHold({
      mtId: match.id, kind: 'score', rev: match.rev, retrying: false, message: null, updated: null, scoreConfirm: true,
    });
  }

  function openForfeit(match: MatchDoc): void {
    if (lock.current) return;
    setPanel({ kind: 'forfeit', mtId: match.id, side: 'home', reason: '' });
    setHold({
      mtId: match.id, kind: 'forfeit', rev: match.rev, retrying: false, message: null, updated: null, scoreConfirm: false,
    });
  }

  function openReset(match: MatchDoc): void {
    if (lock.current) return;
    setPanel({ kind: 'reset', mtId: match.id, reason: '' });
    setHold({
      mtId: match.id, kind: 'reset', rev: match.rev, retrying: false, message: null, updated: null, scoreConfirm: false,
    });
  }

  function openCancel(match: MatchDoc): void {
    if (lock.current) return;
    setPanel({ kind: 'cancel', mtId: match.id, reason: '' });
    setHold({
      mtId: match.id, kind: 'cancel', rev: match.rev, retrying: false, message: null, updated: null, scoreConfirm: false,
    });
  }

  function openReschedule(match: MatchDoc): void {
    if (lock.current) return;
    const draft = rescheduleDraft(match, comp.venues.length);
    // 打開改期時清掉上一則「已自動發布公告」，避免看起來像這次已經成功。
    setPosted(false);
    setReschedClash(null);
    setPanel({ kind: 'reschedule', mtId: match.id, ...draft });
    setHold({
      mtId: match.id, kind: 'reschedule', rev: match.rev, retrying: false, message: null, updated: null, scoreConfirm: false,
    });
  }

  function closePanel(): void {
    if (lock.current) return;
    setPanel(null);
    setHold((cur) => (cur?.kind === 'confirm' ? cur : null));
  }

  async function submitScore(confirmFlag: boolean): Promise<void> {
    if (!panel || panel.kind !== 'score' || !hold || hold.mtId !== panel.mtId) return;
    scoreConfirmRef.current = confirmFlag;
    await commit(panel.mtId, hold.rev, {
      kind: 'record',
      score: { home: panel.home, away: panel.away },
      confirm: confirmFlag,
    });
  }

  async function submitForfeit(): Promise<void> {
    if (!panel || panel.kind !== 'forfeit' || !hold) return;
    const problem = reasonProblem(panel.reason);
    if (problem) {
      const params = problem === 'FIELD_LENGTH' ? { min: 1, max: 200 } : undefined;
      const message = reasonText(ct, problem, params);
      toast.show({ message, tone: 'error' });
      setHold({ ...hold, message, updated: null });
      return;
    }
    await commit(panel.mtId, hold.rev, {
      kind: 'walkover',
      forfeitSide: panel.side,
      reason: panel.reason.trim(),
    });
  }

  async function submitReset(): Promise<void> {
    if (!panel || panel.kind !== 'reset' || !hold) return;
    const problem = reasonProblem(panel.reason);
    if (problem) {
      const params = problem === 'FIELD_LENGTH' ? { min: 1, max: 200 } : undefined;
      const message = reasonText(ct, problem, params);
      toast.show({ message, tone: 'error' });
      setHold({ ...hold, message, updated: null });
      return;
    }
    await commit(panel.mtId, hold.rev, { kind: 'reset', reason: panel.reason.trim() });
  }

  async function submitCancel(): Promise<void> {
    if (!panel || panel.kind !== 'cancel' || !hold) return;
    const problem = boundedReason(panel.reason, 2, 100);
    if (problem) {
      const params = problem === 'FIELD_LENGTH' ? { min: 2, max: 100 } : undefined;
      const message = reasonText(ct, problem, params);
      toast.show({ message, tone: 'error' });
      setHold({ ...hold, retrying: false, message, updated: null });
      return;
    }
    await commit(panel.mtId, hold.rev, { kind: 'cancel', reason: panel.reason.trim() });
  }

  function openEnd(): void {
    setEndReason('');
    setEndMessage(null);
    setEndOpen(true);
    endSeq.current += 1;
    const seq = endSeq.current;
    const known = env.schedule?.standings;
    if (known) {
      setEndTie(hasPendingTie(known));
      return;
    }
    setEndTie(false);
    void env.repo.listStandings(cid).then((rows) => {
      if (endSeq.current !== seq) return;
      setEndTie(hasPendingTie(rows));
    }).catch(() => undefined);
  }

  async function submitEnd(): Promise<void> {
    if (lock.current) return;
    const problem = boundedReason(endReason, 2, 100);
    if (problem) {
      const params = problem === 'FIELD_LENGTH' ? { min: 2, max: 100 } : undefined;
      const message = reasonText(ct, problem, params);
      toast.show({ message, tone: 'error' });
      setEndMessage(message);
      return;
    }
    lock.current = true;
    setBusy(true);
    setEndMessage(null);
    try {
      const reason = endReason.trim();
      await env.actions.endCompetition({ cid, reason });
      setBundle((current) => {
        if (!current?.competition) return current;
        return {
          ...current,
          competition: { ...current.competition, endedAt: now, endedBy: 'host', endReason: reason },
        };
      });
      setEndOpen(false);
      setEndReason('');
    } catch (err) {
      const info = errorOf(err);
      const message = reasonText(ct, info.reason, info.params);
      toast.show({ message, tone: 'error' });
      setEndMessage(message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function submitReschedule(force = false): Promise<void> {
    if (!panel || panel.kind !== 'reschedule' || !hold) return;
    const parsed = parseReschedule({
      tbd: panel.tbd,
      date: panel.date,
      time: panel.time,
      venueIdx: panel.venueIdx,
      venueCount: comp.venues.length,
    });
    if (!parsed.ok) {
      const message = reasonText(ct, parsed.reason);
      toast.show({ message, tone: 'error' });
      setHold({ ...hold, retrying: false, message, updated: null });
      return;
    }
    setPosted(false);
    await commit(panel.mtId, hold.rev, {
      kind: 'reschedule',
      kickoffAt: parsed.kickoffAt,
      venueIdx: parsed.venueIdx,
      force,
    });
  }

  function rememberLast(rows: readonly MatchDoc[]): void {
    setBundle((current) => {
      if (!current?.competition) return current;
      const lastMatchAt = extendLastMatchAt(
        current.competition.lastMatchAt,
        rows.map((row) => row.kickoffAt),
      );
      if (lastMatchAt === current.competition.lastMatchAt) return current;
      return { ...current, competition: { ...current.competition, lastMatchAt } };
    });
  }

  function flexFailure(err: unknown): FlexWriteResult {
    const info = errorOf(err);
    toast.show({ message: reasonText(ct, info.reason, info.params), tone: 'error' });
    if (info.reason === 'SCHEDULE_CONFLICT') return { ok: false, clash: parseConflict(info.params) };
    return { ok: false, clash: null };
  }

  async function runShift(input: ShiftRequest): Promise<FlexWriteResult> {
    if (lock.current) return { ok: false, clash: null };
    setPosted(false);
    lock.current = true;
    setBusy(true);
    try {
      await env.actions.shiftMatchDay({
        cid,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason,
        ...(input.force ? { force: true } : {}),
      });
      const next = applyDayShift(matches, input.fromDate, input.toDate);
      setMatches(next);
      rememberLast(next);
      setPosted(true);
      return { ok: true };
    } catch (err) {
      return flexFailure(err);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function runSwap(input: SwapRequest): Promise<FlexWriteResult> {
    if (lock.current) return { ok: false, clash: null };
    setPosted(false);
    lock.current = true;
    setBusy(true);
    try {
      await env.actions.swapMatches({
        cid,
        mtIdA: input.mtIdA,
        mtIdB: input.mtIdB,
        expectedRevA: input.expectedRevA,
        expectedRevB: input.expectedRevB,
        reason: input.reason,
        ...(input.force ? { force: true } : {}),
      });
      const next = applySwap(matches, input.mtIdA, input.mtIdB);
      setMatches(next);
      rememberLast(next);
      setPosted(true);
      return { ok: true };
    } catch (err) {
      // 版次衝突時兩場都可能已被別人改過，比照其他寫入重讀整份場次再更新畫面。
      if (errorOf(err).reason === 'REV_CONFLICT') {
        try {
          const rows = await env.repo.listMatches(cid);
          setMatches(rows);
          rememberLast(rows);
        } catch {
          // 讀不到最新場次時仍提示衝突，畫面留舊資料。
        }
      }
      return flexFailure(err);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function submitConfirm(match: MatchDoc): Promise<void> {
    const rev = hold?.kind === 'confirm' && hold.mtId === match.id ? hold.rev : match.rev;
    await commit(match.id, rev, { kind: 'confirm', score: { home: match.score.home, away: match.score.away } });
  }

  function retry(): void {
    if (!hold) return;
    if (hold.kind === 'score') {
      void submitScore(scoreConfirmRef.current);
      return;
    }
    if (hold.kind === 'forfeit') {
      void submitForfeit();
      return;
    }
    if (hold.kind === 'reset') {
      void submitReset();
      return;
    }
    if (hold.kind === 'cancel') {
      void submitCancel();
      return;
    }
    if (hold.kind === 'reschedule') {
      void submitReschedule();
      return;
    }
    const match = matches.find((row) => row.id === hold.mtId);
    if (match) void submitConfirm(match);
  }

  // Flash 初審 P2：重送遇 REV_CONFLICT 且這場已被別人改成不同內容時，鎖住面板的送出鈕，
  // 要主辦關閉面板、看過最新內容後重新操作，避免用舊輸入覆蓋新結果。
  const staleHold = hold?.updated != null;

  function notice(kind: Hold['kind'], mtId: string): JSX.Element | null {
    if (!hold || hold.kind !== kind || hold.mtId !== mtId) return null;
    if (!hold.message && !hold.updated && !hold.retrying) return null;
    const lead = hold.kind === 'confirm' ? ct('matchUpdatedShort') : ct('matchUpdated');
    return (
      <div>
        {hold.updated ? (
          <div role="status">
            <p>{lead}</p>
            {hold.updated !== lead ? <p>{hold.updated}</p> : null}
          </div>
        ) : null}
        {hold.message ? <p class="cps-note cps-warn" role="alert">{hold.message}</p> : null}
        {hold.retrying ? (
          <div class="cps-actions">
            <Button variant="secondary" disabled={busy} onClick={retry}>{ct('retrySubmit')}</Button>
          </div>
        ) : null}
      </div>
    );
  }

  const groups = groupHostMatches(matches, divisions, now, scheduleLabels(ct));
  const active = panel ? matches.find((row) => row.id === panel.mtId) ?? null : null;
  // 已發布、未結束就顯示結束賽事；延期、草稿不顯示。站長 11-23：沒排賽程也要能手動結束（後端同步拿掉 SCHEDULE_REQUIRED），取代原本「已有場次才顯示」。
  const isAdmin = isCpAdmin(env.actor.role);
  // 下架時只留管理員（後端 hostComp：hidden 且非管理員回 COMPETITION_HIDDEN，一致性盤點 #14）。
  const hiddenBlock = comp.hidden && !isAdmin;
  const showEnd = canEndCompetition(comp) && !hiddenBlock;
  // 順延／對調：末場確認結束 3 天內主辦仍可用，管理員不受限（一致性盤點 #4）。沒有場次不顯示。
  const showFlex = canShowFlexSchedule(comp, isAdmin, now) && matches.length > 0;
  // 場次按鈕（確認、登錄比分、改期、取消、重置、棄權）都先過後端 assertNotEnded；結束後照同一條收起（#4）。
  const rowsEditable = hostEditsOpen(comp, isAdmin, now) && !hiddenBlock;
  // 「記分」走 Rules compScorableData（已發布、未下架）；賽事結束後記完也確認不了，一律不給（記分盤點 S1）。
  const liveScoring = comp.endedAt == null && !comp.hidden;

  // 矮板（3.4）：只用這頁已讀到的場次與賽事文件。場次讀到上限（100）時數字都可能少算，整塊不放。
  // 第一格「進行中 N」或「下一場 HH:MM」；再加「今天 N 場」「待確認 N 場」；是 0 的格不放；一格都沒有不放板。
  const sb = matches.length >= CP_READ_LIMIT.matches ? null : hostMatchesBoard(matches, now);
  type Cell = { k: string; n: string; tail?: string; now?: boolean; say: string };
  const cells: Cell[] = [];
  if (sb && sb.live > 0) {
    cells.push({ k: ct('phaseLive'), n: String(sb.live), now: true, say: `${ct('phaseLive')} ${sb.live}` });
  } else if (sb?.next) {
    const time = formatKickoffClock(sb.next.kickoffAt);
    cells.push({ k: ct('boardNext'), n: time, now: true, say: `${ct('boardNext')} ${time}` });
  }
  if (sb && sb.today > 0) {
    const say = ct('lineTodayOnly', { n: sb.today });
    const cut = splitCount((n) => ct('lineTodayOnly', { n }), sb.today, 0);
    cells.push(cut ? { k: cut.k, n: String(cut.n), tail: cut.tail, say } : { k: say, n: '', say });
  }
  if (sb && sb.pending > 0) {
    cells.push({ k: ct('matchPending'), n: String(sb.pending), tail: ct('matchUnit'), say: ct('pendingMatchesN', { n: sb.pending }) });
  }
  const lit = competitionPhase(comp, now) === 'live';
  const board = cells.length > 0 ? (
    <div class={`d2-sb d2-sb--row cph-sb${lit ? ' d2-sb--lit' : ''}`}>
      <p class="cps-vh">{cells.map((cell) => cell.say).join('　')}</p>
      <div class="d2-cells d2-cells--row" aria-hidden="true">
        {cells.map((cell) => (
          <div class={cell.now ? 'd2-cell d2-cell--now' : 'd2-cell'} key={cell.k}>
            <span class="d2-cell__k">{cell.k}</span>
            {cell.n ? <span class="d2-cell__v"><b class="d2-num">{cell.n}</b>{cell.tail ? <small>{cell.tail}</small> : null}</span> : null}
          </div>
        ))}
      </div>
    </div>
  ) : null;
  const nextId = sb?.next?.id ?? null;

  return (
    <CpFrame title={ct('hostListTitle')} context={comp.name}>
      {posted ? <p class="s4b-alert" role="status">{ct('autoPost')}</p> : null}
      {showFlex ? (
        <HostFlexCards
          board={board}
          ct={ct}
          matches={matches}
          weekdays={scheduleLabels(ct).weekdays}
          busy={busy}
          onShift={runShift}
          onSwap={runSwap}
          onOpen={() => setPosted(false)}
        />
      ) : board ? <section class="d2-hero d2-hero--bare">{board}</section> : null}
      {matches.length === 0 ? (
        competitionPhase(comp, now) === 'done' ? (
          <CpCard>
            {/* 顧問 §3.791：已取消與已結束分兩句，都不放排賽程鈕。 */}
            <p class="cps-note">{ct(comp.status === 'cancelled' ? 'hostCancelledNoMatches' : 'hostEndedNoMatches')}</p>
          </CpCard>
        ) : (
          <CpCard>
            <p class="cps-note">{ct('reason.SCHEDULE_REQUIRED')}</p>
            <div class="cph-start">
              <Button variant="secondary" size="sm" onClick={() => route(`/competitions/${cid}/schedule`)}>{ct('hostSchedTitle')}</Button>
            </div>
          </CpCard>
        )
      ) : null}
      {groups.map((group) => (
        <div key={group.divisionId}>
          {group.heading ? <h3 class="cp3-day">{group.heading}</h3> : null}
          {group.days.map((day) => (
            <div key={day.key} class="cph-day">
              <h4 class="cp3-day">{day.label}</h4>
              <CpCard>
                <ul class="cp3-ml">
                  {day.matches.map((match) => {
                    const actions = rowsEditable ? hostActions(match.status) : [];
                    const badge = hostBadgeKey(match.status);
                    const reset = actions.includes('reset');
                    const rowActions = actions.filter((action) => action !== 'reset');
                    const scoreEntry = liveScoring && showScoreEntry(match, now);
                    // 開賽前不給「登錄比分」（後端 MATCH_NOT_STARTED），判棄權照舊可用（#8）。
                    const scoreOpen = rowActions.includes('score') && scoreEntryOpen(match, now);
                    const forfeitOnly = rowActions.includes('score') && !scoreOpen;
                    return (
                      <li class={`cp3-m${badge === 'live' ? ' cp3-m--live' : badge === 'cancelled' ? ' cp3-m--off' : match.id === nextId ? ' cp3-m--next' : ''}`} key={match.id}>
                        <div class="cp3-m__top">
                          {match.kickoffAt == null ? (
                            <MatchWhen time={ct('timeTbd')} />
                          ) : (
                            <MatchWhen time={formatKickoffClock(match.kickoffAt)} venue={match.venueName} />
                          )}
                          {badge && reset ? (
                            <span class="cp3-tags">
                              <StatusTag kind={badgeKind(badge)} label={statusText(ct, match.status)} />
                              <Button variant="ghost" size="sm" class="cph-reset" leading={<ResetIcon />} disabled={busy} onClick={() => openReset(match)}>{ct('resetMatch')}</Button>
                            </span>
                          ) : null}
                          {badge && !reset ? <StatusTag kind={badgeKind(badge)} label={statusText(ct, match.status)} /> : null}
                        </div>
                        <MatchVs
                          home={{ id: match.home.teamId, name: match.home.name }}
                          away={{ id: match.away.teamId, name: match.away.name }}
                          crests={crests}
                          score={(match.status === 'cancelled'
                            ? match.score.home !== 0 || match.score.away !== 0
                            : hostShowsScore(match.status)) ? [match.score.home, match.score.away] : null}
                        />
                        {match.status === 'cancelled' && match.cancelReason ? (
                          <p class="cpm-reason"><b>{ct('reasonPrefix')}</b>　{match.cancelReason}</p>
                        ) : null}
                        {rowActions.length > 0 || scoreEntry ? (
                          <div class="cp3-m__act">
                            {/* 顧問 §3.469：DOM 順序跟著畫面（確認 → 登錄比分 → 記分 → 改期 ……… 取消這場），按鈕的集合與出現條件不動 */}
                            {rowActions.includes('confirm') ? (
                              <Button key="confirm" variant="primary" size="sm" disabled={busy} onClick={() => { void submitConfirm(match); }}>{ct('confirmMatch')}</Button>
                            ) : null}
                            {scoreOpen ? (
                              <Button key="score" variant="secondary" size="sm" disabled={busy} onClick={() => openScore(match)}>{ct('enterScore')}</Button>
                            ) : null}
                            {forfeitOnly ? (
                              <Button key="forfeit" variant="secondary" size="sm" disabled={busy} onClick={() => openForfeit(match)}>{ct('forfeitTitle')}</Button>
                            ) : null}
                            {scoreEntry ? (
                              <Button key="score-live" variant="secondary" size="sm" trailing={<NextIcon />} disabled={busy} onClick={() => route(`/competitions/${cid}/matches/${match.id}/score`)}>{ct('scoreTitle')}</Button>
                            ) : null}
                            {rowActions.includes('reschedule') ? (
                              <Button key="reschedule" variant="secondary" size="sm" disabled={busy} onClick={() => openReschedule(match)}>{ct('reschedTitle')}</Button>
                            ) : null}
                            {rowActions.includes('cancel') ? (
                              <Button key="cancel" variant="danger" size="sm" disabled={busy} onClick={() => openCancel(match)}>{ct('cancelMatch')}</Button>
                            ) : null}
                          </div>
                        ) : null}
                        {notice('confirm', match.id)}
                      </li>
                    );
                  })}
                </ul>
              </CpCard>
            </div>
          ))}
        </div>
      ))}
      {/* 顧問 §R2：結束賽事移到場次清單之後，第一屏只留順延／對調；危險色與確認流程不變。 */}
      {showEnd ? (
        <div class="cph-end">
          <Button variant="danger" disabled={busy || endOpen} onClick={openEnd}>
            {ct('endTitle')}
          </Button>
        </div>
      ) : null}
      {panel?.kind === 'score' && active ? (
        <BottomSheet open class="d2-panel" title={ct('scoreSheetTitle')} onClose={closePanel} busy={busy}>
          <div class="cps-sheet-body">
            <p class="cp3-ctx">
              {active.kickoffAt == null ? ct('timeTbd') : `${formatKickoffClock(active.kickoffAt)}${active.venueName ? `　${active.venueName}` : ''}`}
            </p>
            <div class="cp3-score">
              <div class="cp3-score__team">
                <span class="cp3-score__name">{active.home.name}</span>
                <div class="cp3-score__num">{panel.home}</div>
                <div class="cp3-score__btns">
                  <button type="button" class="cp3-stepbtn" aria-label={ct('scoreMinus')} disabled={busy || panel.home <= 0} onClick={() => patchPanel({ home: stepScore(panel.home, -1) })}>−</button>
                  <button type="button" class="cp3-stepbtn" aria-label={ct('scorePlus')} disabled={busy || panel.home >= 99} onClick={() => patchPanel({ home: stepScore(panel.home, 1) })}>＋</button>
                </div>
              </div>
              <span class="cp3-score__colon">：</span>
              <div class="cp3-score__team">
                <span class="cp3-score__name">{active.away.name}</span>
                <div class="cp3-score__num">{panel.away}</div>
                <div class="cp3-score__btns">
                  <button type="button" class="cp3-stepbtn" aria-label={ct('scoreMinus')} disabled={busy || panel.away <= 0} onClick={() => patchPanel({ away: stepScore(panel.away, -1) })}>−</button>
                  <button type="button" class="cp3-stepbtn" aria-label={ct('scorePlus')} disabled={busy || panel.away >= 99} onClick={() => patchPanel({ away: stepScore(panel.away, 1) })}>＋</button>
                </div>
              </div>
            </div>
            <div class="cp3-stack-btns">
              <Button variant="primary" disabled={busy || staleHold} onClick={() => { void submitScore(true); }}>{ct('saveConfirm')}</Button>
              <Button variant="secondary" disabled={busy || staleHold} onClick={() => { void submitScore(false); }}>{ct('saveLater')}</Button>
            </div>
            <button type="button" class="cp3-textlink" disabled={busy} onClick={() => openForfeit(active)}>{ct('toForfeit')}</button>
            {notice('score', panel.mtId)}
          </div>
        </BottomSheet>
      ) : null}
      {panel?.kind === 'forfeit' && active ? (
        <BottomSheet
          open
          class="d2-panel"
          title={ct('forfeitTitle')}
          onClose={closePanel}
          busy={busy}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" disabled={busy} onClick={closePanel}>{ct('cancel')}</Button>
              <Button variant="danger" disabled={busy || staleHold} onClick={() => { void submitForfeit(); }}>{ct('forfeitOk')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <RadioGroup
              label={ct('forfeitWho')}
              value={panel.side}
              onValueChange={(value) => {
                if (value === 'home' || value === 'away') patchPanel({ side: value });
              }}
              options={[
                { value: 'home', label: active.home.name },
                { value: 'away', label: active.away.name },
              ]}
            />
            <Textarea
              label={ct('forfeitReason')}
              required
              value={panel.reason}
              maxLength={200}
              onValueChange={(value) => patchPanel({ reason: value })}
            />
            <p class="cp3-judge">{ct('forfeitHint')}</p>
            {notice('forfeit', panel.mtId)}
          </div>
        </BottomSheet>
      ) : null}
      {panel?.kind === 'reset' && active ? (
        <Modal
          open
          class="d2-panel"
          title={ct('resetTitle')}
          onClose={closePanel}
          busy={busy}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" disabled={busy} onClick={closePanel}>{ct('cancel')}</Button>
              <Button variant="danger" disabled={busy || staleHold} onClick={() => { void submitReset(); }}>{ct('resetMatch')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <p class="cp3-modal-p">{ct('resetBody')}</p>
            <Textarea
              label={ct('resetReason')}
              required
              value={panel.reason}
              maxLength={200}
              onValueChange={(value) => patchPanel({ reason: value })}
            />
            {notice('reset', panel.mtId)}
          </div>
        </Modal>
      ) : null}
      {panel?.kind === 'cancel' && active ? (
        <BottomSheet
          open
          class="d2-panel"
          title={ct('cancelMatch')}
          onClose={closePanel}
          busy={busy}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" disabled={busy} onClick={closePanel}>{ct('keepMatch')}</Button>
              <Button variant="danger" disabled={busy || staleHold} onClick={() => { void submitCancel(); }}>{ct('cancelOk')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <p class="cp3-ctx">
              {active.kickoffAt == null ? ct('timeTbd') : `${formatKickoffClock(active.kickoffAt)}${active.venueName ? `　${active.venueName}` : ''}`}
            </p>
            <p class="cp3-ctx">{active.home.name}　vs　{active.away.name}</p>
            <Textarea
              label={ct('cancelReason')}
              required
              value={panel.reason}
              maxLength={100}
              rows={2}
              variant="fixed"
              onValueChange={(value) => patchPanel({ reason: value })}
            />
            <p class="cpm-hint">{ct('cancelPublic')}</p>
            <p class="cpm-hint">{ct('cancelHint')}</p>
            {notice('cancel', panel.mtId)}
          </div>
        </BottomSheet>
      ) : null}
      {endOpen ? (
        <Modal
          open
          class="d2-panel"
          title={ct('endTitle')}
          onClose={() => { if (!lock.current) setEndOpen(false); }}
          busy={busy}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" disabled={busy} onClick={() => setEndOpen(false)}>{ct('cancel')}</Button>
              <Button variant="danger" disabled={busy} onClick={() => { void submitEnd(); }}>{ct('endOk')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <p class="cpm-hint cps-pre">{ct('endHint')}</p>
            {!isCpAdmin(env.actor.role) ? <p class="cpm-hint cps-pre">{ct('endNoRestore')}</p> : null}
            {endTie ? <p class="cpm-hint">{ct('endTieHint')}</p> : null}
            <p class="cpm-preview">{ct('unconfirmed', { n: unconfirmedCount(matches) })}</p>
            <Textarea
              label={ct('endReason')}
              required
              value={endReason}
              maxLength={100}
              rows={2}
              variant="fixed"
              onValueChange={setEndReason}
            />
            {endMessage ? <p class="cps-note cps-warn" role="alert">{endMessage}</p> : null}
          </div>
        </Modal>
      ) : null}
      {panel?.kind === 'reschedule' && active ? (
        <BottomSheet
          open
          class="d2-panel"
          title={ct('reschedTitle')}
          onClose={closePanel}
          busy={busy}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" disabled={busy} onClick={closePanel}>{ct('cancel')}</Button>
              <Button variant="primary" disabled={busy || staleHold} onClick={() => { void submitReschedule(); }}>{ct('reschedOk')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <p class="cp3-ctx">{active.home.name}　vs　{active.away.name}</p>
            <p class="cpm-cap">{ct('cap60')}</p>
            <Checkbox
              label={ct('reschedTbd')}
              checked={panel.tbd}
              disabled={busy}
              onCheckedChange={(checked) => {
                patchPanel({ tbd: checked });
                setReschedClash(null);
              }}
            />
            <div class="cps-grid2">
              <DateField
                id="cp-resched-date"
                label={ct('schedDate')}
                value={panel.date}
                disabled={panel.tbd || busy}
                onValueChange={(value) => {
                  patchPanel({ date: value });
                  setReschedClash(null);
                }}
              />
              <Input
                label={ct('reschedTime')}
                value={panel.time}
                disabled={panel.tbd || busy}
                onValueChange={(value) => {
                  patchPanel({ time: value });
                  setReschedClash(null);
                }}
              />
            </div>
            {!panel.tbd && dateAfterLast(panel.date, comp.lastMatchAt) ? (
              <p class="cpm-hint">{ct('delayHint', { date: slashDate(panel.date) ?? '' })}</p>
            ) : null}
            {comp.venues.length > 0 ? (
              <Select
                label={ct('venue')}
                value={panel.venueIdx}
                disabled={panel.tbd || busy}
                onValueChange={(value) => {
                  patchPanel({ venueIdx: value });
                  setReschedClash(null);
                }}
                options={comp.venues.map((venue, index) => ({
                  value: String(index),
                  label: venue.name || ct('venue'),
                }))}
              />
            ) : null}
            {reschedClash ? (
              <p class="cpm-warn" role="alert">
                {clashSentence(
                  matches.find((row) => row.id === reschedClash.mtId),
                  reschedClash.type,
                  ct('clashTeam'),
                  ct('clashVenue'),
                  ct('vsWord'),
                )}
              </p>
            ) : null}
            {reschedClash ? (
              <Button variant="secondary" disabled={busy || staleHold} onClick={() => { void submitReschedule(true); }}>
                {ct('forceReschedule')}
              </Button>
            ) : null}
            {notice('reschedule', panel.mtId)}
          </div>
        </BottomSheet>
      ) : null}
    </CpFrame>
  );
}

export default function HostMatchesPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  if (injected) return <HostMatchesView env={injected} cid={cid} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <HostMatchesView env={{ actor, repo, actions: liveCpActions }} cid={cid} />}
    </LiveBoundary>
  );
}
