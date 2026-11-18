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
  rostersLockedAt: number | null;
  ageBasisAt: number | null;
  timezone: string;
  venues: Venue[];
  feeNote: string | null;
  liveLinks: string[];
  stateVersion: number;
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
}

export interface EntryDoc {
  id: string;
  dvId: string;
  teamId: string;
  name: string;
  status: EntryStatus;
  rosterCount: number;
  rosterConfirmed: boolean;
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
}

/** 契約 §3 的筆數上限。 */
export const CP_READ_LIMIT = {
  mine: 50,
  publicList: 30,
  hostTeam: 50,
  divisions: 8,
  entries: 100,
  roster: 60,
  private: 100,
} as const;
