import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import type { MatchDoc, MatchSideName, RosterPublicDoc } from '../data/types';
import type { ActionLogEntry, GoalKind, TimelineEvent, VoidMark } from '../testing/step4-fixtures';
import { CardFlash } from './CardFlash';
import {
  type LiveClock,
  type LiveLink,
  formatMatchClock,
  recordMinute,
  stageLabel,
  undoClock,
} from './clock';
import { LIVE_COPY, offlineChip, offlineSaved, teamAction, undoWithin } from './copy';
import { PlayerSheet } from './PlayerSheet';
import {
  type FlashCard,
  type RecordAction,
  eventLines,
  findPlayer,
  flashForNewCard,
  flashFromCard,
  unappliedEntries,
} from './present';
import { TakeoverDialog } from './TakeoverDialog';
import { UnappliedSheet } from './UnappliedSheet';
import './live.css';

export interface ScorePick {
  side: MatchSideName;
  action: RecordAction;
  plId: string | null;
  goalKind: GoalKind | null;
  minute: number;
}

export interface ScorePadProps {
  match: MatchDoc;
  homeRoster: readonly RosterPublicDoc[];
  awayRoster: readonly RosterPublicDoc[];
  events: readonly TimelineEvent[];
  voids: readonly VoidMark[];
  actionLog: readonly ActionLogEntry[];
  link: LiveLink;
  clock: LiveClock;
  nowMs: number;
  takeoverOffered: boolean;
  onRecord?: (pick: ScorePick) => void;
  onUndo?: (seq: number) => void;
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
  if (match.status === 'finished' || match.status === 'confirmed') {
    return undoClock(match.finishedAt, nowMs) ? 'undo' : 'locked';
  }
  return 'play';
}

function Mark({ kind, second }: { kind: 'goal' | 'yellow' | 'red'; second: boolean }): JSX.Element {
  const tone = kind === 'goal' ? 'goal' : second || kind === 'red' ? 'red' : 'yellow';
  return <i class={`s4-mark s4-mark--${tone}`} aria-hidden="true" />;
}

export function ScorePad(props: ScorePadProps): JSX.Element {
  const {
    match, homeRoster, awayRoster, events, voids, actionLog, link, clock, nowMs, takeoverOffered,
  } = props;
  const phase = phaseOf(match, nowMs);
  const canRecord = phase === 'play' || phase === 'ht';
  const showStage = phase === 'play' || phase === 'ht';
  const lines = eventLines({
    events,
    voids,
    homeName: match.home.name,
    awayName: match.away.name,
    homeRoster,
    awayRoster,
    hideVoided: false,
    limit: 5,
  });
  const pending = unappliedEntries(actionLog);
  const remain = phase === 'undo' ? undoClock(match.finishedAt, nowMs) : null;

  const [picker, setPicker] = useState<{ side: MatchSideName; action: RecordAction } | null>(null);
  const [goalKind, setGoalKind] = useState<GoalKind>('normal');
  const [flash, setFlash] = useState<FlashCard | null>(null);
  const [unappliedOpen, setUnappliedOpen] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  function openPicker(side: MatchSideName, action: RecordAction): void {
    if (!canRecord) return;
    setGoalKind('normal');
    setPicker({ side, action });
    setMenuOpen(false);
  }

  function choose(plId: string | null): void {
    if (!picker) return;
    const minute = recordMinute(clock.elapsedSec);
    props.onRecord?.({
      side: picker.side,
      action: picker.action,
      plId,
      goalKind: picker.action === 'goal' ? goalKind : null,
      minute,
    });
    if (picker.action !== 'goal' && plId) {
      const player = findPlayer(homeRoster, awayRoster, plId);
      setFlash(flashForNewCard(picker.action, player, events, voids));
    }
    setPicker(null);
  }

  function showExisting(seq: number): void {
    const event = events.find((item) => item.seq === seq);
    if (!event || event.type !== 'card') return;
    setFlash(flashFromCard(event.cardType, findPlayer(homeRoster, awayRoster, event.plId)));
  }

  const pickerRoster = picker?.side === 'away' ? awayRoster : homeRoster;
  const pickerTeam = picker?.side === 'away' ? match.away.name : match.home.name;

  return (
    <section class="s4-root">
      <header>
        <div class="s4-board">
          <span class="s4-team">{match.home.name}</span>
          <span class="s4-score">{match.score.home}:{match.score.away}</span>
          <span class="s4-team s4-team--away">{match.away.name}</span>
        </div>
        <div class="s4-clockrow">
          <span class="s4-clock">{formatMatchClock(clock.elapsedSec)}</span>
          {showStage ? <span class="s4-stage">{stageLabel(clock)}</span> : null}
        </div>
        <div class="s4-meta">
          <Badge
            size="sm"
            tone={link.online ? 'success' : 'warning'}
            label={link.online ? LIVE_COPY.connected : offlineChip(link.pendingCount)}
          />
        </div>
      </header>

      {!link.online && link.storageUnavailable ? (
        <p class="s4-banner s4-banner--danger" role="alert">{LIVE_COPY.offlineUnstored}</p>
      ) : null}
      {!link.online && !link.storageUnavailable ? (
        <p class="s4-banner s4-banner--saved" role="status">{offlineSaved(link.pendingCount)}</p>
      ) : null}
      {!link.wakeLock ? <p class="s4-wake">{LIVE_COPY.wakeLock}</p> : null}

      <div class="s4-pitch">
        <TeamColumn
          side="home"
          team={match.home.name}
          disabled={!canRecord}
          onAction={openPicker}
        />
        <TeamColumn
          side="away"
          team={match.away.name}
          disabled={!canRecord}
          onAction={openPicker}
        />
      </div>

      {lines.length > 0 ? (
        <ul class="s4-events">
          {lines.map((line) => {
            const shown = line.number == null
              ? `${line.minute} ${line.team}`
              : `${line.minute} ${line.team} ${line.number} ${line.name}`;
            return (
              <li key={line.seq} class={line.voided ? 's4-ev s4-ev--void' : 's4-ev'}>
                <Mark kind={line.kind} second={line.secondYellow} />
                {line.showLabel ? (
                  <button type="button" class="s4-ev__main" aria-label={line.showLabel} onClick={() => showExisting(line.seq)}>
                    {shown}
                  </button>
                ) : (
                  <div class="s4-ev__main">{shown}</div>
                )}
                {line.voided ? <span class="s4-ev__tag">{LIVE_COPY.undone}</span> : null}
                {!line.voided && (line.kind === 'goal' || line.kind === 'yellow' || line.kind === 'red') ? (
                  <Button variant="ghost" size="sm" onClick={() => props.onUndo?.(line.seq)}>{LIVE_COPY.undo}</Button>
                ) : null}
              </li>
            );
          })}
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

      {phase === 'undo' && remain ? (
        <div class="s4-sent">
          <p class="s4-sent__st">{LIVE_COPY.fulltimeSent}</p>
          <p class="s4-sent__cd">{undoWithin(remain)}</p>
          <Button variant="danger" onClick={() => props.onUndoFulltime?.()}>{LIVE_COPY.undoFulltime}</Button>
        </div>
      ) : null}

      {phase === 'pre' || phase === 'play' || phase === 'ht' ? (
        <div class="s4-ctrl">
          {phase === 'pre' ? (
            <Button size="lg" onClick={() => props.onKickoff?.()}>{LIVE_COPY.kickoff}</Button>
          ) : null}
          {phase === 'play' ? (
            <Button variant="secondary" onClick={() => props.onHalftime?.()}>{LIVE_COPY.halftime}</Button>
          ) : null}
          {phase === 'play' ? (
            <Button variant="danger" onClick={() => props.onFulltime?.()}>{LIVE_COPY.fulltime}</Button>
          ) : null}
          {phase === 'ht' ? (
            <Button size="lg" onClick={() => props.onResume?.()}>{LIVE_COPY.resume}</Button>
          ) : null}
          <div class="s4-menu-wrap">
            <Button
              class="s4-menu-btn"
              variant="ghost"
              aria-expanded={menuOpen}
              aria-label={LIVE_COPY.matchMenu}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {LIVE_COPY.matchMenu}
            </Button>
            {menuOpen ? (
              <div class="s4-menu" role="menu">
                <Button
                  variant="ghost"
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
        </div>
      ) : null}

      {picker ? (
        <PlayerSheet
          open
          teamName={pickerTeam}
          action={picker.action}
          minute={recordMinute(clock.elapsedSec)}
          roster={pickerRoster}
          goalKind={goalKind}
          onGoalKind={setGoalKind}
          onPick={choose}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {flash ? <CardFlash {...flash} onClose={() => setFlash(null)} /> : null}
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

function TeamColumn({
  side,
  team,
  disabled,
  onAction,
}: {
  side: MatchSideName;
  team: string;
  disabled: boolean;
  onAction: (side: MatchSideName, action: RecordAction) => void;
}): JSX.Element {
  return (
    <div class={side === 'home' ? 's4-col s4-col--home' : 's4-col s4-col--away'}>
      <span class="s4-col__name">{team}</span>
      <button
        type="button"
        class="s4-hit s4-hit--goal"
        disabled={disabled}
        aria-label={teamAction(team, LIVE_COPY.goal)}
        onClick={() => onAction(side, 'goal')}
      >
        {LIVE_COPY.goal}
      </button>
      <div class="s4-cardrow">
        <button
          type="button"
          class="s4-hit s4-hit--card s4-hit--yellow"
          disabled={disabled}
          aria-label={teamAction(team, LIVE_COPY.yellow)}
          onClick={() => onAction(side, 'yellow')}
        >
          {LIVE_COPY.yellow}
        </button>
        <button
          type="button"
          class="s4-hit s4-hit--card s4-hit--red"
          disabled={disabled}
          aria-label={teamAction(team, LIVE_COPY.red)}
          onClick={() => onAction(side, 'red')}
        >
          {LIVE_COPY.red}
        </button>
      </div>
    </div>
  );
}
