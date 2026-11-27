import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { blockedStep, heldQueued, heldRejected, LIVE_COPY } from '../copy';
import { IndexedDbActionLog, MemoryActionLog, ResilientActionLog, type ActionLog } from './action-log';
import { applyPlanLocal, buildBatch } from './batch';
import { budgetView, groupWithinBudget, pauseUseCount } from './budget';
import { activeYellowRefs, findOpenYellow, groupMessage, liveSecondYellow, overlayScore, overlayStatus, scoreView, voidsFromTimeline } from './derive';
import { memorySidStore } from './sid';
import { classifyReject, decideRetry, Sender } from './sender';
import type { LiveListener } from './live-repo';
import { createScoringSession, loadingView, type ScoringSession } from './session';
import { acquireTabLock, TAB_HINT, type LockManager, type TabChannel } from './tab-lock';
import type {
  BatchPlan,
  LogEntry,
  LogPatch,
  ScoringPort,
  ServerControl,
  ServerEvent,
  ServerMatch,
} from './types';
import { bindWakeLock } from './wake-lock';
import { h as jsx } from 'preact';
import { cleanup, render, screen } from '@testing-library/preact';
import { ScorePad } from '../ScorePad';
import { scorePadPropsFrom } from '../scoring-adapter';

const CID = 'c1';
const MT = 'm1';
const UID = 'user-1';
const SID = 'local-sid-0123456789ab';

function clockEvent(seq: number, op = `clock-${seq}`): ServerEvent {
  return { seq, type: 'clock', op, sid: SID, matchSecond: seq, createdAt: seq };
}

function goalEvent(seq: number, side: 'home' | 'away', op = `goal-${seq}`): ServerEvent {
  return { seq, type: 'goal', op, sid: SID, side, goalKind: 'normal', matchSecond: 1, createdAt: seq };
}

function baseMatch(patch: Partial<ServerMatch> = {}): ServerMatch {
  return {
    id: MT,
    status: 'live',
    rev: 0,
    resetRev: 0,
    score: { home: 0, away: 0 },
    lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: true, period: 'h1' },
    finishedAt: null,
    home: { teamId: 'en_h', name: '主', logo: null },
    away: { teamId: 'en_a', name: '客', logo: null },
    divisionId: 'dv',
    ...patch,
  };
}

function entry(partial: Partial<LogEntry> & Pick<LogEntry, 'op' | 'intent'>): LogEntry {
  return {
    cid: CID,
    mtId: MT,
    uid: UID,
    sid: SID,
    kind: partial.intent.kind,
    state: 'pending',
    createdAt: 1,
    attempts: 0,
    ...partial,
  };
}

describe('decideRetry（S1／S2／S3）', () => {
  const row = { op: 'op-1', seq: 5 as number | undefined };

  it('對到自己的 op 就是已套用，進行中也一樣', () => {
    expect(decideRetry(row, { rev: 5, eventAtSeq: { op: 'op-1' }, matchedSeq: 5 }, true)).toEqual({ kind: 'applied', seq: 5 });
    expect(decideRetry(row, { rev: 4, eventAtSeq: { op: 'op-1' }, matchedSeq: null }, true)).toEqual({ kind: 'applied', seq: 5 });
  });

  it('S3：commit 還沒結束且伺服器還沒有這筆，不得重送', () => {
    expect(decideRetry(row, { rev: 4, eventAtSeq: null, matchedSeq: null }, true)).toEqual({ kind: 'inflight' });
  });

  it('S2：rev >= seq 且 e{seq} 不存在或 op 不是自己，才換號', () => {
    expect(decideRetry(row, { rev: 5, eventAtSeq: null, matchedSeq: null }, false)).toEqual({ kind: 'resequence' });
    expect(decideRetry(row, { rev: 9, eventAtSeq: { op: 'other' }, matchedSeq: null }, false)).toEqual({ kind: 'resequence' });
  });

  it('rev 還差一截就等；rev 正好是 seq-1 且事件不存在就沿用原 seq', () => {
    expect(decideRetry(row, { rev: 3, eventAtSeq: null, matchedSeq: null }, false)).toEqual({ kind: 'wait' });
    expect(decideRetry(row, { rev: 4, eventAtSeq: null, matchedSeq: null }, false)).toEqual({ kind: 'reuse' });
  });

  it('還沒取號就 assign', () => {
    expect(decideRetry({ op: 'op-1' }, { rev: 4, eventAtSeq: null, matchedSeq: null }, false)).toEqual({ kind: 'assign' });
  });

  it('resetRev 比 baseResetRev 大就丟棄，而且排在換號之前', () => {
    const server = { rev: 9, resetRev: 4, eventAtSeq: null, matchedSeq: null };
    expect(decideRetry({ op: 'op-1', seq: 5, baseResetRev: 0 }, server, false)).toEqual({ kind: 'discard', reason: 'reset' });
    expect(decideRetry({ op: 'op-1', seq: 5 }, { ...server, resetRev: 1 }, false)).toEqual({ kind: 'discard', reason: 'reset' });
    expect(decideRetry(
      { op: 'op-1', seq: 5, baseResetRev: 4 },
      { rev: 4, resetRev: 4, eventAtSeq: null, matchedSeq: null },
      false,
    )).toEqual({ kind: 'reuse' });
  });
});

describe('classifyReject', () => {
  const match = baseMatch();
  const control: ServerControl = { uid: UID, sid: SID, takenAt: 1 };

  it('順序是接手、鎖、上限、衝突，其餘當規則', () => {
    expect(classifyReject({
      entrySeq: 1, localSid: SID, uid: UID, match, control: { uid: 'other', sid: SID, takenAt: 1 },
    })).toBe('takenOver');
    expect(classifyReject({
      entrySeq: 1, localSid: SID, uid: UID, match: baseMatch({ status: 'finished', lock: { locked: true } }), control,
    })).toBe('locked');
    expect(classifyReject({
      entrySeq: 201, localSid: SID, uid: UID, match: baseMatch({ rev: 200 }), control,
    })).toBe('limit');
    expect(classifyReject({
      entrySeq: 4, localSid: SID, uid: UID, match: baseMatch({ rev: 2 }), control,
    })).toBe('conflict');
    expect(classifyReject({
      entrySeq: 1, localSid: SID, uid: UID, match: baseMatch({ rev: 0 }), control,
    })).toBe('rules');
  });
});

describe('buildBatch', () => {
  const match = baseMatch({ score: { home: 1, away: 2 }, rev: 3, status: 'live' });

  function keysOf(plan: BatchPlan): string[] {
    return Object.keys(plan.event).sort();
  }

  it('進球只加意圖那一隊，烏龍不換邊', () => {
    const plan = buildBatch({
      entry: entry({ op: 'opgoalopgoalopgoal', intent: { kind: 'goal', side: 'home', goalKind: 'own', matchSecond: 12, plId: 'pl_a' } }),
      seq: 4,
      match,
      sid: SID,
    });
    expect(plan.sid).toBe(SID);
    expect(plan.op).toBe('opgoalopgoalopgoal');
    expect(plan.match.rev).toBe(4);
    expect(plan.match.score).toEqual({ home: 2, away: 2 });
    expect(plan.event.goalKind).toBe('own');
    expect(plan.event.side).toBe('home');
    expect(plan.event.createdAt).toEqual({ kind: 'server' });
    expect(keysOf(plan)).toEqual(['createdAt', 'goalKind', 'matchSecond', 'op', 'plId', 'seq', 'sid', 'side', 'type']);
  });

  it('牌、第二黃、換人、作廢、時鐘、階段的鍵', () => {
    const card = buildBatch({
      entry: entry({ op: 'cardcardcardcardcard', intent: { kind: 'card', side: 'away', plId: 'pl_b', cardType: 'yellow', matchSecond: 3 } }),
      seq: 4, match, sid: SID,
    });
    expect(card.cardLink).toBeUndefined();
    expect(keysOf(card)).toEqual(['cardType', 'createdAt', 'matchSecond', 'op', 'plId', 'seq', 'sid', 'side', 'type']);

    const second = buildBatch({
      entry: entry({ op: 'secondsecondsecondse', intent: { kind: 'card', side: 'away', plId: 'pl_b', cardType: 'second_yellow', matchSecond: 4, refSeq: 2 } }),
      seq: 5, match, sid: SID, refSeq: 2, cardLinkMode: 'create',
    });
    expect(second.event.refSeq).toBe(2);
    expect(second.cardLink).toEqual({ ySeq: 2, seq: 5, mode: 'create' });

    const sub = buildBatch({
      entry: entry({ op: 'subsubsubsubsubsubsu', intent: { kind: 'sub', side: 'home', inPlId: 'pl_in', outPlId: 'pl_out', matchSecond: 8 } }),
      seq: 6, match, sid: SID,
    });
    expect(sub.event.inPlId).toBe('pl_in');
    expect(keysOf(sub)).toEqual(['createdAt', 'inPlId', 'matchSecond', 'op', 'outPlId', 'seq', 'sid', 'side', 'type']);

    const target = goalEvent(4, 'home');
    const wiped = buildBatch({
      entry: entry({ op: 'voidvoidvoidvoidvoid', intent: { kind: 'void', matchSecond: 9, targetSeq: 4 } }),
      seq: 7, match, sid: SID, targetSeq: 4, target,
    });
    expect(wiped.match.score).toEqual({ home: 0, away: 2 });
    expect(wiped.voidDoc).toEqual({ targetSeq: 4, seq: 7 });
    expect(wiped.event.targetSeq).toBe(4);

    const cardVoid = buildBatch({
      entry: entry({ op: 'voidcardvoidcardvoid', intent: { kind: 'void', matchSecond: 9, targetSeq: 2 } }),
      seq: 8, match, sid: SID, targetSeq: 2, target: { ...goalEvent(2, 'away'), type: 'card', cardType: 'yellow' },
    });
    expect(cardVoid.match.score).toBeUndefined();

    const paused = buildBatch({
      entry: entry({
        op: 'clockclockclockclock',
        intent: { kind: 'clock', matchSecond: 10, clockAction: 'pause', clock: { running: false, period: 'h1', pausedSec: 40, startedAt: 5000 } },
      }),
      seq: 9, match, sid: SID,
    });
    expect(paused.match.clockBase).toEqual({
      startedAt: { kind: 'millis', ms: 5000 }, pausedSec: 40, running: false, period: 'h1',
    });
    expect(keysOf(paused)).toEqual(['createdAt', 'matchSecond', 'op', 'seq', 'sid', 'type']);

    const kick = buildBatch({
      entry: entry({
        op: 'kickoffkickoffkickof',
        intent: { kind: 'kickoff', matchSecond: 0, clock: { running: true, period: 'h1', pausedSec: 0, startedAt: 6000 } },
      }),
      seq: 1, match: baseMatch({ status: 'scheduled' }), sid: SID,
    });
    expect(kick.match.status).toBe('live');
    expect(kick.match.clockBase?.period).toBe('h1');
  });

  it('暫停、pkStart、pk 的鍵，以及作廢進了的 pk 扣回', () => {
    const stopped = baseMatch({
      score: { home: 1, away: 1 },
      clockBase: { startedAt: 1000, pausedSec: 80, running: false, period: 'h2' },
      penaltyScore: { home: 2, away: 1 },
    });
    const timeout = buildBatch({
      entry: entry({
        op: 'timeouttimeouttimeou',
        intent: {
          kind: 'timeout', side: 'home', matchSecond: 80, stopClock: true,
          clock: { running: false, period: 'h2', pausedSec: 90, startedAt: 2000 },
        },
      }),
      seq: 4, match: stopped, sid: SID,
    });
    expect(keysOf(timeout)).toEqual(['createdAt', 'matchSecond', 'op', 'seq', 'sid', 'side', 'type']);
    expect(timeout.event).not.toHaveProperty('stopClock');
    expect(timeout.match.clockBase?.running).toBe(false);
    expect(timeout.match.clockBase?.period).toBe('h2');

    const quiet = buildBatch({
      entry: entry({
        op: 'timeoutquiettimeoutq',
        intent: { kind: 'timeout', side: 'away', matchSecond: 80 },
      }),
      seq: 5, match: stopped, sid: SID,
    });
    expect(quiet.match.clockBase).toBeUndefined();
    expect(quiet.event.side).toBe('away');

    const start = buildBatch({
      entry: entry({
        op: 'pkstartpkstartpkstar',
        intent: { kind: 'pkStart', matchSecond: 80, clock: { running: false, period: 'pk', pausedSec: 80, startedAt: 1000 } },
      }),
      seq: 6, match: baseMatch({ penaltyScore: null, score: { home: 1, away: 1 } }), sid: SID,
    });
    expect(keysOf(start)).toEqual(['createdAt', 'matchSecond', 'op', 'seq', 'sid', 'type']);
    expect(start.match.penaltyScore).toEqual({ home: 0, away: 0 });
    expect(start.match.clockBase?.period).toBe('pk');

    const scored = buildBatch({
      entry: entry({
        op: 'pkscoredpkscoredpksco',
        intent: { kind: 'pk', side: 'home', scored: true, matchSecond: 80, plId: 'pl_a' },
      }),
      seq: 7, match: stopped, sid: SID,
    });
    expect(scored.match.penaltyScore).toEqual({ home: 3, away: 1 });
    expect(scored.event.scored).toBe(true);
    expect(keysOf(scored)).toEqual(['createdAt', 'matchSecond', 'op', 'plId', 'scored', 'seq', 'sid', 'side', 'type']);

    const missed = buildBatch({
      entry: entry({
        op: 'pkmissedpkmissedpkmis',
        intent: { kind: 'pk', side: 'away', scored: false, matchSecond: 81 },
      }),
      seq: 8, match: stopped, sid: SID,
    });
    expect(missed.match.penaltyScore).toBeUndefined();
    expect(missed.event.scored).toBe(false);
    expect(keysOf(missed)).toEqual(['createdAt', 'matchSecond', 'op', 'scored', 'seq', 'sid', 'side', 'type']);

    const wiped = buildBatch({
      entry: entry({ op: 'voidpkvoidpkvoidpkvoi', intent: { kind: 'void', matchSecond: 82, targetSeq: 7 } }),
      seq: 9,
      match: stopped,
      sid: SID,
      targetSeq: 7,
      target: { seq: 7, type: 'pk', op: 'pkscoredpkscoredpksco', sid: SID, side: 'home', scored: true, matchSecond: 80, createdAt: 7 },
    });
    expect(wiped.match.penaltyScore).toEqual({ home: 1, away: 1 });
    expect(wiped.match.score).toBeUndefined();

    const missVoid = buildBatch({
      entry: entry({ op: 'voidmissvoidmissvoid', intent: { kind: 'void', matchSecond: 83, targetSeq: 8 } }),
      seq: 10,
      match: stopped,
      sid: SID,
      targetSeq: 8,
      target: { seq: 8, type: 'pk', op: 'pkmissedpkmissedpkmis', sid: SID, side: 'away', scored: false, matchSecond: 81, createdAt: 8 },
    });
    expect(missVoid.match.penaltyScore).toBeUndefined();
  });
});

describe('額度', () => {
  function used(rev: number) {
    return budgetView(rev, 0, [], []);
  }

  it('門檻 129／131、179／180、189／190、199／200', () => {
    expect(used(129).pauseEnabled).toBe(true);
    expect(used(130).pauseEnabled).toBe(true);
    expect(used(131).pauseEnabled).toBe(false);
    expect(used(179).nearLimit).toBe(false);
    expect(used(180).nearLimit).toBe(true);
    expect(used(189).controlsOnly).toBe(false);
    expect(used(190).controlsOnly).toBe(true);
    expect(used(199).exhausted).toBe(false);
    expect(used(200).exhausted).toBe(true);
  });

  it('停錶次數含時鐘修正，重整後仍由事件推算', () => {
    const pause = clockEvent(1, 'p');
    const correction = clockEvent(2, 'c');
    expect(pauseUseCount([pause], [], 0)).toBe(0);
    expect(pauseUseCount([pause, correction], [], 0)).toBe(1);
    const pending = entry({
      op: 'pending-pause-000001',
      intent: { kind: 'clock', matchSecond: 1, clockAction: 'pause', clock: { running: false, period: 'h1', pausedSec: 1, startedAt: 1 } },
    });
    expect(pauseUseCount([], [pending], 0)).toBe(1);
    expect(pauseUseCount([pause, correction], [pending], 0)).toBe(2);
  });

  it('停錶型暫停計入停錶次數，不停錶的不計', () => {
    const serverTimeout = { seq: 3, type: 'timeout', op: 'timeout-server-0001', sid: SID, side: 'home' as const, matchSecond: 1, createdAt: 3 };
    expect(pauseUseCount([serverTimeout], [], 0)).toBe(0);
    expect(pauseUseCount([serverTimeout], [], 0, true)).toBe(1);
    const stopping = entry({
      op: 'timeout-pending-0001',
      intent: {
        kind: 'timeout', side: 'away', matchSecond: 2, stopClock: true,
        clock: { running: false, period: 'h1', pausedSec: 2, startedAt: 2 },
      },
    });
    const quiet = entry({
      op: 'timeout-pending-0002',
      intent: { kind: 'timeout', side: 'home', matchSecond: 3 },
    });
    expect(pauseUseCount([], [stopping], 0)).toBe(1);
    expect(pauseUseCount([], [quiet], 0)).toBe(0);
    const budget = budgetView(0, 0, [], [], true);
    expect(groupWithinBudget([stopping.intent], { ...budget, pauseUses: 20 })).toBe(false);
    expect(groupWithinBudget([quiet.intent], { ...budget, pauseUses: 20 })).toBe(true);
  });
});

describe('時間軸推出作廢與第二黃', () => {
  it('不靠 voids／cardLinks 集合', () => {
    const events: ServerEvent[] = [
      goalEvent(1, 'home'),
      { seq: 2, type: 'card', op: 'y', sid: SID, side: 'home', plId: 'pl_a', cardType: 'yellow', matchSecond: 2, createdAt: 2 },
      { seq: 3, type: 'card', op: 's', sid: SID, side: 'home', plId: 'pl_a', cardType: 'second_yellow', refSeq: 2, matchSecond: 3, createdAt: 3 },
      { seq: 4, type: 'void', op: 'v', sid: SID, targetSeq: 1, matchSecond: 4, createdAt: 4 },
    ];
    expect(voidsFromTimeline(events).map((mark) => mark.targetSeq)).toEqual([1]);
    expect(activeYellowRefs(events).get(2)).toBe(3);
    const voidedSecond = [
      ...events,
      { seq: 5, type: 'void', op: 'v2', sid: SID, targetSeq: 3, matchSecond: 5, createdAt: 5 },
    ];
    expect(activeYellowRefs(voidedSecond).has(2)).toBe(false);
    const appliedSecond = entry({
      op: 'applied-second-yellow',
      state: 'applied',
      seq: 3,
      intent: { kind: 'card', side: 'home', plId: 'pl_a', cardType: 'second_yellow', matchSecond: 3, refSeq: 2 },
    });
    expect(liveSecondYellow({ seq: 2 }, voidedSecond, [appliedSecond])).toBeNull();
    const pendingVoid = entry({
      op: 'pending-void-second01',
      state: 'pending',
      intent: { kind: 'void', matchSecond: 6, targetSeq: 3 },
    });
    expect(liveSecondYellow({ seq: 2 }, events, [appliedSecond, pendingVoid])).toBeNull();
    expect(findOpenYellow('pl_a', 'home', events, [])).toBeNull();
    const src = readFileSync('src/features/competitions/live/data/live-repo.ts', 'utf8');
    expect(src).not.toMatch(/collection\([^)]*voids/);
    expect(src).not.toMatch(/collection\([^)]*cardLinks/);
  });
});

describe('比分疊加', () => {
  it('快照加待送，已拒的不加，烏龍不換邊', () => {
    const match = baseMatch({ score: { home: 1, away: 0 }, rev: 1 });
    const events = [goalEvent(1, 'home')];
    const pending = entry({
      op: 'away-goal-pending01',
      createdAt: 2,
      intent: { kind: 'goal', side: 'away', goalKind: 'own', matchSecond: 3 },
    });
    const rejected = entry({
      op: 'rejected-goal-00001',
      createdAt: 3,
      state: 'rejected',
      rejectReason: 'rules',
      intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 4 },
    });
    const view = scoreView(match, events, [pending, rejected]);
    expect(view).toEqual({ home: 1, away: 1, pendingCount: 1, server: { home: 1, away: 0 } });
    const wiping = entry({
      op: 'void-home-pending01',
      createdAt: 4,
      intent: { kind: 'void', matchSecond: 5, targetSeq: 1 },
    });
    expect(scoreView(match, events, [wiping]).home).toBe(0);
  });

  it('已套用但快照 rev 還沒追上時，進球與時鐘仍疊加', () => {
    const match = baseMatch({
      rev: 3,
      score: { home: 0, away: 0 },
      clockBase: { startedAt: null, pausedSec: 0, running: true, period: 'h1' },
    });
    const goal = entry({
      op: 'applied-ahead-goal01',
      state: 'applied',
      seq: 4,
      createdAt: 4,
      intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 8 },
    });
    const clock = entry({
      op: 'applied-ahead-clock1',
      state: 'applied',
      seq: 5,
      createdAt: 5,
      intent: {
        kind: 'clock',
        matchSecond: 9,
        clockAction: 'pause',
        clock: { running: false, period: 'h1', pausedSec: 40, startedAt: 9 },
      },
    });
    const view = scoreView(match, [], [goal, clock]);
    expect(view.home).toBe(1);
    expect(view.pendingCount).toBe(0);
    expect(overlayScore(match, [], [goal, clock]).clockBase).toMatchObject({ pausedSec: 40, running: false });
    const caught = scoreView(baseMatch({ rev: 5, score: { home: 1, away: 0 } }), [], [goal, clock]);
    expect(caught.home).toBe(1);
  });
});

interface Harness {
  match: ServerMatch;
  control: ServerControl | null;
  events: ServerEvent[];
  commits: BatchPlan[];
  gate: Promise<void> | null;
  failBefore: ((plan: BatchPlan) => void) | null;
  failAfter: ((plan: BatchPlan) => void) | null;
  online: boolean;
  log: ActionLog;
  sids: ReturnType<typeof memorySidStore>;
  session: ScoringSession;
  listener: LiveListener;
  release: () => void;
  stop: () => void;
}

const sessions: ScoringSession[] = [];

function snapshotOf(match: ServerMatch): ServerMatch {
  return {
    ...match,
    score: { ...match.score },
    lock: { ...match.lock },
    clockBase: { ...match.clockBase },
    home: { ...match.home },
    away: { ...match.away },
  };
}

async function openHarness(options?: {
  log?: ActionLog;
  sids?: ReturnType<typeof memorySidStore>;
  locks?: LockManager | null;
  match?: ServerMatch;
  control?: ServerControl | null;
  events?: ServerEvent[];
}): Promise<Harness> {
  let clock = 10_000;
  const now = () => ++clock;
  let n = 1;
  const randomBytes = (size: number) => {
    const out = new Uint8Array(size);
    const value = n++;
    out[0] = value & 255;
    out[1] = (value >> 8) & 255;
    out[2] = 9;
    return out;
  };
  const log = options?.log ?? new MemoryActionLog();
  const sids = options?.sids ?? memorySidStore();
  if (!options?.sids) await sids.set(CID, MT, UID, SID);
  const box: Harness = {
    match: options?.match ?? baseMatch(),
    control: options?.control === undefined ? { uid: UID, sid: SID, takenAt: 1 } : options.control,
    events: options?.events ?? [],
    commits: [],
    gate: null,
    failBefore: null,
    failAfter: null,
    online: true,
    log,
    sids,
    session: null as unknown as ScoringSession,
    listener: { onMatch() {}, onControl() {}, onEvents() {}, onError() {} },
    release: () => {},
    stop: () => {},
  };
  let release = () => {};
  box.release = () => release();
  const port: ScoringPort = {
    async commit(plan) {
      box.commits.push(plan);
      if (box.gate) await box.gate;
      box.failBefore?.(plan);
      applyPlanLocal(box.match, box.events, plan, 1_700_000_000_000);
      box.listener.onMatch(snapshotOf(box.match));
      box.listener.onEvents(box.events.map((event) => ({ ...event })), 'replace');
      box.failAfter?.(plan);
    },
    async loadServer() {
      return { match: snapshotOf(box.match), control: box.control ? { ...box.control } : null };
    },
    async loadTimelineFrom(minSeq, resetRev) {
      return { events: box.events.filter((event) => event.seq >= minSeq && event.seq > resetRev).map((event) => ({ ...event })), pending: false };
    },
    knownEvents: () => box.events,
    async takeover(sid) {
      box.control = { uid: UID, sid, takenAt: now() };
      box.listener.onControl(box.control);
    },
  };
  let listenerReady: (value: Harness['listener']) => void = () => {};
  const ready = new Promise<Harness['listener']>((resolve) => { listenerReady = resolve; });
  const session = createScoringSession({
    cid: CID,
    mtId: MT,
    uid: UID,
    backend: {
      port,
      async open(listener) {
        box.listener = listener;
        listenerReady(listener);
        return {
          match: snapshotOf(box.match),
          control: box.control,
          events: box.events.map((event) => ({ ...event })),
          home: [],
          away: [],
          staffRoles: ['scorer'],
          setVisible() {},
          stop() {},
        };
      },
    },
    log,
    sids,
    now,
    randomBytes,
    online: () => box.online,
    locks: options?.locks === undefined ? null : options.locks,
    channel: null,
    wakeRequest: null,
    tick: false,
  });
  sessions.push(session);
  box.session = session;
  box.stop = () => session.stop();
  const held = new Promise<void>((resolve) => { release = resolve; });
  void held;
  await session.start();
  await ready;
  return box;
}

afterEach(() => {
  for (const session of sessions) session.stop();
  sessions.length = 0;
});

describe('送出與工作階段', () => {
  it('成功記一球，sid 用本機的', async () => {
    const h = await openHarness();
    const result = await h.session.getState().actions.goal({ side: 'home', plId: 'pl_a', goalKind: 'normal' });
    expect(result).toEqual({ status: 'applied' });
    expect(h.events).toHaveLength(1);
    expect(h.commits[0]?.sid).toBe(SID);
    expect(h.commits[0]?.event.sid).toBe(SID);
    expect(h.match.score).toEqual({ home: 1, away: 0 });
    expect(h.session.getState().score.home).toBe(1);
  });

  it('回應遺失但伺服器已有這筆：標 applied，不重送', async () => {
    const h = await openHarness();
    h.failAfter = () => { throw { code: 'unavailable' }; };
    const result = await h.session.getState().actions.goal({ side: 'home' });
    expect(result.status).toBe('applied');
    expect(h.commits).toHaveLength(1);
    expect(h.events).toHaveLength(1);
  });

  it('conflict 自動重試一次；第二次仍衝突就交給使用者', async () => {
    const h = await openHarness();
    let bumps = 0;
    h.failBefore = () => {
      bumps += 1;
      h.match.rev += 1;
      throw { code: 'permission-denied' };
    };
    const failed = await h.session.getState().actions.goal({ side: 'away' });
    expect(failed).toEqual({ status: 'rejected', reason: 'conflict' });
    expect(bumps).toBe(2);
    expect(h.events).toHaveLength(0);
    h.failBefore = null;
    const op = (await h.log.list(CID, MT)).find((row) => row.state === 'rejected')?.op;
    expect(op).toBeTruthy();
    const again = await h.session.getState().actions.reapply(op ?? '');
    expect(again.status).toBe('applied');
    expect(h.events).toHaveLength(1);
    expect(new Set(h.events.map((event) => event.op)).size).toBe(1);
  });

  it('rev 被往前推之前沿用原 seq 等待，不吃掉自動重試', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'preset-seq-goal-0001', intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 1 }, seq: 5 });
    await log.put(goal);
    let reads = 0;
    let committed = false;
    const events: ServerEvent[] = [];
    const match = baseMatch({ rev: 4 });
    const plans: BatchPlan[] = [];
    const port: ScoringPort = {
      async commit(plan) {
        plans.push(plan);
        committed = true;
        throw { code: 'permission-denied' };
      },
      async loadServer() {
        reads += 1;
        const rev = reads <= 2 ? 4 : 1;
        return { match: { ...match, rev }, control: { uid: UID, sid: SID, takenAt: 1 } };
      },
      async loadTimelineFrom() { return { events, pending: false }; },
      knownEvents: () => events,
      async takeover() {},
    };
    const sender = new Sender({ log, port, uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    const saved = await log.get(goal.op);
    expect(saved?.state).toBe('pending');
    expect(saved?.seq).toBe(5);
    expect(saved?.autoRetried).toBeUndefined();
    expect(plans).toHaveLength(1);
    expect(committed).toBe(true);
  });

  it('四種拒絕會停住佇列', async () => {
    const deny = () => { throw { code: 'permission-denied' }; };
    const cases: Array<{ reason: 'takenOver' | 'locked' | 'limit' | 'rules'; arm: (h: Harness) => void }> = [
      {
        reason: 'takenOver',
        arm: (h) => {
          h.failBefore = () => {
            h.control = { uid: 'other', sid: 'other-sid-0123456789', takenAt: 2 };
            deny();
          };
        },
      },
      {
        reason: 'locked',
        arm: (h) => {
          h.match.status = 'finished';
          h.match.lock = { locked: true };
          h.failBefore = deny;
        },
      },
      {
        reason: 'limit',
        arm: (h) => {
          h.match.rev = 200;
          h.failBefore = deny;
        },
      },
      { reason: 'rules', arm: (h) => { h.failBefore = deny; } },
    ];
    for (const item of cases) {
      const h = await openHarness();
      item.arm(h);
      const result = await h.session.getState().actions.goal({ side: 'home' });
      expect(result).toEqual({ status: 'rejected', reason: item.reason });
      expect(h.events).toHaveLength(0);
      h.stop();
    }
  });

  it('離線兩筆，恢復後各記一次且 seq 連續', async () => {
    const h = await openHarness();
    let release = () => {};
    h.gate = new Promise<void>((resolve) => { release = resolve; });
    h.online = false;
    const first = await h.session.getState().actions.goal({ side: 'home' });
    const second = await h.session.getState().actions.goal({ side: 'away' });
    expect(first.status).toBe('queued');
    expect(second.status).toBe('queued');
    const mid = await h.log.list(CID, MT);
    expect(mid.filter((row) => row.state === 'sending')).toHaveLength(1);
    expect(mid.filter((row) => row.state === 'pending')).toHaveLength(1);
    h.online = true;
    release();
    await h.session.whenIdle();
    expect(h.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(new Set(h.events.map((event) => event.op)).size).toBe(2);
    expect(h.match.score).toEqual({ home: 1, away: 1 });
  });

  it('模擬重整：舊頁面晚到的寫入不會再記一次', async () => {
    const h = await openHarness();
    let release = () => {};
    h.gate = new Promise<void>((resolve) => { release = resolve; });
    h.online = false;
    await h.session.getState().actions.goal({ side: 'home' });
    await h.session.getState().actions.goal({ side: 'home' });
    h.session.stop();
    release();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    const again = await openHarness({
      log: h.log,
      sids: h.sids,
      match: h.match,
      events: h.events,
      control: h.control,
    });
    await again.session.whenIdle();
    expect(again.events).toHaveLength(2);
    expect(new Set(again.events.map((event) => event.op)).size).toBe(2);
    expect(again.match.score.home).toBe(2);
  });

  it('inflight 中重置標成 discarded，原 commit 成功後仍是 discarded', async () => {
    const log = new MemoryActionLog();
    const goal = entry({
      op: 'inflight-goal-000001',
      intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 1 },
    });
    await log.put(goal);
    const match = baseMatch();
    const events: ServerEvent[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = 0;
    const port: ScoringPort = {
      async commit() {
        started += 1;
        await gate;
      },
      async loadServer() {
        return { match: snapshotOf(match), control: { uid: UID, sid: SID, takenAt: 1 } };
      },
      async loadTimelineFrom() {
        return { events: events.filter((event) => event.seq > match.resetRev), pending: false };
      },
      knownEvents: () => events,
      async takeover() {},
    };
    const first = new Sender({ log, port, uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 50 });
    const flushing = first.flush();
    for (let i = 0; i < 30 && started < 1; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(started).toBe(1);
    match.resetRev = 4;
    match.rev = 4;
    const other = new Sender({ log, port, uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 60 });
    await other.flush();
    expect(await log.get(goal.op)).toMatchObject({ state: 'discarded', rejectReason: 'reset' });
    release();
    await flushing;
    expect(await log.get(goal.op)).toMatchObject({ state: 'discarded', rejectReason: 'reset' });
  });

  it('兩個 Sender 搶同一個已取號項目，只留下一筆', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'shared-op-shared-op1', intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 1 } });
    await log.put(goal);
    const match = baseMatch();
    const events: ServerEvent[] = [];
    const plans: BatchPlan[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const port: ScoringPort = {
      async commit(plan) {
        plans.push(plan);
        if (plans.length === 1) await gate;
        if (events.some((event) => event.seq === plan.seq)) throw { code: 'already-exists' };
        applyPlanLocal(match, events, plan, 10);
      },
      async loadServer() { return { match: snapshotOf(match), control: { uid: UID, sid: SID, takenAt: 1 } }; },
      async loadTimelineFrom(minSeq) { return { events: events.filter((event) => event.seq >= minSeq).map((event) => ({ ...event })), pending: false }; },
      knownEvents: () => events,
      async takeover() {},
    };
    const first = new Sender({ log, port, uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 20 });
    const second = new Sender({ log, port, uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 20 });
    const left = first.flush();
    for (let i = 0; i < 20 && plans.length < 1; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
    const right = second.flush();
    for (let i = 0; i < 20 && plans.length < 2; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
    release();
    await Promise.all([left, right]);
    expect(plans.map((plan) => plan.seq)).toEqual([1, 1]);
    expect(events).toHaveLength(1);
    expect((await log.get(goal.op))?.state).toBe('applied');
  });

  it('接手後舊的兩筆被拒，新的動作留在 pending', async () => {
    const h = await openHarness();
    let release = () => {};
    h.gate = new Promise<void>((resolve) => { release = resolve; });
    h.online = false;
    await h.session.getState().actions.goal({ side: 'home' });
    await h.session.getState().actions.goal({ side: 'away' });
    h.failBefore = () => {
      h.control = { uid: UID, sid: 'second-device-sid-0001', takenAt: 9 };
      throw { code: 'permission-denied' };
    };
    h.online = true;
    release();
    await h.session.whenIdle();
    const rows = await h.log.list(CID, MT);
    expect(rows.every((row) => row.state === 'rejected' && row.rejectReason === 'takenOver')).toBe(true);
    expect(h.events).toHaveLength(0);
    const before = h.commits.length;
    const next = await h.session.getState().actions.goal({ side: 'home' });
    expect(next.status).toBe('queued');
    const added = (await h.log.list(CID, MT)).find((row) => row.state === 'pending');
    expect(added).toBeTruthy();
    expect(h.session.getState().control.needsTakeover).toBe(true);
    expect(h.commits).toHaveLength(before);
  });

  it('重新接手後用新的 sid 送出', async () => {
    const h = await openHarness();
    h.control = { uid: 'other', sid: 'other-sid-0123456789', takenAt: 2 };
    h.listener.onControl(h.control);
    await h.session.whenIdle();
    const queued = await h.session.getState().actions.goal({ side: 'home', plId: 'pl_a' });
    expect(queued.status).toBe('queued');
    expect(h.events).toHaveLength(0);
    const taken = await h.session.getState().actions.takeover();
    expect(taken.status).toBe('applied');
    expect(h.events).toHaveLength(1);
    expect(h.commits.at(-1)?.sid).not.toBe(SID);
    expect(h.commits.at(-1)?.event.sid).toBe(h.commits.at(-1)?.sid);
    expect(h.session.getState().control.needsTakeover).toBe(false);
  });

  it('改判第二步被拒時終場停用，重新套用後完成；捨棄則放行終場', async () => {
    const h = await openHarness();
    await h.session.getState().actions.goal({ side: 'home', plId: 'pl_a' });
    h.failBefore = (plan) => {
      if (plan.event.type === 'goal') throw { code: 'permission-denied' };
    };
    const amended = await h.session.getState().actions.amend(
      { seq: 1 },
      { kind: 'goal', side: 'home', goalKind: 'penalty', matchSecond: 15, plId: 'pl_a' },
    );
    expect(amended).toEqual({ status: 'rejected', reason: 'rules' });
    expect(h.session.getState().groups[0]?.message).toBe(LIVE_COPY.amendHalf);
    expect(h.session.getState().fulltimeBlocked).toBe(true);
    const blocked = await h.session.getState().actions.fulltime();
    expect(blocked.status).toBe('rejected');
    h.failBefore = null;
    const failed = (await h.log.list(CID, MT)).find((row) => row.state === 'rejected');
    expect((await h.session.getState().actions.reapply(failed?.op ?? '')).status).toBe('applied');
    expect(h.session.getState().fulltimeBlocked).toBe(false);
    expect(h.match.score.home).toBe(1);
    expect(new Set(h.events.map((event) => event.op)).size).toBe(h.events.length);

    const other = await openHarness();
    await other.session.getState().actions.goal({ side: 'home', plId: 'pl_a' });
    other.failBefore = (plan) => {
      if (plan.event.type === 'goal') throw { code: 'permission-denied' };
    };
    await other.session.getState().actions.amend(
      { seq: 1 },
      { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 4 },
    );
    const reject = (await other.log.list(CID, MT)).find((row) => row.state === 'rejected');
    expect((await other.session.getState().actions.discard(reject?.op ?? '')).status).toBe('applied');
    expect(other.session.getState().fulltimeBlocked).toBe(false);
    other.failBefore = null;
    expect((await other.session.getState().actions.fulltime()).status).toBe('applied');
  });

  it('復原被引用的第一黃：第二步被拒時顯示半套訊息', async () => {
    const h = await openHarness();
    await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    expect(h.events[1]?.cardType).toBe('second_yellow');
    expect(h.events[1]?.refSeq).toBe(1);
    expect(h.commits[1]?.cardLink?.ySeq).toBe(1);
    let voids = 0;
    h.failBefore = (plan) => {
      if (plan.event.type !== 'void') return;
      voids += 1;
      if (voids === 2) throw { code: 'permission-denied' };
    };
    const result = await h.session.getState().actions.undoFirstYellow({ seq: 1 });
    expect(result.status).toBe('rejected');
    expect(h.session.getState().groups[0]?.message).toBe(LIVE_COPY.undoHalf);
    h.failBefore = null;
    const failed = (await h.log.list(CID, MT)).find((row) => row.state === 'rejected');
    expect((await h.session.getState().actions.reapply(failed?.op ?? '')).status).toBe('applied');
    expect(h.events.filter((event) => event.type === 'void')).toHaveLength(2);
  });

  it('額度門檻會擋住動作；停錶次數重整後還在', async () => {
    const h = await openHarness();
    h.match.rev = 131;
    h.listener.onMatch(snapshotOf(h.match));
    expect((await h.session.getState().actions.pauseClock()).status).toBe('rejected');
    expect((await h.session.getState().actions.resumeClock()).status).toBe('applied');
    const high = await openHarness();
    high.match.rev = 190;
    high.listener.onMatch(snapshotOf(high.match));
    expect((await high.session.getState().actions.goal({ side: 'home' })).status).toBe('rejected');
    expect(high.session.getState().budget.controlsOnly).toBe(true);
    const cap = await openHarness();
    cap.match.rev = 200;
    cap.listener.onMatch(snapshotOf(cap.match));
    expect((await cap.session.getState().actions.fulltime()).status).toBe('rejected');
    expect(cap.session.getState().budget.exhausted).toBe(true);

    const events = [clockEvent(1, 'pause'), clockEvent(2, 'correct')];
    const first = await openHarness({ events, match: baseMatch({ rev: 2 }) });
    expect(first.session.getState().budget.pauseUses).toBe(1);
    first.session.stop();
    const second = await openHarness({ log: first.log, events, match: baseMatch({ rev: 2 }) });
    expect(second.session.getState().budget.pauseUses).toBe(1);
  });

  it('拿不到分頁鎖就不送', async () => {
    const locks: LockManager = {
      request(_name, _options, callback) {
        void callback(null);
        return Promise.resolve();
      },
    };
    const h = await openHarness({ locks });
    expect(h.session.getState().tabHint).toBe(TAB_HINT);
    const result = await h.session.getState().actions.goal({ side: 'home' });
    expect(result).toEqual({ status: 'rejected', reason: 'rules' });
    expect(h.commits).toHaveLength(0);
  });

  it('IndexedDB 開不起來就改走記憶體並顯示提示', async () => {
    const broken = new IndexedDbActionLog(async () => { throw new Error('開不起來'); });
    expect(await broken.probe()).toBe(false);
    const h = await openHarness({ log: broken });
    expect(h.session.getState().storage).toBe('unavailable');
    expect(h.session.getState().storageHint).toBe(LIVE_COPY.offlineUnstored);
    expect(h.session.getState().control.localSid).toBeNull();
    expect(h.session.getState().control.needsTakeover).toBe(true);
    expect(h.session.getState().control.takeoverSelf).toBe(true);
    const other = await openHarness({
      log: new IndexedDbActionLog(async () => { throw new Error('開不起來'); }),
      control: { uid: 'other', sid: 'other-sid-0123456789', takenAt: 2 },
    });
    expect(other.session.getState().control.needsTakeover).toBe(true);
    expect(other.session.getState().control.takeoverSelf).toBe(false);
    const fresh = await openHarness({
      log: new IndexedDbActionLog(async () => { throw new Error('開不起來'); }),
      control: null,
    });
    expect(fresh.session.getState().control.localSid).toBeNull();
    expect(fresh.session.getState().control.needsTakeover).toBe(true);
    expect(fresh.session.getState().control.takeoverSelf).toBe(true);
    const queued = await h.session.getState().actions.goal({ side: 'home' });
    expect(queued.status).toBe('queued');
    expect(h.session.getState().unapplied.some((row) => row.kind === 'goal')).toBe(true);
  });

  it('重置後舊日誌丟棄且不重送，重新套用也被拒', async () => {
    const log = new MemoryActionLog();
    await log.put(entry({
      op: 'old-goal-old-goal01',
      baseResetRev: 0,
      seq: 1,
      state: 'pending',
      intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 1 },
    }));
    await log.put(entry({
      op: 'old-goal-old-goal02',
      seq: 2,
      state: 'sending',
      intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 2 },
    }));
    const h = await openHarness({
      log,
      match: baseMatch({ rev: 6, resetRev: 5, score: { home: 0, away: 0 } }),
      events: [goalEvent(1, 'home', 'old-goal-old-goal01'), goalEvent(6, 'away', 'kept-goal')],
    });
    const rows = await log.list(CID, MT);
    expect(rows.every((row) => row.state === 'discarded' && row.rejectReason === 'reset')).toBe(true);
    expect(h.commits).toHaveLength(0);
    expect(h.session.getState().events.map((event) => event.seq)).toEqual([6]);
    expect(await h.session.getState().actions.reapply('old-goal-old-goal01')).toEqual({ status: 'rejected', reason: 'reset' });
    expect(h.commits).toHaveLength(0);
  });

  it('剩 1 筆額度時兩步改判被拒、單步動作可過', async () => {
    const near = await openHarness();
    near.match.rev = 189;
    near.listener.onMatch(snapshotOf(near.match));
    expect(await near.session.getState().actions.amend(
      { seq: 1 },
      { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 12 },
    )).toEqual({ status: 'rejected', reason: 'limit' });
    expect(near.commits).toHaveLength(0);
    expect(await near.log.list(CID, MT)).toHaveLength(0);
    expect((await near.session.getState().actions.goal({ side: 'home' })).status).toBe('applied');

    const yellows = await openHarness();
    await yellows.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    await yellows.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    yellows.match.rev = 189;
    yellows.listener.onMatch(snapshotOf(yellows.match));
    const commits = yellows.commits.length;
    expect(await yellows.session.getState().actions.undoFirstYellow({ seq: 1 })).toEqual({ status: 'rejected', reason: 'limit' });
    expect(yellows.commits).toHaveLength(commits);

    const cap = await openHarness();
    cap.match.rev = 199;
    cap.listener.onMatch(snapshotOf(cap.match));
    expect(await cap.session.getState().actions.amend(
      { seq: 1 },
      { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 8 },
    )).toEqual({ status: 'rejected', reason: 'limit' });
    expect((await cap.session.getState().actions.fulltime()).status).toBe('applied');
  });

  it('改判、復原第一黃、重新套用都先過額度', async () => {
    const h = await openHarness();
    await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    h.failBefore = () => { throw { code: 'permission-denied' }; };
    expect((await h.session.getState().actions.goal({ side: 'home' })).status).toBe('rejected');
    h.failBefore = null;
    const op = (await h.log.list(CID, MT)).find((row) => row.state === 'rejected')?.op ?? '';
    h.match.rev = 190;
    h.listener.onMatch(snapshotOf(h.match));
    const before = h.commits.length;
    expect(await h.session.getState().actions.reapply(op)).toEqual({ status: 'rejected', reason: 'limit' });
    expect((await h.log.get(op))?.state).toBe('rejected');
    expect(await h.session.getState().actions.amend(
      { seq: 1 },
      { kind: 'card', side: 'home', plId: 'pl_a', cardType: 'red', matchSecond: 12 },
    )).toEqual({ status: 'rejected', reason: 'limit' });
    expect(await h.session.getState().actions.undoFirstYellow({ seq: 1 })).toEqual({ status: 'rejected', reason: 'limit' });
    expect(h.commits).toHaveLength(before);

    const pause = await openHarness();
    await pause.log.put(entry({
      op: 'rejected-pause-00001',
      state: 'rejected',
      rejectReason: 'rules',
      intent: {
        kind: 'clock',
        matchSecond: 1,
        clockAction: 'pause',
        clock: { running: false, period: 'h1', pausedSec: 1, startedAt: 1 },
      },
    }));
    pause.match.rev = 131;
    pause.listener.onMatch(snapshotOf(pause.match));
    expect(await pause.session.getState().actions.reapply('rejected-pause-00001')).toEqual({ status: 'rejected', reason: 'limit' });
  });

  it('已作廢的第二黃不會讓改判變成改判第一黃', async () => {
    const h = await openHarness();
    await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    expect((await h.session.getState().actions.voidEvent({ seq: 2 })).status).toBe('applied');
    const before = h.commits.length;
    const amended = await h.session.getState().actions.amend(
      { seq: 1 },
      { kind: 'card', side: 'home', plId: 'pl_a', cardType: 'red', matchSecond: 20 },
    );
    expect(amended.status).toBe('applied');
    expect(h.session.getState().groups.some((group) => group.label === 'amendFirstYellow')).toBe(false);
    expect(h.commits.slice(before).filter((plan) => plan.event.type === 'void')).toHaveLength(1);
  });

  it('改判第一黃的新紀錄被拒時說明原紀錄已復原', async () => {
    const h = await openHarness();
    await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    h.failBefore = (plan) => {
      if (plan.event.type === 'card' && plan.event.cardType === 'red') throw { code: 'permission-denied' };
    };
    const result = await h.session.getState().actions.amend(
      { seq: 1 },
      { kind: 'card', side: 'home', plId: 'pl_a', cardType: 'red', matchSecond: 30 },
    );
    expect(result.status).toBe('rejected');
    expect(h.session.getState().groups[0]?.message).toBe(LIVE_COPY.amendHalf);
    const steps = (await h.log.list(CID, MT)).filter((row) => row.group?.label === 'amendFirstYellow');
    expect(groupMessage(steps)).toBe(LIVE_COPY.amendHalf);
  });

  it('非終場動作日誌被清掉時不視為已套用', async () => {
    const inner = new MemoryActionLog();
    const log: ActionLog = {
      probe: () => inner.probe(),
      put: (row) => inner.put(row),
      get: (op) => inner.get(op),
      list: (cid, mtId) => inner.list(cid, mtId),
      async patch(op, patch: LogPatch) {
        const next = await inner.patch(op, patch);
        if (next?.state === 'applied') await inner.remove(op);
        return next;
      },
      remove: (op) => inner.remove(op),
      removeMatch: (cid, mtId) => inner.removeMatch(cid, mtId),
      purgeOlderThan: (nowMs, maxAgeMs) => inner.purgeOlderThan(nowMs, maxAgeMs),
    };
    // P1-A 後確認場本機就不收進球，改成送出當下場次才變成已確認，仍走「終局＋日誌被清」分支。
    const h = await openHarness({ log, match: baseMatch({ rev: 3 }) });
    h.failBefore = () => {
      h.match.status = 'confirmed';
      h.match.lock = { locked: true };
    };
    const result = await h.session.getState().actions.goal({ side: 'home' });
    expect(h.session.getState().match?.status).toBe('confirmed');
    expect(result).toEqual({ status: 'queued' });
    expect(h.commits).toHaveLength(1);
  });

  it('終場日誌被清掉時仍回 applied', async () => {
    const inner = new MemoryActionLog();
    const log: ActionLog = {
      probe: () => inner.probe(),
      put: (row) => inner.put(row),
      get: (op) => inner.get(op),
      list: (cid, mtId) => inner.list(cid, mtId),
      async patch(op, patch: LogPatch) {
        const next = await inner.patch(op, patch);
        if (next?.state === 'applied' && next.kind === 'fulltime') await inner.removeMatch(CID, MT);
        return next;
      },
      remove: (op) => inner.remove(op),
      removeMatch: (cid, mtId) => inner.removeMatch(cid, mtId),
      purgeOlderThan: (nowMs, maxAgeMs) => inner.purgeOlderThan(nowMs, maxAgeMs),
    };
    const h = await openHarness({ log });
    const result = await h.session.getState().actions.fulltime();
    expect(result).toEqual({ status: 'applied' });
    expect(h.match.status).toBe('finished');
    expect(await inner.get((h.commits.at(-1)?.op) ?? '')).toBeNull();
  });
});

describe('韌性日誌與清除', () => {
  it('拋錯後改走記憶體並搬走已讀到的項目', async () => {
    const inner = new MemoryActionLog();
    let throwPatch = false;
    const flaky: ActionLog = {
      probe: () => inner.probe(),
      put: (row) => inner.put(row),
      get: (op) => inner.get(op),
      list: (cid, mtId) => inner.list(cid, mtId),
      patch: async (op, patch) => {
        if (throwPatch) throw new Error('quota');
        return inner.patch(op, patch);
      },
      remove: (op) => inner.remove(op),
      removeMatch: (cid, mtId) => inner.removeMatch(cid, mtId),
      purgeOlderThan: (nowMs, maxAgeMs) => inner.purgeOlderThan(nowMs, maxAgeMs),
    };
    let trips = 0;
    const log = new ResilientActionLog(flaky, () => { trips += 1; });
    const row = entry({ op: 'kept-row-kept-row01', intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 1 } });
    await log.put(row);
    await log.list(CID, MT);
    throwPatch = true;
    const patched = await log.patch(row.op, { state: 'rejected', rejectReason: 'limit' });
    expect(trips).toBe(1);
    expect(patched?.state).toBe('rejected');
    throwPatch = true;
    await log.put(entry({ op: 'after-switch-row001', intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 2 } }));
    const listed = await log.list(CID, MT);
    expect(listed.map((item) => item.op).sort()).toEqual(['after-switch-row001', 'kept-row-kept-row01']);
    expect(await inner.get('after-switch-row001')).toBeNull();
  });

  it('清除用 cursor，在同一個請求鏈裡刪', async () => {
    const rows = new Map<string, LogEntry>();
    const oldRow = entry({ op: 'old-row-old-row0001', createdAt: 1, intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 1 } });
    const newRow = entry({ op: 'new-row-new-row0001', createdAt: 20_000, intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 2 } });
    rows.set(oldRow.op, oldRow);
    rows.set(newRow.op, newRow);
    const db = {
      transaction() {
        let finished = false;
        const tx = {
          error: null,
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          onabort: null as null | (() => void),
          objectStore() {
            return {
              openCursor() {
                const keys = [...rows.keys()];
                let index = 0;
                const req = {
                  result: null as { value: LogEntry; delete: () => void; continue: () => void } | null,
                  onsuccess: null as null | (() => void),
                  onerror: null as null | (() => void),
                };
                const finish = () => {
                  if (finished) return;
                  finished = true;
                  queueMicrotask(() => tx.oncomplete?.());
                };
                const step = () => {
                  if (index >= keys.length) {
                    req.result = null;
                    req.onsuccess?.();
                    finish();
                    return;
                  }
                  const key = keys[index] ?? '';
                  const value = rows.get(key);
                  if (!value) {
                    index += 1;
                    step();
                    return;
                  }
                  let inside = true;
                  req.result = {
                    value,
                    delete() {
                      if (!inside) throw new Error('TransactionInactiveError');
                      rows.delete(key);
                    },
                    continue() {
                      if (!inside) throw new Error('TransactionInactiveError');
                      index += 1;
                      queueMicrotask(step);
                    },
                  };
                  req.onsuccess?.();
                  inside = false;
                };
                queueMicrotask(step);
                return req;
              },
            };
          },
        };
        return tx;
      },
    };
    const log = new IndexedDbActionLog(async () => db as unknown as IDBDatabase);
    await log.purgeOlderThan(10_000, 1000);
    expect([...rows.keys()]).toEqual([newRow.op]);
  });

  it('假 IndexedDB 拋錯後 pending 都在，已清項目不復活', async () => {
    const rows = new Map<string, LogEntry>();
    let broken = false;
    const done = (tx: { oncomplete: null | (() => void); settled: boolean }) => {
      if (tx.settled) return;
      tx.settled = true;
      setTimeout(() => tx.oncomplete?.(), 0);
    };
    const request = <T>(value: T) => {
      const req = {
        result: value,
        error: null,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    };
    const db = {
      transaction() {
        if (broken) throw new Error('TransactionInactiveError');
        const tx = {
          error: null,
          settled: false,
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          onabort: null as null | (() => void),
          objectStore() {
            return {
              put(value: LogEntry) { rows.set(value.op, value); },
              delete(op: string) { rows.delete(op); },
              get(op: string) { return request(rows.get(op)); },
              getAll() { return request([...rows.values()]); },
              index() {
                return {
                  getAll(range: IDBKeyRange) {
                    const key = range.lower as [string, string];
                    return request([...rows.values()].filter((row) => row.cid === key[0] && row.mtId === key[1]));
                  },
                };
              },
              openCursor() {
                const keys = [...rows.keys()];
                let index = 0;
                const req = {
                  result: null as { value: LogEntry; delete: () => void; continue: () => void } | null,
                  onsuccess: null as null | (() => void),
                  onerror: null as null | (() => void),
                };
                const step = () => {
                  if (index >= keys.length) {
                    req.result = null;
                    req.onsuccess?.();
                    return;
                  }
                  const key = keys[index] ?? '';
                  const value = rows.get(key);
                  if (!value) {
                    index += 1;
                    step();
                    return;
                  }
                  let inside = true;
                  req.result = {
                    value,
                    delete() {
                      if (!inside) throw new Error('TransactionInactiveError');
                      rows.delete(key);
                    },
                    continue() {
                      if (!inside) throw new Error('TransactionInactiveError');
                      index += 1;
                      queueMicrotask(step);
                    },
                  };
                  req.onsuccess?.();
                  inside = false;
                };
                queueMicrotask(step);
                return req;
              },
            };
          },
        };
        setTimeout(() => done(tx), 0);
        return tx;
      },
    };
    const inner = new IndexedDbActionLog(async () => db as unknown as IDBDatabase);
    let trips = 0;
    const log = new ResilientActionLog(inner, () => { trips += 1; });
    const here = entry({
      op: 'pending-here-000001',
      createdAt: 20_000,
      intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 1 },
    });
    const there = entry({
      op: 'pending-there-00001',
      cid: 'c2',
      mtId: 'm2',
      createdAt: 20_000,
      intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 2 },
    });
    const old = entry({
      op: 'purged-old-row0001',
      createdAt: 1,
      intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 3 },
    });
    await log.put(here);
    await log.put(there);
    await log.put(old);
    await log.purgeOlderThan(10_000, 1000);
    expect(rows.has(old.op)).toBe(false);
    broken = true;
    await log.put(entry({
      op: 'after-break-row0001',
      createdAt: 21_000,
      intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 4 },
    }));
    expect(trips).toBe(1);
    expect((await log.list(CID, MT)).map((row) => row.op).sort()).toEqual(['after-break-row0001', here.op]);
    expect((await log.list('c2', 'm2')).map((row) => row.op)).toEqual([there.op]);
    expect(rows.has('after-break-row0001')).toBe(false);
  });

  it('purge 拋錯不會讓工作階段起不來', async () => {
    const inner = new MemoryActionLog();
    const log: ActionLog = {
      probe: async () => true,
      put: (row) => inner.put(row),
      get: (op) => inner.get(op),
      list: (cid, mtId) => inner.list(cid, mtId),
      patch: (op, patch) => inner.patch(op, patch),
      remove: (op) => inner.remove(op),
      removeMatch: (cid, mtId) => inner.removeMatch(cid, mtId),
      purgeOlderThan: async () => { throw new Error('TransactionInactiveError'); },
    };
    const h = await openHarness({ log });
    expect(h.session.getState().storage).toBe('unavailable');
    expect(h.session.getState().loading).toBe(false);
  });

  it('start 的 purge 失敗不會丟掉既有 pending', async () => {
    const inner = new MemoryActionLog();
    const pending = entry({
      op: 'kept-pending-000001',
      state: 'pending',
      createdAt: 50_000,
      intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 1 },
    });
    await inner.put(pending);
    const log: ActionLog = {
      probe: async () => true,
      put: (row) => inner.put(row),
      get: (op) => inner.get(op),
      list: (cid, mtId) => inner.list(cid, mtId),
      listAll: () => inner.listAll(),
      patch: (op, patch) => inner.patch(op, patch),
      remove: (op) => inner.remove(op),
      removeMatch: (cid, mtId) => inner.removeMatch(cid, mtId),
      purgeOlderThan: async () => { throw new Error('TransactionInactiveError'); },
    };
    const h = await openHarness({ log });
    expect(h.session.getState().storage).toBe('unavailable');
    expect(h.commits.map((plan) => plan.op)).toEqual([pending.op]);
    expect(h.events.some((event) => event.op === pending.op)).toBe(true);
  });
});

describe('分頁鎖與螢幕鎖定', () => {
  it('BroadcastChannel 第二頁被擋住；都沒有就照常當擁有者', async () => {
    const link = (left: TabChannel, right: TabChannel) => {
      left.postMessage = (data) => { right.onmessage?.({ data }); };
      right.postMessage = (data) => { left.onmessage?.({ data }); };
    };
    const a: TabChannel = { postMessage() {}, onmessage: null, close() {} };
    const b: TabChannel = { postMessage() {}, onmessage: null, close() {} };
    link(a, b);
    const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
    const owner = await acquireTabLock({ name: 'cp-scoring-c-m', locks: null, channel: a, tabId: 'tab-a', wait });
    const blocked = await acquireTabLock({ name: 'cp-scoring-c-m', locks: null, channel: b, tabId: 'tab-b', wait });
    expect(owner.role).toBe('owner');
    expect(blocked.role).toBe('blocked');
    owner.release();
    blocked.release();
    const alone = await acquireTabLock({ name: 'n', locks: null, channel: null, tabId: 'z', wait });
    expect(alone.role).toBe('owner');
  });

  it('同時啟動的兩個分頁只會有一個擁有者', async () => {
    const link = (left: TabChannel, right: TabChannel) => {
      left.postMessage = (data) => { right.onmessage?.({ data }); };
      right.postMessage = (data) => { left.onmessage?.({ data }); };
    };
    const a: TabChannel = { postMessage() {}, onmessage: null, close() {} };
    const b: TabChannel = { postMessage() {}, onmessage: null, close() {} };
    link(a, b);
    const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
    const [left, right] = await Promise.all([
      acquireTabLock({ name: 'cp-scoring-c-m', locks: null, channel: a, tabId: 'id-a', wait, random: () => 0 }),
      acquireTabLock({ name: 'cp-scoring-c-m', locks: null, channel: b, tabId: 'id-b', wait, random: () => 0 }),
    ]);
    const roles = [left.role, right.role].sort();
    expect(roles).toEqual(['blocked', 'owner']);
    expect(right.role).toBe('owner');
    expect(left.role).toBe('blocked');
    left.release();
    right.release();
  });

  it('延遲讓兩邊都當上 owner 後，一次心跳只留下優先的那個', async () => {
    const a: TabChannel = { postMessage() {}, onmessage: null, close() {} };
    const b: TabChannel = { postMessage() {}, onmessage: null, close() {} };
    let delay = true;
    const queued: Array<() => void> = [];
    const send = (to: TabChannel, data: unknown) => {
      const deliver = () => to.onmessage?.({ data });
      if (delay) queued.push(deliver);
      else deliver();
    };
    a.postMessage = (data) => send(b, data);
    b.postMessage = (data) => send(a, data);
    const wait = () => Promise.resolve();
    let roleA = '';
    let roleB = '';
    const [left, right] = await Promise.all([
      acquireTabLock({
        name: 'cp-scoring-c-m', locks: null, channel: a, tabId: 'id-a', wait, random: () => 0,
        onRole: (role) => { roleA = role; },
      }),
      acquireTabLock({
        name: 'cp-scoring-c-m', locks: null, channel: b, tabId: 'id-b', wait, random: () => 0,
        onRole: (role) => { roleB = role; },
      }),
    ]);
    roleA = left.role;
    roleB = right.role;
    expect(roleA).toBe('owner');
    expect(roleB).toBe('owner');
    delay = false;
    b.onmessage?.({ data: { type: 'beat', tabId: 'id-a' } });
    a.onmessage?.({ data: { type: 'beat', tabId: 'id-b' } });
    await Promise.resolve();
    await Promise.resolve();
    expect(roleA).toBe('blocked');
    expect(roleB).toBe('owner');
    left.release();
    right.release();
    expect(queued.length).toBeGreaterThan(0);
  });

  it('要得到鎖就標持有；失敗就標不支援', async () => {
    let state = '';
    const ok = bindWakeLock({
      request: async () => ({ release: async () => {} }),
      active: () => true,
      visible: () => true,
      onChange: (next) => { state = next; },
    });
    ok.refresh();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(state).toBe('held');
    ok.stop();
    const bad = bindWakeLock({
      request: async () => { throw new Error('no'); },
      active: () => true,
      visible: () => true,
      onChange: (next) => { state = next; },
    });
    bad.refresh();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(state).toBe('unsupported');
    bad.stop();
  });
});

describe('暫停與 PK 意圖層', () => {
  function ready(h: Harness, patch?: Partial<ServerMatch>): void {
    h.match.status = 'live';
    h.match.score = patch?.score ?? { home: 0, away: 0 };
    h.match.clockBase = patch?.clockBase ?? { startedAt: null, pausedSec: 90, running: false, period: 'h2' };
    h.match.penaltyScore = patch?.penaltyScore ?? null;
    h.listener.onMatch(snapshotOf(h.match));
  }

  it('時鐘在走才停錶；已停只送事件；事件沒有 stopClock', async () => {
    const running = await openHarness();
    const stoppedClock = await running.session.getState().actions.timeout({ side: 'home' });
    expect(stoppedClock.status).toBe('applied');
    expect(running.commits[0]?.event.side).toBe('home');
    expect(running.commits[0]?.event).not.toHaveProperty('stopClock');
    expect(running.commits[0]?.match.clockBase).toMatchObject({ running: false, period: 'h1' });
    expect(running.match.clockBase.running).toBe(false);

    const parked = await openHarness({
      match: baseMatch({ clockBase: { startedAt: null, pausedSec: 40, running: false, period: 'h2' } }),
    });
    const quiet = await parked.session.getState().actions.timeout({ side: 'away' });
    expect(quiet.status).toBe('applied');
    expect(parked.commits[0]?.match.clockBase).toBeUndefined();
    expect(parked.match.clockBase.running).toBe(false);
    expect(parked.match.clockBase.pausedSec).toBe(40);
  });

  it('額度超過 130 時停錶型暫停被擋且不寫日誌，不停錶的仍可記', async () => {
    const h = await openHarness();
    h.match.rev = 131;
    h.listener.onMatch(snapshotOf(h.match));
    const blocked = await h.session.getState().actions.timeout({ side: 'home' });
    expect(blocked).toEqual({ status: 'rejected', reason: 'limit' });
    expect(h.commits).toHaveLength(0);
    expect(await h.log.list(CID, MT)).toHaveLength(0);
    const quiet = await h.session.getState().actions.timeout({ side: 'away', stopClock: false });
    expect(quiet.status).toBe('applied');
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]?.match.clockBase).toBeUndefined();
  });

  it('比分不平、時鐘還在走、或已開始時 pkStart 不寫日誌', async () => {
    const uneven = await openHarness();
    ready(uneven, { score: { home: 1, away: 0 } });
    expect(await uneven.session.getState().actions.pkStart()).toEqual({ status: 'rejected', reason: 'rules' });
    expect(uneven.commits).toHaveLength(0);
    expect(await uneven.log.list(CID, MT)).toHaveLength(0);

    const running = await openHarness();
    ready(running, { clockBase: { startedAt: 1, pausedSec: 10, running: true, period: 'h2' } });
    expect(await running.session.getState().actions.pkStart()).toEqual({ status: 'rejected', reason: 'rules' });
    expect(await running.log.list(CID, MT)).toHaveLength(0);

    const begun = await openHarness();
    ready(begun, { penaltyScore: { home: 0, away: 0 }, clockBase: { startedAt: null, pausedSec: 90, running: false, period: 'pk' } });
    expect(begun.session.getState().pk.canStart).toBe(false);
    expect(begun.session.getState().pk.started).toBe(true);
    expect(await begun.session.getState().actions.pkStart()).toEqual({ status: 'rejected', reason: 'rules' });
    expect(await begun.log.list(CID, MT)).toHaveLength(0);
  });

  it('pkStart 之後進、沒進、作廢進的那腳，正規比分不變', async () => {
    const h = await openHarness();
    ready(h, { score: { home: 1, away: 1 } });
    expect(h.session.getState().pk.canStart).toBe(true);
    expect((await h.session.getState().actions.pkStart()).status).toBe('applied');
    expect(h.match.penaltyScore).toEqual({ home: 0, away: 0 });
    expect(h.match.clockBase.period).toBe('pk');
    expect(h.match.score).toEqual({ home: 1, away: 1 });
    expect(h.session.getState().pk.canStart).toBe(false);
    expect((await h.session.getState().actions.pk({ side: 'home', scored: true, plId: 'pl_a' })).status).toBe('applied');
    expect(h.match.penaltyScore).toEqual({ home: 1, away: 0 });
    expect((await h.session.getState().actions.pk({ side: 'away', scored: false })).status).toBe('applied');
    expect(h.match.penaltyScore).toEqual({ home: 1, away: 0 });
    expect(h.commits.at(-1)?.match.penaltyScore).toBeUndefined();
    const scored = h.events.find((event) => event.type === 'pk' && event.scored);
    expect((await h.session.getState().actions.voidEvent({ seq: scored?.seq })).status).toBe('applied');
    expect(h.match.penaltyScore).toEqual({ home: 0, away: 0 });
    expect(h.match.score).toEqual({ home: 1, away: 1 });
  });

  it('PK 期間一般進球、作廢一般進球、改判進球與離開 pk 的時鐘都不寫日誌', async () => {
    const h = await openHarness();
    expect((await h.session.getState().actions.goal({ side: 'home' })).status).toBe('applied');
    expect((await h.session.getState().actions.goal({ side: 'away' })).status).toBe('applied');
    h.match.clockBase = { startedAt: null, pausedSec: 200, running: false, period: 'h2' };
    h.listener.onMatch(snapshotOf(h.match));
    expect((await h.session.getState().actions.pkStart()).status).toBe('applied');
    const before = h.commits.length;
    const logged = (await h.log.list(CID, MT)).length;
    const goal = h.events.find((event) => event.type === 'goal');
    expect(await h.session.getState().actions.goal({ side: 'home' })).toEqual({ status: 'rejected', reason: 'rules' });
    expect(await h.session.getState().actions.voidEvent({ seq: goal?.seq })).toEqual({ status: 'rejected', reason: 'rules' });
    expect(await h.session.getState().actions.amend(
      { seq: goal?.seq },
      { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 12 },
    )).toEqual({ status: 'rejected', reason: 'rules' });
    expect(await h.session.getState().actions.halftime()).toEqual({ status: 'rejected', reason: 'rules' });
    expect(await h.session.getState().actions.correctClock({
      running: false, period: 'ft', pausedSec: 200, startedAt: null,
    })).toEqual({ status: 'rejected', reason: 'rules' });
    expect(h.commits).toHaveLength(before);
    expect(await h.log.list(CID, MT)).toHaveLength(logged);
    expect((await h.session.getState().actions.fulltime()).status).toBe('applied');
    expect(h.commits.at(-1)?.match.clockBase?.period).toBe('pk');
    expect(h.match.status).toBe('finished');
  });

  it('暫停與 pkStart 不能作廢；牌在 PK 期間仍可作廢', async () => {
    const h = await openHarness();
    ready(h);
    expect((await h.session.getState().actions.timeout({ side: 'home' })).status).toBe('applied');
    const timeoutSeq = h.events.find((event) => event.type === 'timeout')?.seq;
    const logged = (await h.log.list(CID, MT)).length;
    expect(await h.session.getState().actions.voidEvent({ seq: timeoutSeq })).toEqual({ status: 'rejected', reason: 'rules' });
    expect(await h.log.list(CID, MT)).toHaveLength(logged);
    expect((await h.session.getState().actions.pkStart()).status).toBe('applied');
    const startSeq = h.events.find((event) => event.type === 'pkStart')?.seq;
    expect(await h.session.getState().actions.voidEvent({ seq: startSeq })).toEqual({ status: 'rejected', reason: 'rules' });
    expect((await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' })).status).toBe('applied');
    const cardSeq = h.events.find((event) => event.type === 'card')?.seq;
    expect((await h.session.getState().actions.voidEvent({ seq: cardSeq })).status).toBe('applied');
  });
});

describe('P1-A 疊加狀態擋規則不允許的動作', () => {
  function serverStatus(h: Harness, status: string): void {
    h.match.status = status;
    h.listener.onMatch(snapshotOf(h.match));
  }

  async function goalAt(h: Harness): Promise<number> {
    expect((await h.session.getState().actions.goal({ side: 'home' })).status).toBe('applied');
    const seq = h.events.filter((event) => event.type === 'goal').at(-1)?.seq;
    expect(seq).toBeTypeOf('number');
    return seq as number;
  }

  it('overlayStatus：已套用未追上與待送的階段動作才疊加，被拒與捨棄的不算', () => {
    const match = baseMatch({ rev: 2 });
    const phase = (op: string, kind: 'halftime' | 'resume' | 'fulltime', patch: Partial<LogEntry> = {}) => entry({
      op,
      intent: { kind, matchSecond: 1, clock: { running: false, period: 'ht', pausedSec: 1, startedAt: 1 } },
      ...patch,
    });
    expect(overlayStatus(match, [phase('a', 'halftime', { state: 'rejected' })])).toBe('live');
    expect(overlayStatus(match, [phase('a', 'halftime', { state: 'discarded' })])).toBe('live');
    expect(overlayStatus(match, [phase('a', 'halftime', { state: 'applied', seq: 2 })])).toBe('live');
    expect(overlayStatus(match, [phase('a', 'halftime', { state: 'applied', seq: 3 })])).toBe('halftime');
    expect(overlayStatus(match, [phase('a', 'halftime', { state: 'sending' })])).toBe('halftime');
    expect(overlayStatus(match, [
      phase('b', 'resume', { createdAt: 2 }),
      phase('a', 'halftime', { createdAt: 1 }),
    ])).toBe('live');
    expect(overlayStatus(match, [phase('a', 'fulltime')])).toBe('finished');
  });

  it('中場改判進球：不產生作廢、不寫日誌與佇列，回 rules；復原照常', async () => {
    const h = await openHarness();
    const seq = await goalAt(h);
    expect((await h.session.getState().actions.halftime()).status).toBe('applied');
    expect(h.match.status).toBe('halftime');
    expect(h.session.getState().liveStatus).toBe('halftime');
    const commits = h.commits.length;
    const logged = (await h.log.list(CID, MT)).length;
    expect(await h.session.getState().actions.amend(
      { seq },
      { kind: 'goal', side: 'home', goalKind: 'penalty', matchSecond: 12 },
    )).toEqual({ status: 'rejected', reason: 'rules' });
    expect(h.commits).toHaveLength(commits);
    expect(await h.log.list(CID, MT)).toHaveLength(logged);
    expect(h.events.some((event) => event.type === 'void')).toBe(false);
    expect(h.match.score).toEqual({ home: 1, away: 0 });
    expect(await h.session.getState().actions.goal({ side: 'away' })).toEqual({ status: 'rejected', reason: 'rules' });
    expect((await h.session.getState().actions.voidEvent({ seq })).status).toBe('applied');
    expect(h.match.score).toEqual({ home: 0, away: 0 });
    expect((await h.session.getState().actions.resume()).status).toBe('applied');
  });

  it('live 時改判進球照舊：先作廢再記新進球', async () => {
    const h = await openHarness();
    const seq = await goalAt(h);
    expect((await h.session.getState().actions.amend(
      { seq },
      { kind: 'goal', side: 'home', goalKind: 'penalty', matchSecond: 12 },
    )).status).toBe('applied');
    expect(h.events.map((event) => event.type)).toEqual(['goal', 'void', 'goal']);
    expect(h.match.score).toEqual({ home: 1, away: 0 });
  });

  it('改判進球帶 matchSecond 0 時保留 0，不換成按改判當下的時間', async () => {
    const h = await openHarness();
    const seq = await goalAt(h);
    // 時鐘停在 90 秒：舊寫法（||）會把 0 換成 90
    h.match.clockBase = { startedAt: null, pausedSec: 90, running: false, period: 'h1' };
    h.listener.onMatch(snapshotOf(h.match));
    expect((await h.session.getState().actions.amend(
      { seq },
      { kind: 'goal', side: 'home', goalKind: 'penalty', matchSecond: 0 },
    )).status).toBe('applied');
    const last = h.events[h.events.length - 1];
    expect(last?.type).toBe('goal');
    expect(last?.matchSecond).toBe(0);
  });

  it('伺服器仍 live、本機已按半場（待送）：改判進球也被擋', async () => {
    const h = await openHarness();
    const seq = await goalAt(h);
    h.online = false;
    expect((await h.session.getState().actions.halftime()).status).toBe('queued');
    expect(h.match.status).toBe('live');
    expect(h.session.getState().liveStatus).toBe('halftime');
    const logged = (await h.log.list(CID, MT)).length;
    expect(await h.session.getState().actions.amend(
      { seq },
      { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 12 },
    )).toEqual({ status: 'rejected', reason: 'rules' });
    expect(await h.log.list(CID, MT)).toHaveLength(logged);
  });

  it('被拒的半場不算中場：之後 live 記進球照樣放行', async () => {
    const h = await openHarness();
    h.failBefore = (plan) => {
      if (plan.event.type === 'halftime') throw { code: 'permission-denied' };
    };
    expect(await h.session.getState().actions.halftime()).toEqual({ status: 'rejected', reason: 'rules' });
    expect(h.session.getState().liveStatus).toBe('live');
    h.failBefore = null;
    const result = await h.session.getState().actions.goal({ side: 'home' });
    expect(result).not.toEqual({ status: 'rejected', reason: 'rules' });
    const rows = await h.log.list(CID, MT);
    expect(rows.some((row) => row.kind === 'goal' && row.state !== 'rejected')).toBe(true);
  });

  it('被拒的進球：live 時重新套用放行，中場時重新套用被擋且不改日誌', async () => {
    for (const status of ['live', 'halftime'] as const) {
      const h = await openHarness();
      h.failBefore = (plan) => {
        if (plan.event.type === 'goal') throw { code: 'permission-denied' };
      };
      expect(await h.session.getState().actions.goal({ side: 'home' })).toEqual({ status: 'rejected', reason: 'rules' });
      h.failBefore = null;
      const failed = (await h.log.list(CID, MT)).find((row) => row.state === 'rejected');
      expect(failed?.kind).toBe('goal');
      if (status === 'halftime') serverStatus(h, 'halftime');
      const commits = h.commits.length;
      const result = await h.session.getState().actions.reapply(failed?.op ?? '');
      if (status === 'live') {
        expect(result.status).toBe('applied');
        expect(h.match.score.home).toBe(1);
      } else {
        expect(result).toEqual({ status: 'rejected', reason: 'rules' });
        expect(h.commits).toHaveLength(commits);
        expect((await h.log.get(failed?.op ?? ''))?.state).toBe('rejected');
      }
      h.stop();
    }
  });

  it('Opus 終審 P2-1 A：被拒進球之後才排入待送半場，重新套用仍放行（送出順序在半場之前）', async () => {
    const h = await openHarness();
    h.failBefore = (plan) => {
      if (plan.event.type === 'goal') throw { code: 'permission-denied' };
    };
    expect(await h.session.getState().actions.goal({ side: 'home' })).toEqual({ status: 'rejected', reason: 'rules' });
    h.failBefore = null;
    const failed = (await h.log.list(CID, MT)).find((row) => row.state === 'rejected');
    h.online = false;
    // 第 4 步 A F5-3：有被拒項目時階段動作不再建項目（回 blocked）。待送半場只會在被拒之前就已排入，這裡直接放進日誌。
    expect(await h.session.getState().actions.halftime()).toEqual({ status: 'rejected', reason: 'blocked' });
    await h.log.put(entry({
      op: 'queued-halftime-op01',
      intent: { kind: 'halftime', matchSecond: 60, clock: { running: false, period: 'ht', pausedSec: 60, startedAt: 1 } },
      createdAt: (failed?.createdAt ?? 0) + 5,
    }));
    h.listener.onMatch(snapshotOf(h.match));
    await h.session.whenIdle();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(h.session.getState().liveStatus).toBe('halftime');
    const result = await h.session.getState().actions.reapply(failed?.op ?? '');
    expect(result).not.toEqual({ status: 'rejected', reason: 'rules' });
    expect((await h.log.get(failed?.op ?? ''))?.state).toBe('pending');
  });

  it('Opus 終審 P2-1 B：中場被拒進球之後排入待送續賽，重新套用要擋（送出時伺服器仍在中場）', async () => {
    const h = await openHarness();
    h.failBefore = (plan) => {
      if (plan.event.type === 'goal') throw { code: 'permission-denied' };
    };
    expect(await h.session.getState().actions.goal({ side: 'home' })).toEqual({ status: 'rejected', reason: 'rules' });
    h.failBefore = null;
    const failed = (await h.log.list(CID, MT)).find((row) => row.state === 'rejected');
    // 被拒那筆會暫停佇列，所以直接讓伺服器進中場（等同另一路徑已送出半場）。
    serverStatus(h, 'halftime');
    h.online = false;
    expect(await h.session.getState().actions.resume()).toEqual({ status: 'rejected', reason: 'blocked' });
    await h.log.put(entry({
      op: 'queued-resume-op0001',
      intent: { kind: 'resume', matchSecond: 60, clock: { running: true, period: 'h2', pausedSec: 60, startedAt: 1 } },
      createdAt: (failed?.createdAt ?? 0) + 5,
    }));
    h.listener.onMatch(snapshotOf(h.match));
    await h.session.whenIdle();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(h.session.getState().liveStatus).toBe('live');
    const logged = (await h.log.list(CID, MT)).length;
    expect(await h.session.getState().actions.reapply(failed?.op ?? '')).toEqual({ status: 'rejected', reason: 'rules' });
    expect(await h.log.list(CID, MT)).toHaveLength(logged);
    expect((await h.log.get(failed?.op ?? ''))?.state).toBe('rejected');
  });

  it('Opus 終審 P2-2：待送終場後復原第一黃（連帶第二黃）回 rules，日誌不變', async () => {
    const h = await openHarness();
    await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' });
    h.online = false;
    expect((await h.session.getState().actions.fulltime()).status).toBe('queued');
    expect(h.session.getState().liveStatus).toBe('finished');
    const logged = (await h.log.list(CID, MT)).length;
    expect(await h.session.getState().actions.undoFirstYellow({ seq: 1 })).toEqual({ status: 'rejected', reason: 'rules' });
    expect(await h.log.list(CID, MT)).toHaveLength(logged);
  });

  it('階段動作依疊加狀態擋：開賽、半場、續賽、終場、撤回終場各一正一反', async () => {
    const h = await openHarness({
      match: baseMatch({ status: 'scheduled', clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' } }),
    });
    const act = h.session.getState().actions;
    const rules = { status: 'rejected', reason: 'rules' };
    expect(await act.halftime()).toEqual(rules);
    expect(await act.resume()).toEqual(rules);
    expect(await act.fulltime()).toEqual(rules);
    expect(await act.undoFinish()).toEqual(rules);
    expect(await act.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' })).toEqual(rules);
    expect(await act.goal({ side: 'home' })).toEqual(rules);
    expect(h.commits).toHaveLength(0);
    expect((await act.kickoff()).status).toBe('applied');
    expect(await act.kickoff()).toEqual(rules);
    expect(await act.resume()).toEqual(rules);
    expect((await act.halftime()).status).toBe('applied');
    expect(await act.halftime()).toEqual(rules);
    expect((await act.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' })).status).toBe('applied');
    expect((await act.resume()).status).toBe('applied');
    expect(await act.undoFinish()).toEqual(rules);
    expect((await act.fulltime()).status).toBe('applied');
    expect(h.match.status).toBe('finished');
    expect(await act.fulltime()).toEqual(rules);
    expect((await act.undoFinish()).status).toBe('applied');
    expect(h.match.status).toBe('live');
  });
});

describe('半場鈕看疊加後的節次', () => {
  afterEach(() => cleanup());

  it('本機已按下半場開始（待送）、伺服器還在中場：疊加節次是 h2，半場鈕不顯示', async () => {
    const h = await openHarness();
    expect((await h.session.getState().actions.halftime()).status).toBe('applied');
    expect(h.match.status).toBe('halftime');
    h.online = false;
    expect((await h.session.getState().actions.resume()).status).toBe('queued');
    const state = h.session.getState();
    expect(state.match?.status).toBe('halftime');
    expect(state.liveStatus).toBe('live');
    const props = scorePadPropsFrom(state, 1_700_000_000_000);
    expect(props.match.clockBase.period).toBe('h2');
    render(jsx(ScorePad, props));
    expect(screen.queryByRole('button', { name: LIVE_COPY.halftime })).toBeNull();
  });
});

describe('預演：離線記一球比分多加（延遲補償的本機快照已含這一筆）', () => {
  const goal = (patch: Partial<LogEntry>) => entry({
    op: 'g1',
    intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 30 },
    ...patch,
  });

  it('送出中且 seq 已被快照涵蓋：比分不重複加，但仍算待送筆數', () => {
    const match = baseMatch({ rev: 5, score: { home: 1, away: 2 } });
    const over = overlayScore(match, [], [goal({ state: 'sending', seq: 5 })]);
    expect(over.score).toEqual({ home: 1, away: 2 });
    expect(over.pendingCount).toBe(1);
  });

  it('送出中但快照還沒涵蓋（seq > rev）：照常疊加', () => {
    const match = baseMatch({ rev: 4, score: { home: 1, away: 1 } });
    expect(overlayScore(match, [], [goal({ state: 'sending', seq: 5 })]).score).toEqual({ home: 1, away: 2 });
  });

  it('還沒排定序號的待送：照常疊加', () => {
    const match = baseMatch({ rev: 4, score: { home: 1, away: 1 } });
    expect(overlayScore(match, [], [goal({ state: 'pending' })]).score).toEqual({ home: 1, away: 2 });
  });

  it('被涵蓋的待送半場也不重複算進狀態', () => {
    const match = baseMatch({ rev: 6, status: 'halftime' });
    const ht = entry({
      op: 'h1',
      intent: { kind: 'halftime', matchSecond: 1, clock: { running: false, period: 'ht', pausedSec: 1, startedAt: 1 } },
      state: 'sending',
      seq: 6,
    });
    expect(overlayStatus(match, [ht])).toBe('halftime');
  });
});

describe('預演離線疊加：額度與連記兩球（Opus 終審 c、e）', () => {
  it('離線連記兩球：第一球已被快照涵蓋、第二球未排序號 → 只多一球，待送 2 筆', () => {
    const match = baseMatch({ rev: 6, score: { home: 1, away: 2 } });
    const covered = entry({ op: 'g1', intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 30 }, state: 'sending', seq: 6 });
    const next = entry({ op: 'g2', intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 40 }, state: 'pending', createdAt: 2 });
    const over = overlayScore(match, [], [covered, next]);
    expect(over.score).toEqual({ home: 1, away: 3 });
    expect(over.pendingCount).toBe(2);
  });

  it('事件額度：被快照 rev 涵蓋的送出中項目不重算', () => {
    const covered = entry({ op: 'g1', intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 30 }, state: 'sending', seq: 6 });
    expect(budgetView(6, 0, [covered], []).used).toBe(6);
    const fresh = entry({ op: 'g2', intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 30 }, state: 'sending', seq: 7 });
    expect(budgetView(6, 0, [fresh], []).used).toBe(7);
  });

  it('停錶次數：本機快照已讀進事件的待送停錶不重算（依 op 去重）', () => {
    const pending = entry({
      op: 'pause-op-0000000001',
      intent: { kind: 'timeout', side: 'home', matchSecond: 1, stopClock: true, clock: { running: false, period: 'h1', pausedSec: 1, startedAt: 1 } },
      state: 'sending',
      seq: 3,
    });
    const echoed = { seq: 3, type: 'timeout', op: 'pause-op-0000000001', sid: SID, side: 'home' as const, matchSecond: 1, createdAt: 1 };
    expect(pauseUseCount([echoed], [pending], 0, true)).toBe(1);
    expect(pauseUseCount([], [pending], 0, true)).toBe(1);
  });

  it('停錶（時鐘 pause）：本機快照已讀進的單筆 pause 仍算 1 次（floor 吸收、待送補回）', () => {
    const pending = entry({
      op: 'clock-pause-000000001',
      intent: { kind: 'clock', matchSecond: 1, clockAction: 'pause', clock: { running: false, period: 'h1', pausedSec: 1, startedAt: 1 } },
      state: 'sending',
      seq: 3,
    });
    const echoed = { seq: 3, type: 'clock', op: 'clock-pause-000000001', sid: SID, matchSecond: 1, createdAt: 1 };
    expect(pauseUseCount([echoed], [pending], 0)).toBe(1);
  });
});


describe('第 4 步 A：本機未確認寫入（hasPendingWrites）不得當成伺服器已確認', () => {
  it('decideRetry：pending 且沒有已確認的對應 → inflight（不換號、不重送、不標 applied）', () => {
    expect(decideRetry({ op: 'op-a', seq: 3 }, { rev: 5, eventAtSeq: null, matchedSeq: null, pending: true }, false))
      .toEqual({ kind: 'inflight' });
    expect(decideRetry({ op: 'op-a' }, { rev: 5, eventAtSeq: null, matchedSeq: null, pending: true }, false))
      .toEqual({ kind: 'inflight' });
    // 沒有 pending 時照舊依 S2。
    expect(decideRetry({ op: 'op-a', seq: 3 }, { rev: 5, eventAtSeq: null, matchedSeq: null }, false))
      .toEqual({ kind: 'resequence' });
  });

  it('decideRetry：已確認的 matchedSeq／eventAtSeq 對到自己 → applied（pending 也一樣）；重置仍最優先', () => {
    expect(decideRetry({ op: 'op-a', seq: 3 }, { rev: 5, eventAtSeq: null, matchedSeq: 4, pending: true }, false))
      .toEqual({ kind: 'applied', seq: 4 });
    expect(decideRetry({ op: 'op-a', seq: 3 }, { rev: 5, eventAtSeq: { op: 'op-a' }, matchedSeq: null, pending: true }, false))
      .toEqual({ kind: 'applied', seq: 3 });
    expect(decideRetry({ op: 'op-a', seq: 3, baseResetRev: 0 }, { rev: 5, resetRev: 2, eventAtSeq: null, matchedSeq: null, pending: true }, false))
      .toEqual({ kind: 'discard', reason: 'reset' });
  });

  /** 重整後的持久化佇列：日誌是 sending（已取號），這個頁面沒有 commit promise；SDK 讀取疊上自己的寫入。 */
  function persistedPort(state: {
    match: ServerMatch;
    events: ServerEvent[];
    pending: boolean;
    control: ServerControl | null;
    plans: BatchPlan[];
  }): ScoringPort {
    return {
      async commit(plan) {
        state.plans.push(plan);
        if (!state.control || state.control.sid !== SID) throw { code: 'permission-denied' };
        applyPlanLocal(state.match, state.events, plan, 10);
      },
      async loadServer() {
        return { match: snapshotOf(state.match), control: state.control ? { ...state.control } : null, pending: state.pending };
      },
      async loadTimelineFrom(minSeq, resetRev) {
        return {
          events: state.events.filter((event) => event.seq >= minSeq && event.seq > resetRev).map((event) => ({ ...event })),
          pending: state.pending,
        };
      },
      knownEvents: () => state.events,
      async takeover() {},
    };
  }

  it('recover：pending 時 sending 項目維持原狀與 seq、不 commit；pending 轉 false 後依已確認資料重送', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'persist-op-0000001', state: 'sending', seq: 1, intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 5 } });
    await log.put(goal);
    const state = { match: baseMatch(), events: [] as ServerEvent[], pending: true, control: { uid: UID, sid: SID, takenAt: 1 }, plans: [] as BatchPlan[] };
    const changes: number[] = [];
    const sender = new Sender({
      log, port: persistedPort(state), uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100,
      onChange: () => changes.push(1),
    });
    await sender.flush();
    expect(await log.get(goal.op)).toMatchObject({ state: 'sending', seq: 1 });
    expect(state.plans).toHaveLength(0);
    // 持久化佇列的那筆被拒（伺服器沒有 e1、rev 仍 0），快照回滾後 pending 變 false，監聽觸發 flush。
    state.pending = false;
    await sender.flush();
    expect(state.plans).toHaveLength(1);
    expect(state.plans[0]?.seq).toBe(1);
    expect(await log.get(goal.op)).toMatchObject({ state: 'applied', seq: 1 });
    expect(state.match.score).toEqual({ home: 1, away: 0 });
    expect(changes.length).toBeGreaterThan(0);
  });

  it('recover：pending 轉 false 時伺服器已有自己的 e1 → applied、不再送', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'persist-op-0000002', state: 'sending', seq: 1, intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 5 } });
    await log.put(goal);
    const state = { match: baseMatch(), events: [] as ServerEvent[], pending: true, control: { uid: UID, sid: SID, takenAt: 1 }, plans: [] as BatchPlan[] };
    const sender = new Sender({ log, port: persistedPort(state), uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    expect(await log.get(goal.op)).toMatchObject({ state: 'sending', seq: 1 });
    state.match.rev = 1;
    state.match.score.home = 1;
    state.events.push({ ...goalEvent(1, 'home', goal.op) });
    state.pending = false;
    await sender.flush();
    expect(state.plans).toHaveLength(0);
    expect(await log.get(goal.op)).toMatchObject({ state: 'applied', seq: 1 });
  });

  it('recover：重整後另一台接手、持久化寫入被拒 → 原頁面出現被拒（takenOver），不默默當成已送出', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'persist-op-0000003', state: 'sending', seq: 1, createdAt: 1, intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 5 } });
    await log.put(goal);
    const state = { match: baseMatch(), events: [] as ServerEvent[], pending: true, control: { uid: UID, sid: SID, takenAt: 1 } as ServerControl | null, plans: [] as BatchPlan[] };
    const sender = new Sender({ log, port: persistedPort(state), uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    expect((await log.get(goal.op))?.state).toBe('sending');
    state.control = { uid: UID, sid: 'other-device-sid-00009', takenAt: 2 };
    state.pending = false;
    await sender.flush();
    expect(await log.get(goal.op)).toMatchObject({ state: 'rejected', rejectReason: 'takenOver' });
    expect(state.plans).toHaveLength(0);
  });

  it('sendOne catch：日誌先被標 applied（推定）、commit 仍被拒 → 照樣分類成被拒，不吞掉', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'catch-op-000000001', intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 5 } });
    await log.put(goal);
    const match = baseMatch();
    let control: ServerControl = { uid: UID, sid: SID, takenAt: 1 };
    const port: ScoringPort = {
      async commit() {
        await log.patch(goal.op, { state: 'applied', seq: 1 });
        control = { uid: UID, sid: 'other-device-sid-00008', takenAt: 2 };
        throw { code: 'permission-denied' };
      },
      async loadServer() { return { match: snapshotOf(match), control: { ...control }, pending: false }; },
      async loadTimelineFrom() { return { events: [], pending: false }; },
      knownEvents: () => [],
      async takeover() {},
    };
    const sender = new Sender({ log, port, uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    expect(await log.get(goal.op)).toMatchObject({ state: 'rejected', rejectReason: 'takenOver', seq: 1 });
  });

  it('sendOne catch：被拒後讀到別筆未確認寫入 → 維持送出中等待，不用疊加過的 rev 判衝突', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'catch-op-000000002', intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 5 } });
    await log.put(goal);
    const match = baseMatch();
    let pending = false;
    const port: ScoringPort = {
      async commit() {
        pending = true;
        throw { code: 'permission-denied' };
      },
      async loadServer() { return { match: snapshotOf({ ...match, rev: pending ? 1 : 0 }), control: { uid: UID, sid: SID, takenAt: 1 }, pending }; },
      async loadTimelineFrom() { return { events: [], pending }; },
      knownEvents: () => [],
      async takeover() {},
    };
    const sender = new Sender({ log, port, uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    const row = await log.get(goal.op);
    expect(row?.state).toBe('sending');
    expect(row?.seq).toBe(1);
    expect(row?.autoRetried).not.toBe(true);
  });

  it('session：送出中先來 rev=seq 的本機快照，之後被拒並回滾 → 比分、事件、待送都回到送出前，被拒列自己出現', async () => {
    const h = await openHarness();
    let releaseGate = () => {};
    h.gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const action = h.session.getState().actions.goal({ side: 'home', plId: 'pl_a' });
    for (let i = 0; i < 30 && h.commits.length < 1; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(h.commits).toHaveLength(1);
    // SDK 延遲補償：本機快照先到（rev=1、1:0）。
    h.listener.onMatch({ ...snapshotOf(h.match), rev: 1, score: { home: 1, away: 0 } });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(h.session.getState().score.home).toBe(1);
    // 另一台接手，寫入被拒；SDK 回滾快照（rev 0）。
    h.control = { uid: UID, sid: 'other-device-sid-00007', takenAt: 2 };
    h.failBefore = () => { throw { code: 'permission-denied' }; };
    releaseGate();
    h.gate = null;
    const result = await action;
    expect(result).toEqual({ status: 'rejected', reason: 'takenOver' });
    h.listener.onMatch(snapshotOf(h.match));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    const view = h.session.getState();
    expect(view.score).toMatchObject({ home: 0, away: 0, pendingCount: 0 });
    expect(view.events).toEqual([]);
    expect(view.unapplied.map((row) => `${row.kind}:${row.state}:${row.rejectReason}`)).toEqual(['goal:rejected:takenOver']);
  });

  it('F4：sender 標被拒後不用任何動作，工作階段自己重讀日誌並更新畫面', async () => {
    const h = await openHarness();
    let releaseGate = () => {};
    h.gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    h.online = false;
    expect((await h.session.getState().actions.goal({ side: 'home' })).status).toBe('queued');
    for (let i = 0; i < 30 && h.commits.length < 1; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(h.session.getState().unapplied.map((row) => row.state)).toEqual(['sending']);
    const seen: string[] = [];
    h.session.subscribe((view) => { seen.push(view.unapplied.map((row) => row.state).join(',')); });
    h.control = { uid: UID, sid: 'other-device-sid-00006', takenAt: 2 };
    h.failBefore = () => { throw { code: 'permission-denied' }; };
    // 寫入被拒只發生在 sender 內部，沒有任何會 emit 的動作或快照；只靠 onChange 更新畫面。
    releaseGate();
    await h.session.whenIdle();
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(h.session.getState().unapplied.map((row) => row.state)).toEqual(['rejected']);
    expect(seen.at(-1)).toBe('rejected');
  });

  it('已套用、監聽還沒讀到事件時：連記兩張黃牌第二張仍是第二黃，復原第一黃會連帶第二黃', async () => {
    const h = await openHarness();
    // 監聽改成只在已確認快照後讀事件：commit 回來到事件讀進來之間有空檔。這裡讓事件一直不送進工作階段。
    h.listener = { ...h.listener, onEvents() {} };
    expect((await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' })).status).toBe('applied');
    expect((await h.session.getState().actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' })).status).toBe('applied');
    expect(h.commits[1]?.event.cardType).toBe('second_yellow');
    expect(h.commits[1]?.event.refSeq).toBe(1);
    expect((await h.session.getState().actions.undoFirstYellow({ seq: 1 })).status).toBe('applied');
    expect(h.commits.slice(2).map((plan) => [plan.event.type, plan.event.targetSeq])).toEqual([['void', 2], ['void', 1]]);
  });

  it('phase 看疊加：待送下半場開始是 play、待送終場是 undo（不落到 locked）', async () => {
    const h = await openHarness({ match: baseMatch({ status: 'halftime', clockBase: { startedAt: 1, pausedSec: 1500, running: false, period: 'ht' } }) });
    expect(h.session.getState().phase).toBe('ht');
    h.online = false;
    expect((await h.session.getState().actions.resume()).status).toBe('queued');
    expect(h.session.getState().liveStatus).toBe('live');
    expect(h.session.getState().clock.period).toBe('h2');
    expect(h.session.getState().phase).toBe('play');
    expect((await h.session.getState().actions.fulltime()).status).toBe('queued');
    expect(h.session.getState().liveStatus).toBe('finished');
    expect(h.session.getState().phase).toBe('undo');
    const props = scorePadPropsFrom(h.session.getState(), 20_000);
    expect(props.match.status).toBe('finished');
    expect(props.match.finishedAt).not.toBeNull();
  });

  it('被拒項目存在時：階段動作回 blocked 不建項目；進球照常排入；held 給畫面筆數與擋住的那一步', async () => {
    const h = await openHarness();
    h.failBefore = (plan) => {
      if (plan.event.type === 'goal') throw { code: 'permission-denied' };
    };
    expect(await h.session.getState().actions.goal({ side: 'home' })).toEqual({ status: 'rejected', reason: 'rules' });
    h.failBefore = null;
    const logged = (await h.log.list(CID, MT)).length;
    for (const press of ['halftime', 'fulltime'] as const) {
      expect(await h.session.getState().actions[press]()).toEqual({ status: 'rejected', reason: 'blocked' });
    }
    expect(await h.log.list(CID, MT)).toHaveLength(logged);
    expect(h.session.getState().held).toEqual({ rejected: 1, queued: 0, blockedAction: 'fulltime' });
    h.online = false;
    expect((await h.session.getState().actions.goal({ side: 'away' })).status).toBe('queued');
    expect(await h.log.list(CID, MT)).toHaveLength(logged + 1);
    expect(h.session.getState().held).toEqual({ rejected: 1, queued: 1, blockedAction: 'fulltime' });
    const lines = scorePadPropsFrom(h.session.getState(), 20_000).heldLines ?? [];
    expect(lines.map((line) => line.text)).toEqual([blockedStep('fulltime'), heldQueued(1)]);
    expect(lines[0]?.alert).toBe(true);
    // 處理掉被拒那筆（捨棄）後提示消失、階段動作恢復。
    const failed = (await h.log.list(CID, MT)).find((row) => row.state === 'rejected');
    await h.session.getState().actions.discard(failed?.op ?? '');
    expect(h.session.getState().held).toEqual({ rejected: 0, queued: 0, blockedAction: null });
    expect(scorePadPropsFrom(h.session.getState(), 20_000).heldLines).toEqual([]);
    expect((await h.session.getState().actions.halftime()).status).toBe('queued');
  });

  it('開始 PK：有被拒項目時回 blocked、不建項目、提示要先處理；記分頁按 PK 大戰不開確認框；沒有被拒時照常', async () => {
    const tied = () => baseMatch({ clockBase: { startedAt: 1, pausedSec: 5400, running: false, period: 'h2' } });
    const h = await openHarness({ match: tied() });
    h.failBefore = (plan) => {
      if (plan.event.type === 'goal') throw { code: 'permission-denied' };
    };
    expect(await h.session.getState().actions.goal({ side: 'home' })).toEqual({ status: 'rejected', reason: 'rules' });
    h.failBefore = null;
    expect(h.session.getState().pk.canStart).toBe(true);
    const logged = (await h.log.list(CID, MT)).length;
    expect(await h.session.getState().actions.pkStart()).toEqual({ status: 'rejected', reason: 'blocked' });
    expect(await h.log.list(CID, MT)).toHaveLength(logged);
    expect(h.commits.filter((plan) => plan.event.type === 'pkStart')).toHaveLength(0);
    expect(h.session.getState().held.blockedAction).toBe('pkStart');
    const props = scorePadPropsFrom(h.session.getState(), 20_000);
    expect((props.heldLines ?? []).map((line) => line.text)).toEqual([blockedStep('pkStart')]);
    expect(blockedStep('pkStart')).toBe('先處理沒送出的紀錄，才能開始 PK');
    expect(props.pkStartBlocked).toBe(true);
    // 個別 PK 踢球不擋（這裡還沒開始 PK，只確認 pkStart 以外的判斷沒被動到）：沒有被拒時照常開始。
    const clean = await openHarness({ match: tied() });
    expect(scorePadPropsFrom(clean.session.getState(), 20_000).pkStartBlocked).toBe(false);
    expect((await clean.session.getState().actions.pkStart()).status).toBe('applied');
  });

  it('P2-1 被接手：已取號項目在場次還有本機未確認寫入時維持送出中；pending 轉 false 才分類', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'taken-op-000000001', state: 'sending', seq: 1, createdAt: 1, intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 5 } });
    await log.put(goal);
    const state = { match: baseMatch(), events: [] as ServerEvent[], pending: true, control: { uid: UID, sid: 'other-device-sid-00010', takenAt: 2 } as ServerControl | null, plans: [] as BatchPlan[] };
    const sender = new Sender({ log, port: persistedPort(state), uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    expect(sender.needsTakeover).toBe(true);
    expect(await log.get(goal.op)).toMatchObject({ state: 'sending', seq: 1 });
    state.pending = false;
    await sender.flush();
    expect(await log.get(goal.op)).toMatchObject({ state: 'rejected', rejectReason: 'takenOver' });
    expect(state.plans).toHaveLength(0);
  });

  it('P2-1 被接手：寫入其實已在伺服器（確認遺失）→ 標 applied，不標被拒', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'taken-op-000000002', state: 'sending', seq: 1, createdAt: 1, intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 5 } });
    await log.put(goal);
    const state = { match: baseMatch(), events: [] as ServerEvent[], pending: true, control: { uid: UID, sid: 'other-device-sid-00011', takenAt: 2 } as ServerControl | null, plans: [] as BatchPlan[] };
    const sender = new Sender({ log, port: persistedPort(state), uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    expect((await log.get(goal.op))?.state).toBe('sending');
    state.match.rev = 1;
    state.match.score.home = 1;
    state.events.push({ ...goalEvent(1, 'home', goal.op) });
    state.pending = false;
    await sender.flush();
    expect(await log.get(goal.op)).toMatchObject({ state: 'applied', seq: 1 });
    expect(state.plans).toHaveLength(0);
  });

  it('§3.436 守則 1：從沒送出過的項目（沒取號）被接手時照舊直接標被拒，不等 pending', async () => {
    const log = new MemoryActionLog();
    const fresh = entry({ op: 'never-sent-op-00001', createdAt: 1, intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 5 } });
    const sent = entry({ op: 'sent-op-0000000001', state: 'sending', seq: 1, createdAt: 0, intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 4 } });
    await log.put(sent);
    await log.put(fresh);
    const state = { match: baseMatch(), events: [] as ServerEvent[], pending: true, control: { uid: UID, sid: 'other-device-sid-00012', takenAt: 2 } as ServerControl | null, plans: [] as BatchPlan[] };
    const sender = new Sender({ log, port: persistedPort(state), uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    expect(await log.get(fresh.op)).toMatchObject({ state: 'rejected', rejectReason: 'takenOver' });
    expect(await log.get(sent.op)).toMatchObject({ state: 'sending', seq: 1 });
    expect(state.plans).toHaveLength(0);
  });

  it('§3.436 守則 2：被接手時記分區與接手入口立刻停用，不等送出中的項目分類', async () => {
    const h = await openHarness();
    let releaseGate = () => {};
    h.gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    h.online = false;
    await h.session.getState().actions.goal({ side: 'home' });
    for (let i = 0; i < 30 && h.commits.length < 1; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(h.session.getState().unapplied.map((row) => row.state)).toEqual(['sending']);
    h.listener.onControl({ uid: UID, sid: 'other-device-sid-00013', takenAt: 2 });
    // 同一輪就停用：不經過任何 await。
    expect(h.session.getState().control.needsTakeover).toBe(true);
    expect(scorePadPropsFrom(h.session.getState(), 20_000).takeoverOffered).toBe(true);
    expect(h.session.getState().unapplied.map((row) => row.state)).toEqual(['sending']);
    releaseGate();
    h.gate = null;
  });

  it('§3.436 守則 3：離線（讀不到伺服器，或只讀到疊加本機寫入的快取）時被接手，送出中維持原狀不誤標', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'offline-op-0000001', state: 'sending', seq: 1, createdAt: 1, intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 5 } });
    await log.put(goal);
    let offline = true;
    const state = { match: baseMatch(), events: [] as ServerEvent[], pending: true, control: { uid: UID, sid: 'other-device-sid-00014', takenAt: 2 } as ServerControl | null, plans: [] as BatchPlan[] };
    const base = persistedPort(state);
    const port: ScoringPort = {
      ...base,
      async loadServer() {
        if (offline) throw { code: 'unavailable' };
        return base.loadServer();
      },
    };
    const sender = new Sender({ log, port, uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    expect(await log.get(goal.op)).toMatchObject({ state: 'sending', seq: 1 });
    // SDK 回快取：場次疊加本機未送寫入（pending）。
    offline = false;
    await sender.flush();
    expect(await log.get(goal.op)).toMatchObject({ state: 'sending', seq: 1 });
    expect(state.plans).toHaveLength(0);
  });

  it('§3.446 重整後還在送出中的那筆排在前面：沒取號的新項目等它，不 commit；它確認後新項目才取下一號', async () => {
    const log = new MemoryActionLog();
    const persisted = entry({ op: 'persisted-op-00001', state: 'sending', seq: 1, createdAt: 1, intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 5 } });
    const fresh = entry({ op: 'fresh-op-000000001', createdAt: 2, intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 6 } });
    await log.put(persisted);
    await log.put(fresh);
    // SDK 讀取疊上持久化佇列的寫入：rev 1、pending。
    const state = { match: baseMatch({ rev: 1, score: { home: 1, away: 0 } }), events: [] as ServerEvent[], pending: true, control: { uid: UID, sid: SID, takenAt: 1 } as ServerControl | null, plans: [] as BatchPlan[] };
    const sender = new Sender({ log, port: persistedPort(state), uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    expect(state.plans).toHaveLength(0);
    expect(await log.get(persisted.op)).toMatchObject({ state: 'sending', seq: 1 });
    const waiting = await log.get(fresh.op);
    expect(waiting?.state).toBe('pending');
    expect(waiting?.seq).toBeUndefined();
    // 持久化寫入被伺服器接受：快照 pending 轉 false，伺服器有 e1。
    state.events.push({ ...goalEvent(1, 'home', persisted.op) });
    state.pending = false;
    await sender.flush();
    expect(await log.get(persisted.op)).toMatchObject({ state: 'applied', seq: 1 });
    expect(state.plans.map((plan) => plan.seq)).toEqual([2]);
    expect(await log.get(fresh.op)).toMatchObject({ state: 'applied', seq: 2 });
  });

  /**
   * SDK 佇列裡有一筆日誌沒有的未確認寫入 W（例如儲存不可用、日誌是記憶體版時重整）。SDK 依序送：新寫入一定排在 W 之後。
   * W 被接受：伺服器 rev 先到 1，新項目用疊加讀到的 rev 1 取號 2，剛好接上。
   * W 被拒：伺服器 rev 仍 0，新項目的 seq 2 寫入被規則拒（rev 不接續），之後依 S2 處理。
   */
  function sdkQueuePort(outcome: 'accept' | 'reject') {
    const server = { match: baseMatch(), events: [] as ServerEvent[] };
    const control = { uid: UID, sid: SID, takenAt: 1 };
    let wPending = true;
    let resolveW = () => {};
    const wDone = new Promise<void>((resolve) => { resolveW = resolve; });
    const plans: BatchPlan[] = [];
    const settleW = () => {
      if (!wPending) return;
      wPending = false;
      if (outcome === 'accept') {
        server.match.rev = 1;
        server.match.score.home += 1;
        server.events.push({ ...goalEvent(1, 'home', 'w-unlogged-op-00001') });
      }
      resolveW();
    };
    const overlaid = () => (wPending
      ? { ...snapshotOf(server.match), rev: server.match.rev + 1, score: { home: server.match.score.home + 1, away: 0 } }
      : snapshotOf(server.match));
    const port: ScoringPort = {
      async commit(plan) {
        plans.push(plan);
        // SDK 依序送出：W 先有結果。
        settleW();
        await wDone;
        if (plan.match.rev !== server.match.rev + 1 || server.events.some((event) => event.seq === plan.seq)) {
          throw { code: 'permission-denied' };
        }
        applyPlanLocal(server.match, server.events, plan, 10);
      },
      async loadServer() { return { match: overlaid(), control: { ...control }, pending: wPending }; },
      async loadTimelineFrom(minSeq, resetRev) {
        return { events: server.events.filter((event) => event.seq >= minSeq && event.seq > resetRev).map((event) => ({ ...event })), pending: wPending };
      },
      knownEvents: () => server.events,
      async takeover() {},
    };
    return { port, server, plans, settleW };
  }

  it('§3.446 SDK 佇列有日誌沒有的未確認寫入、它被接受：新項目照常取號送出，不錯號、不重複', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'after-unlogged-op01', intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 9 } });
    await log.put(goal);
    const fake = sdkQueuePort('accept');
    const sender = new Sender({ log, port: fake.port, uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    expect(fake.plans.map((plan) => plan.seq)).toEqual([2]);
    expect(await log.get(goal.op)).toMatchObject({ state: 'applied', seq: 2 });
    expect(fake.server.events.map((event) => `${event.seq}:${event.op}`)).toEqual(['1:w-unlogged-op-00001', `2:${goal.op}`]);
    expect(fake.server.match).toMatchObject({ rev: 2, score: { home: 1, away: 1 } });
  });

  it('§3.446 SDK 佇列有日誌沒有的未確認寫入、它被拒：新項目的寫入被規則擋下，伺服器沒有錯號或重複', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'after-unlogged-op02', intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 9 } });
    await log.put(goal);
    const fake = sdkQueuePort('reject');
    const sender = new Sender({ log, port: fake.port, uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    await sender.flush();
    const afterFirst = await log.get(goal.op);
    // 第一次用疊加讀到的 rev 取了 2，被拒；伺服器維持 rev 0、沒有任何事件。
    expect(fake.plans[0]?.seq).toBe(2);
    expect(fake.server.events.filter((event) => event.seq === 2)).toHaveLength(0);
    expect(afterFirst?.seq).toBe(2);
    // 再觸發幾次 flush（實際由快照與動作觸發）。這條鎖的是「沒有錯號、沒有重複」與目前的卡住現況，
    // 不是期望行為；期望（最後換號送出）在下一條 it.fails。
    for (let i = 0; i < 3 && (await log.get(goal.op))?.state !== 'applied'; i += 1) await sender.flush();
    const final = await log.get(goal.op);
    // 伺服器完全沒有寫入：被拒的 W 沒進去、新項目也沒有用錯號寫進去（取代原本在空陣列上跑的迴圈斷言）。
    expect(fake.server.events).toHaveLength(0);
    expect(fake.server.match.rev).toBe(0);
    // 已知問題（顧問 §3.448 接受、排開放後第一批）：日誌停在 pending、seq 2。S2 的 wait（rev < seq-1）等別人補上 seq 1，這裡沒有人會補，所以一直不送、也沒有紅列。
    expect(final).toMatchObject({ state: 'pending', seq: 2 });
  });

  // 期望行為（目前不成立，用 it.fails 標記；顧問 §3.448 保留當作已知問題的紀錄，開放後第一批修好時改回 it）：上一條的情境最後要換號送出、只有一筆。
  it.fails('§3.446 期望：SDK 佇列裡日誌沒有的寫入被拒後，新項目最後換號送出（目前卡在 pending seq 2）', async () => {
    const log = new MemoryActionLog();
    const goal = entry({ op: 'after-unlogged-op03', intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 9 } });
    await log.put(goal);
    const fake = sdkQueuePort('reject');
    const sender = new Sender({ log, port: fake.port, uid: UID, cid: CID, mtId: MT, localSid: () => SID, now: () => 100 });
    for (let i = 0; i < 4 && (await log.get(goal.op))?.state !== 'applied'; i += 1) await sender.flush();
    expect(await log.get(goal.op)).toMatchObject({ state: 'applied', seq: 1 });
  });

  it('P3-3 待送終場的撤回倒數起點是那筆終場的建立時間；沒有可用時間就是 null，不用現在時間', async () => {
    const h = await openHarness();
    h.online = false;
    expect((await h.session.getState().actions.fulltime()).status).toBe('queued');
    const row = (await h.log.list(CID, MT)).find((item) => item.kind === 'fulltime');
    expect(scorePadPropsFrom(h.session.getState(), 99_999_999).match.finishedAt).toBe(row?.createdAt);
    const bare = { ...loadingView(), loading: false, match: baseMatch(), liveStatus: 'finished', unapplied: [], events: [] };
    expect(scorePadPropsFrom(bare, 99_999_999).match.finishedAt).toBeNull();
  });

  it('held 提示：沒有剛被擋的動作時顯示哪一筆沒送出；被接手（整區停用）時不顯示', async () => {
    const h = await openHarness();
    h.failBefore = () => { throw { code: 'permission-denied' }; };
    await h.session.getState().actions.goal({ side: 'home' });
    h.failBefore = null;
    expect((scorePadPropsFrom(h.session.getState(), 20_000).heldLines ?? []).map((line) => line.text)).toEqual([heldRejected(1)]);
    h.control = { uid: UID, sid: 'other-device-sid-00005', takenAt: 2 };
    h.listener.onControl(h.control);
    expect(scorePadPropsFrom(h.session.getState(), 20_000).heldLines).toEqual([]);
  });
});
