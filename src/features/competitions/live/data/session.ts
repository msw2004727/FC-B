// 把日誌、送出、sid、額度、鎖組成記分工作階段。useScoring 只負責訂閱。

import { LIVE_COPY } from '../copy';
import { clockFromBase, type ClockReading } from '../clock';
import { pkCanStart } from '../present';
import type { RosterPublicDoc } from '../../data/types';
import { ACTION_LOG_MAX_AGE_MS, compareEntries, MemoryActionLog, ResilientActionLog, type ActionLog } from './action-log';
import { actionAllowed, budgetView, groupWithinBudget } from './budget';
import {
  entryInEpoch,
  findOpenYellow,
  fulltimeBlocked,
  groupViews,
  liveSecondYellow,
  mergedEvents,
  overlayScore,
  overlayStatus,
  scoreView,
  unappliedSummary,
  voidsAsMarks,
} from './derive';
import { browserRandom, createOp, createSid } from './ids';
import type { ScoringBackend } from './live-repo';
import { memorySidStore, type SidStore } from './sid';
import { isOfflineError, Sender } from './sender';
import { acquireTabLock, TAB_HINT, type LockManager, type TabChannel } from './tab-lock';
import { defaultTimeoutRule, readTimeoutRule, type TimeoutRule } from './timeout-rule';
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
  PkIntent,
  ScoreView,
  ScoringPhase,
  ServerEvent,
  ServerMatch,
  Side,
  StorageMode,
  TabRole,
  TimeoutIntent,
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
  timeout(input: { side: Side; stopClock?: boolean }): Promise<ActionResult>;
  pkStart(): Promise<ActionResult>;
  pk(input: { side: Side; plId?: string; scored: boolean }): Promise<ActionResult>;
}

export interface ScoringStaff {
  roles: string[];
  matchIds: string[];
  expiresAt: number | null;
}

/** 畫面上的分頁角色。鎖住的那一頁對外叫 reader，內部仍是 blocked。 */
export type ScoringTab = 'owner' | 'reader' | 'unknown';

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
    /** 沒有本機 sid，而且控制權不是別人。按鈕用「接手記分」。 */
    takeoverSelf: boolean;
  };
  /** 依疊加狀態（liveStatus）算出，和節次一致（第 4 步 A F5-1，取代只看伺服器 status）。 */
  phase: ScoringPhase;
  /**
   * 有被拒項目擋住送出（pickNext 停住）時的筆數：rejected 被拒、queued 排在後面的待送／送出中。
   * blockedAction：最近一次被擋下的階段動作，被拒項目都處理完就清掉。
   */
  held: { rejected: number; queued: number; blockedAction: PhaseIntent['kind'] | null };
  /** 伺服器狀態疊加待送的開賽／半場／續賽／終場／撤回終場。沒有場次時是 null。 */
  liveStatus: string | null;
  clock: ClockReading;
  budget: BudgetView;
  storage: StorageMode;
  storageHint: string | null;
  connection: { online: boolean; wakeLock: WakeState };
  unapplied: UnappliedView[];
  groups: GroupView[];
  fulltimeBlocked: boolean;
  tab: ScoringTab;
  tabHint: string | null;
  score: ScoreView;
  staffRoles: string[];
  staff: ScoringStaff;
  pk: { started: boolean; score: { home: number; away: number } | null; canStart: boolean };
  timeoutRule: TimeoutRule;
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
    timeout: no, pkStart: no, pk: no,
  };
}

export function loadingView(): ScoringView {
  return {
    match: null,
    roster: { home: [], away: [] },
    events: [],
    voids: [],
    control: { uid: null, sid: null, localSid: null, needsTakeover: false, takeoverSelf: false },
    phase: 'pre',
    held: { rejected: 0, queued: 0, blockedAction: null },
    liveStatus: null,
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
    staff: { roles: [], matchIds: [], expiresAt: null },
    pk: { started: false, score: null, canStart: false },
    timeoutRule: defaultTimeoutRule(),
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

/**
 * 畫面階段看疊加狀態，和節次、liveStatus 一致（C1：疊加已是 live／h2，按鈕卻停在「下半場開始」）。
 * 終場還在待送（伺服器尚未 finished、沒有 finishedAt）時是 undo：剛按的終場可以撤回，不落到 locked。
 */
function overlayPhase(match: ServerMatch, entries: readonly LogEntry[], nowMs: number): ScoringPhase {
  const status = overlayStatus(match, entries);
  if (status === 'finished' && match.status !== 'finished') return 'undo';
  return phaseOf({ ...match, status }, nowMs);
}

const PHASE_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>(['kickoff', 'halftime', 'resume', 'fulltime', 'undoFinish']);

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
  let staff: ScoringStaff = { roles: [], matchIds: [], expiresAt: null };
  let timeoutRule: TimeoutRule = defaultTimeoutRule();
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
  let blockedAction: PhaseIntent['kind'] | null = null;
  const listeners = new Set<(view: ScoringView) => void>();

  const isOnline = () => (options.online ? options.online() : online);
  const isVisible = () => (options.visible ? options.visible() : visible);

  function senderOrThrow(): Sender {
    if (!sender) throw new Error('記分工作階段還沒開始');
    return sender;
  }

  async function reloadEntries(): Promise<void> {
    entries = await log.list(cid, mtId);
    if (!hasRejected()) blockedAction = null;
  }

  /** 和 pickNext 同一個條件：有被拒的項目，送出就停在它前面。 */
  function hasRejected(): boolean {
    return entries.some((entry) => entry.state === 'rejected');
  }

  function heldView(): ScoringView['held'] {
    const rejectedCount = entries.filter((entry) => entry.state === 'rejected').length;
    if (rejectedCount === 0) return { rejected: 0, queued: 0, blockedAction: null };
    const queued = entries.filter((entry) => entry.state === 'pending' || entry.state === 'sending').length;
    return { rejected: rejectedCount, queued, blockedAction };
  }

  /** sender 改了日誌：同一輪只重讀一次再更新畫面（第 4 步 A F4：被拒後畫面要自己更新，不必等下一個動作）。 */
  let changeQueued = false;
  function senderChanged(): void {
    if (changeQueued || stopped) return;
    changeQueued = true;
    queueMicrotask(() => {
      changeQueued = false;
      if (stopped) return;
      void reloadEntries().then(() => {
        if (!stopped) emit();
      }, () => {});
    });
  }

  /**
   * 伺服器事件加上已套用、監聽還沒讀到的日誌項目（commit 已成功＝伺服器已確認）。
   * 監聽改成只在已確認快照後讀事件（第 4 步 A F3），commit 回來到事件讀進來之間有空檔；
   * 判斷第二黃、作廢目標、額度時要算進去，不然剛記的第一黃會被漏看（模擬器 e2e 8 抓到）。
   */
  function knownEvents(): ServerEvent[] {
    const floor = match?.resetRev ?? 0;
    return mergedEvents(events, entries.filter((entry) => entryInEpoch(entry, floor) && (entry.seq == null || entry.seq > floor)));
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
      ? { ...base, score: { ...over.score }, clockBase: { ...over.clockBase }, penaltyScore: over.penalty }
      : base;
    const floor = base?.resetRev ?? 0;
    // 已套用但監聽還沒跟上的事件留在清單，待送小標拿掉時同一列不閃。
    const shownEvents = mergedEvents(
      events,
      entries.filter((entry) => entryInEpoch(entry, floor) && (entry.seq == null || entry.seq > floor)),
    );
    const budget = budgetView(base?.rev ?? 0, base?.resetRev ?? 0, entries, shownEvents, timeoutRule.stopsClock);
    const score = base ? scoreView(base, events, entries) : loadingView().score;
    const needsTakeover = current?.needsTakeover ?? !localSid;
    const takeoverSelf = needsTakeover && !localSid && !(control != null && control.uid !== uid);
    return {
      match: shown,
      roster,
      events: shownEvents,
      voids: voidsAsMarks(shownEvents),
      control: {
        uid: control?.uid ?? null,
        sid: control?.sid ?? null,
        localSid,
        needsTakeover,
        takeoverSelf,
      },
      phase: base ? overlayPhase(base, entries, now()) : 'pre',
      held: heldView(),
      liveStatus: base ? overlayStatus(base, entries) : null,
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
      tab: tab === 'blocked' ? 'reader' : tab,
      tabHint: tab === 'blocked' ? TAB_HINT : null,
      score,
      staffRoles,
      staff,
      pk: pkView(base, over),
      timeoutRule,
      loading: false,
      actions,
    };
  }

  function pendingPkStart(): boolean {
    const resetRev = match?.resetRev ?? 0;
    return entries.some((entry) => entryInEpoch(entry, resetRev)
      && (entry.state === 'pending' || entry.state === 'sending')
      && entry.kind === 'pkStart');
  }

  function pkView(
    base: ServerMatch | null,
    over: ReturnType<typeof overlayScore> | null,
  ): ScoringView['pk'] {
    const penalty = over?.penalty ?? null;
    const period = over?.clockBase.period;
    const canStart = !!(base && over && pkCanStart({
      status: overlayStatus(base, entries),
      running: over.clockBase.running,
      period: over.clockBase.period,
      home: over.score.home,
      away: over.score.away,
      penalty,
      pendingPkStart: pendingPkStart(),
    }));
    return {
      started: penalty != null || period === 'pk',
      score: penalty,
      canStart,
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
    const budget = budgetView(match?.rev ?? 0, match?.resetRev ?? 0, entries, knownEvents(), timeoutRule.stopsClock);
    return actionAllowed(kind, budget, clockAction);
  }

  function allowGroup(intents: readonly Intent[]): boolean {
    if (tab === 'blocked') return false;
    const budget = budgetView(match?.rev ?? 0, match?.resetRev ?? 0, entries, knownEvents(), timeoutRule.stopsClock);
    return groupWithinBudget(intents, budget);
  }

  function overNow(): ReturnType<typeof overlayScore> | null {
    if (!match) return null;
    return overlayScore(match, events, entries);
  }

  /** 現在的疊加狀態：伺服器 status 加上已套用未追上與待送的階段動作。被拒、捨棄不算。 */
  /**
   * 疊加狀態。傳 before 時只疊加「送出順序排在它前面」的項目（已套用未追上＋建立較早的待送），
   * 用於重新套用：被拒那筆 createdAt 不變、會比之後才排入的待送先送出（Opus 終審 P2-1，取代一律用全部待送）。
   */
  function statusNow(before?: LogEntry): string | null {
    if (!match) return null;
    if (!before) return overlayStatus(match, entries);
    const earlier = entries.filter((entry) => entry.op !== before.op
      && (entry.state === 'applied' || compareEntries(entry, before) < 0));
    return overlayStatus(match, earlier);
  }

  function pkActive(): boolean {
    const over = overNow();
    if (!over) return false;
    return over.penalty != null || over.clockBase.period === 'pk';
  }

  function describedTarget(target: { seq?: number; op?: string }): { type: string } | null {
    if (target.seq != null) {
      const found = knownEvents().find((event) => event.seq === target.seq);
      if (found) return { type: found.type };
      const logged = entries.find((entry) => entry.seq === target.seq);
      if (logged) return { type: logged.kind };
    }
    if (target.op) {
      const logged = entries.find((entry) => entry.op === target.op);
      if (logged) return { type: logged.kind };
    }
    return null;
  }

  function pkStartOk(): boolean {
    if (!match) return false;
    const over = overlayScore(match, events, entries);
    return pkCanStart({
      status: overlayStatus(match, entries),
      running: over.clockBase.running,
      period: over.clockBase.period,
      home: over.score.home,
      away: over.score.away,
      penalty: over.penalty,
      pendingPkStart: pendingPkStart(),
    });
  }

  function pkKickOk(): boolean {
    if (!match || statusNow() !== 'live') return false;
    const over = overlayScore(match, events, entries);
    return over.penalty != null && over.clockBase.period === 'pk';
  }

  /**
   * 規則不允許的意圖。回 true 時呼叫端不得寫日誌。
   * 狀態一律看 statusNow()（現在的疊加狀態），對齊 Rules 的 a.status 條件。
   */
  function intentForbidden(intent: Intent, before?: LogEntry): boolean {
    const status = statusNow(before);
    if (status != null) {
      const playing = status === 'live' || status === 'halftime';
      if (intent.kind === 'goal' && status !== 'live') return true;
      if ((intent.kind === 'void' || intent.kind === 'card' || intent.kind === 'sub'
        || intent.kind === 'timeout' || intent.kind === 'clock' || intent.kind === 'fulltime') && !playing) return true;
      if (intent.kind === 'kickoff' && status !== 'scheduled') return true;
      if (intent.kind === 'halftime' && status !== 'live') return true;
      if (intent.kind === 'resume' && status !== 'halftime') return true;
      if (intent.kind === 'undoFinish' && status !== 'finished') return true;
    }
    if (intent.kind === 'goal') return pkActive();
    if (intent.kind === 'pkStart') return !pkStartOk();
    if (intent.kind === 'pk') return !pkKickOk();
    if (intent.kind === 'void') {
      const target = describedTarget({ seq: intent.targetSeq, op: intent.targetOp });
      if (!target) return false;
      if (target.type === 'timeout' || target.type === 'pkStart') return true;
      if (target.type === 'goal' && pkActive()) return true;
      return false;
    }
    if (intent.kind === 'kickoff' || intent.kind === 'halftime' || intent.kind === 'resume') return pkActive();
    if (!pkActive()) return false;
    if (intent.kind === 'clock' || intent.kind === 'fulltime' || intent.kind === 'undoFinish') {
      return intent.clock.period !== 'pk';
    }
    if (intent.kind === 'timeout') return !!intent.clock && intent.clock.period !== 'pk';
    return false;
  }

  async function finish(ops: string[], kinds: readonly ActionKind[] = []): Promise<ActionResult> {
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
    // 終場寫入落地後日誌可能已被清掉，get 會是 null。只對終場類（fulltime）視為已套用。
    const terminalAction = ops.length > 0
      && kinds.length === ops.length
      && kinds.every((kind) => kind === 'fulltime');
    if (terminalAction && terminalMatch(match) && rows.every((entry) => entry == null || entry.state === 'applied')) {
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

  async function one(intent: Intent, group?: ActionGroup, clockAction?: ClockActionName): Promise<ActionResult> {
    if (intentForbidden(intent)) return rejected('rules');
    const action = clockAction ?? (intent.kind === 'clock' ? intent.clockAction : undefined);
    if (!allow(intent.kind, action)) {
      return rejected(tab === 'blocked' ? 'rules' : 'limit');
    }
    if (intent.kind === 'fulltime' && fulltimeBlocked(entries)) return rejected('rules');
    // 有被拒項目時送出會停住。階段動作不再建新項目：疊加後狀態會先跳（例如已是下半場），之後重送又會被規則拒（C1）。
    // 進球、牌、換人、暫停照常排在後面（顧問 11-20 裁定），畫面另有常駐提示。
    if (PHASE_KINDS.has(intent.kind) && hasRejected()) {
      blockedAction = intent.kind as PhaseIntent['kind'];
      emit();
      return rejected('blocked');
    }
    const row = make(intent, group);
    await putAll([row]);
    return finish([row.op], [intent.kind]);
  }

  function second(): number {
    return Math.max(0, Math.min(10800, Math.floor(elapsedSec())));
  }

  function linkedSecond(target: { seq?: number; op?: string }): { seq?: number; op?: string } | null {
    return liveSecondYellow(target, knownEvents(), entries, match?.resetRev ?? 0);
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
        const open = findOpenYellow(input.plId, input.side, knownEvents(), entries, match?.resetRev ?? 0);
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
    halftime: () => one({ kind: 'halftime', matchSecond: second(), clock: phaseClock('halftime', elapsedSec(), now(), livePeriod()) }),
    resume: () => one({ kind: 'resume', matchSecond: second(), clock: phaseClock('resume', elapsedSec(), now(), 'ht') }),
    fulltime: () => one({
      kind: 'fulltime',
      matchSecond: second(),
      clock: pkActive()
        ? stoppedClock('pk')
        : phaseClock('fulltime', elapsedSec(), now(), livePeriod()),
    }),
    undoFinish: () => one({ kind: 'undoFinish', matchSecond: second(), clock: phaseClock('undoFinish', elapsedSec(), now(), livePeriod()) }),
    pauseClock() {
      const intent: Intent = {
        kind: 'clock',
        matchSecond: second(),
        clockAction: 'pause',
        clock: { running: false, period: livePeriod(), pausedSec: Math.floor(elapsedSec()), startedAt: now() },
      };
      return one(intent);
    },
    resumeClock() {
      return one({
        kind: 'clock',
        matchSecond: second(),
        clockAction: 'resume',
        clock: { running: true, period: livePeriod(), pausedSec: Math.floor(elapsedSec()), startedAt: now() },
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
      if (intents.some((intent) => intentForbidden(intent))) return rejected('rules');
      if (!allowGroup(intents)) return rejected('limit');
      const label: GroupLabel = secondYellow ? 'amendFirstYellow' : 'amend';
      const rows = groupRows(label, intents);
      await putAll(rows);
      return finish(rows.map((row) => row.op), rows.map((row) => row.kind));
    },
    async undoFirstYellow(target) {
      if (tab === 'blocked') return rejected('rules');
      const secondYellow = linkedSecond(target);
      if (!secondYellow) return actions.voidEvent(target);
      const intents: Intent[] = [voidOf(secondYellow), voidOf(target)];
      // 與 amend 一致：整組任一不允許就整組不寫（Opus 終審 P2-2：待送終場後復原第一黃會卡佇列）。
      if (intents.some((intent) => intentForbidden(intent))) return rejected('rules');
      if (!allowGroup(intents)) return rejected('limit');
      const rows = groupRows('undoFirstYellow', intents);
      await putAll(rows);
      return finish(rows.map((row) => row.op), rows.map((row) => row.kind));
    },
    async reapply(op) {
      if (tab === 'blocked') return rejected('rules');
      const current = senderOrThrow();
      if (!localSid || current.needsTakeover) return rejected('takenOver');
      const entry = await log.get(op);
      if (!entry) return rejected();
      if (entry.state === 'applied') return { status: 'applied' };
      if (entry.state === 'discarded') {
        return rejected(entry.rejectReason === 'reset' ? 'reset' : 'rules');
      }
      if ((match?.resetRev ?? 0) > (entry.baseResetRev ?? 0)) {
        await log.patch(op, { state: 'discarded', rejectReason: 'reset' });
        await reloadEntries();
        emit();
        return rejected('reset');
      }
      const clockAction = entry.intent.kind === 'clock'
        ? entry.intent.clockAction
        : entry.intent.kind === 'timeout' && entry.intent.stopClock
          ? 'pause'
          : undefined;
      if (intentForbidden(entry.intent, entry)) return rejected('rules');
      if (!allow(entry.kind, clockAction)) return rejected('limit');
      await log.patch(op, { state: 'pending', rejectReason: null, autoRetried: false });
      return finish([op], [entry.kind]);
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
    timeout(input) {
      const over = overNow();
      const running = over?.clockBase.running === true;
      const wantStop = input.stopClock === undefined ? timeoutRule.stopsClock : input.stopClock;
      const stop = wantStop && running;
      const period = over?.clockBase.period ?? livePeriod();
      const intent: TimeoutIntent = {
        kind: 'timeout',
        side: input.side,
        matchSecond: second(),
        ...(stop ? {
          stopClock: true,
          clock: {
            running: false,
            period,
            pausedSec: Math.max(0, Math.min(10800, Math.floor(elapsedSec()))),
            startedAt: now(),
          },
        } : {}),
      };
      return one(intent, undefined, stop ? 'pause' : undefined);
    },
    pkStart() {
      const over = overNow();
      const base = over?.clockBase;
      const intent: Intent = {
        kind: 'pkStart',
        matchSecond: second(),
        clock: {
          running: false,
          period: 'pk',
          pausedSec: Math.max(0, Math.min(10800, Math.floor(base?.pausedSec ?? elapsedSec()))),
          startedAt: base && !base.running ? base.startedAt : null,
        },
      };
      return one(intent);
    },
    pk(input) {
      const intent: PkIntent = {
        kind: 'pk',
        side: input.side,
        scored: input.scored,
        matchSecond: second(),
        ...(input.plId ? { plId: input.plId } : {}),
      };
      return one(intent);
    },
  };

  function livePeriod(): string {
    return overNow()?.clockBase.period ?? match?.clockBase.period ?? 'h1';
  }

  function stoppedClock(period: string): ClockTarget {
    return {
      running: false,
      period,
      pausedSec: Math.max(0, Math.min(10800, Math.floor(elapsedSec()))),
      startedAt: null,
    };
  }

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
      let kept: LogEntry[] = [];
      try {
        kept = await log.list(cid, mtId);
      } catch {
        kept = [];
      }
      try {
        await log.purgeOlderThan(now());
      } catch {
        const memory = new MemoryActionLog();
        for (const row of kept) await memory.put(row);
        log = memory;
        storage = 'unavailable';
      }
      try {
        const after = await log.list(cid, mtId);
        const live = new Set(after.map((row) => row.op));
        const cut = now() - ACTION_LOG_MAX_AGE_MS;
        for (const row of kept) {
          if (row.state !== 'pending' && row.state !== 'sending') continue;
          if (live.has(row.op)) continue;
          if (row.createdAt < cut) continue;
          await log.put(row);
        }
      } catch {
        // 列不出來就維持清除後的日誌，不把已過期項目救回。
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
        onChange: senderChanged,
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
      staff = {
        roles: opened.staffRoles,
        matchIds: opened.matchIds ?? [],
        expiresAt: opened.expiresAt ?? null,
      };
      timeoutRule = readTimeoutRule(opened.timeoutRaw ?? null);
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
