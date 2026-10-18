/**
 * FC-B 活動資料層型別。
 *
 * 只列出 A 原始碼在這些規則中實際讀到的欄位；不確定語意者以 「待核實」註解 標注。
 * 注意：B 與 A 共用 Firestore，資料形狀必須一致，本檔僅作讀取型別，不構成寫入契約。
 */

export interface EventImageVariants {
  cover?: string;
  homeNext?: string;
}

export interface EventDoc {
  /** public eventId（R-ID-010：與 Firestore docId 不同時需走 paths.resolveEventDocId） */
  id?: string;
  /** Firestore document ID（snapshot.id） */
  _docId?: string;
  /** 部分舊資料以 docId 命名 */
  docId?: string;
  title?: string;
  /** 形如「2026/05/09 15:00~17:00」 */
  date?: string;
  /** home-next-activity 的 legacy fallback（型別待核實） */
  startAt?: unknown;
  /** home-next-activity 的 legacy fallback（型別待核實） */
  startTime?: unknown;
  status?: string;
  location?: string;
  image?: string;
  imageVariants?: EventImageVariants;
  type?: string;
  externalUrl?: string;
  /** 黑名單（R-EVT-010／011）；A 接受任意值，函式內以 Array.isArray 防禦 */
  blockedUids?: unknown;
  /** 私密活動：非 owner/delegate 且 non-admin 不可見 */
  privateEvent?: boolean;
  /** 俱樂部限定：需 owner / event.edit_all / 隊伍交集 / isPublic */
  teamOnly?: boolean;
  /** teamOnly 下額外允許可見的旗標 */
  isPublic?: boolean;
  creatorUid?: string;
  ownerUid?: string;
  captainUid?: string;
  creatorTeamId?: string;
  /** 可能是字串或字串陣列；A 只對陣列做 forEach */
  creatorTeamIds?: unknown;
  delegateUids?: string[];
  /** 僅顯示用 metadata；A 不以此作授權依據 */
  delegates?: unknown;
  /* ── home-next-activity 的 managed events 查詢欄位 ── */
  createdByUid?: string;
  creatorId?: string;
  ownerId?: string;
  organizerUid?: string;
  /* ── home-next-activity 的名稱欄位（B 只用 uid 判 owner） ── */
  creator?: string;
  creatorName?: string;
  ownerName?: string;
  organizer?: string;
  organizerDisplay?: string;
}

export interface RegistrationDoc {
  id?: string;
  _docId?: string;
  eventId?: string;
  /** R-ID-003：身分欄位 canonical 為 userId */
  userId?: string;
  /** legacy：A 有讀到 uid */
  uid?: string;
  /** legacy：A 有讀到 ownerUid */
  ownerUid?: string;
  status?: string;
  participantType?: string;
  managedRole?: string;
}

/**
 * 檢視者上下文。以參數注入取代 A 讀全域 App / ApiService / cache 的寫法。
 * 呼叫端負責組裝：
 *   - uid：currentUser.uid 或 null
 *   - teamIds：等價於 A 的 _getVisibleTeamIdsForLimitedEvents()
 *   - hasPermission：等價於 A 的 hasPermission(code)
 *   - roleLevel：等價於 A 的 ROLE_LEVEL_MAP[role]（admin = 4）
 */
export interface ViewerContext {
  uid: string | null;
  teamIds: ReadonlySet<string>;
  hasPermission: (code: string) => boolean;
  roleLevel: number;
}
