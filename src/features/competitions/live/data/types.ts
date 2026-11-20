// 記分資料層的共用型別。日誌只留意圖與 plId，不留姓名或生日。

import type { MatchClock, RosterPublicDoc } from '../../data/types';

export type Side = 'home' | 'away';
export type GoalKindName = 'normal' | 'penalty' | 'own';
export type CardTypeName = 'yellow' | 'second_yellow' | 'red';
export type ActionKind =
  | 'goal'
  | 'card'
  | 'sub'
  | 'kickoff'
  | 'halftime'
  | 'resume'
  | 'fulltime'
  | 'undoFinish'
  | 'clock'
  | 'void'
  | 'timeout'
  | 'pkStart'
  | 'pk';
export type LogState = 'pending' | 'sending' | 'applied' | 'rejected' | 'discarded';
// blocked：有被拒項目擋住送出時，階段動作不建新項目（第 4 步 A F5-3）。只回給呼叫端，不寫進日誌。
export type RejectReason = 'conflict' | 'takenOver' | 'locked' | 'limit' | 'rules' | 'unknown' | 'reset' | 'blocked';
export type GroupLabel = 'amend' | 'undoFirstYellow' | 'amendFirstYellow';
export type ClockActionName = 'pause' | 'resume' | 'correct';
export type ScoringPhase = 'pre' | 'play' | 'ht' | 'undo' | 'locked';
export type StorageMode = 'ok' | 'unavailable';
export type WakeState = 'held' | 'unsupported' | 'off';
export type TabRole = 'owner' | 'blocked' | 'unknown';

export interface ActionGroup {
  id: string;
  index: number;
  size: number;
  label: GroupLabel;
}

export interface ClockTarget {
  running: boolean;
  period: string;
  pausedSec: number;
  startedAt: number | null;
}

export interface GoalIntent {
  kind: 'goal';
  side: Side;
  plId?: string;
  goalKind: GoalKindName;
  matchSecond: number;
}

export interface CardIntent {
  kind: 'card';
  side: Side;
  plId: string;
  cardType: CardTypeName;
  matchSecond: number;
  /** 第一黃還沒落地時先記 op，送出當下才換成 refSeq。 */
  refOp?: string;
  refSeq?: number;
}

export interface SubIntent {
  kind: 'sub';
  side: Side;
  inPlId: string;
  outPlId: string;
  matchSecond: number;
}

export interface PhaseIntent {
  kind: 'kickoff' | 'halftime' | 'resume' | 'fulltime' | 'undoFinish';
  matchSecond: number;
  clock: ClockTarget;
}

export interface ClockIntent {
  kind: 'clock';
  matchSecond: number;
  clockAction: ClockActionName;
  clock: ClockTarget;
}

export interface VoidIntent {
  kind: 'void';
  matchSecond: number;
  targetOp?: string;
  targetSeq?: number;
}

/** stopClock 只留在意圖。規則的事件鍵不收它；要停錶時才帶 clock。 */
export interface TimeoutIntent {
  kind: 'timeout';
  side: Side;
  matchSecond: number;
  stopClock?: boolean;
  clock?: ClockTarget;
}

export interface PkStartIntent {
  kind: 'pkStart';
  matchSecond: number;
  clock: ClockTarget;
}

export interface PkIntent {
  kind: 'pk';
  side: Side;
  scored: boolean;
  plId?: string;
  matchSecond: number;
}

export type Intent =
  | GoalIntent
  | CardIntent
  | SubIntent
  | PhaseIntent
  | ClockIntent
  | VoidIntent
  | TimeoutIntent
  | PkStartIntent
  | PkIntent;

export interface LogEntry {
  op: string;
  cid: string;
  mtId: string;
  uid: string;
  /** 建立當下的本機 sid。送出時仍以當時的本機 sid 為準，不抄伺服器。 */
  sid: string;
  kind: ActionKind;
  intent: Intent;
  group?: ActionGroup;
  state: LogState;
  seq?: number;
  rejectReason?: RejectReason;
  createdAt: number;
  attempts: number;
  /** 建立當下本機已知的 match.resetRev。舊資料沒有這個欄位時視為 0。 */
  baseResetRev?: number;
  /** 這一次使用者嘗試裡，自動換號重送已經用過。重新套用會清掉。 */
  autoRetried?: boolean;
}

/** null 表示清掉該欄。省略表示不改。 */
export type LogPatch = Partial<Omit<LogEntry, 'seq' | 'rejectReason' | 'group'>> & {
  seq?: number | null;
  rejectReason?: RejectReason | null;
  group?: ActionGroup | null;
};

export interface ActionResult {
  status: 'applied' | 'queued' | 'rejected';
  reason?: RejectReason;
}

/** 伺服器時間或用戶端毫秒。純函式不碰 Firestore SDK。 */
export type TimeMark = { kind: 'server' } | { kind: 'millis'; ms: number };

export interface BatchPlan {
  seq: number;
  op: string;
  sid: string;
  match: {
    rev: number;
    updatedAt: TimeMark;
    score?: { home: number; away: number };
    status?: string;
    lock?: { locked: boolean };
    finishedAt?: TimeMark | null;
    clockBase?: {
      startedAt: TimeMark | null;
      pausedSec: number;
      running: boolean;
      period: string;
    };
    /** 省略表示這筆不改 PK 比分。 */
    penaltyScore?: { home: number; away: number };
  };
  /** 事件正文。createdAt 是 TimeMark，寫入時才換成 serverTimestamp。 */
  event: Record<string, unknown>;
  voidDoc?: { targetSeq: number; seq: number };
  cardLink?: { ySeq: number; seq: number; mode: 'create' | 'update' };
}

export interface ServerClock {
  startedAt: number | null;
  pausedSec: number;
  running: boolean;
  period: string;
}

export interface ServerSide {
  teamId: string;
  name: string;
  logo: string | null;
}

export interface ServerMatch {
  id: string;
  status: string;
  rev: number;
  resetRev: number;
  score: { home: number; away: number };
  lock: { locked: boolean };
  clockBase: ServerClock;
  finishedAt: number | null;
  home: ServerSide;
  away: ServerSide;
  divisionId: string;
  /** 缺欄與 null 都是還沒開始 PK。舊測試可以不填。 */
  penaltyScore?: { home: number; away: number } | null;
}

export interface ServerControl {
  uid: string;
  sid: string;
  takenAt: number | null;
}

export interface ServerEvent {
  seq: number;
  type: string;
  op: string;
  sid: string;
  side?: Side;
  plId?: string;
  goalKind?: string;
  cardType?: string;
  refSeq?: number;
  targetSeq?: number;
  inPlId?: string;
  outPlId?: string;
  /** pk 進或沒進。其他事件沒有這個欄。 */
  scored?: boolean;
  matchSecond: number;
  createdAt: number;
}

export interface DecideEntry {
  op: string;
  seq?: number;
  /** 缺值視為 0。伺服器 resetRev 比這個大，項目就屬於重置前。 */
  baseResetRev?: number;
}

/**
 * eventAtSeq：e{項目.seq}。null 是確定不存在。
 * matchedSeq：時間軸上 op 相同的事件。沒有就是 null。
 * resetRev 缺值視為 0。
 */
export interface DecideServer {
  rev: number;
  resetRev?: number;
  eventAtSeq: { op: string } | null;
  matchedSeq: number | null;
  /**
   * 讀到的場次或時間軸有本機還沒被伺服器確認的寫入（Firestore metadata.hasPendingWrites）。
   * eventAtSeq、matchedSeq 只來自已確認的文件；pending 為真時不換號、不重送、不標 applied，等 SDK 結果（第 4 步 A F2）。
   */
  pending?: boolean;
}

export type RetryDecision =
  | { kind: 'assign' }
  | { kind: 'applied'; seq: number }
  | { kind: 'inflight' }
  | { kind: 'wait' }
  | { kind: 'reuse' }
  | { kind: 'resequence' }
  | { kind: 'discard'; reason: 'reset' };

/** 時間軸讀取結果。events 只含伺服器已確認的文件；pending 表示讀到過本機未確認的文件（已排除）。 */
export interface TimelineRead {
  events: ServerEvent[];
  pending: boolean;
}

export interface ServerRead {
  match: ServerMatch;
  control: ServerControl | null;
  /** 場次文件有本機未確認的寫入。缺值視為 false（舊的假後端）。 */
  pending?: boolean;
}

export interface ScoringPort {
  commit(plan: BatchPlan): Promise<void>;
  loadServer(): Promise<ServerRead>;
  /** seq >= minSeq 且 seq > resetRev，由小到大，最多 200 筆，只含已確認文件。 */
  loadTimelineFrom(minSeq: number, resetRev: number): Promise<TimelineRead>;
  knownEvents(): readonly ServerEvent[];
  takeover(sid: string): Promise<void>;
}

export interface BudgetView {
  used: number;
  pauseUses: number;
  pauseLeft: number;
  /** n > 130 或停錶次數已滿就 false。 */
  pauseEnabled: boolean;
  nearLimit: boolean;
  controlsOnly: boolean;
  exhausted: boolean;
}

export interface GroupView {
  id: string;
  label: GroupLabel;
  size: number;
  applied: number;
  message: string | null;
  ops: string[];
}

export interface UnappliedView {
  op: string;
  kind: ActionKind;
  state: LogState;
  rejectReason?: RejectReason;
  createdAt: number;
  intent: Intent;
  group?: ActionGroup;
  summary: string;
}

export interface ScoreView {
  home: number;
  away: number;
  pendingCount: number;
  server: { home: number; away: number };
}

export interface RosterSnap {
  home: RosterPublicDoc[];
  away: RosterPublicDoc[];
}

export type { MatchClock };
