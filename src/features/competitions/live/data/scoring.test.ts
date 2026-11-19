import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { LIVE_COPY } from '../copy';
import { IndexedDbActionLog, MemoryActionLog, ResilientActionLog, type ActionLog } from './action-log';
import { applyPlanLocal, buildBatch } from './batch';
import { budgetView, pauseUseCount } from './budget';
import { activeYellowRefs, findOpenYellow, groupMessage, liveSecondYellow, overlayScore, scoreView, voidsFromTimeline } from './derive';
import { memorySidStore } from './sid';
import { classifyReject, decideRetry, Sender } from './sender';
import type { LiveListener } from './live-repo';
import { createScoringSession, type ScoringSession } from './session';
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
      return box.events.filter((event) => event.seq >= minSeq && event.seq > resetRev).map((event) => ({ ...event }));
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
      async loadTimelineFrom() { return events; },
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
      async loadTimelineFrom(minSeq) { return events.filter((event) => event.seq >= minSeq).map((event) => ({ ...event })); },
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
