// 賽事第 2 步讀取模型。欄位照後端契約 §3；根文件沒有 hostUid。
// 文件 id 是 Firestore 文件名稱，不是儲存欄位。

export type HostType = 'personal' | 'club';
export type CompetitionSport = 'football';
export type CompetitionTimezone = 'Asia/Taipei';
export type MapProvider = 'google' | 'manual';
export type CompetitionStatus = 'draft' | 'published' | 'postponed' | 'cancelled';
export type PlayersOnField = 5 | 7 | 8 | 9 | 11;
export type EntryStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type PaymentStatus = 'none' | 'pending' | 'paid' | 'refunded';
/** setPaymentStatus 只接受這兩個值（契約 §6）。讀取模型的 paymentStatus 較寬。 */
export type PaymentStatusWrite = 'none' | 'paid';
export type RosterPositionCode = 'GK' | 'DF' | 'MF' | 'FW' | 'custom';
export type ReportReason = 'impersonation' | 'fake' | 'inappropriate' | 'privacy' | 'other';
/** 主辦身分只有 host／coHost。沒有 creator 角色（契約 §4，站長選乙）。 */
export type StaffRole = 'host' | 'coHost';
export type MineRole = 'host' | 'rep' | 'player';
/** 根文件 category。缺值視為 league（categoryOf）。 */
export type CompetitionCategory = 'league' | 'cup' | 'friendly';
export type MatchStatus =
  | 'scheduled'
  | 'postponed'
  | 'live'
  | 'halftime'
  | 'finished'
  | 'confirmed'
  | 'walkover'
  | 'cancelled';
/** 手動裁定或抽籤登錄。列上 decidedBy 與此相同。 */
export type TieDecisionMethod = 'host' | 'drawLots';
/** 積分排序捷徑。省略時畫面用對戰優先（h2hFirst）。 */
export type StandingRanking = 'h2hFirst' | 'goalDiffFirst';
export type MatchSideName = 'home' | 'away';
/** 公告作者。host 占主辦 20 則；system 另計，不占這 20 則。 */
export type NoticeKind = 'host' | 'system';

/** 賽事根文件 notices 的一則。沒有這個欄位時讀成空陣列。 */
export interface CompetitionNotice {
  id: string;
  text: string;
  kind: NoticeKind;
  /** 伺服器時鐘，毫秒。 */
  at: number;
  /** 稽核雜湊。不寫 uid。 */
  by: string | null;
}

export interface Venue {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  mapPlaceId?: string;
  mapProvider?: MapProvider;
}

export interface DivisionInput {
  dvId?: string;
  name: string;
  playersOnField: PlayersOnField;
  maxTeams: number;
  rosterMin: number;
  rosterMax: number;
  minAge?: number;
  maxAge?: number;
  requireRealName?: boolean;
  feePerTeam?: number;
}

/** 根文件。沒有 hostUid（主辦身分在 staff/{uid}.roles）。 */
export interface CompetitionDoc {
  id: string;
  name: string;
  sport: CompetitionSport;
  hostType: HostType;
  hostTeamId: string | null;
  hostDisplay: string | null;
  visibility: string;
  status: CompetitionStatus;
  statusReason: string | null;
  hidden: boolean;
  regOpenAt: number;
  regCloseAt: number;
  firstMatchAt: number;
  lastMatchAt: number;
  endedAt: number | null;
  /**
   * confirm：全部場次解決後由觸發器寫，沒有 endReason。
   * host：主辦手動結束。auto：每日自動結束（本步只允許管理員恢復）。
   */
  endedBy: 'confirm' | 'host' | 'auto' | null;
  /** 只在手動結束時有原因。恢復時清成 null。 */
  endReason: string | null;
  rostersLockedAt: number | null;
  ageBasisAt: number | null;
  timezone: string;
  venues: Venue[];
  feeNote: string | null;
  liveLinks: string[];
  /** 公開聯絡文字。沒有或空白讀成 null。 */
  contactNote: string | null;
  /** 沒有這個欄位時是空陣列（舊賽事）。 */
  notices: CompetitionNotice[];
  /**
   * 第一次把末場往後延之前的原本 lastMatchAt。
   * 沒有時，60 天上限從目前 lastMatchAt 算。
   */
  lastMatchOriginAt: number | null;
  stateVersion: number;
  /** 缺值視為 league。讀取時已用 categoryOf 補上，不會是 undefined。 */
  category: CompetitionCategory;
}

export interface DivisionDoc {
  dvId: string;
  name: string;
  playersOnField: PlayersOnField;
  maxTeams: number;
  rosterMin: number;
  rosterMax: number;
  minAge: number | null;
  maxAge: number | null;
  requireRealName: boolean;
  feePerTeam: number;
  entryCount: number;
  approvedCount: number;
  order: number;
  /**
   * divisions.schedule.ranking。沒有賽程、或缺欄，是 null。
   * 進行中與已結束首屏不讀組別時，這個欄位不在手上。
   */
  ranking: StandingRanking | null;
}

export interface EntryDoc {
  id: string;
  dvId: string;
  teamId: string;
  name: string;
  status: EntryStatus;
  rosterCount: number;
  rosterConfirmed: boolean;
  /** https 網址或 null。不是 https 的值讀成 null。沒有 coverImage。 */
  teamLogo: string | null;
}

export interface EntryPrivateDoc {
  id: string;
  teamId: string;
  contactName: string | null;
  contactPhone: string | null;
  paymentStatus: PaymentStatus;
  reviewNote: string | null;
}

/** 公開名單投影：displayName、number、position、positionText、isMinor。 */
export interface RosterPublicDoc {
  id: string;
  enId: string;
  displayName: string;
  number: number;
  position: RosterPositionCode | null;
  positionText: string | null;
  isMinor: boolean;
}

/**
 * 名單私密文件。
 * ASSUMPTION: 契約只寫查詢條件 uid，沒有列出其他欄位，這裡不自創。
 */
export interface RosterPrivateDoc {
  id: string;
  uid: string;
}

/** cpMine/{uid}/items。roles 含 host／rep／player；host true 表示我發起的。 */
export interface CpMineItem {
  id: string;
  /** ASSUMPTION: 沒有 cid 欄位時用文件 id。 */
  cid: string;
  roles: MineRole[];
  host: boolean;
  /** 有名稱就不用再讀賽事文件。舊文件可能沒有這個欄。 */
  name?: string;
  /** 缺值視為 league。讀取時已用 categoryOf 補上。 */
  category: CompetitionCategory;
}

export interface LaunchDoc {
  isPublic: boolean;
  bannedWords: string[];
}

/**
 * 主辦身分。
 * ASSUMPTION: 契約 §3 寫在 staff/{uid}.roles，讀取表沒有獨立一列，仍做成一個讀取方法要用的型別。
 * roles 只收 host／coHost；文件若帶 creator 會在讀取時濾掉。
 */
export interface StaffDoc {
  uid: string;
  roles: StaffRole[];
  /**
   * 後端 K10 依加入先後配發，不回收。建賽主辦為 1。
   * 讀取只留正整數；缺欄、0、負數、小數、非數字都丟掉。
   */
  memberNo?: number;
}

/** 指派讀取用。含記分角色。與 StaffDoc 分開，既有 getStaff 仍只留 host／coHost。 */
export type StaffAssignmentRole = 'host' | 'coHost' | 'scorer' | 'referee';

export interface StaffAssignment {
  uid: string;
  roles: StaffAssignmentRole[];
  matchIds: string[];
  /** 沒有到期是 null。毫秒。 */
  expiresAt: number | null;
  /**
   * 後端 K10 依加入先後配發，不回收。建賽主辦為 1。
   * 讀取只留正整數；缺欄、0、負數、小數、非數字都丟掉。
   */
  memberNo?: number;
}

export interface MatchSide {
  teamId: string;
  name: string;
}

export interface MatchScore {
  home: number;
  away: number;
}

/** 契約 §1.2 的 result。winner／method 伺服器沒有逐項列舉，先照字串收。 */
export interface MatchResult {
  winner: string | null;
  method: string | null;
  homePoints: number;
  awayPoints: number;
}

export interface MatchClock {
  startedAt: number | null;
  pausedSec: number;
  running: boolean;
  period: string;
}

/**
 * 公開場次。時間是毫秒。penaltyScore 第 3 步一律 null（循環賽不收 PK）。
 * id 是文件 id（mt_…）。
 */
export interface MatchDoc {
  id: string;
  divisionId: string;
  stageId: string;
  groupId: string;
  round: number;
  matchNo: number;
  label: string | null;
  matchKey: string | null;
  kickoffAt: number | null;
  venueIdx: number | null;
  venueName: string | null;
  home: MatchSide;
  away: MatchSide;
  teamIds: [string, string];
  score: MatchScore;
  penaltyScore: null;
  status: MatchStatus;
  rev: number;
  resetRev: number;
  lock: { locked: boolean };
  clockBase: MatchClock;
  finishedAt: number | null;
  confirmedAt: number | null;
  walkoverSide: MatchSideName | null;
  result: MatchResult | null;
  resultSource: 'host' | null;
  updatedAt: number | null;
  /** 取消當下寫入。2～100 字。沒有取消是 null。 */
  cancelReason: string | null;
  cancelledAt: number | null;
}

/** 契約 §1.4／§7 的摘要條目。id 是摘要 map 的鍵。 */
export interface SummaryEntry {
  id: string;
  dv: string;
  r: number;
  no: number | null;
  k: number | null;
  v: string | null;
  h: { id: string; n: string; /** 摘要隊徽。沒有就不寫。 */ l?: string };
  a: { id: string; n: string; l?: string };
  s: [number, number];
  st: string;
  wo: string | null;
  /** 場地序號。沒有、或不是非負整數就不寫。 */
  vi?: number;
  /** 確認後改分時間（毫秒）。沒有就不寫。 */
  cx?: number;
  /** PK 比分。沒有就不寫。 */
  p?: [number, number];
  /**
   * 取消原因。摘要片欄位 cr。只有 st 為 cancelled 才有，最多 100 字。
   * 沒有、空白、或不是已取消就不寫。公開賽程與全部賽程都讀這個欄位。
   */
  cr?: string;
}

/**
 * 積分列。對齊引擎 StandingRow：win／draw／loss。
 * 欄位名照後端：另留每列的 hasUnresolvedTie、tiedWith。
 * 缺數字視為 0。name 不是字串時是空字串。
 * hasUnresolvedTie 缺值或不是 true 就是 false。tiedWith 只留非空字串（隊伍 id），其他當空陣列。
 */
export interface StandingRow {
  teamId: string;
  name: string;
  played: number;
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  rank: number;
  /** 後端這一列還沒裁定同分。只有 === true 才標「同分」。 */
  hasUnresolvedTie: boolean;
  /** 與這一列同分、尚未裁定的隊伍 id。欄位名照後端 StandingRow。 */
  tiedWith: string[];
  /**
   * 這一版名次真的照裁定排時才有。沒套用就不寫。
   * 判斷「同分待裁定」以這個欄位優先：有值就不是待裁定，
   * 即使 hasUnresolvedTie 或 tieBreakTrace 仍含 unresolved@manual。
   */
  decidedBy: TieDecisionMethod | null;
}

/** standings/{dvId}__group__A。契約 §1.3。 */
export interface StandingDoc {
  id: string;
  divisionId: string;
  groupId: string;
  rows: StandingRow[];
  version: number;
  hasUnresolvedTie: boolean;
  /**
   * 後端寫在積分文件上的組名。可能缺。
   * 進行中／已結束不讀組別文件，組名只看這個欄位。
   */
  divisionName?: string;
  /**
   * 尚未撤銷的裁定。enabled 不是 true 時是 null。
   * 這一版有沒有套上名次，看列上的 decidedBy，不看這裡。
   */
  manualOverride: ManualOverride | null;
  /** 積分文件若自帶 ranking 就用。沒有是 null，改看組別。 */
  ranking: StandingRanking | null;
  updatedAt: number | null;
}

/** 積分文件 manualOverride。方式、原因、時間。by 不放到畫面上。 */
export interface ManualOverride {
  method: TieDecisionMethod | null;
  reason: string | null;
  /** decidedAt，沒有時退回 at。毫秒。 */
  at: number | null;
}

/**
 * 契約 §3 的筆數上限，加上第 3 步。
 * 場次沿用契約觸發器「該組 ≤ 240」（16 隊雙循環）。
 * 摘要片 ≤ 14 天（計畫書）。積分榜對齊組別上限 8。隊徽對齊報隊 ≤ 32。
 */
export const CP_READ_LIMIT = {
  mine: 50,
  publicList: 30,
  hostTeam: 50,
  divisions: 8,
  entries: 100,
  roster: 60,
  private: 100,
  matches: 240,
  summary: 14,
  standings: 8,
  crest: 32,
} as const;
