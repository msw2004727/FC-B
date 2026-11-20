// 依意圖與伺服器現況組出 K1 批次。純函式，不寫入。

import type {
  BatchPlan,
  ClockTarget,
  LogEntry,
  ServerEvent,
  ServerMatch,
  TimeMark,
} from './types';

const SERVER: TimeMark = { kind: 'server' };

function clampSec(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10800, Math.floor(n)));
}

function clockMark(clock: ClockTarget): NonNullable<BatchPlan['match']['clockBase']> {
  return {
    startedAt: clock.startedAt == null ? null : { kind: 'millis', ms: clock.startedAt },
    pausedSec: clampSec(clock.pausedSec),
    running: clock.running,
    period: clock.period,
  };
}

function baseEvent(entry: LogEntry, seq: number, sid: string): Record<string, unknown> {
  const second = entry.intent.kind === 'sub'
    ? entry.intent.matchSecond
    : entry.intent.matchSecond;
  return {
    seq,
    type: entry.kind,
    matchSecond: clampSec(second),
    createdAt: SERVER,
    sid,
    op: entry.op,
  };
}

export interface BuildBatchInput {
  entry: LogEntry;
  seq: number;
  match: ServerMatch;
  /** 送出當下的本機 sid，不是接手文件上的 sid。 */
  sid: string;
  refSeq?: number;
  targetSeq?: number;
  /** 作廢目標。進球才扣分。 */
  target?: ServerEvent | null;
  cardLinkMode?: 'create' | 'update';
}

export function buildBatch(input: BuildBatchInput): BatchPlan {
  const { entry, seq, match, sid } = input;
  const intent = entry.intent;
  const event = baseEvent(entry, seq, sid);
  const plan: BatchPlan = {
    seq,
    op: entry.op,
    sid,
    match: { rev: seq, updatedAt: SERVER },
    event,
  };

  if (intent.kind === 'goal') {
    const score = { home: match.score.home, away: match.score.away };
    score[intent.side] += 1;
    plan.match.score = score;
    event.side = intent.side;
    event.goalKind = intent.goalKind;
    if (intent.plId) event.plId = intent.plId;
    return plan;
  }

  if (intent.kind === 'card') {
    event.side = intent.side;
    event.plId = intent.plId;
    event.cardType = intent.cardType;
    if (intent.cardType === 'second_yellow') {
      if (input.refSeq == null) throw new Error('第二黃缺少 refSeq');
      event.refSeq = input.refSeq;
      plan.cardLink = {
        ySeq: input.refSeq,
        seq,
        mode: input.cardLinkMode ?? 'create',
      };
    }
    return plan;
  }

  if (intent.kind === 'sub') {
    event.side = intent.side;
    event.inPlId = intent.inPlId;
    event.outPlId = intent.outPlId;
    return plan;
  }

  if (intent.kind === 'void') {
    if (input.targetSeq == null) throw new Error('作廢缺少 targetSeq');
    event.targetSeq = input.targetSeq;
    plan.voidDoc = { targetSeq: input.targetSeq, seq };
    if (input.target?.type === 'goal' && input.target.side) {
      const score = { home: match.score.home, away: match.score.away };
      score[input.target.side] -= 1;
      plan.match.score = score;
    }
    if (input.target?.type === 'pk' && input.target.scored && input.target.side) {
      const current = match.penaltyScore ?? { home: 0, away: 0 };
      const penalty = { home: current.home, away: current.away };
      penalty[input.target.side] = Math.max(0, penalty[input.target.side] - 1);
      plan.match.penaltyScore = penalty;
    }
    return plan;
  }

  if (intent.kind === 'clock') {
    plan.match.clockBase = clockMark(intent.clock);
    return plan;
  }

  if (intent.kind === 'timeout') {
    event.side = intent.side;
    if (intent.stopClock && intent.clock) plan.match.clockBase = clockMark(intent.clock);
    return plan;
  }

  if (intent.kind === 'pkStart') {
    plan.match.penaltyScore = { home: 0, away: 0 };
    plan.match.clockBase = clockMark(intent.clock);
    return plan;
  }

  if (intent.kind === 'pk') {
    event.side = intent.side;
    event.scored = intent.scored;
    if (intent.plId) event.plId = intent.plId;
    if (intent.scored) {
      const current = match.penaltyScore ?? { home: 0, away: 0 };
      const penalty = { home: current.home, away: current.away };
      penalty[intent.side] += 1;
      plan.match.penaltyScore = penalty;
    }
    return plan;
  }

  plan.match.clockBase = clockMark(intent.clock);
  if (intent.kind === 'kickoff') plan.match.status = 'live';
  if (intent.kind === 'halftime') plan.match.status = 'halftime';
  if (intent.kind === 'resume') plan.match.status = 'live';
  if (intent.kind === 'fulltime') {
    plan.match.status = 'finished';
    plan.match.lock = { locked: true };
    plan.match.finishedAt = SERVER;
  }
  if (intent.kind === 'undoFinish') {
    plan.match.status = 'live';
    plan.match.lock = { locked: false };
    plan.match.finishedAt = null;
  }
  return plan;
}

/** 給測試與假伺服器用：把計畫套進記憶體裡的場次。 */
export function applyPlanLocal(
  match: ServerMatch,
  events: ServerEvent[],
  plan: BatchPlan,
  nowMs: number,
): void {
  match.rev = plan.match.rev;
  if (plan.match.score) match.score = { home: plan.match.score.home, away: plan.match.score.away };
  if (plan.match.status) match.status = plan.match.status;
  if (plan.match.lock) match.lock = { locked: plan.match.lock.locked };
  if (plan.match.clockBase) {
    const started = plan.match.clockBase.startedAt;
    match.clockBase = {
      startedAt: started == null ? null : started.kind === 'millis' ? started.ms : nowMs,
      pausedSec: plan.match.clockBase.pausedSec,
      running: plan.match.clockBase.running,
      period: plan.match.clockBase.period,
    };
  }
  if ('finishedAt' in plan.match) {
    match.finishedAt = plan.match.finishedAt == null ? null : nowMs;
  }
  if (plan.match.penaltyScore) {
    match.penaltyScore = { home: plan.match.penaltyScore.home, away: plan.match.penaltyScore.away };
  }
  const ev = plan.event;
  const row: ServerEvent = {
    seq: plan.seq,
    type: String(ev.type),
    op: plan.op,
    sid: plan.sid,
    matchSecond: Number(ev.matchSecond ?? 0),
    createdAt: nowMs,
  };
  if (typeof ev.side === 'string') row.side = ev.side === 'away' ? 'away' : 'home';
  if (typeof ev.plId === 'string') row.plId = ev.plId;
  if (typeof ev.goalKind === 'string') row.goalKind = ev.goalKind;
  if (typeof ev.cardType === 'string') row.cardType = ev.cardType;
  if (typeof ev.refSeq === 'number') row.refSeq = ev.refSeq;
  if (typeof ev.targetSeq === 'number') row.targetSeq = ev.targetSeq;
  if (typeof ev.inPlId === 'string') row.inPlId = ev.inPlId;
  if (typeof ev.outPlId === 'string') row.outPlId = ev.outPlId;
  if (typeof ev.scored === 'boolean') row.scored = ev.scored;
  const existing = events.findIndex((item) => item.seq === row.seq);
  if (existing >= 0) events[existing] = row;
  else events.push(row);
  events.sort((a, b) => a.seq - b.seq);
}
