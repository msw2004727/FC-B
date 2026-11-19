// 正式記分頁把 ScoringView 轉成記分板 props。預覽不走這裡。

import type { MatchDoc, MatchStatus, RosterPublicDoc } from '../data/types';
import type { LiveClock, LiveLink } from './clock';
import { LIVE_COPY, minuteMark, pkKickLine } from './copy';
import { eventLines, findPlayer, nextPkRound, type EventLine } from './present';
import type { ScoreFeedRow, ScorePadProps, ScorePick } from './ScorePad';
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
  for (const row of view.unapplied) {
    if (row.state !== 'pending' && row.state !== 'sending') continue;
    if (row.intent.kind !== 'timeout') continue;
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

function matchDoc(view: ScoringView): MatchDoc {
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
    status: asStatus(match?.status),
    rev: match?.rev ?? 0,
    resetRev: match?.resetRev ?? 0,
    lock: { locked: match?.lock.locked === true },
    clockBase: {
      startedAt: clock.startedAt,
      pausedSec: clock.pausedSec,
      running: clock.running,
      period: clock.period,
    },
    finishedAt: match?.finishedAt ?? null,
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
    match: matchDoc(view),
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
    storageBanner: view.storage === 'unavailable',
    clockControlled: true,
    timeoutControlled: true,
    onTimeout: (side) => { void view.actions.timeout({ side }); },
    timeoutRule: view.timeoutRule,
    timeoutUses: timeoutUsesFrom(view),
    pkCanStart: view.pk.canStart,
    confirmPk: true,
    lockRegularGoals: view.pk.started,
    feed: feedOf(view, timeline, view.voids),
    pkDigits: view.pk.started ? (view.pk.score ?? { home: 0, away: 0 }) : null,
  };
}
