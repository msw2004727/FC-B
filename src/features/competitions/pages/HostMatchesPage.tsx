// 主辦賽程管理：依狀態給改期、登錄比分、確認、重置。寫入都帶 expectedRev。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { Badge, type BadgeTone } from '@/ui/Badge';
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
import { canEndCompetition, canHostOrCo, isCpAdmin } from '../access';
import { liveCpActions } from '../actions';
import {
  applyWrite,
  boundedReason,
  groupHostMatches,
  hostActions,
  hostBadgeKey,
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
import type { CompetitionDoc, EntryDoc, MatchDoc, MatchStatus, StaffDoc } from '../data/types';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { LiveBoundary } from '../live';
import { errorOf, reasonText } from '../ui/feedback';
import { DateField } from '../ui/fields';
import { scheduleLabels } from '../ui/schedule-board';
import { CpCard, CpFrame, CpI18nPending } from '../ui/shell';
import { crestFromEntry, TeamCrest } from '../ui/TeamCrest';

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

function allowedOf(env: CpInjectedEnv, staff: StaffDoc | null): boolean {
  return canHostOrCo({
    staffRoles: staff?.roles ?? [],
    isAdmin: isCpAdmin(env.actor.role),
  });
}

async function loadBundle(env: CpInjectedEnv, cid: string): Promise<CpBundle | null> {
  const uid = env.actor.uid;
  const [competition, divisions, staff, entries] = await Promise.all([
    env.repo.getCompetition(cid),
    env.repo.listDivisions(cid),
    uid ? env.repo.getStaff(cid, uid) : Promise.resolve(null),
    env.repo.listEntriesForCrest(cid),
  ]);
  if (!competition) return null;
  return { competition, divisions, entries, roster: [], privates: [], staff };
}

function holdKind(intent: WriteIntent): Hold['kind'] {
  if (intent.kind === 'record') return 'score';
  if (intent.kind === 'walkover') return 'forfeit';
  return intent.kind;
}

function badgeTone(key: HostBadgeKey): BadgeTone {
  if (key === 'sched') return 'neutral';
  if (key === 'pending') return 'warning';
  if (key === 'confirmed') return 'success';
  if (key === 'forfeit' || key === 'cancelled') return 'danger';
  if (key === 'moved') return 'info';
  return 'warning';
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

function SideName({
  entryId,
  name,
  crests,
  align,
}: {
  entryId: string;
  name: string;
  crests: readonly EntryDoc[];
  align: 'home' | 'away';
}): JSX.Element {
  const crest = crestFromEntry(entryId, name, crests);
  const mark = <TeamCrest teamId={crest.teamId} name={crest.name} teamLogo={crest.teamLogo} size={22} />;
  if (align === 'home') return <span class="cp3-tn cp3-tn--h"><em>{name}</em>{mark}</span>;
  return <span class="cp3-tn">{mark}<em>{name}</em></span>;
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
  const [endOpen, setEndOpen] = useState(false);
  const [endReason, setEndReason] = useState('');
  const [endMessage, setEndMessage] = useState<string | null>(null);
  const lock = useRef(false);
  const scoreConfirmRef = useRef(true);
  const now = env.now ?? Date.now();

  useEffect(() => {
    if (env.bundle) {
      if (!env.matches && allowedOf(env, env.bundle.staff)) {
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
    let alive = true;
    void (async () => {
      const next = await loadBundle(env, cid);
      if (!alive) return;
      if (!next?.competition) {
        setPhase('missing');
        return;
      }
      setBundle(next);
      if (allowedOf(env, next.staff)) setMatches(await env.repo.listMatches(cid));
      if (alive) setPhase('ready');
    })().catch(() => {
      if (alive) setPhase('error');
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.actor.uid, env.actor.role, env.bundle, env.matches]);

  const competition = bundle?.competition ?? null;
  const divisions = bundle?.divisions ?? [];
  const crests = bundle?.entries ?? [];

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  if (env.actor.authPending || phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  if (phase === 'error' || !competition) {
    return (
      <CpFrame title={ct('hostListTitle')}>
        <p class="cps-note" role="alert">{ct('loadFailed')}</p>
      </CpFrame>
    );
  }
  if (!allowedOf(env, bundle?.staff ?? null)) {
    return (
      <CpFrame title={ct('hostListTitle')}>
        <p class="cps-note" role="alert">{ct('reason.NOT_HOST')}</p>
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
      cid, mtId, expectedRev: rev, kickoffAt: intent.kickoffAt, venueIdx: intent.venueIdx,
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
      setPanel(null);
      setHold(null);
    } catch (err) {
      const info = errorOf(err);
      if (info.reason === 'REV_CONFLICT') {
        const latest = await reread(mtId);
        if (wasRetry && latest && outcomeMatches(intent, latest)) {
          replaceMatch(latest);
          setPanel(null);
          setHold(null);
          toast.show({ message: digest(latest), tone: 'success' });
          return;
        }
        toast.show({ message: ct('matchUpdated'), tone: 'error' });
        if (latest) replaceMatch(latest);
        remember(intent, mtId, latest?.rev ?? rev, false, null, latest ? digest(latest) : ct('matchUpdated'));
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
      setHold({ ...hold, retrying: false, message, updated: null });
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
      setHold({ ...hold, retrying: false, message, updated: null });
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

  async function submitReschedule(): Promise<void> {
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
    await commit(panel.mtId, hold.rev, {
      kind: 'reschedule',
      kickoffAt: parsed.kickoffAt,
      venueIdx: parsed.venueIdx,
    });
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
    return (
      <div>
        {hold.updated ? (
          <div role="status">
            <p>{ct('matchUpdated')}</p>
            <p>{hold.updated}</p>
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

  return (
    <CpFrame title={ct('hostListTitle')}>
      <p class="cps-sub" style="margin:0">{comp.name}</p>
      {canEndCompetition(comp) ? (
        <div class="cps-actions" style="margin-top:0">
          <Button variant="danger" disabled={busy || endOpen} onClick={() => { setEndReason(''); setEndMessage(null); setEndOpen(true); }}>
            {ct('endTitle')}
          </Button>
        </div>
      ) : null}
      {matches.length === 0 ? (
        <CpCard>
          <p class="cps-note">{ct('reason.SCHEDULE_REQUIRED')}</p>
          <div class="cps-actions">
            <Button variant="secondary" onClick={() => route(`/competitions/${cid}/schedule`)}>{ct('hostSchedTitle')}</Button>
          </div>
        </CpCard>
      ) : null}
      {groups.map((group) => (
        <div key={group.divisionId}>
          {group.heading ? <h3 class="cp3-day">{group.heading}</h3> : null}
          {group.days.map((day) => (
            <div key={day.key}>
              <h4 class="cp3-day">{day.label}</h4>
              <CpCard>
                <ul class="cp3-ml">
                  {day.matches.map((match) => {
                    const actions = hostActions(match.status);
                    const badge = hostBadgeKey(match.status);
                    const reset = actions.includes('reset');
                    const rowActions = actions.filter((action) => action !== 'reset');
                    return (
                      <li class="cp3-m" key={match.id}>
                        <div class="cp3-m__top">
                          {match.kickoffAt == null ? (
                            <span class="cp3-m__when"><b>{ct('timeTbd')}</b></span>
                          ) : (
                            <span class="cp3-m__when">
                              <b>{formatKickoffClock(match.kickoffAt)}</b>
                              {match.venueName ? `　${match.venueName}` : ''}
                            </span>
                          )}
                          {badge && reset ? (
                            <span class="cp3-tags">
                              <Badge tone={badgeTone(badge)} label={statusText(ct, match.status)} size="sm" />
                              <Button variant="ghost" size="sm" disabled={busy} onClick={() => openReset(match)}>{ct('resetMatch')}</Button>
                            </span>
                          ) : null}
                          {badge && !reset ? <Badge tone={badgeTone(badge)} label={statusText(ct, match.status)} size="sm" /> : null}
                        </div>
                        <div class="cp3-m__vs">
                          <span class="h"><SideName entryId={match.home.teamId} name={match.home.name} crests={crests} align="home" /></span>
                          {(match.status === 'cancelled'
                            ? match.score.home !== 0 || match.score.away !== 0
                            : hostShowsScore(match.status)) ? (
                            <span class="s">{match.score.home}：{match.score.away}</span>
                          ) : (
                            <span class="s vs">vs</span>
                          )}
                          <span class="a"><SideName entryId={match.away.teamId} name={match.away.name} crests={crests} align="away" /></span>
                        </div>
                        {match.status === 'cancelled' && match.cancelReason ? (
                          <p class="cpm-reason"><b>{ct('reasonPrefix')}</b>　{match.cancelReason}</p>
                        ) : null}
                        {rowActions.length > 0 ? (
                          <div class="cp3-m__act">
                            {rowActions.map((action) => {
                              if (action === 'reschedule') {
                                return <Button key={action} variant="ghost" size="sm" disabled={busy} onClick={() => openReschedule(match)}>{ct('reschedTitle')}</Button>;
                              }
                              if (action === 'score') {
                                return <Button key={action} variant="secondary" size="sm" disabled={busy} onClick={() => openScore(match)}>{ct('enterScore')}</Button>;
                              }
                              if (action === 'cancel') {
                                return <Button key={action} variant="danger" size="sm" disabled={busy} onClick={() => openCancel(match)}>{ct('cancelMatch')}</Button>;
                              }
                              return <Button key={action} variant="primary" size="sm" disabled={busy} onClick={() => { void submitConfirm(match); }}>{ct('confirmMatch')}</Button>;
                            })}
                          </div>
                        ) : null}
                        {notice('confirm', match.id)}
                      </li>
                    );
                  })}
                </ul>
              </CpCard>
              <div style="height:12px" />
            </div>
          ))}
        </div>
      ))}
      {panel?.kind === 'score' && active ? (
        <BottomSheet open title={ct('scoreSheetTitle')} onClose={closePanel} busy={busy}>
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
          title={ct('cancelMatch')}
          onClose={closePanel}
          busy={busy}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" disabled={busy} onClick={closePanel}>{ct('cancel')}</Button>
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
            <p class="cpm-hint">{ct('cancelHint')}</p>
            {notice('cancel', panel.mtId)}
          </div>
        </BottomSheet>
      ) : null}
      {endOpen ? (
        <Modal
          open
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
            <p class="cpm-hint">{ct('endHint')}</p>
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
            <Checkbox
              label={ct('reschedTbd')}
              checked={panel.tbd}
              disabled={busy}
              onCheckedChange={(checked) => patchPanel({ tbd: checked })}
            />
            <div class="cps-grid2">
              <DateField
                id="cp-resched-date"
                label={ct('schedDate')}
                value={panel.date}
                disabled={panel.tbd}
                onValueChange={(value) => patchPanel({ date: value })}
              />
              <Input
                label={ct('reschedTime')}
                value={panel.time}
                disabled={panel.tbd}
                onValueChange={(value) => patchPanel({ time: value })}
              />
            </div>
            {comp.venues.length > 0 ? (
              <Select
                label={ct('venue')}
                value={panel.venueIdx}
                disabled={panel.tbd}
                onValueChange={(value) => patchPanel({ venueIdx: value })}
                options={comp.venues.map((venue, index) => ({
                  value: String(index),
                  label: venue.name || ct('venue'),
                }))}
              />
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
