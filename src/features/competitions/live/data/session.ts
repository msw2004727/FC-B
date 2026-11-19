// 把日誌、送出、sid、額度、鎖組成記分工作階段。useScoring 只負責訂閱。

import { LIVE_COPY } from '../copy';
import { clockFromBase, type ClockReading } from '../clock';
import type { RosterPublicDoc } from '../../data/types';
import { MemoryActionLog, ResilientActionLog, type ActionLog } from './action-log';
import { actionAllowed, budgetView } from './budget';
import {
  findOpenYellow,
  fulltimeBlocked,
  groupViews,
  liveSecondYellow,
  overlayScore,
  scoreView,
  unappliedSummary,
  voidsAsMarks,
} from './derive';
import { browserRandom, createOp, createSid } from './ids';
import type { ScoringBackend } from './live-repo';
import { memorySidStore, type SidStore } from './sid';
import { isOfflineError, Sender } from './sender';
import { acquireTabLock, TAB_HINT, type LockManager, type TabChannel } from './tab-lock';
import { bindWakeLock, type WakeHandle } from './wake-lock';
import type {
  ActionGroup,
  ActionKind,
  ActionResult,
  BudgetView,
  CardIntent,
  ClockActionName,
  ClockTarget,
  GoalIntent,
  GroupLabel,
  GroupView,
  Intent,
  LogEntry,
  PhaseIntent,
  ScoreView,
  ScoringPhase,
  ServerEvent,
  ServerMatch,
  Side,
  StorageMode,
  TabRole,
  UnappliedView,
  VoidIntent,
  WakeState,
} from './types';
import { undoClock } from '../clock';

export interface ScoringActions {
  goal(input: { side: Side; plId?: string; goalKind?: GoalIntent['goalKind']; matchSecond?: number }): Promise<ActionResult>;
  card(input: { side: Side; plId: string; cardType: 'yellow' | 'red'; matchSecond?: number }): Promise<ActionResult>;
  sub(input: { side: Side; inPlId: string; outPlId: string; matchSecond?: number }): Promise<ActionResult>;
  kickoff(): Promise<ActionResult>;
  halftime(): Promise<ActionResult>;
  resume(): Promise<ActionResult>;
  fulltime(): Promise<ActionResult>;
  undoFinish(): Promise<ActionResult>;
  pauseClock(): Promise<ActionResult>;
  resumeClock(): Promise<ActionResult>;
  correctClock(clock: ClockTarget): Promise<ActionResult>;
  voidEvent(target: { seq?: number; op?: string }): Promise<ActionResult>;
  amend(target: { seq?: number; op?: string }, next: GoalIntent | CardIntent): Promise<ActionResult>;
  undoFirstYellow(target: { seq?: number; op?: string }): Promise<ActionResult>;
  reapply(op: string): Promise<ActionResult>;
  discard(op: string): Promise<ActionResult>;
  takeover(): Promise<ActionResult>;
}

export interface ScoringView {
  match: ServerMatch | null;
  roster: { home: RosterPublicDoc[]; away: RosterPublicDoc[] };
  events: ServerEvent[];
  voids: ReturnType<typeof voidsAsMarks>;
  control: {
    uid: string | null;
    sid: string | null;
    localSid: string | null;
    needsTakeover: boolean;
  };
  phase: ScoringPhase;
  clock: ClockReading;
  budget: BudgetView;
  storage: StorageMode;
  storageHint: string | null;
  connection: { online: boolean; wakeLock: WakeState };
  unapplied: UnappliedView[];
  groups: GroupView[];
  fulltimeBlocked: boolean;
  tab: TabRole;
  tabHint: string | null;
  score: ScoreView;
  staffRoles: string[];
  loading: boolean;
  actions: ScoringActions;
}

export interface SessionOptions {
  cid: string;
  mtId: string;
  uid: string;
  backend: ScoringBackend;
  log?: ActionLog;
  sids?: SidStore;
  now?: () => number;
  randomBytes?: (n: number) => Uint8Array;
  online?: () => boolean;
  watchOnline?: (cb: (online: boolean) => void) => () => void;
  visible?: () => boolean;
  watchVisible?: (cb: () => void) => () => void;
  locks?: LockManager | null;
  channel?: TabChannel | null;
  wakeRequest?: (() => Promise<WakeHandle>) | null;
  tick?: boolean;
}

export interface ScoringSession {
  start(): Promise<void>;
  stop(): void;
  getState(): ScoringView;
  subscribe(listener: (view: ScoringView) => void): () => void;
  whenIdle(): Promise<void>;
}

const EMPTY_CLOCK: ClockReading = { elapsedSec: 0, holdSec: null, period: 'pre' };

function rejected(reason: ActionResult['reason'] = 'unknown'): ActionResult {
  return { status: 'rejected', reason };
}

function inertActions(): ScoringActions {
  const no = async () => rejected();
  return {
    goal: no, card: no, sub: no, kickoff: no, halftime: no, resume: no, fulltime: no,
    undoFinish: no, pauseClock: no, resumeClock: no, correctClock: no, voidEvent: no,
    amend: no, undoFirstYellow: no, reapply: no, discard: no, takeover: no,
  };
}

export function loadingView(): ScoringView {
  return {
    match: null,
    roster: { home: [], away: [] },
    events: [],
    voids: [],
    control: { uid: null, sid: null, localSid: null, needsTakeover: false },
    phase: 'pre',
    clock: EMPTY_CLOCK,
    budget: {
      used: 0, pauseUses: 0, pauseLeft: 20, pauseEnabled: true,
      nearLimit: false, controlsOnly: false, exhausted: false,
    },
    storage: 'ok',
    storageHint: null,
    connection: { online: true, wakeLock: 'off' },
    unapplied: [],
    groups: [],
    fulltimeBlocked: false,
    tab: 'unknown',
    tabHint: null,
    score: { home: 0, away: 0, pendingCount: 0, server: { home: 0, away: 0 } },
    staffRoles: [],
    loading: true,
    actions: inertActions(),
  };
}

function phaseOf(match: ServerMatch, nowMs: number): ScoringPhase {
  if (match.status === 'scheduled' || match.status === 'postponed') return 'pre';
  if (match.status === 'halftime') return 'ht';
  if (match.status === 'finished') return undoClock(match.finishedAt, nowMs) ? 'undo' : 'locked';
  if (match.status === 'confirmed' || match.status === 'walkover' || match.status === 'cancelled') return 'locked';
  return 'play';
}

function phaseClock(
  kind: PhaseIntent['kind'],
  elapsedSec: number,
  nowMs: number,
  period: string,
): ClockTarget {
  const pausedSec = Math.max(0, Math.min(10800, Math.floor(elapsedSec)));
  if (kind === 'kickoff') return { running: true, period: 'h1', pausedSec: 0, startedAt: nowMs };
  if (kind === 'halftime') return { running: false, period: 'ht', pausedSec, startedAt: nowMs };
  if (kind === 'resume') return { running: true, period: 'h2', pausedSec, startedAt: nowMs };
  if (kind === 'fulltime') return { running: false, period: 'ft', pausedSec, startedAt: null };
  const nextPeriod = period === 'ft' ? 'h2' : period;
  return { running: false, period: nextPeriod || 'h2', pausedSec, startedAt: nowMs };
}

function resultOf(entry: LogEntry | null): ActionResult {
  if (!entry) return rejected();
  if (entry.state === 'applied') return { status: 'applied' };
  if (entry.state === 'rejected') return { status: 'rejected', reason: entry.rejectReason ?? 'unknown' };
  return { status: 'queued' };
}

export function createScoringSession(options: SessionOptions): ScoringSession {
  const now = options.now ?? (() => Date.now());
  const randomBytes = options.randomBytes ?? browserRandom;
  const cid = options.cid;
  const mtId = options.mtId;
  const uid = options.uid;
  let log: ActionLog = options.log ?? new MemoryActionLog();
  let sids: SidStore = options.sids ?? memorySidStore();
  let storage: StorageMode = 'ok';
  let localSid: string | null = null;
  let match: ServerMatch | null = null;
  let control: { uid: string; sid: string; takenAt: number | null } | null = null;
  let events: ServerEvent[] = [];
  let roster = { home: [] as RosterPublicDoc[], away: [] as RosterPublicDoc[] };
  let staffRoles: string[] = [];
  let entries: LogEntry[] = [];
  let online = options.online ? options.online() : true;
  let visible = options.visible ? options.visible() : true;
  let wake: WakeState = 'off';
  let tab: TabRole = 'unknown';
  let tabRelease = () => {};
  let openedStop = () => {};
  let openedVisible: ((v: boolean) => void) | null = null;
  let wakeStop = () => {};
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let unwatchOnline = () => {};
  let unwatchVisible = () => {};
  let stopped = false;
  let sender: Sender | null = null;
  const listeners = new Set<(view: ScoringView) => void>();

  const isOnline = () => (options.online ? options.online() : online);
  const isVisible = () => (options.visible ? options.visible() : visible);

  function senderOrThrow(): Sender {
    if (!sender) throw new Error('記分工作階段還沒開始');
    return sender;
  }

  async function reloadEntries(): Promise<void> {
    entries = await log.list(cid, mtId);
  }

  function elapsedSec(): number {
    if (!match) return 0;
    const over = overlayScore(match, events, entries);
    return clockFromBase(over.clockBase, now()).elapsedSec;
  }

  function view(): ScoringView {
    const current = sender;
    const base = match;
    const over = base ? overlayScore(base, events, entries) : null;
    const shown = base && over
      ? { ...base, score: { ...over.score }, clockBase: { ...over.clockBase } }
      : base;
    const budget = budgetView(base?.rev ?? 0, base?.resetRev ?? 0, entries, events);
    const score = base ? scoreView(base, events, entries) : loadingView().score;
    const needsTakeover = current?.needsTakeover ?? !localSid;
    return {
      match: shown,
      roster,
      events,
      voids: voidsAsMarks(events),
      control: {
        uid: control?.uid ?? null,
        sid: control?.sid ?? null,
        localSid,
        needsTakeover,
      },
      phase: base ? phaseOf(base, now()) : 'pre',
      clock: over ? clockFromBase(over.clockBase, now()) : EMPTY_CLOCK,
      budget,
      storage,
      storageHint: storage === 'unavailable' ? LIVE_COPY.offlineUnstored : null,
      connection: { online: isOnline(), wakeLock: wake },
      unapplied: entries
        .filter((entry) => entry.state === 'pending' || entry.state === 'sending' || entry.state === 'rejected')
        .map((entry) => ({
          op: entry.op,
          kind: entry.kind,
          state: entry.state,
          ...(entry.rejectReason ? { rejectReason: entry.rejectReason } : {}),
          createdAt: entry.createdAt,
          intent: entry.intent,
          ...(entry.group ? { group: entry.group } : {}),
          summary: unappliedSummary(entry),
        })),
      groups: groupViews(entries),
      fulltimeBlocked: fulltimeBlocked(entries),
      tab,
      tabHint: tab === 'blocked' ? TAB_HINT : null,
      score,
      staffRoles,
      loading: false,
      actions,
    };
  }

  function emit(): void {
    const next = view();
    for (const listener of listeners) listener(next);
  }

  function aboveReset(list: ServerEvent[], resetRev: number): ServerEvent[] {
    return list.filter((event) => event.seq > resetRev);
  }

  async function discardStale(resetRev: number): Promise<void> {
    if (resetRev <= 0) return;
    let changed = false;
    for (const entry of entries) {
      if (entry.state === 'discarded') continue;
      if (resetRev <= (entry.baseResetRev ?? 0)) continue;
      await log.patch(entry.op, { state: 'discarded', rejectReason: 'reset' });
      changed = true;
    }
    if (changed) await reloadEntries();
  }

  function terminalMatch(current: ServerMatch | null): boolean {
    if (!current) return false;
    return current.status === 'finished' || current.status === 'confirmed' || current.lock.locked;
  }

  async function maybeClear(): Promise<void> {
    if (!match) return;
    const terminal = match.status === 'confirmed' || match.lock.locked;
    if (!terminal || entries.length === 0) return;
    if (entries.every((entry) => entry.state === 'applied' || entry.state === 'discarded')) {
      await log.removeMatch(cid, mtId);
      entries = [];
    }
  }

  function syncTakeover(): void {
    const current = sender;
    if (!current) return;
    const sid = localSid;
    if (!sid || !control || control.uid !== uid || control.sid !== sid) {
      current.needsTakeover = true;
      if (current.blockedAt == null) current.blockedAt = now();
      return;
    }
    current.needsTakeover = false;
  }

  function allow(kind: ActionKind, clockAction?: ClockActionName): boolean {
    if (tab === 'blocked') return false;
    const budget = budgetView(match?.rev ?? 0, match?.resetRev ?? 0, entries, events);
    return actionAllowed(kind, budget, clockAction);
  }

  function allowIntent(intent: Intent): boolean {
    return allow(intent.kind, intent.kind === 'clock' ? intent.clockAction : undefined);
  }

  async function finish(ops: string[]): Promise<ActionResult> {
    await reloadEntries();
    emit();
    const current = senderOrThrow();
    if (tab === 'blocked') return rejected('rules');
    if (!localSid || current.needsTakeover) return { status: 'queued' };
    const pending = current.flush();
    if (!isOnline()) return { status: 'queued' };
    await pending;
    await reloadEntries();
    emit();
    const rows = [];
    for (const op of ops) rows.push(await log.get(op));
    if (rows.some((entry) => entry?.state === 'rejected')) {
      const hit = rows.find((entry) => entry?.state === 'rejected');
      return { status: 'rejected', reason: hit?.rejectReason ?? 'unknown' };
    }
    if (rows.every((entry) => entry?.state === 'applied')) return { status: 'applied' };
    // 終場寫入落地後日誌可能已被清掉，get 會是 null。場次已是終場就視為已套用。
    if (ops.length > 0 && terminalMatch(match) && rows.every((entry) => entry == null || entry.state === 'applied')) {
      return { status: 'applied' };
    }
    return { status: 'queued' };
  }

  function make(intent: Intent, group?: ActionGroup, createdAt?: number): LogEntry {
    return {
      op: createOp(randomBytes),
      cid,
      mtId,
      uid,
      sid: localSid ?? '',
      kind: intent.kind,
      intent,
      ...(group ? { group } : {}),
      state: 'pending',
      createdAt: createdAt ?? now(),
      attempts: 0,
      baseResetRev: match?.resetRev ?? 0,
    };
  }

  async function putAll(rows: LogEntry[]): Promise<void> {
    for (const row of rows) await log.put(row);
    await reloadEntries();
    emit();
  }

  async function one(intent: Intent, group?: ActionGroup): Promise<ActionResult> {
    if (!allow(intent.kind, intent.kind === 'clock' ? intent.clockAction : undefined)) {
      return rejected(tab === 'blocked' ? 'rules' : 'limit');
    }
    if (intent.kind === 'fulltime' && fulltimeBlocked(entries)) return rejected('rules');
    const row = make(intent, group);
    await putAll([row]);
    return finish([row.op]);
  }

  function second(): number {
    return Math.max(0, Math.min(10800, Math.floor(elapsedSec())));
  }

  function linkedSecond(target: { seq?: number; op?: string }): { seq?: number; op?: string } | null {
    return liveSecondYellow(target, events, entries, match?.resetRev ?? 0);
  }

  function groupRows(label: GroupLabel, intents: Intent[]): LogEntry[] {
    const id = createOp(randomBytes);
    const at = now();
    return intents.map((intent, index) => make(intent, {
      id,
      index,
      size: intents.length,
      label,
    }, at + index));
  }

  const actions: ScoringActions = {
    async goal(input) {
      const intent: GoalIntent = {
        kind: 'goal',
        side: input.side,
        goalKind: input.goalKind ?? 'normal',
        matchSecond: input.matchSecond ?? second(),
        ...(input.plId ? { plId: input.plId } : {}),
      };
      return one(intent);
    },
    async card(input) {
      const intent: CardIntent = {
        kind: 'card',
        side: input.side,
        plId: input.plId,
        cardType: input.cardType,
        matchSecond: input.matchSecond ?? second(),
      };
      if (input.cardType === 'yellow') {
        const open = findOpenYellow(input.plId, input.side, events, entries, match?.resetRev ?? 0);
        if (open?.seq != null) {
          intent.cardType = 'second_yellow';
          intent.refSeq = open.seq;
        } else if (open?.op) {
          intent.cardType = 'second_yellow';
          intent.refOp = open.op;
        }
      }
      return one(intent);
    },
    async sub(input) {
      return one({
        kind: 'sub',
        side: input.side,
        inPlId: input.inPlId,
        outPlId: input.outPlId,
        matchSecond: input.matchSecond ?? second(),
      });
    },
    kickoff: () => one({ kind: 'kickoff', matchSecond: second(), clock: phaseClock('kickoff', elapsedSec(), now(), 'pre') }),
    halftime: () => one({ kind: 'halftime', matchSecond: second(), clock: phaseClock('halftime', elapsedSec(), now(), match?.clockBase.period ?? 'h1') }),
    resume: () => one({ kind: 'resume', matchSecond: second(), clock: phaseClock('resume', elapsedSec(), now(), 'ht') }),
    fulltime: () => one({ kind: 'fulltime', matchSecond: second(), clock: phaseClock('fulltime', elapsedSec(), now(), match?.clockBase.period ?? 'h2') }),
    undoFinish: () => one({ kind: 'undoFinish', matchSecond: second(), clock: phaseClock('undoFinish', elapsedSec(), now(), match?.clockBase.period ?? 'ft') }),
    pauseClock() {
      const period = match?.clockBase.period ?? 'h1';
      const intent: Intent = {
        kind: 'clock',
        matchSecond: second(),
        clockAction: 'pause',
        clock: { running: false, period, pausedSec: Math.floor(elapsedSec()), startedAt: now() },
      };
      return one(intent);
    },
    resumeClock() {
      const period = match?.clockBase.period ?? 'h1';
      return one({
        kind: 'clock',
        matchSecond: second(),
        clockAction: 'resume',
        clock: { running: true, period, pausedSec: Math.floor(elapsedSec()), startedAt: now() },
      });
    },
    correctClock(clock) {
      return one({ kind: 'clock', matchSecond: second(), clockAction: 'correct', clock });
    },
    voidEvent(target) {
      const intent: VoidIntent = {
        kind: 'void',
        matchSecond: second(),
        ...(target.seq != null ? { targetSeq: target.seq } : {}),
        ...(target.op ? { targetOp: target.op } : {}),
      };
      return one(intent);
    },
    async amend(target, next) {
      if (tab === 'blocked') return rejected('rules');
      const secondYellow = linkedSecond(target);
      const intents: Intent[] = [];
      if (secondYellow) intents.push(voidOf(secondYellow));
      intents.push(voidOf(target));
      intents.push(next.kind === 'goal' ? { ...next, matchSecond: next.matchSecond || second() } : { ...next });
      if (intents.some((intent) => !allowIntent(intent))) return rejected('limit');
      const label: GroupLabel = secondYellow ? 'amendFirstYellow' : 'amend';
      const rows = groupRows(label, intents);
      await putAll(rows);
      return finish(rows.map((row) => row.op));
    },
    async undoFirstYellow(target) {
      if (tab === 'blocked') return rejected('rules');
      if (!allow('void')) return rejected('limit');
      const secondYellow = linkedSecond(target);
      if (!secondYellow) return actions.voidEvent(target);
      const rows = groupRows('undoFirstYellow', [voidOf(secondYellow), voidOf(target)]);
      await putAll(rows);
      return finish(rows.map((row) => row.op));
    },
    async reapply(op) {
      if (tab === 'blocked') return rejected('rules');
      const current = senderOrThrow();
      if (!localSid || current.needsTakeover) return rejected('takenOver');
      const entry = await log.get(op);
      if (!entry) return rejected();
      if (entry.state === 'applied') return { status: 'applied' };
      if ((match?.resetRev ?? 0) > (entry.baseResetRev ?? 0) || (entry.state === 'discarded' && entry.rejectReason === 'reset')) {
        if (entry.state !== 'discarded') {
          await log.patch(op, { state: 'discarded', rejectReason: 'reset' });
          await reloadEntries();
          emit();
        }
        return rejected('reset');
      }
      const clockAction = entry.intent.kind === 'clock' ? entry.intent.clockAction : undefined;
      if (!allow(entry.kind, clockAction)) return rejected('limit');
      await log.patch(op, { state: 'pending', rejectReason: null, autoRetried: false });
      return finish([op]);
    },
    async discard(op) {
      const all = await log.list(cid, mtId);
      const entry = all.find((item) => item.op === op);
      if (!entry) return rejected();
      const targets = entry.group
        ? all.filter((item) => item.group?.id === entry.group?.id
          && (item.group?.index ?? 0) >= (entry.group?.index ?? 0)
          && item.state !== 'applied')
        : [entry];
      for (const item of targets) await log.patch(item.op, { state: 'discarded' });
      await reloadEntries();
      emit();
      if (sender && localSid && !sender.needsTakeover) void sender.flush();
      return { status: 'applied' };
    },
    async takeover() {
      if (tab === 'blocked') return rejected('rules');
      const sid = createSid(randomBytes);
      try {
        await sids.set(cid, mtId, uid, sid);
      } catch {
        sids = memorySidStore();
        await sids.set(cid, mtId, uid, sid);
        storage = 'unavailable';
      }
      localSid = sid;
      const current = senderOrThrow();
      current.needsTakeover = false;
      current.blockedAt = null;
      try {
        await options.backend.port.takeover(sid);
      } catch (err) {
        if (isOfflineError(err) || !isOnline()) return { status: 'queued' };
        return rejected('rules');
      }
      control = { uid, sid, takenAt: now() };
      emit();
      if (!isOnline()) return { status: 'queued' };
      await current.flush();
      await reloadEntries();
      emit();
      return { status: 'applied' };
    },
  };

  function voidOf(target: { seq?: number; op?: string }): VoidIntent {
    return {
      kind: 'void',
      matchSecond: second(),
      ...(target.seq != null ? { targetSeq: target.seq } : {}),
      ...(target.op ? { targetOp: target.op } : {}),
    };
  }

  return {
    getState: () => view(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    whenIdle: () => sender?.whenIdle() ?? Promise.resolve(),
    stop() {
      stopped = true;
      sender?.stop();
      openedStop();
      wakeStop();
      tabRelease();
      unwatchOnline();
      unwatchVisible();
      if (tickTimer != null) clearInterval(tickTimer);
    },
    async start() {
      log = new ResilientActionLog(log, () => {
        storage = 'unavailable';
      });
      const probed = await log.probe();
      if (!probed) {
        log = new MemoryActionLog();
        sids = memorySidStore();
        storage = 'unavailable';
      }
      try {
        await log.purgeOlderThan(now());
      } catch {
        let kept: LogEntry[] = [];
        try {
          kept = await log.list(cid, mtId);
        } catch {
          kept = [];
        }
        log = new MemoryActionLog();
        for (const row of kept) await log.put(row);
        storage = 'unavailable';
      }
      try {
        localSid = await sids.get(cid, mtId, uid);
      } catch {
        sids = memorySidStore();
        localSid = null;
        storage = 'unavailable';
      }
      const held = await acquireTabLock({
        name: `cp-scoring-${cid}-${mtId}`,
        locks: options.locks === undefined ? null : options.locks,
        channel: options.channel === undefined ? null : options.channel,
        tabId: createOp(randomBytes),
        wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
        random: Math.random,
        onRole: (role) => {
          if (stopped) return;
          tab = role;
          emit();
          if (role === 'owner' && sender && localSid && !sender.needsTakeover) void sender.flush();
        },
      });
      tab = held.role;
      tabRelease = held.release;
      sender = new Sender({
        log,
        port: options.backend.port,
        uid,
        cid,
        mtId,
        localSid: () => localSid ?? '',
        now,
      });
      const opened = await options.backend.open({
        onMatch: (next) => {
          const prevReset = match?.resetRev ?? -1;
          match = next;
          if (next && prevReset >= 0 && next.resetRev > prevReset) {
            events = aboveReset(events, next.resetRev);
          }
          void reloadEntries().then(async () => {
            if (next && prevReset >= 0 && next.resetRev > prevReset) await discardStale(next.resetRev);
            await maybeClear();
          }).then(() => {
            emit();
            if (sender && localSid && !sender.needsTakeover && tab !== 'blocked') void sender.flush();
          });
        },
        onControl: (next) => {
          control = next;
          syncTakeover();
          emit();
          if (sender?.needsTakeover) void sender.flush();
        },
        onEvents: (added, mode) => {
          const floor = match?.resetRev ?? 0;
          const incoming = added.filter((event) => event.seq > floor);
          if (mode === 'replace') events = incoming;
          else {
            const map = new Map(aboveReset(events, floor).map((event) => [event.seq, event]));
            for (const event of incoming) map.set(event.seq, event);
            events = [...map.values()].sort((a, b) => a.seq - b.seq);
          }
          emit();
        },
        onError: (err) => {
          if (isOfflineError(err)) online = false;
          emit();
        },
      }, isVisible);
      if (stopped) {
        opened.stop();
        return;
      }
      match = opened.match;
      control = opened.control;
      events = aboveReset(opened.events, match?.resetRev ?? 0);
      roster = { home: opened.home, away: opened.away };
      staffRoles = opened.staffRoles;
      openedStop = opened.stop;
      openedVisible = opened.setVisible;
      syncTakeover();
      await reloadEntries();
      if (match) await discardStale(match.resetRev);
      await maybeClear();
      const wakeBind = bindWakeLock({
        request: options.wakeRequest === undefined ? null : options.wakeRequest,
        active: () => {
          if (!match) return false;
          const phase = phaseOf(match, now());
          return phase === 'play' || phase === 'ht';
        },
        visible: isVisible,
        onChange: (state) => {
          wake = state;
          emit();
        },
      });
      wakeStop = wakeBind.stop;
      wakeBind.refresh();
      unwatchOnline = options.watchOnline?.((next) => {
        online = next;
        if (next && sender && tab !== 'blocked') {
          void sender.reconcileInflight();
          void sender.flush();
        }
        emit();
      }) ?? (() => {});
      unwatchVisible = options.watchVisible?.(() => {
        visible = isVisible();
        openedVisible?.(visible);
        wakeBind.refresh();
        emit();
      }) ?? (() => {});
      if (options.tick !== false) {
        tickTimer = setInterval(() => {
          if (!stopped && isVisible()) emit();
        }, 1000);
      }
      emit();
      // 已被接手時也要跑一次，才會把舊的待送標成 takenOver；sendOne 在寫入前就停。
      if (tab !== 'blocked') await sender.flush();
      await reloadEntries();
      emit();
    },
  };
}
