import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Badge } from '@/ui/Badge';
import { BottomSheet } from '@/ui/BottomSheet';
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
import {
  LIVE_COPY,
  offlineChip,
  offlineSaved,
  pauseRemain,
  pausedFor,
  pkKickLine,
  pkScoreLabel,
  restedFor,
  teamAction,
  teamTimeoutText,
  timeoutClock,
  timeoutTeamChoice,
  undoWithin,
} from './copy';
import { EventSheet } from './EventSheet';
import { PendingTag, PkConfirmDialog } from './score-states';
import { PlayerSheet } from './PlayerSheet';
import {
  EVENT_MAX,
  EVENT_RESERVE,
  EVENT_WARN,
  PAUSE_MAX,
  TEAM_TIMEOUT_PER_HALF,
  TEAM_TIMEOUT_SEC,
  type FlashCard,
  type RecordAction,
  eventLines,
  findPlayer,
  flashForNewCard,
  flashFromCard,
  linkedSecondSeq,
  nextPkRound,
  openYellowSeq,
  pauseHeldForScoring,
  pkScore,
  recordIntent,
  seenCards,
  shootoutOffered,
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
  /** 改判沿用原事件的比賽秒，含不足 1 分鐘的餘秒。新記的不帶。 */
  matchSecond?: number;
  /** PK 這一腳是該隊第幾輪。 */
  round?: number;
}

/** 預覽用：進來時倒數已經在走。正式操作從選單「球隊暫停」開始。 */
export interface TimeoutView {
  side: MatchSideName;
  leftSec: number;
  collapsed?: boolean;
  over?: boolean;
  /** 這次暫停的事件時間。正式頁用來對上同一段倒數。 */
  startedAt?: number;
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
  /** 這場已經按過幾次停錶。沒傳當 0，每場最多 PAUSE_MAX 次。 */
  pauseUses?: number;
  /** 截圖：倒數進行到這一秒。不從選單點。 */
  timeoutView?: TimeoutView;
  crests?: readonly EntryDoc[];
  link: LiveLink;
  clock: LiveClock;
  nowMs: number;
  takeoverOffered: boolean;
  /** 沒有本機 sid、控制權不是別人時，按鈕寫「接手記分」。沒傳沿用「其他裝置記分中」。 */
  takeoverSelf?: boolean;
  onRecord?: (pick: ScorePick) => void | boolean;
  onUndo?: (seq: number) => void | boolean;
  /** 停錶／繼續只改 clockBase，不改狀態與比分。 */
  onClock?: (clockBase: MatchClock) => void;
  onKickoff?: () => void;
  onHalftime?: () => void;
  onFulltime?: () => void;
  onResume?: () => void;
  onUndoFulltime?: () => void;
  onCorrectClock?: () => void;
  /** 下半場或延長結束且平手時，按下「PK 大戰」。不在這裡改節次。 */
  onStartPk?: () => void;
  onReapply?: (id: string) => void;
  onDiscard?: (id: string) => void;
  onTakeover?: () => void;
  /** 正式頁：比賽選單最後一項。沒傳不顯示，預覽選單維持原樣。 */
  onLeave?: () => void;
  /** 正式頁：全部記分按鈕停用。預設不關。 */
  scoringDisabled?: boolean;
  /** 正式頁：分頁提示。預設不顯示。 */
  topBanner?: string | null;
  /** 正式頁：儲存不可用時也顯示既有警告，即使目前有網路。 */
  storageBanner?: boolean;
  /** 正式頁：時鐘只回呼，不改記分板自己的預覽時鐘。 */
  clockControlled?: boolean;
  /** 正式頁：球隊暫停只回呼，不跑預覽倒數。 */
  timeoutControlled?: boolean;
  onTimeout?: (side: MatchSideName) => void;
  /** 有傳才改次數判斷。沒傳維持預覽的每半場 1 次。 */
  timeoutRule?: { enabled: boolean; per: 'half' | 'match'; count: number; seconds: number; stopsClock: boolean };
  timeoutUses?: { home: number; away: number };
  /** 有傳就取代 shootoutOffered。沒傳維持預覽。 */
  pkCanStart?: boolean;
  /** 正式頁先開確認框。預設按了就送。 */
  confirmPk?: boolean;
  /** PK 開始後，一般進球的復原與改判停用。 */
  lockRegularGoals?: boolean;
  /** 疊加狀態是中場：點開進球只能復原，不能改判。沒傳不鎖。 */
  halftimeGoalUndoOnly?: boolean;
  /** 正式頁的事件列（含待送）。沒傳就用 events 畫預覽列。 */
  feed?: readonly ScoreFeedRow[];
  /** 正式頁的 PK 比分（含還沒落地的腳）。沒傳就從 events 算。 */
  pkDigits?: { home: number; away: number } | null;
}

export interface ScoreFeedRow {
  key: string;
  seq: number;
  pending: boolean;
  text: string;
  label: string;
  kind: 'goal' | 'yellow' | 'red' | 'pk';
  secondYellow: boolean;
  pkScored?: boolean;
  voided: boolean;
}

type Phase = 'pre' | 'play' | 'ht' | 'undo' | 'locked';

interface TeamTimeoutState {
  side: MatchSideName;
  leftSec: number;
  collapsed: boolean;
  over: boolean;
  done: boolean;
  /** 正式頁這段倒數的事件時間。預覽本機倒數沒有。 */
  startedAt?: number;
}

interface TimeoutUses {
  period: string;
  home: number;
  away: number;
}

type ConfirmPair =
  | { mode: 'undo'; first: number; second: number }
  | { mode: 'amend'; first: number; second: number; pick: ScorePick };

function phaseOf(match: MatchDoc, nowMs: number): Phase {
  if (match.status === 'scheduled' || match.status === 'postponed') return 'pre';
  if (match.status === 'halftime') return 'ht';
  if (match.status === 'finished') {
    return undoClock(match.finishedAt, nowMs) ? 'undo' : 'locked';
  }
  if (match.status === 'confirmed') return 'locked';
  return 'play';
}

function previewTimeout(view: TimeoutView | undefined): TeamTimeoutState | null {
  if (!view) return null;
  return {
    side: view.side,
    leftSec: Math.max(0, view.leftSec),
    collapsed: view.collapsed ?? false,
    over: view.over ?? false,
    done: view.leftSec <= 0,
    ...(view.startedAt != null ? { startedAt: view.startedAt } : {}),
  };
}

function sameTimeout(current: TeamTimeoutState, next: TeamTimeoutState): boolean {
  return current.side === next.side
    && current.leftSec === next.leftSec
    && current.collapsed === next.collapsed
    && current.over === next.over
    && current.done === next.done
    && current.startedAt === next.startedAt;
}

/** 正式頁倒數只跟著 timeoutView。收合留在同一段；走完後留到按結束暫停。 */
function controlledTimeout(
  current: TeamTimeoutState | null,
  view: TimeoutView | undefined,
  hiddenStart: number | null,
): TeamTimeoutState | null {
  if (view?.startedAt != null && view.startedAt === hiddenStart) return null;
  if (!view) {
    if (current?.startedAt == null) return null;
    if (current.startedAt === hiddenStart) return null;
    if (current.done && current.leftSec === 0) return current;
    return { ...current, leftSec: 0, done: true };
  }
  const next: TeamTimeoutState = {
    side: view.side,
    leftSec: Math.max(0, view.leftSec),
    collapsed: current != null && current.startedAt === view.startedAt ? current.collapsed : (view.collapsed ?? false),
    over: view.over ?? false,
    done: view.leftSec <= 0,
    ...(view.startedAt != null ? { startedAt: view.startedAt } : {}),
  };
  if (current && sameTimeout(current, next)) return current;
  return next;
}

function Mark({
  kind,
  second,
  scored,
}: {
  kind: 'goal' | 'yellow' | 'red' | 'pk';
  second: boolean;
  scored?: boolean;
}): JSX.Element {
  if (kind === 'pk') {
    return <i class={scored ? 's4-mark s4-mark--goal' : 's4-mark s4-mark--miss'} aria-hidden="true" />;
  }
  const tone = kind === 'goal' ? 'goal' : second || kind === 'red' ? 'red' : 'yellow';
  return <i class={`s4-mark s4-mark--${tone}`} aria-hidden="true" />;
}

function shownText(line: {
  minute: string;
  team: string;
  number: number | null;
  name: string;
  pkRound?: number;
  pkScored?: boolean;
}): string {
  if (line.pkRound != null) {
    const who = line.number == null ? LIVE_COPY.unspecified : `${line.number} ${line.name}`;
    return pkKickLine(line.pkRound, line.team, who, line.pkScored === true);
  }
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
  const readerOff = props.scoringDisabled === true;
  // 需要接手時，記分與比賽控制比照讀分頁停用。接手鈕不跟這批一起關。
  const padOff = readerOff || takeoverOffered;
  const goalOff = padOff || atMax || reserved || phase !== 'play';
  const cardOff = padOff || atMax || reserved || (phase !== 'play' && phase !== 'ht');
  const flowOff = padOff || atMax;
  const phaseOpen = phase === 'play' || phase === 'ht';
  /** 190 起或不是進行中／中場，復原與改判都不可按。 */
  const blocked = reserved || !phaseOpen;

  const [clockBase, setClockBase] = useState(match.clockBase);
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    setClockBase(match.clockBase);
  }, [match.clockBase]);
  useEffect(() => {
    setNow(nowMs);
  }, [nowMs]);

  const reading = clockFromBase(clockBase, now);
  const rawPeriod = reading.period;
  const pk = rawPeriod === 'pk';
  const offered = shootoutOffered({
    live: phase === 'play',
    running: clockBase.running,
    period: rawPeriod,
    home: match.score.home,
    away: match.score.away,
  });
  const pkReady = props.pkCanStart == null ? offered : props.pkCanStart;
  const period = rawPeriod === 'pk' ? 'pk' : asPeriod(rawPeriod);
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
  const showPause = phase === 'play' && !pk && !pkReady;
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
  const shoot = props.pkDigits ?? pkScore(events, voids);
  const [pkConfirm, setPkConfirm] = useState(false);

  const [picker, setPicker] = useState<{ side: MatchSideName; action: RecordAction } | null>(null);
  const [goalKind, setGoalKind] = useState<GoalKind>('normal');
  const [flash, setFlash] = useState<FlashCard | null>(null);
  const [unappliedOpen, setUnappliedOpen] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [timeoutOpen, setTimeoutOpen] = useState(false);
  const [teamTimeout, setTeamTimeout] = useState<TeamTimeoutState | null>(() => previewTimeout(props.timeoutView));
  const [hiddenStart, setHiddenStart] = useState<number | null>(null);
  const [timeoutUses, setTimeoutUses] = useState<TimeoutUses>({
    period: match.clockBase.period,
    home: 0,
    away: 0,
  });
  const [eventSeq, setEventSeq] = useState<number | null>(null);
  const [amendKind, setAmendKind] = useState<GoalKind>('normal');
  const [amendCard, setAmendCard] = useState<'yellow' | 'red'>('yellow');
  const [amendPl, setAmendPl] = useState<string | null>(null);
  const [confirmPair, setConfirmPair] = useState<ConfirmPair | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (props.timeoutControlled !== true) return;
    const view = props.timeoutView;
    setTeamTimeout((current) => controlledTimeout(current, view, hiddenStart));
  }, [props.timeoutControlled, props.timeoutView, hiddenStart]);
  const timeoutLive = teamTimeout != null && !teamTimeout.done && props.timeoutControlled !== true;

  useEffect(() => {
    setTimeoutUses((prev) => (
      prev.period === clockBase.period ? prev : { period: clockBase.period, home: 0, away: 0 }
    ));
  }, [clockBase.period]);

  useEffect(() => {
    if (!timeoutLive) return;
    const id = window.setInterval(() => {
      setTeamTimeout((current) => {
        if (!current || current.done) return current;
        if (current.leftSec <= 1) return { ...current, leftSec: 0, done: true };
        return { ...current, leftSec: current.leftSec - 1 };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timeoutLive]);

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

  function sideName(side: MatchSideName): string {
    return side === 'home' ? match.home.name : match.away.name;
  }

  function timeoutLeft(side: MatchSideName): number {
    if (props.timeoutRule) {
      const used = side === 'home' ? (props.timeoutUses?.home ?? 0) : (props.timeoutUses?.away ?? 0);
      return Math.max(0, props.timeoutRule.count - used);
    }
    const used = side === 'home' ? timeoutUses.home : timeoutUses.away;
    return Math.max(0, TEAM_TIMEOUT_PER_HALF - used);
  }

  function timeoutSideOff(side: MatchSideName): boolean {
    return props.timeoutRule?.enabled === true && timeoutLeft(side) <= 0;
  }

  function openPicker(side: MatchSideName, action: RecordAction): void {
    const pkAction = action === 'pk-in' || action === 'pk-miss';
    if (pkAction) {
      if (padOff || atMax || reserved) return;
    } else if (action === 'goal' ? goalOff : cardOff) return;
    rememberFocus();
    setGoalKind('normal');
    setPicker({ side, action });
    setMenuOpen(false);
  }

  function choose(plId: string | null): void {
    if (!picker) return;
    const minute = recordMinute(reading.elapsedSec);
    if (picker.action === 'pk-in' || picker.action === 'pk-miss') {
      props.onRecord?.({
        side: picker.side,
        action: picker.action,
        plId,
        goalKind: null,
        minute,
        round: nextPkRound(events, voids, picker.side),
      });
      setPicker(null);
      return;
    }
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
      const flashCard = flashForNewCard(picker.action === 'red' ? 'red' : 'yellow', player, events, voids, [...actionLog, ...localLog]);
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
    if (!props.clockControlled) {
      if (clockBase.running) setPauseUses((value) => value + 1);
      setClockBase(next);
    }
    props.onClock?.(next);
  }

  function startTimeout(side: MatchSideName): void {
    if (props.timeoutControlled) {
      props.onTimeout?.(side);
      setTimeoutOpen(false);
      return;
    }
    const over = timeoutLeft(side) <= 0;
    setTimeoutUses((prev) => ({ ...prev, [side]: prev[side] + 1 }));
    setTeamTimeout({
      side,
      leftSec: TEAM_TIMEOUT_SEC,
      collapsed: false,
      over,
      done: false,
    });
    setTimeoutOpen(false);
  }

  function openEvent(seq: number): void {
    if (!phaseOpen || padOff) return;
    const event = events.find((item) => item.seq === seq);
    if (!event || (event.type !== 'goal' && event.type !== 'card' && event.type !== 'pk')) return;
    if (event.type === 'goal') {
      setAmendKind(event.goalKind);
      setAmendPl(event.plId ?? null);
    } else if (event.type === 'card') {
      setAmendCard(event.cardType === 'yellow' ? 'yellow' : 'red');
      setAmendPl(event.plId);
    }
    setEventSeq(seq);
    setMenuOpen(false);
  }

  const feedOpen = props.feed?.find((row) => row.seq === eventSeq && !row.pending);
  const lineOpen = lines.find((line) => line.seq === eventSeq);
  const openLine = props.feed
    ? (feedOpen ? { seq: feedOpen.seq, label: feedOpen.label } : null)
    : lineOpen;
  const openEventDoc = events.find((item) => item.seq === eventSeq) ?? null;

  function undoSeq(seq: number): void {
    if (blocked) return;
    const second = linkedSecondSeq(cards, seq);
    if (second != null) {
      setConfirmPair({ mode: 'undo', first: seq, second });
      return;
    }
    props.onUndo?.(seq);
    setEventSeq(null);
  }

  function finishAmend(first: number, pick: ScorePick, second?: number): void {
    if (second != null) {
      const secondOk = props.onUndo?.(second) !== false;
      if (!secondOk) {
        setConfirmPair(null);
        setNotice(LIVE_COPY.undoSecondFailed);
        return;
      }
    }
    const voidOk = props.onUndo?.(first) !== false;
    if (!voidOk) {
      setConfirmPair(null);
      setEventSeq(null);
      if (second != null) setNotice(LIVE_COPY.undoHalf);
      return;
    }
    const recorded = props.onRecord?.(pick) !== false;
    if (!recorded) {
      const player = findPlayer(homeRoster, awayRoster, pick.plId ?? undefined);
      const team = sideName(pick.side);
      setNotice(LIVE_COPY.amendHalf);
      setLocalLog((rows) => [
        ...rows,
        {
          id: `amend-${first}`,
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
    setConfirmPair(null);
    setEventSeq(null);
  }

  function submitAmend(): void {
    if (!openEventDoc || blocked) return;
    if (openEventDoc.type !== 'goal' && openEventDoc.type !== 'card') return;
    const minute = Math.floor(openEventDoc.matchSecond / 60);
    const side = openEventDoc.side;
    let pick: ScorePick;
    if (openEventDoc.type === 'goal') {
      pick = {
        side,
        action: 'goal',
        plId: amendPl,
        goalKind: amendKind,
        minute,
        matchSecond: openEventDoc.matchSecond,
      };
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
        matchSecond: openEventDoc.matchSecond,
      };
    }
    const second = openEventDoc.type === 'card' && openEventDoc.cardType === 'yellow'
      ? linkedSecondSeq(cards, openEventDoc.seq)
      : null;
    if (second != null) {
      setConfirmPair({ mode: 'amend', first: openEventDoc.seq, second, pick });
      return;
    }
    finishAmend(openEventDoc.seq, pick);
  }

  function runConfirm(): void {
    if (!confirmPair) return;
    if (confirmPair.mode === 'undo') {
      const secondOk = props.onUndo?.(confirmPair.second) !== false;
      if (!secondOk) {
        setConfirmPair(null);
        setNotice(LIVE_COPY.undoSecondFailed);
        return;
      }
      const firstOk = props.onUndo?.(confirmPair.first) !== false;
      setConfirmPair(null);
      setEventSeq(null);
      if (!firstOk) setNotice(LIVE_COPY.undoHalf);
      return;
    }
    finishAmend(confirmPair.first, confirmPair.pick, confirmPair.second);
  }

  function showOpenCard(): void {
    if (!openEventDoc || openEventDoc.type !== 'card') return;
    rememberFocus();
    setFlash(flashFromCard(openEventDoc.cardType, findPlayer(homeRoster, awayRoster, openEventDoc.plId)));
  }

  const pickerRoster = picker?.side === 'away' ? awayRoster : homeRoster;
  const pickerTeam = picker ? sideName(picker.side) : '';
  const amendRoster = openEventDoc && 'side' in openEventDoc && openEventDoc.side === 'away' ? awayRoster : homeRoster;
  const pauseDisabled = flowOff || (clockBase.running && (pauseBlocked || pauseUses >= PAUSE_MAX));
  const showCtrl = phase === 'pre' || phase === 'play' || phase === 'ht';
  const timeoutLabel = teamTimeout
    ? (teamTimeout.done
      ? LIVE_COPY.resumeClock
      : teamTimeoutText(sideName(teamTimeout.side), timeoutClock(teamTimeout.leftSec)))
    : '';

  const alerts: JSX.Element[] = [];
  if (props.topBanner) {
    alerts.push(<p key="tab" class="s4-banner" role="status">{props.topBanner}</p>);
  }
  if (pauseBlocked) {
    alerts.push(<p key="pause" class="s4-banner s4-banner--saved" role="status">{LIVE_COPY.pauseReserved}</p>);
  }
  if (nearCap) alerts.push(<p key="near" class="s4-banner s4-banner--saved" role="status">{LIVE_COPY.nearCap}</p>);
  if (reserved) alerts.push(<p key="cap" class="s4-banner s4-banner--saved" role="status">{LIVE_COPY.atCap}</p>);
  if (notice) alerts.push(<p key="notice" class="s4-banner s4-banner--saved" role="alert">{notice}</p>);
  const storageDanger = props.storageBanner === true || (!link.online && link.storageUnavailable);
  if (storageDanger) {
    alerts.push(<p key="off" class="s4-banner s4-banner--danger" role="alert">{LIVE_COPY.offlineUnstored}</p>);
  } else if (!link.online) {
    alerts.push(<p key="saved" class="s4-banner s4-banner--saved" role="status">{offlineSaved(link.pendingCount)}</p>);
  }
  if (!link.wakeLock) alerts.push(<p key="wake" class="s4-wake">{LIVE_COPY.wakeLock}</p>);

  const top = (
    <header key="top" class="s4-top">
      <div class="s4-board">
        <TeamLockup entryId={match.home.teamId} name={match.home.name} crests={crests} align="home" place="board" />
        <span class="s4-scoreline">
          <span class="s4-score">{match.score.home}:{match.score.away}</span>
          {pk ? <span class="s4-pk">{pkScoreLabel(shoot.home, shoot.away)}</span> : null}
        </span>
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

  const goals = pk ? (
    <div key="goals" class="s4-goals s4-goals--pk">
      <div class="s4-pkpair">
        <Hit team={match.home.name} action="pk-in" tone="home" disabled={padOff || atMax || reserved} onClick={() => openPicker('home', 'pk-in')} />
        <Hit team={match.home.name} action="pk-miss" tone="miss" disabled={padOff || atMax || reserved} onClick={() => openPicker('home', 'pk-miss')} />
      </div>
      <div class="s4-pkpair">
        <Hit team={match.away.name} action="pk-in" tone="away" disabled={padOff || atMax || reserved} onClick={() => openPicker('away', 'pk-in')} />
        <Hit team={match.away.name} action="pk-miss" tone="miss" disabled={padOff || atMax || reserved} onClick={() => openPicker('away', 'pk-miss')} />
      </div>
    </div>
  ) : (
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
      {props.feed ? (
        props.feed.length > 0 ? (
          <ul class="s4-events">
            {props.feed.map((row) => (
              <li key={row.key} class={row.voided ? 's4-ev s4-ev--void' : 's4-ev'}>
                <Mark kind={row.kind} second={row.secondYellow} scored={row.pkScored} />
                {row.pending || row.voided || !phaseOpen ? (
                  <>
                    <div class="s4-ev__main">{row.text}</div>
                    <span class="s4-sr">{row.label}</span>
                  </>
                ) : (
                  <button
                    type="button"
                    class="s4-ev__main"
                    aria-label={row.label}
                    disabled={padOff}
                    onClick={() => openEvent(row.seq)}
                  >
                    {row.text}
                  </button>
                )}
                {row.voided ? <span class="s4-ev__tag">{LIVE_COPY.undone}</span> : null}
                {row.pending ? <PendingTag /> : null}
              </li>
            ))}
          </ul>
        ) : null
      ) : lines.length > 0 ? (
        <ul class="s4-events">
          {lines.map((line) => (
            <li key={line.seq} class={line.voided ? 's4-ev s4-ev--void' : 's4-ev'}>
              <Mark kind={line.kind} second={line.secondYellow} scored={line.pkScored} />
              {line.voided || !phaseOpen ? (
                <>
                  <div class="s4-ev__main">{shownText(line)}</div>
                  <span class="s4-sr">{line.label}</span>
                </>
              ) : (
                <button
                  type="button"
                  class="s4-ev__main"
                  aria-label={line.label}
                  disabled={padOff}
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
            <Button variant="secondary" disabled={padOff} onClick={() => setUnappliedOpen(true)}>{LIVE_COPY.unappliedTitle}</Button>
          ) : null}
          {takeoverOffered ? (
            <Button variant="secondary" disabled={readerOff} onClick={() => setTakeoverOpen(true)}>
              {props.takeoverSelf ? LIVE_COPY.takeoverAction : LIVE_COPY.takeoverEntry}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const timeoutBanner = teamTimeout ? (
    <div key="timeout" class={teamTimeout.collapsed ? 's4-timeout s4-timeout--mini' : 's4-timeout'} role="status">
      {teamTimeout.collapsed ? (
        <button
          type="button"
          class="s4-timeout__mini"
          aria-expanded="false"
          onClick={() => setTeamTimeout({ ...teamTimeout, collapsed: false })}
        >
          {timeoutLabel}
        </button>
      ) : (
        <>
          <div class="s4-timeout__row">
            <span class="s4-timeout__text">{timeoutLabel}</span>
            <button
              type="button"
              class="s4-timeout__btn"
              onClick={() => {
                if (props.timeoutControlled === true && teamTimeout.startedAt != null) {
                  setHiddenStart(teamTimeout.startedAt);
                }
                setTeamTimeout(null);
              }}
            >
              {LIVE_COPY.endTimeout}
            </button>
            <button
              type="button"
              class="s4-timeout__btn"
              aria-expanded="true"
              onClick={() => setTeamTimeout({ ...teamTimeout, collapsed: true })}
            >
              {LIVE_COPY.collapseTimeout}
            </button>
          </div>
          {teamTimeout.over && !teamTimeout.done ? <p class="s4-timeout__over">{LIVE_COPY.timeoutOver}</p> : null}
        </>
      )}
    </div>
  ) : null;

  const bar = (
    <div key="bar" class="s4-dock">
      {phase === 'undo' && remain ? (
        <div class="s4-sent">
          <p class="s4-sent__st">{LIVE_COPY.fulltimeSent}</p>
          <p class="s4-sent__cd">{undoWithin(remain)}</p>
          <Button variant="danger" disabled={flowOff} onClick={() => props.onUndoFulltime?.()}>{LIVE_COPY.undoFulltime}</Button>
        </div>
      ) : null}
      {phase === 'pre' ? (
        <button
          type="button"
          class="s4-kickoff"
          disabled={flowOff}
          aria-disabled={flowOff ? 'true' : undefined}
          onClick={() => {
            if (flowOff) return;
            props.onKickoff?.();
          }}
        >
          {LIVE_COPY.kickoff}
        </button>
      ) : null}
      {showCtrl ? (
        <div class="s4-ctrl">
          {/* 半場只在上半場。節次取 match.clockBase：正式頁由 adapter 傳入疊加後（快照＋未追上已套用＋待送）的時鐘。 */}
          {phase === 'play' && rawPeriod === 'h1' && !pk && !pkReady ? (
            <Button variant="secondary" disabled={flowOff} onClick={() => props.onHalftime?.()}>{LIVE_COPY.halftime}</Button>
          ) : null}
          {phase === 'ht' ? (
            <Button disabled={flowOff} onClick={() => props.onResume?.()}>{LIVE_COPY.resume}</Button>
          ) : null}
          {pkReady ? (
            <Button
              disabled={flowOff}
              onClick={() => {
                if (props.confirmPk) {
                  setPkConfirm(true);
                  return;
                }
                props.onStartPk?.();
              }}
            >
              {LIVE_COPY.pkStart}
            </Button>
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
              disabled={flowOff && props.onLeave == null}
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
                  disabled={padOff || reserved}
                  onClick={() => {
                    setMenuOpen(false);
                    props.onCorrectClock?.();
                  }}
                >
                  {LIVE_COPY.correctClock}
                </Button>
                {phase === 'play' && !pk ? (
                  <Button
                    variant="ghost"
                    disabled={flowOff}
                    onClick={() => {
                      setMenuOpen(false);
                      setTimeoutOpen(true);
                    }}
                  >
                    {LIVE_COPY.teamTimeout}
                  </Button>
                ) : null}
                {props.onLeave ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setMenuOpen(false);
                      props.onLeave?.();
                    }}
                  >
                    {LIVE_COPY.leaveScore}
                  </Button>
                ) : null}
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
  const homeTimeoutLeft = timeoutLeft('home');
  const awayTimeoutLeft = timeoutLeft('away');

  return (
    <section class="s4-root">
      {top}
      {alertBlock}
      {timeoutBanner}
      {log}
      {goals}
      {cardRow}
      {bar}

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
      {openLine && openEventDoc && (openEventDoc.type === 'goal' || openEventDoc.type === 'card' || openEventDoc.type === 'pk') ? (
        <EventSheet
          summary={openLine.label}
          label={openLine.label}
          kind={openEventDoc.type === 'card' ? 'card' : 'goal'}
          undoOnly={openEventDoc.type === 'pk'}
          roster={amendRoster}
          goalKind={amendKind}
          cardChoice={amendCard}
          playerId={amendPl}
          blocked={blocked}
          onGoalKind={setAmendKind}
          onCardChoice={setAmendCard}
          onPlayer={setAmendPl}
          onUnspecified={() => setAmendPl(null)}
          goalLocked={props.lockRegularGoals === true && openEventDoc.type === 'goal'}
          halftimeGoal={props.halftimeGoalUndoOnly === true && openEventDoc.type === 'goal'}
          onUndo={() => undoSeq(openLine.seq)}
          onAmend={submitAmend}
          onShowCard={showOpenCard}
          onClose={() => setEventSeq(null)}
        />
      ) : null}
      {pkConfirm ? (
        <PkConfirmDialog
          onCancel={() => setPkConfirm(false)}
          onConfirm={() => {
            setPkConfirm(false);
            props.onStartPk?.();
          }}
        />
      ) : null}
      {confirmPair ? (
        <Modal
          open
          class="s4-dialog"
          title={confirmPair.mode === 'amend' ? LIVE_COPY.amend : LIVE_COPY.undo}
          onClose={() => setConfirmPair(null)}
          footer={(
            <>
              <Button onClick={runConfirm}>
                {confirmPair.mode === 'amend' ? LIVE_COPY.amendConfirm : LIVE_COPY.undoBothConfirm}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmPair(null)}>{LIVE_COPY.takeoverLater}</Button>
            </>
          )}
        >
          <p class="s4-note">{LIVE_COPY.undoBoth}</p>
        </Modal>
      ) : null}
      {timeoutOpen ? (
        <BottomSheet open class="s4-sheet" title={LIVE_COPY.teamTimeout} onClose={() => setTimeoutOpen(false)}>
          <p class="s4-note">{LIVE_COPY.timeoutRule}</p>
          {homeTimeoutLeft <= 0 || awayTimeoutLeft <= 0 ? (
            <p class="s4-note">{LIVE_COPY.timeoutOver}</p>
          ) : null}
          <div class="s4-timeout-picks">
            <Button disabled={timeoutSideOff('home')} onClick={() => startTimeout('home')}>{timeoutTeamChoice(match.home.name, homeTimeoutLeft)}</Button>
            <Button disabled={timeoutSideOff('away')} onClick={() => startTimeout('away')}>{timeoutTeamChoice(match.away.name, awayTimeoutLeft)}</Button>
          </div>
        </BottomSheet>
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
  tone: 'home' | 'away' | 'yellow' | 'red' | 'miss';
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  const label = action === 'goal'
    ? LIVE_COPY.goal
    : action === 'yellow'
      ? LIVE_COPY.yellow
      : action === 'red'
        ? LIVE_COPY.red
        : action === 'pk-in'
          ? LIVE_COPY.pkIn
          : LIVE_COPY.pkMiss;
  const kind = action === 'goal' ? 's4-hit--goal' : action === 'pk-in' || action === 'pk-miss' ? 's4-hit--pk' : 's4-hit--card';
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
