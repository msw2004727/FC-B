import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import type { EntryDoc, MatchClock, MatchDoc, MatchSideName, RosterPublicDoc } from '../data/types';
import { CardFlash } from './CardFlash';
import {
  type LiveClock,
  type LiveLink,
  asPeriod,
  clockFromBase,
  formatMatchClock,
  recordMinute,
  stageLabel,
  undoClock,
} from './clock';
import { LIVE_COPY, offlineChip, offlineSaved, pauseRemain, pausedFor, restedFor, teamAction, undoWithin } from './copy';
import { EventSheet } from './EventSheet';
import { PlayerSheet } from './PlayerSheet';
import {
  EVENT_MAX,
  EVENT_RESERVE,
  EVENT_WARN,
  PAUSE_MAX,
  type FlashCard,
  type RecordAction,
  eventLines,
  findPlayer,
  flashForNewCard,
  flashFromCard,
  linkedSecondSeq,
  openYellowSeq,
  pauseHeldForScoring,
  recordIntent,
  seenCards,
  unappliedEntries,
} from './present';
import { TakeoverDialog } from './TakeoverDialog';
import { TeamLockup } from './TeamLockup';
import type { ActionLogEntry, GoalKind, TimelineEvent, VoidMark } from './types';
import { UnappliedSheet } from './UnappliedSheet';
import './live.css';

export interface ScorePick {
  side: MatchSideName;
  action: RecordAction;
  plId: string | null;
  goalKind: GoalKind | null;
  minute: number;
  /** 第二張黃牌指向的第一張黃牌。一般黃牌與直紅是 null。進球不帶這個欄。 */
  refSeq?: number | null;
}

export interface ScorePadProps {
  match: MatchDoc;
  homeRoster: readonly RosterPublicDoc[];
  awayRoster: readonly RosterPublicDoc[];
  events: readonly TimelineEvent[];
  voids: readonly VoidMark[];
  actionLog: readonly ActionLogEntry[];
  /** 沒傳就用 rev − resetRev。 */
  eventCount?: number;
  /** 這場已經按過幾次暫停。沒傳當 0，每場最多 PAUSE_MAX 次。 */
  pauseUses?: number;
  /** default：進球在上。thumb：紀錄在上、進球與牌集中在下半屏。 */
  layout?: 'default' | 'thumb';
  crests?: readonly EntryDoc[];
  link: LiveLink;
  clock: LiveClock;
  nowMs: number;
  takeoverOffered: boolean;
  onRecord?: (pick: ScorePick) => void | boolean;
  onUndo?: (seq: number) => void | boolean;
  /** 暫停／繼續只改 clockBase，不改狀態與比分。 */
  onClock?: (clockBase: MatchClock) => void;
  onKickoff?: () => void;
  onHalftime?: () => void;
  onFulltime?: () => void;
  onResume?: () => void;
  onUndoFulltime?: () => void;
  onCorrectClock?: () => void;
  onReapply?: (id: string) => void;
  onDiscard?: (id: string) => void;
  onTakeover?: () => void;
}

type Phase = 'pre' | 'play' | 'ht' | 'undo' | 'locked';

function phaseOf(match: MatchDoc, nowMs: number): Phase {
  if (match.status === 'scheduled' || match.status === 'postponed') return 'pre';
  if (match.status === 'halftime') return 'ht';
  if (match.status === 'finished') {
    return undoClock(match.finishedAt, nowMs) ? 'undo' : 'locked';
  }
  if (match.status === 'confirmed') return 'locked';
  return 'play';
}

function Mark({ kind, second }: { kind: 'goal' | 'yellow' | 'red'; second: boolean }): JSX.Element {
  const tone = kind === 'goal' ? 'goal' : second || kind === 'red' ? 'red' : 'yellow';
  return <i class={`s4-mark s4-mark--${tone}`} aria-hidden="true" />;
}

function shownText(line: { minute: string; team: string; number: number | null; name: string }): string {
  return line.number == null
    ? `${line.minute} ${line.team}`
    : `${line.minute} ${line.team} ${line.number} ${line.name}`;
}

export function ScorePad(props: ScorePadProps): JSX.Element {
  const {
    match, homeRoster, awayRoster, events, voids, actionLog, link, clock, nowMs, takeoverOffered,
    crests = [],
  } = props;
  const eventCount = props.eventCount ?? Math.max(0, match.rev - match.resetRev);
  const phase = phaseOf(match, nowMs);
  const reserved = eventCount >= EVENT_RESERVE;
  const atMax = eventCount >= EVENT_MAX;
  const nearCap = eventCount >= EVENT_WARN && eventCount < EVENT_RESERVE;
  const pauseBlocked = pauseHeldForScoring(eventCount);
  const goalOff = atMax || reserved || phase !== 'play';
  const cardOff = atMax || reserved || (phase !== 'play' && phase !== 'ht');
  const flowOff = atMax;

  const [clockBase, setClockBase] = useState(match.clockBase);
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    setClockBase(match.clockBase);
  }, [match.clockBase]);
  useEffect(() => {
    setNow(nowMs);
  }, [nowMs]);

  const reading = clockFromBase(clockBase, now);
  const period = asPeriod(reading.period);
  const holdLive = !clockBase.running && clockBase.startedAt != null && (phase === 'play' || phase === 'ht');
  useEffect(() => {
    if (!holdLive) return;
    const id = window.setInterval(() => {
      setNow((value) => value + 1000);
    }, 1000);
    return () => window.clearInterval(id);
  }, [holdLive]);

  const stageClock: LiveClock = {
    elapsedSec: reading.elapsedSec,
    period,
    addedMin: clock.addedMin,
    periodBaseMin: clock.periodBaseMin ?? null,
  };
  const showStage = phase === 'play' || phase === 'ht';
  const holdText = holdLive && reading.holdSec != null
    ? (phase === 'ht' ? restedFor(formatMatchClock(reading.holdSec)) : pausedFor(formatMatchClock(reading.holdSec)))
    : null;
  const showPause = phase === 'play' || phase === 'ht';
  const lines = eventLines({
    events,
    voids,
    homeName: match.home.name,
    awayName: match.away.name,
    homeRoster,
    awayRoster,
    hideVoided: false,
    order: 'recent',
  });
  const [pauseUses, setPauseUses] = useState(props.pauseUses ?? 0);
  useEffect(() => {
    setPauseUses(props.pauseUses ?? 0);
  }, [props.pauseUses]);
  const pauseLeft = Math.max(0, PAUSE_MAX - pauseUses);
  const [localLog, setLocalLog] = useState<ActionLogEntry[]>([]);
  const pending = unappliedEntries([...actionLog, ...localLog]);
  const cards = seenCards(events, voids, [...actionLog, ...localLog]);
  const remain = phase === 'undo' ? undoClock(match.finishedAt, nowMs) : null;

  const [picker, setPicker] = useState<{ side: MatchSideName; action: RecordAction } | null>(null);
  const [goalKind, setGoalKind] = useState<GoalKind>('normal');
  const [flash, setFlash] = useState<FlashCard | null>(null);
  const [unappliedOpen, setUnappliedOpen] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [eventSeq, setEventSeq] = useState<number | null>(null);
  const [amendKind, setAmendKind] = useState<GoalKind>('normal');
  const [amendCard, setAmendCard] = useState<'yellow' | 'red'>('yellow');
  const [amendPl, setAmendPl] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<{ first: number; second: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  function rememberFocus(): void {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function closeFlash(): void {
    setFlash(null);
    const back = restoreFocus.current;
    restoreFocus.current = null;
    queueMicrotask(() => {
      if (back?.isConnected) back.focus();
    });
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  function openPicker(side: MatchSideName, action: RecordAction): void {
    if (action === 'goal' ? goalOff : cardOff) return;
    rememberFocus();
    setGoalKind('normal');
    setPicker({ side, action });
    setMenuOpen(false);
  }

  function choose(plId: string | null): void {
    if (!picker) return;
    const minute = recordMinute(reading.elapsedSec);
    if (picker.action === 'goal') {
      props.onRecord?.({
        side: picker.side,
        action: 'goal',
        plId,
        goalKind,
        minute,
      });
    } else {
      const player = plId ? findPlayer(homeRoster, awayRoster, plId) : undefined;
      const flashCard = flashForNewCard(picker.action, player, events, voids, [...actionLog, ...localLog]);
      props.onRecord?.({
        side: picker.side,
        action: picker.action,
        plId,
        goalKind: null,
        minute,
        refSeq: flashCard.refSeq,
      });
      if (plId) setFlash(flashCard);
    }
    setPicker(null);
  }

  function togglePause(): void {
    if (flowOff) return;
    if (clockBase.running && (pauseBlocked || pauseUses >= PAUSE_MAX)) return;
    const elapsed = Math.floor(clockFromBase(clockBase, now).elapsedSec);
    const next: MatchClock = {
      ...clockBase,
      running: !clockBase.running,
      startedAt: now,
      pausedSec: elapsed,
    };
    if (clockBase.running) setPauseUses((value) => value + 1);
    setClockBase(next);
    props.onClock?.(next);
  }

  function openEvent(seq: number): void {
    const event = events.find((item) => item.seq === seq);
    if (!event || (event.type !== 'goal' && event.type !== 'card')) return;
    if (event.type === 'goal') {
      setAmendKind(event.goalKind);
      setAmendPl(event.plId ?? null);
    } else {
      setAmendCard(event.cardType === 'yellow' ? 'yellow' : 'red');
      setAmendPl(event.plId);
    }
    setEventSeq(seq);
    setMenuOpen(false);
  }

  const openLine = lines.find((line) => line.seq === eventSeq) ?? null;
  const openEventDoc = events.find((item) => item.seq === eventSeq) ?? null;

  function undoSeq(seq: number): void {
    if (reserved) return;
    const second = linkedSecondSeq(cards, seq);
    if (second != null) {
      setConfirmUndo({ first: seq, second });
      return;
    }
    props.onUndo?.(seq);
    setEventSeq(null);
  }

  function runConfirmUndo(): void {
    if (!confirmUndo) return;
    const { first, second } = confirmUndo;
    const secondOk = props.onUndo?.(second) !== false;
    if (!secondOk) {
      setConfirmUndo(null);
      return;
    }
    const firstOk = props.onUndo?.(first) !== false;
    setConfirmUndo(null);
    setEventSeq(null);
    if (!firstOk) setNotice(LIVE_COPY.undoHalf);
  }

  function submitAmend(): void {
    if (!openEventDoc || reserved) return;
    if (openEventDoc.type !== 'goal' && openEventDoc.type !== 'card') return;
    const minute = Math.floor(openEventDoc.matchSecond / 60);
    const side = openEventDoc.side;
    const team = side === 'home' ? match.home.name : match.away.name;
    let pick: ScorePick;
    if (openEventDoc.type === 'goal') {
      pick = { side, action: 'goal', plId: amendPl, goalKind: amendKind, minute };
    } else {
      if (amendPl == null) return;
      const refSeq = amendCard === 'yellow' ? openYellowSeq(cards, amendPl, openEventDoc.seq) : null;
      pick = {
        side,
        action: amendCard === 'yellow' ? 'yellow' : 'red',
        plId: amendPl,
        goalKind: null,
        minute,
        refSeq,
      };
    }
    const voidOk = props.onUndo?.(openEventDoc.seq) !== false;
    if (!voidOk) return;
    const recorded = props.onRecord?.(pick) !== false;
    if (!recorded) {
      const player = findPlayer(homeRoster, awayRoster, pick.plId ?? undefined);
      setNotice(LIVE_COPY.amendHalf);
      setLocalLog((rows) => [
        ...rows,
        {
          id: `amend-${openEventDoc.seq}`,
          intent: recordIntent(team, pick, player),
          state: 'pending',
          at: now,
          card: pick.action !== 'goal' && pick.plId
            ? {
              plId: pick.plId,
              cardType: pick.refSeq != null ? 'second_yellow' : pick.action === 'yellow' ? 'yellow' : 'red',
              seq: match.rev + rows.length + 1,
              refSeq: pick.refSeq ?? undefined,
            }
            : undefined,
        },
      ]);
    }
    setEventSeq(null);
  }

  function showOpenCard(): void {
    if (!openEventDoc || openEventDoc.type !== 'card') return;
    rememberFocus();
    setFlash(flashFromCard(openEventDoc.cardType, findPlayer(homeRoster, awayRoster, openEventDoc.plId)));
  }

  const pickerRoster = picker?.side === 'away' ? awayRoster : homeRoster;
  const pickerTeam = picker?.side === 'away' ? match.away.name : match.home.name;
  const amendRoster = openEventDoc && 'side' in openEventDoc && openEventDoc.side === 'away' ? awayRoster : homeRoster;
  const pauseDisabled = flowOff || (clockBase.running && (pauseBlocked || pauseUses >= PAUSE_MAX));
  const showCtrl = phase === 'pre' || phase === 'play' || phase === 'ht';
  const thumb = props.layout === 'thumb';

  const alerts: JSX.Element[] = [];
  if (pauseBlocked) {
    alerts.push(<p key="pause" class="s4-banner s4-banner--saved" role="status">{LIVE_COPY.pauseReserved}</p>);
  }
  if (nearCap) alerts.push(<p key="near" class="s4-banner s4-banner--saved" role="status">{LIVE_COPY.nearCap}</p>);
  if (reserved) alerts.push(<p key="cap" class="s4-banner s4-banner--saved" role="status">{LIVE_COPY.atCap}</p>);
  if (notice) alerts.push(<p key="notice" class="s4-banner s4-banner--saved" role="alert">{notice}</p>);
  if (!link.online && link.storageUnavailable) {
    alerts.push(<p key="off" class="s4-banner s4-banner--danger" role="alert">{LIVE_COPY.offlineUnstored}</p>);
  } else if (!link.online) {
    alerts.push(<p key="saved" class="s4-banner s4-banner--saved" role="status">{offlineSaved(link.pendingCount)}</p>);
  }
  if (!link.wakeLock) alerts.push(<p key="wake" class="s4-wake">{LIVE_COPY.wakeLock}</p>);

  const top = (
    <header key="top" class="s4-top">
      <div class="s4-board">
        <TeamLockup entryId={match.home.teamId} name={match.home.name} crests={crests} align="home" place="board" />
        <span class="s4-score">{match.score.home}:{match.score.away}</span>
        <TeamLockup entryId={match.away.teamId} name={match.away.name} crests={crests} align="away" place="board" />
      </div>
      <div class="s4-clockrow">
        <span class="s4-clock">{formatMatchClock(reading.elapsedSec)}</span>
        {showStage ? <span class="s4-stage">{stageLabel(stageClock)}</span> : null}
        <Badge
          size="sm"
          tone={link.online ? 'success' : 'warning'}
          label={link.online ? LIVE_COPY.connected : offlineChip(link.pendingCount)}
        />
      </div>
      {holdText ? <p class="s4-hold">{holdText}</p> : null}
    </header>
  );

  const goals = (
    <div key="goals" class="s4-goals">
      <Hit team={match.home.name} action="goal" tone="home" disabled={goalOff} onClick={() => openPicker('home', 'goal')} />
      <Hit team={match.away.name} action="goal" tone="away" disabled={goalOff} onClick={() => openPicker('away', 'goal')} />
    </div>
  );

  const cardRow = (
    <div key="cards" class="s4-cards">
      <div class="s4-cardpair">
        <Hit team={match.home.name} action="yellow" tone="yellow" disabled={cardOff} onClick={() => openPicker('home', 'yellow')} />
        <Hit team={match.home.name} action="red" tone="red" disabled={cardOff} onClick={() => openPicker('home', 'red')} />
      </div>
      <div class="s4-cardpair">
        <Hit team={match.away.name} action="yellow" tone="yellow" disabled={cardOff} onClick={() => openPicker('away', 'yellow')} />
        <Hit team={match.away.name} action="red" tone="red" disabled={cardOff} onClick={() => openPicker('away', 'red')} />
      </div>
    </div>
  );

  const log = (
    <div key="log" class="s4-feed">
      {lines.length > 0 ? (
        <ul class="s4-events">
          {lines.map((line) => (
            <li key={line.seq} class={line.voided ? 's4-ev s4-ev--void' : 's4-ev'}>
              <Mark kind={line.kind} second={line.secondYellow} />
              {line.voided ? (
                <>
                  <div class="s4-ev__main">{shownText(line)}</div>
                  <span class="s4-sr">{line.label}</span>
                </>
              ) : (
                <button
                  type="button"
                  class="s4-ev__main"
                  aria-label={line.label}
                  onClick={() => openEvent(line.seq)}
                >
                  {shownText(line)}
                </button>
              )}
              {line.voided ? <span class="s4-ev__tag">{LIVE_COPY.undone}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {pending.length > 0 || takeoverOffered ? (
        <div class="s4-extra">
          {pending.length > 0 ? (
            <Button variant="secondary" onClick={() => setUnappliedOpen(true)}>{LIVE_COPY.unappliedTitle}</Button>
          ) : null}
          {takeoverOffered ? (
            <Button variant="secondary" onClick={() => setTakeoverOpen(true)}>{LIVE_COPY.takeoverEntry}</Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const bar = (
    <div key="bar" class="s4-dock">
      {phase === 'undo' && remain ? (
        <div class="s4-sent">
          <p class="s4-sent__st">{LIVE_COPY.fulltimeSent}</p>
          <p class="s4-sent__cd">{undoWithin(remain)}</p>
          <Button variant="danger" disabled={flowOff} onClick={() => props.onUndoFulltime?.()}>{LIVE_COPY.undoFulltime}</Button>
        </div>
      ) : null}
      {showCtrl ? (
        <div class="s4-ctrl">
          {phase === 'pre' ? (
            <Button disabled={flowOff} onClick={() => props.onKickoff?.()}>{LIVE_COPY.kickoff}</Button>
          ) : null}
          {phase === 'play' ? (
            <Button variant="secondary" disabled={flowOff} onClick={() => props.onHalftime?.()}>{LIVE_COPY.halftime}</Button>
          ) : null}
          {phase === 'ht' ? (
            <Button disabled={flowOff} onClick={() => props.onResume?.()}>{LIVE_COPY.resume}</Button>
          ) : null}
          {showPause ? (
            <Button variant="secondary" disabled={pauseDisabled} onClick={togglePause}>
              {clockBase.running ? pauseRemain(pauseLeft) : LIVE_COPY.resumeClock}
            </Button>
          ) : null}
          <div class="s4-menu-wrap">
            <Button
              class="s4-menu-btn"
              variant="ghost"
              disabled={flowOff}
              aria-expanded={menuOpen}
              aria-controls="s4-clock-menu"
              aria-label={LIVE_COPY.matchMenu}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {LIVE_COPY.matchMenu}
            </Button>
            {menuOpen ? (
              <div id="s4-clock-menu" class="s4-menu">
                <Button
                  variant="ghost"
                  disabled={reserved}
                  onClick={() => {
                    setMenuOpen(false);
                    props.onCorrectClock?.();
                  }}
                >
                  {LIVE_COPY.correctClock}
                </Button>
              </div>
            ) : null}
          </div>
          {phase === 'play' ? <span class="s4-ctrl__gap" aria-hidden="true" /> : null}
          {phase === 'play' ? (
            <Button class="s4-end" variant="danger" disabled={flowOff} onClick={() => props.onFulltime?.()}>{LIVE_COPY.fulltime}</Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const alertBlock = alerts.length > 0 ? <div key="alerts" class="s4-alerts">{alerts}</div> : null;
  const parts = thumb
    ? [top, alertBlock, log, goals, cardRow, bar]
    : [top, alertBlock, goals, cardRow, log, bar];

  return (
    <section class={thumb ? 's4-root s4-root--thumb' : 's4-root'}>
      {parts}

      {picker ? (
        <PlayerSheet
          open
          teamName={pickerTeam}
          action={picker.action}
          minute={recordMinute(reading.elapsedSec)}
          roster={pickerRoster}
          goalKind={goalKind}
          onGoalKind={setGoalKind}
          onPick={choose}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {openLine && openEventDoc && (openEventDoc.type === 'goal' || openEventDoc.type === 'card') ? (
        <EventSheet
          summary={openLine.label}
          label={openLine.label}
          kind={openEventDoc.type === 'goal' ? 'goal' : 'card'}
          roster={amendRoster}
          goalKind={amendKind}
          cardChoice={amendCard}
          playerId={amendPl}
          blocked={reserved}
          onGoalKind={setAmendKind}
          onCardChoice={setAmendCard}
          onPlayer={setAmendPl}
          onUnspecified={() => setAmendPl(null)}
          onUndo={() => undoSeq(openLine.seq)}
          onAmend={submitAmend}
          onShowCard={showOpenCard}
          onClose={() => setEventSeq(null)}
        />
      ) : null}
      {confirmUndo ? (
        <Modal
          open
          class="s4-dialog"
          title={LIVE_COPY.undo}
          onClose={() => setConfirmUndo(null)}
          footer={(
            <>
              <Button onClick={runConfirmUndo}>{LIVE_COPY.undoBothConfirm}</Button>
              <Button variant="secondary" onClick={() => setConfirmUndo(null)}>{LIVE_COPY.takeoverLater}</Button>
            </>
          )}
        >
          <p class="s4-note">{LIVE_COPY.undoBoth}</p>
        </Modal>
      ) : null}
      {flash ? <CardFlash {...flash} onClose={closeFlash} /> : null}
      <UnappliedSheet
        open={unappliedOpen}
        entries={pending}
        onReapply={(id) => props.onReapply?.(id)}
        onDiscard={(id) => props.onDiscard?.(id)}
        onClose={() => setUnappliedOpen(false)}
      />
      <TakeoverDialog
        open={takeoverOpen}
        onTakeover={() => {
          setTakeoverOpen(false);
          props.onTakeover?.();
        }}
        onClose={() => setTakeoverOpen(false)}
      />
    </section>
  );
}

function Hit({
  team,
  action,
  tone,
  disabled,
  onClick,
}: {
  team: string;
  action: RecordAction;
  tone: 'home' | 'away' | 'yellow' | 'red';
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  const label = action === 'goal' ? LIVE_COPY.goal : action === 'yellow' ? LIVE_COPY.yellow : LIVE_COPY.red;
  const kind = action === 'goal' ? 's4-hit--goal' : 's4-hit--card';
  return (
    <button
      type="button"
      class={`s4-hit ${kind} s4-hit--${tone}`}
      disabled={disabled}
      aria-disabled={disabled ? 'true' : undefined}
      aria-label={teamAction(team, label)}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
