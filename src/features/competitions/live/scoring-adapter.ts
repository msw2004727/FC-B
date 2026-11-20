// 正式記分頁把 ScoringView 轉成記分板 props。預覽不走這裡。

import type { MatchDoc, MatchStatus, RosterPublicDoc } from '../data/types';
import type { LiveClock, LiveLink } from './clock';
import { blockedStep, heldQueued, heldRejected, LIVE_COPY, minuteMark, pkKickLine } from './copy';
import { eventLines, findPlayer, nextPkRound, type EventLine } from './present';
import type { ScoreFeedRow, ScoreHeldLine, ScorePadProps, ScorePick, TimeoutView } from './ScorePad';
import type { ScoringView } from './data/session';
import type { ServerEvent, UnappliedView } from './data/types';
import type { ActionLogEntry, CardType, GoalKind, TimelineEvent, VoidMark } from './types';

const MATCH_STATUS: readonly MatchStatus[] = [
  'scheduled', 'postponed', 'live', 'halftime', 'finished', 'confirmed', 'walkover', 'cancelled',
];

function asStatus(value: string | undefined): MatchStatus {
  if (value && (MATCH_STATUS as readonly string[]).includes(value)) return value as MatchStatus;
  return 'scheduled';
}

function padPeriod(period: string): LiveClock['period'] {
  if (period === 'ht' || period === 'h2' || period === 'pk') return period;
  return 'h1';
}

function goalKindOf(value: string | undefined): GoalKind {
  if (value === 'penalty' || value === 'own') return value;
  return 'normal';
}

function cardTypeOf(value: string | undefined): CardType {
  if (value === 'second_yellow' || value === 'red') return value;
  return 'yellow';
}

/** 伺服器事件沒有輪次。沒作廢的腳才占該隊的輪。 */
export function timelineFrom(events: readonly ServerEvent[], voids: readonly VoidMark[]): TimelineEvent[] {
  const voided = new Set(voids.map((mark) => mark.targetSeq));
  const rounds = { home: 0, away: 0 };
  const out: TimelineEvent[] = [];
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  for (const event of sorted) {
    const side = event.side === 'home' || event.side === 'away' ? event.side : null;
    if (event.type === 'pk' && side) {
      const round = rounds[side] + 1;
      if (!voided.has(event.seq)) rounds[side] += 1;
      out.push({
        seq: event.seq,
        type: 'pk',
        side,
        ...(event.plId ? { plId: event.plId } : {}),
        scored: event.scored === true,
        round,
        matchSecond: event.matchSecond,
        createdAt: event.createdAt,
      });
      continue;
    }
    if (event.type === 'goal' && side) {
      out.push({
        seq: event.seq,
        type: 'goal',
        side,
        ...(event.plId ? { plId: event.plId } : {}),
        goalKind: goalKindOf(event.goalKind),
        matchSecond: event.matchSecond,
        createdAt: event.createdAt,
      });
      continue;
    }
    if (event.type === 'card' && side && event.plId) {
      out.push({
        seq: event.seq,
        type: 'card',
        side,
        plId: event.plId,
        cardType: cardTypeOf(event.cardType),
        ...(event.refSeq != null ? { refSeq: event.refSeq } : {}),
        matchSecond: event.matchSecond,
        createdAt: event.createdAt,
      });
      continue;
    }
    if (event.type === 'sub' && side && event.inPlId && event.outPlId) {
      out.push({
        seq: event.seq,
        type: 'sub',
        side,
        inPlId: event.inPlId,
        outPlId: event.outPlId,
        matchSecond: event.matchSecond,
        createdAt: event.createdAt,
      });
      continue;
    }
    if (
      event.type === 'kickoff'
      || event.type === 'halftime'
      || event.type === 'resume'
      || event.type === 'fulltime'
      || event.type === 'undoFinish'
    ) {
      out.push({
        seq: event.seq,
        type: event.type,
        matchSecond: event.matchSecond,
        createdAt: event.createdAt,
      });
    }
  }
  return out;
}

function feedText(line: EventLine): string {
  if (line.pkRound != null) {
    const who = line.number == null ? LIVE_COPY.unspecified : `${line.number} ${line.name}`;
    return pkKickLine(line.pkRound, line.team, who, line.pkScored === true);
  }
  return line.number == null
    ? `${line.minute} ${line.team}`
    : `${line.minute} ${line.team} ${line.number} ${line.name}`;
}

function whoText(number: number | null, name: string): string {
  return number == null ? '' : ` ${number} ${name}`;
}

/**
 * 停錶次數。per 為 match 時數重置線之後的全部暫停。
 * per 為 half 時，只數最近一次開賽、半場、續賽、pkStart 之後的暫停。
 * 伺服器暫停事件沒有節次，待送的暫停還沒有 seq，待送一律計入。
 */
export function timeoutUsesFrom(view: ScoringView): { home: number; away: number } {
  const resetRev = view.match?.resetRev ?? 0;
  let floor = resetRev;
  if (view.timeoutRule.per === 'half') {
    for (const event of view.events) {
      if (event.seq <= resetRev) continue;
      if (event.type === 'kickoff' || event.type === 'halftime' || event.type === 'resume' || event.type === 'pkStart') {
        if (event.seq > floor) floor = event.seq;
      }
    }
  }
  const uses = { home: 0, away: 0 };
  for (const event of view.events) {
    if (event.type !== 'timeout' || event.seq <= floor) continue;
    if (event.side === 'home' || event.side === 'away') uses[event.side] += 1;
  }
  // 本機快照（離線延遲補償）已讀進 events 的待送暫停不重算（依 op 去重）。
  const serverOps = new Set(view.events.map((event) => event.op));
  for (const row of view.unapplied) {
    if (row.state !== 'pending' && row.state !== 'sending') continue;
    if (row.intent.kind !== 'timeout') continue;
    if (serverOps.has(row.op)) continue;
    if (row.intent.side === 'home' || row.intent.side === 'away') uses[row.intent.side] += 1;
  }
  return uses;
}

function pendingRow(
  view: ScoringView,
  row: UnappliedView,
  timeline: readonly TimelineEvent[],
  voids: readonly VoidMark[],
): ScoreFeedRow | null {
  const match = view.match;
  if (!match) return null;
  const intent = row.intent;
  if (intent.kind !== 'goal' && intent.kind !== 'card' && intent.kind !== 'pk') return null;
  const side = intent.side;
  const team = side === 'home' ? match.home.name : match.away.name;
  const player = findPlayer(view.roster.home, view.roster.away, intent.plId);
  const minute = minuteMark(Math.floor(intent.matchSecond / 60));
  const number = player?.number ?? null;
  const name = player?.displayName ?? '';
  if (intent.kind === 'pk') {
    const round = nextPkRound(timeline, voids, side);
    const who = number == null ? LIVE_COPY.unspecified : `${number} ${name}`;
    const text = pkKickLine(round, team, who, intent.scored);
    return {
      key: row.op,
      seq: -1,
      pending: true,
      text,
      label: text,
      kind: 'pk',
      secondYellow: false,
      pkScored: intent.scored,
      voided: false,
    };
  }
  const kind = intent.kind === 'goal'
    ? 'goal'
    : intent.cardType === 'yellow' ? 'yellow' : 'red';
  const secondYellow = intent.kind === 'card' && intent.cardType === 'second_yellow';
  const word = intent.kind === 'goal'
    ? LIVE_COPY.goal
    : secondYellow ? LIVE_COPY.secondYellowMark : kind === 'yellow' ? LIVE_COPY.yellow : LIVE_COPY.red;
  const text = number == null ? `${minute} ${team}` : `${minute} ${team}${whoText(number, name)}`;
  const label = number == null ? `${minute} ${word} ${team}` : `${minute} ${word} ${team} ${number} ${name}`;
  return {
    key: row.op,
    seq: -1,
    pending: true,
    text,
    label,
    kind: secondYellow ? 'yellow' : kind,
    secondYellow,
    voided: false,
  };
}

function feedOf(view: ScoringView, timeline: readonly TimelineEvent[], voids: readonly VoidMark[]): ScoreFeedRow[] {
  const home = view.match?.home.name ?? '';
  const away = view.match?.away.name ?? '';
  const lines = eventLines({
    events: timeline,
    voids,
    homeName: home,
    awayName: away,
    homeRoster: view.roster.home,
    awayRoster: view.roster.away,
    hideVoided: false,
    order: 'recent',
  });
  const opBySeq = new Map(view.events.map((event) => [event.seq, event.op]));
  const serverOps = new Set(view.events.map((event) => event.op));
  const serverRows: ScoreFeedRow[] = lines.map((line) => ({
    key: opBySeq.get(line.seq) || String(line.seq),
    seq: line.seq,
    pending: false,
    text: feedText(line),
    label: line.label,
    kind: line.kind,
    secondYellow: line.secondYellow,
    ...(line.pkScored != null ? { pkScored: line.pkScored } : {}),
    voided: line.voided,
  }));
  const pending = view.unapplied
    .filter((row) => (row.state === 'pending' || row.state === 'sending') && !serverOps.has(row.op))
    .sort((a, b) => b.createdAt - a.createdAt);
  const pendingRows: ScoreFeedRow[] = [];
  for (const row of pending) {
    const built = pendingRow(view, row, timeline, voids);
    if (built) pendingRows.push(built);
  }
  return [...pendingRows, ...serverRows];
}

function rejectedLog(view: ScoringView): ActionLogEntry[] {
  return view.unapplied
    .filter((row) => row.state === 'rejected')
    .map((row) => ({
      id: row.op,
      intent: row.summary,
      state: 'rejected' as const,
      ...(row.rejectReason ? { rejectReason: row.rejectReason } : {}),
      at: row.createdAt,
    }));
}

/**
 * 終場還在待送時伺服器沒有 finishedAt；記分板會把「finished＋沒有 finishedAt」當成鎖定。
 * 用這筆終場的建立時間當撤回倒數起點（伺服器寫入後改用伺服器時間）。
 */
function finishedAtOf(view: ScoringView, nowMs: number): number | null {
  const server = view.match?.finishedAt ?? null;
  if (view.liveStatus !== 'finished') return server;
  if (server != null && view.match?.status === 'finished') return server;
  const local = view.unapplied
    .filter((row) => row.intent.kind === 'fulltime' && (row.state === 'pending' || row.state === 'sending'))
    .reduce<number | null>((latest, row) => (latest == null || row.createdAt > latest ? row.createdAt : latest), null);
  return local ?? nowMs;
}

/** 被拒項目擋住送出時的常駐提示。被接手時記分區整個停用，改由接手入口處理，不另外提示。 */
export function heldLinesFrom(view: ScoringView): ScoreHeldLine[] {
  const held = view.held;
  if (held.rejected === 0 || view.control.needsTakeover) return [];
  const lines: ScoreHeldLine[] = [{
    key: 'held',
    text: held.blockedAction ? blockedStep(held.blockedAction) : heldRejected(held.rejected),
    alert: held.blockedAction != null,
  }];
  if (held.queued > 0) lines.push({ key: 'queued', text: heldQueued(held.queued), alert: false });
  return lines;
}

function matchDoc(view: ScoringView, nowMs: number): MatchDoc {
  const match = view.match;
  const clock = match?.clockBase ?? { startedAt: null, pausedSec: 0, running: false, period: 'pre' };
  const homeId = match?.home.teamId ?? '';
  const awayId = match?.away.teamId ?? '';
  return {
    id: match?.id ?? '',
    divisionId: match?.divisionId ?? '',
    stageId: '',
    groupId: '',
    round: 0,
    matchNo: 0,
    label: null,
    matchKey: null,
    kickoffAt: null,
    venueIdx: null,
    venueName: null,
    home: { teamId: homeId, name: match?.home.name ?? '' },
    away: { teamId: awayId, name: match?.away.name ?? '' },
    teamIds: [homeId, awayId],
    score: { home: view.score.home, away: view.score.away },
    penaltyScore: null,
    // 階段跟節次一樣看疊加狀態（第 4 步 A F5-2，取代只看伺服器 status：待送「下半場開始」時節次已是 h2、按鈕卻停在中場）。
    status: asStatus(view.liveStatus ?? match?.status),
    rev: match?.rev ?? 0,
    resetRev: match?.resetRev ?? 0,
    lock: { locked: match?.lock.locked === true },
    clockBase: {
      startedAt: clock.startedAt,
      pausedSec: clock.pausedSec,
      running: clock.running,
      period: clock.period,
    },
    finishedAt: finishedAtOf(view, nowMs),
    confirmedAt: null,
    walkoverSide: null,
    result: null,
    resultSource: null,
    updatedAt: null,
    cancelReason: null,
    cancelledAt: null,
  };
}

function sendRecord(view: ScoringView, pick: ScorePick): void {
  if (pick.action === 'goal') {
    void view.actions.goal({
      side: pick.side,
      ...(pick.plId ? { plId: pick.plId } : {}),
      goalKind: pick.goalKind === 'penalty' || pick.goalKind === 'own' ? pick.goalKind : 'normal',
    });
    return;
  }
  if (pick.action === 'yellow' || pick.action === 'red') {
    if (!pick.plId) return;
    void view.actions.card({ side: pick.side, plId: pick.plId, cardType: pick.action });
    return;
  }
  void view.actions.pk({
    side: pick.side,
    scored: pick.action === 'pk-in',
    ...(pick.plId ? { plId: pick.plId } : {}),
  });
}

function timeoutSide(value: string | undefined): 'home' | 'away' | null {
  if (value === 'home' || value === 'away') return value;
  return null;
}

/**
 * 最新一筆還沒走完的球隊暫停。
 * 伺服器事件以 seq 較大者為新；待送或發送中的暫停，時間不早於那一筆才算最新。
 * 現在減事件時間小於規則秒數時回倒數；剛好走完剩 0；再久就沒有。
 */
export function timeoutViewFrom(view: ScoringView, nowMs: number): TimeoutView | undefined {
  const resetRev = view.match?.resetRev ?? 0;
  let best: { side: 'home' | 'away'; at: number } | null = null;
  let bestSeq = resetRev;
  for (const event of view.events) {
    if (event.type !== 'timeout' || event.seq <= resetRev) continue;
    const side = timeoutSide(event.side);
    if (!side) continue;
    if (event.seq > bestSeq) {
      bestSeq = event.seq;
      best = { side, at: event.createdAt };
    }
  }
  for (const row of view.unapplied) {
    if (row.state !== 'pending' && row.state !== 'sending') continue;
    if (row.intent.kind !== 'timeout') continue;
    const side = timeoutSide(row.intent.side);
    if (!side) continue;
    if (best && row.createdAt < best.at) continue;
    best = { side, at: row.createdAt };
  }
  if (!best) return undefined;
  const seconds = view.timeoutRule.seconds;
  const elapsed = Math.floor((nowMs - best.at) / 1000);
  if (elapsed > seconds) return undefined;
  const leftSec = elapsed < 0 ? seconds : seconds - elapsed;
  return { side: best.side, leftSec, startedAt: best.at };
}

/** 正式頁的記分板。本機預覽狀態改由 view 決定。 */
export function scorePadPropsFrom(view: ScoringView, nowMs: number): ScorePadProps {
  const timeline = timelineFrom(view.events, view.voids);
  const reader = view.tab === 'reader';
  const link: LiveLink = {
    online: view.connection.online,
    pendingCount: view.score.pendingCount,
    storageUnavailable: view.storage === 'unavailable',
    wakeLock: view.connection.wakeLock !== 'unsupported',
  };
  const clock: LiveClock = {
    elapsedSec: view.clock.elapsedSec,
    period: padPeriod(view.clock.period),
    addedMin: null,
  };
  const homeRoster: readonly RosterPublicDoc[] = view.roster.home;
  const awayRoster: readonly RosterPublicDoc[] = view.roster.away;
  return {
    match: matchDoc(view, nowMs),
    homeRoster,
    awayRoster,
    events: timeline,
    voids: view.voids,
    actionLog: rejectedLog(view),
    eventCount: view.budget.used,
    pauseUses: view.budget.pauseUses,
    crests: [],
    link,
    clock,
    nowMs,
    takeoverOffered: view.control.needsTakeover,
    takeoverSelf: view.control.takeoverSelf,
    timeoutView: timeoutViewFrom(view, nowMs),
    onRecord: (pick) => {
      sendRecord(view, pick);
      return true;
    },
    onUndo: (seq) => {
      void view.actions.voidEvent({ seq });
      return true;
    },
    onClock: (next) => {
      if (next.running) void view.actions.resumeClock();
      else void view.actions.pauseClock();
    },
    onKickoff: () => { void view.actions.kickoff(); },
    onHalftime: () => { void view.actions.halftime(); },
    onFulltime: () => { void view.actions.fulltime(); },
    onResume: () => { void view.actions.resume(); },
    onUndoFulltime: () => { void view.actions.undoFinish(); },
    onStartPk: () => { void view.actions.pkStart(); },
    onReapply: (id) => { void view.actions.reapply(id); },
    onDiscard: (id) => { void view.actions.discard(id); },
    onTakeover: () => { void view.actions.takeover(); },
    scoringDisabled: reader,
    topBanner: reader ? view.tabHint : null,
    heldLines: reader ? [] : heldLinesFrom(view),
    storageBanner: view.storage === 'unavailable',
    clockControlled: true,
    timeoutControlled: true,
    onTimeout: (side) => { void view.actions.timeout({ side }); },
    timeoutRule: view.timeoutRule,
    timeoutUses: timeoutUsesFrom(view),
    pkCanStart: view.pk.canStart,
    confirmPk: true,
    confirmKickoff: true,
    lockRegularGoals: view.pk.started,
    halftimeGoalUndoOnly: view.liveStatus === 'halftime',
    feed: feedOf(view, timeline, view.voids),
    pkDigits: view.pk.started ? (view.pk.score ?? { home: 0, away: 0 }) : null,
  };
}
