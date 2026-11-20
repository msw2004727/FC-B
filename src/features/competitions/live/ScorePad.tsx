import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
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
  pkRoundText,
  restedFor,
  teamAction,
  teamTimeoutText,
  timeoutClock,
  timeoutLeftText,
  timeoutTeamChoice,
  undoWithin,
} from './copy';
import { EventSheet } from './EventSheet';
import { ConfirmFooter, KickoffConfirmDialog, Mark, PendingTag, PkConfirmDialog, useConfirmArmed } from './score-states';
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
  /** 正式頁：有被拒項目擋住送出時，按「PK 大戰」不開確認框，直接送出讓工作階段回被擋提示。 */
  pkStartBlocked?: boolean;
  /** 正式頁：開賽不能由記分端撤回，先開確認框。預設按了就送。 */
  confirmKickoff?: boolean;
  /** 正式頁：被拒項目擋住送出時的常駐提示（第 4 步 A F5-3）。沒傳不顯示。 */
  heldLines?: readonly ScoreHeldLine[];
  /** PK 開始後，一般進球的復原與改判停用。 */
  lockRegularGoals?: boolean;
  /** 疊加狀態是中場：點開進球只能復原，不能改判。沒傳不鎖。 */
  halftimeGoalUndoOnly?: boolean;
  /** 正式頁的事件列（含待送）。沒傳就用 events 畫預覽列。 */
  feed?: readonly ScoreFeedRow[];
  /** 正式頁的 PK 比分（含還沒落地的腳）。沒傳就從 events 算。 */
  pkDigits?: { home: number; away: number } | null;
}

export interface ScoreHeldLine {
  key: string;
  text: string;
  /** 剛被擋下的階段動作：用 alert 讓報讀立刻念。 */
  alert: boolean;
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
  /** 哪一隊的紀錄；有才照主客隊上色，沒有維持中性。 */
  side?: MatchSideName;
}

type Phase = 'pre' | 'play' | 'ht' | 'undo' | 'locked';

interface TeamTimeoutState {
  side: MatchSideName;
  leftSec: number;
  collapsed: boolean;
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
    done: view.leftSec <= 0,
    ...(view.startedAt != null ? { startedAt: view.startedAt } : {}),
  };
}

function sameTimeout(current: TeamTimeoutState, next: TeamTimeoutState): boolean {
  return current.side === next.side
    && current.leftSec === next.leftSec
    && current.collapsed === next.collapsed
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
    done: view.leftSec <= 0,
    ...(view.startedAt != null ? { startedAt: view.startedAt } : {}),
  };
  if (current && sameTimeout(current, next)) return current;
  return next;
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
  // 同分停錶可進 PK 時仍要能「繼續計時」，與「PK 大戰」並存（顧問 staging 複驗 P1-C，取代 !pkReady 時整顆藏起）。
  const showPause = phase === 'play' && !pk;
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
  const [kickoffConfirm, setKickoffConfirm] = useState(false);
  const confirmArmed = useConfirmArmed(confirmPair != null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  /** 「看這張牌」時暫時收起的事件面板。亮牌關掉後開回來（面板是 top layer，亮牌會被蓋住又點不到）。 */
  const flashReturnSeq = useRef<number | null>(null);
  const refocusShowCard = useRef(false);
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
    const reopen = flashReturnSeq.current;
    flashReturnSeq.current = null;
    // 亮牌期間這筆被作廢或不見了（例如他機復原）就不開回去，焦點回原處。
    const stillThere = reopen != null
      && events.some((item) => item.seq === reopen)
      && !voids.some((mark) => mark.targetSeq === reopen);
    if (reopen != null && stillThere) {
      refocusShowCard.current = true;
      setEventSeq(reopen);
      return;
    }
    queueMicrotask(() => {
      if (back?.isConnected) back.focus();
    });
  }

  useEffect(() => {
    if (!refocusShowCard.current || eventSeq == null) return undefined;
    refocusShowCard.current = false;
    // 面板開回來後焦點回到「看這張牌」（data-show-card 指定，不靠文字）。Modal 在掛上時（layout effect）會先把焦點給第一顆，
    // 這裡排在它之後執行，才不會被蓋掉。
    const id = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('.s4-sheet [data-show-card]')?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [eventSeq]);

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
    setTimeoutUses((prev) => ({ ...prev, [side]: prev[side] + 1 }));
    setTeamTimeout({
      side,
      leftSec: TEAM_TIMEOUT_SEC,
      collapsed: false,
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
    // 先收起事件面板再亮牌：面板是 showModal 的 top layer，背景 inert，亮牌會被蓋住也點不到（顧問 11-20）。
    flashReturnSeq.current = openEventDoc.seq;
    setEventSeq(null);
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

  // 提示區由上到下的固定順序（施工-第2批 3.9）：離線紀錄無法保存 → 沒送出／被擋 → 之後記的 N 筆 → 停錶已停用 → 接近上限
  // → notice → 離線已存 N 筆 → 鎖定提醒。只搬順序，條件不變。
  const alerts: JSX.Element[] = [];
  const storageDanger = props.storageBanner === true || (!link.online && link.storageUnavailable);
  if (storageDanger) {
    alerts.push(<p key="off" class="s4-banner s4-banner--danger" role="alert">{LIVE_COPY.offlineUnstored}</p>);
  }
  for (const line of props.heldLines ?? []) {
    // 顧問 §3.459 (a)＋方案 B（3.11）：紅色那一行是 44px 的可點列，點了開同一個「未套用的動作」面板。
    // 外層 <p role> 保留讓讀屏照舊念；文字包在撐滿整列的原生按鈕裡，可點範圍就是那一列，不再往外延伸。
    // 第二行「之後記的 N 筆」帶 s4-banner--queued（s4-banner--saved 留著），高度 700 以下用樣式藏。
    const tap = line.key === 'held';
    alerts.push(
      <p
        key={`held-${line.key}`}
        class={line.key === 'queued'
          ? 's4-banner s4-banner--saved s4-banner--queued'
          : `s4-banner s4-banner--held${tap ? ' s4-banner--tap' : ''}`}
        role={line.alert ? 'alert' : 'status'}
      >
        {tap ? (
          <button
            type="button"
            class="s4-banner__tap"
            disabled={padOff}
            onClick={() => {
              // 記分區停用（被接手、唯讀）時不開；不只靠 disabled 屬性。
              if (!padOff) setUnappliedOpen(true);
            }}
          >
            {line.text}
          </button>
        ) : line.text}
      </p>,
    );
  }
  if (pauseBlocked) {
    alerts.push(<p key="pause" class="s4-banner s4-banner--saved" role="status">{LIVE_COPY.pauseReserved}</p>);
  }
  if (nearCap) alerts.push(<p key="near" class="s4-banner s4-banner--saved" role="status">{LIVE_COPY.nearCap}</p>);
  if (notice) alerts.push(<p key="notice" class="s4-banner s4-banner--saved" role="alert">{notice}</p>);
  // 3.12：沒有待送紀錄時不顯示「離線中，已存 N 筆」（離線本身仍看得到：板上的連線指示）；無法保存那一句不受影響。
  if (!storageDanger && !link.online && link.pendingCount > 0) {
    alerts.push(<p key="saved" class="s4-banner s4-banner--saved" role="status">{offlineSaved(link.pendingCount)}</p>);
  }
  // 3.13（記分線問答第 3 點）：鎖定提醒不常駐——畫面上還沒有任何一列紀錄時才顯示（正式頁看含待送的 feed，預覽看 lines）。
  if (!link.wakeLock && (props.feed ?? lines).length === 0) alerts.push(<p key="wake" class="s4-wake">{LIVE_COPY.wakeLock}</p>);

  // PK 期間板上不放時鐘，右邊是「第 N 輪」：N＝兩隊都踢完的輪數＋1，用畫面上那一份事件列算（正式頁含待送），與 PK 比分同步。
  const pkRound = !pk
    ? 0
    : props.feed
      ? Math.min(
        props.feed.filter((row) => row.kind === 'pk' && !row.voided && row.side === 'home').length,
        props.feed.filter((row) => row.kind === 'pk' && !row.voided && row.side === 'away').length,
      ) + 1
      : Math.min(nextPkRound(events, voids, 'home'), nextPkRound(events, voids, 'away'));
  const stageCell = showStage || phase === 'undo' || phase === 'locked' || holdText ? (
    <div class="s4-stagecell">
      {showStage ? <span class="s4-stage">{stageLabel(stageClock)}</span> : null}
      {phase === 'undo' || phase === 'locked' ? <span class="s4-stage">{LIVE_COPY.fulltime}</span> : null}
      {holdText ? <p class="s4-hold">{holdText}</p> : null}
    </div>
  ) : null;
  const top = (
    <header key="top" class={`s4-top${holdText ? ' s4-top--held' : ''}${pk ? ' s4-top--pk' : ''}`}>
      <div class="s4-board">
        <TeamLockup entryId={match.home.teamId} name={match.home.name} crests={crests} align="home" place="board" split />
        <span class="s4-scoreline">
          {pk ? (
            <span class="s4-score">
              <span class="s4-score__n">{match.score.home}</span>
              <span class="s4-score__c">:</span>
              <span class="s4-score__n">{match.score.away}</span>
            </span>
          ) : (
            <span class="s4-score">{match.score.home}:{match.score.away}</span>
          )}
        </span>
        <TeamLockup entryId={match.away.teamId} name={match.away.name} crests={crests} align="away" place="board" split />
      </div>
      <div class="s4-clockrow">
        {pk ? (
          <span class="s4-pk">
            <span class="s4-pk__tag">PK</span>
            <span class="s4-pk__n s4-pk__n--home">{shoot.home}</span>
            <span class="s4-pk__c">:</span>
            <span class="s4-pk__n s4-pk__n--away">{shoot.away}</span>
          </span>
        ) : (
          <span class="s4-clock">{formatMatchClock(reading.elapsedSec)}</span>
        )}
        {pk ? <span class="s4-round">{pkRoundText(pkRound)}</span> : stageCell}
        <span class="s4-link" data-link={link.online ? 'on' : 'off'}>
          {link.online ? LIVE_COPY.connected : offlineChip(link.pendingCount)}
        </span>
      </div>
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

  // 進球上方的隊名標籤與兩欄分隔線。隊名已在按鈕 aria-label 裡，標籤只給眼睛看。
  const pad = (
    <div key="pad" class="s4-pad">
      <div class="s4-tags" aria-hidden="true">
        <span class="s4-tag s4-tag--home">
          <TeamLockup entryId={match.home.teamId} name={match.home.name} crests={crests} align="home" place="column" split />
        </span>
        <span class="s4-tag s4-tag--away">
          <TeamLockup entryId={match.away.teamId} name={match.away.name} crests={crests} align="away" place="column" split />
        </span>
      </div>
      {goals}
      {cardRow}
      <span class="s4-pad__rule" aria-hidden="true" />
    </div>
  );

  const log = (
    <div key="log" class="s4-feed">
      {props.feed ? (
        props.feed.length > 0 ? (
          <ul class="s4-events">
            {props.feed.map((row) => (
              <li key={row.key} class={`s4-ev${row.voided ? ' s4-ev--void' : ''}${row.side ? ` s4-ev--${row.side}` : ''}`}>
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
            <li key={line.seq} class={`s4-ev${line.voided ? ' s4-ev--void' : ''} s4-ev--${line.side}`}>
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
      {/* 紅色可點列畫出來的時候，紀錄區最後那顆「未套用的動作」不重複顯示（3.11） */}
      {pending.length > 0 && !(props.heldLines ?? []).some((line) => line.key === 'held') ? (
        <div class="s4-extra">
          <Button variant="secondary" disabled={padOff} onClick={() => setUnappliedOpen(true)}>{LIVE_COPY.unappliedTitle}</Button>
        </div>
      ) : null}
    </div>
  );

  // 3.10：整區不能按的原因與出路放在隊名標籤正上方（紀錄區與按鈕區之間），由狀態決定，不比對文字。
  const blockArea = props.topBanner || reserved || takeoverOffered ? (
    <div key="block" class="s4-block">
      {props.topBanner ? <p class="s4-banner s4-banner--block" role="status">{props.topBanner}</p> : null}
      {reserved ? <p class="s4-banner s4-banner--block" role="status">{LIVE_COPY.atCap}</p> : null}
      {takeoverOffered ? (
        <Button disabled={readerOff} onClick={() => setTakeoverOpen(true)}>
          {props.takeoverSelf ? LIVE_COPY.takeoverAction : LIVE_COPY.takeoverEntry}
        </Button>
      ) : null}
    </div>
  ) : null;

  const timeoutBanner = teamTimeout ? (
    <div
      key="timeout"
      class={`s4-timeout${teamTimeout.collapsed ? ' s4-timeout--mini' : ''} s4-timeout--${teamTimeout.side}`}
      role="status"
    >
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
      {/* 終場後（撤回期與之後）沒有選單；全幅藏了頂欄與導覽，這裡固定給一個出口（顧問 staging 實測 P1-B）。 */}
      {!showCtrl && props.onLeave ? (
        <div class="s4-leave">
          <Button variant="secondary" onClick={() => props.onLeave?.()}>{LIVE_COPY.leaveScore}</Button>
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
            if (props.confirmKickoff) {
              setKickoffConfirm(true);
              return;
            }
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
                if (props.confirmPk && !props.pkStartBlocked) {
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
            <Button variant="secondary" class={clockBase.running ? undefined : 's4-resume'} disabled={pauseDisabled} onClick={togglePause}>
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
                {/* 正式頁尚未接上修正時鐘（onCorrectClock 沒有提供者），沒接上就不顯示，避免按了沒反應（顧問 staging 複驗）。 */}
                {props.onCorrectClock ? (
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
                ) : null}
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
      {blockArea}
      {pad}
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
          side={picker.side}
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
          markKind={openEventDoc.type === 'card' ? (openEventDoc.cardType === 'red' ? 'red' : 'yellow') : openEventDoc.type}
          markSecond={openEventDoc.type === 'card' && openEventDoc.cardType === 'second_yellow'}
          markScored={openEventDoc.type === 'pk' ? openEventDoc.scored : undefined}
          markSide={openEventDoc.side}
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
      {kickoffConfirm ? (
        <KickoffConfirmDialog
          onCancel={() => setKickoffConfirm(false)}
          onConfirm={() => {
            setKickoffConfirm(false);
            if (flowOff) return;
            props.onKickoff?.();
          }}
        />
      ) : null}
      {confirmPair ? (
        <Modal
          open
          class="s4-dialog d2-panel"
          title={confirmPair.mode === 'amend' ? LIVE_COPY.amend : LIVE_COPY.undo}
          onClose={() => setConfirmPair(null)}
          footer={(
            <ConfirmFooter
              armed={confirmArmed}
              confirmLabel={confirmPair.mode === 'amend' ? LIVE_COPY.amendConfirm : LIVE_COPY.undoBothConfirm}
              cancelLabel={LIVE_COPY.takeoverLater}
              confirmVariant="danger"
              onConfirm={runConfirm}
              onCancel={() => setConfirmPair(null)}
            />
          )}
        >
          <p class="s4-note">{LIVE_COPY.undoBoth}</p>
        </Modal>
      ) : null}
      {timeoutOpen ? (
        <BottomSheet open class="s4-sheet d2-panel" title={LIVE_COPY.teamTimeout} onClose={() => setTimeoutOpen(false)}>
          <p class="s4-note">{LIVE_COPY.timeoutRule}</p>
          {homeTimeoutLeft <= 0 || awayTimeoutLeft <= 0 ? (
            <p class="s4-note">{LIVE_COPY.timeoutOver}</p>
          ) : null}
          <div class="s4-timeout-picks">
            {/* 3.22：一律兩行——第一行隊名（放不下省略）、第二行「剩 N 次」（不縮）；名稱仍是整句。 */}
            <Button
              disabled={timeoutSideOff('home')}
              aria-label={timeoutTeamChoice(match.home.name, homeTimeoutLeft)}
              trailing={<span class="s4-tp__left">{timeoutLeftText(homeTimeoutLeft)}</span>}
              onClick={() => startTimeout('home')}
            >
              {match.home.name}
            </Button>
            <Button
              disabled={timeoutSideOff('away')}
              aria-label={timeoutTeamChoice(match.away.name, awayTimeoutLeft)}
              trailing={<span class="s4-tp__left">{timeoutLeftText(awayTimeoutLeft)}</span>}
              onClick={() => startTimeout('away')}
            >
              {match.away.name}
            </Button>
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
