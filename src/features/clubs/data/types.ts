/**
 * 俱樂部資料層型別（FC-B p46 teams）。
 *
 * 僅描述讀取面：A 原始碼在列表/詳情規則中實際讀到的欄位。
 * 所有欄位皆 optional（B 與 A 共用 Firestore，資料形狀無法由 B 片面保證），
 * 未知欄位以索引簽名保留，不得據此寫入。
 */

import type { TeamContactLink } from './team-contact-links';

export interface TeamImageVariants {
  card?: string;
  cover?: string;
  homeNext?: string;
}

export interface TeamEduSettings {
  teachingEnabled?: boolean;
  students?: unknown[];
  [key: string]: unknown;
}

export interface TeamDetailVisibility {
  events?: boolean;
  courses?: boolean;
  matches?: boolean;
  info?: boolean;
  bio?: boolean;
  record?: boolean;
  members?: boolean;
}

export interface TeamHistoryEntry {
  id?: string;
  participants?: unknown[];
  players?: unknown[];
  members?: unknown[];
  roster?: unknown[];
  [key: string]: unknown;
}

/** `users/{uid}` 文件中本層會讀到的欄位（只讀）。 */
export interface TeamMember {
  uid?: string;
  _docId?: string;
  name?: string;
  displayName?: string;
  nickname?: string;
  nickName?: string;
  lineName?: string;
  profileName?: string;
  userName?: string;
  realName?: string;
  selfName?: string;
  childName?: string;
  teamIds?: unknown;
  teamId?: unknown;
  [key: string]: unknown;
}

/**
 * `teams/{teamId}` 文件型別（讀取）。
 *
 * 註：`members` 為伺服器 Callable `recountTeamMembers` 維護的快取；
 * 本層只能顯示、不得自行重算或寫回。
 */
export interface TeamDoc {
  /** 顯示／業務 id（A 在 UI 一律使用此值；通常等於 Firestore docId，但型別允許不同）。 */
  id?: string;
  /** Firestore snapshot.id。 */
  _docId?: string;

  name?: string;
  nameEn?: string;

  /** 對應 A js/modules/team/team-form.js:handleSaveTeam；以下為選填讀取欄位。 */
  nationality?: string;
  founded?: string | number;
  contact?: string;
  bio?: string;
  contactLinksEnabled?: boolean;
  contactLinks?: TeamContactLink[];
  captainName?: string;
  leaderNames?: readonly string[] | null;
  coaches?: readonly string[] | null;
  coachNames?: readonly string[] | null;
  wins?: number;
  draws?: number;
  losses?: number;
  gf?: number;
  ga?: number;

  /** legacy：隊長顯示名稱（只用於關鍵字搜尋）。 */
  captain?: string;
  /** legacy：領隊顯示名稱（只用於關鍵字搜尋）。 */
  leader?: string;
  /** legacy：領隊名稱陣列（本層不用於身分判定）。 */
  leaders?: unknown;

  captainUid?: string;
  /** 與 leaderUids 互斥；當 leaderUids 是陣列時必須忽略本欄。 */
  leaderUid?: string;
  leaderUids?: unknown;
  coachUids?: unknown;

  creatorUid?: string;
  ownerUid?: string;

  region?: string;
  sportTag?: string;

  type?: string;
  teachingEnabled?: boolean;
  isTeaching?: boolean;
  educationTag?: boolean;
  eduSettings?: TeamEduSettings;

  image?: string;
  coverImage?: string;
  imageVariants?: TeamImageVariants;
  attentionEffectEnabled?: boolean;
  attentionEffectColor?: string;
  themeColor?: string;
  themeOverlayEnabled?: boolean;

  teamExp?: number;
  pinned?: boolean;
  pinOrder?: number;

  detailVisibility?: TeamDetailVisibility;

  /** 成員數快取（Callable `recountTeamMembers` 寫入）；本層僅顯示。 */
  members?: number;

  /** 已停用旗標；A 於列表透過 `getActiveTeams()` 過濾。 */
  active?: boolean;

  /** 教育學員來源（本層未移植，僅保留欄位避免意外掉資料）。 */
  students?: unknown[];
  eduStudents?: unknown[];
  educationStudents?: unknown[];
  studentList?: unknown[];

  history?: TeamHistoryEntry[];

  /** 未知欄位保留；不得用於寫入契約。 */
  [key: string]: unknown;
}

/** 照 A `_buildTeamDetailPrimaryAction` 的三種按鈕。 */
export type TeamPrimaryAction = 'join' | 'pending' | 'leave';

export type TeamCategoryKey = 'none' | 'competitive' | 'education' | 'leisure';

export interface TeamCategoryOption {
  key: TeamCategoryKey;
  /** i18n key；A 原始 label 見 getTeamCategoryOptions 註解。 */
  labelKey: string;
  /** i18n key；A 原始 formHint 見 getTeamCategoryOptions 註解。 */
  formHintKey: string;
  ribbonClass: string;
  pillClass: string;
  showEduSettings: boolean;
  coursesEnabled: boolean;
  tournamentSettingsReserved: boolean;
}

/** 詳情頁名單列（純資料；顯示字串由 UI 以 i18n key 決定）。 */
export interface TeamRosterRow {
  uid: string;
  /** 顯示名稱；缺名時為空字串，由 isMissingName 標記交由 UI 決定 fallback。 */
  name: string;
  isMember: boolean;
  /** 角色標記，值為 i18n key（例如 clubs.role.captain）。 */
  roles: string[];
  /** 對應的 user doc；若僅有幹部 UID 而無 user doc，則為 null。 */
  user: TeamMember | null;
  /** 列標籤，值為 i18n key（本版固定為 clubs.roster.member）。 */
  labelKey: string;
  isMissingName: boolean;
}

/**
 * 檢視者（最小介面）。結構上相容 `ViewerView`（profile/data/viewer.ts），
 * 但俱樂部資料層不直接依賴 profile 模組。
 */
export interface ClubViewer {
  uid: string | null;
  teamIds: ReadonlySet<string>;
  hasPermission: (code: string) => boolean;
}
