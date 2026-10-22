/**
 * 建立／編輯活動表單各列的「顯示介面」（T-013）。
 * EventFormFields 只依這些介面輸出 A 的 DOM；資料與互動邏輯由各 hook 提供（封面、委託人、地圖座標）。
 */

/** A `#ce-upload-area`：沒有圖時顯示「點擊上傳圖片」佔位。 */
export interface CoverUploadView {
  /** 預覽圖網址（data: 或 https:）；'' 表示沒有圖。 */
  previewUrl: string;
  /** `input#ce-image` 選到檔案時呼叫（驗證、讀檔、裁圖都在 hook 內）。 */
  onPickFile(file: File): void;
}

/** A `#ce-delegate-tags` 的一個膠囊／搜尋結果的一筆。 */
export interface DelegateChip {
  uid: string;
  name: string;
  /** 用來決定膠囊底色（照 A `_userTag(name, role)`）；缺省 'user'。 */
  role: string;
}

/** A `event-create-delegates.js` 的委託人列。 */
export interface DelegatePickerView {
  chips: readonly DelegateChip[];
  /** false：輸入停用、膠囊沒有 ✕（A `_canCurrentEditManageDelegates()`）。 */
  canManage: boolean;
  query: string;
  /** 搜尋結果（A 最多 5 筆）。 */
  results: readonly DelegateChip[];
  dropdownOpen: boolean;
  /** 照 A _searchDelegates：載入／空結果／失敗文字；空字串表示不顯示。 */
  dropdownStatus: string;
  /** A 的三種 placeholder：「搜尋用戶...」「已達上限 3 人」「無權設定委託人」。 */
  placeholder: string;
  inputDisabled: boolean;
  onQuery(query: string): void;
  onFocus(): void;
  onPick(uid: string): void;
  onRemove(uid: string): void;
}

/** A `.event-location-control`（`_syncEventLocationUi`）。 */
export interface LocationControlView {
  /** 例：「GPS功能未開啟」「尚未設定地圖座標」「已設定地圖座標」 */
  statusText: string;
  /** `#ce-location-status` 的 `data-state`。 */
  statusState: string;
  /** 「設定地圖座標」／「重新設定地圖座標」 */
  buttonText: string;
  buttonDisabled: boolean;
  /** A `event-location-btn-disabled` class 與 aria-disabled（GPS 未開或功能未開）。 */
  buttonLooksDisabled: boolean;
  summary: string;
  showClear: boolean;
  onOpenPicker(): void;
  onClear(): void;
}

/**
 * 進階功能區（加值欄位）的表單狀態（T-013 第 2 段）。
 * 欄位與預設照 A：event-create.js 開表單重設（2758～2797）與 event-create-options.js 各 _set*／_get*FormData。
 */
export type TeamSplitMode = 'random' | 'self-select' | 'manual';

export interface EventFormAddonState {
  /** A `ce-fee-enabled`／`ce-fee`（字串，送出時 parseInt，A `_setEventFeeFormState(false, 0)`）。 */
  feeEnabled: boolean;
  fee: string;
  /** A `ce-team-only`；選到的俱樂部 id（依選取順序；非總管只能 1 支）。 */
  teamOnly: boolean;
  teamOnlyTeamIds: string[];
  /** A `ce-gender-restriction-enabled`／`_getAllowedGenderValue()`。 */
  genderRestrictionEnabled: boolean;
  allowedGender: '' | '男' | '女';
  /** A `ce-private-event`。 */
  privateEvent: boolean;
  /** A 分隊：`ce-team-split-enabled`、`ce-team-split-count`（2～4）、`_tsTeamColorIdx`（每隊色票索引，對應 A `_tsDefaultColors`）、`ce-team-split-balance`（預設 true）、模式（預設 random）、自選鎖定小時（預設 2）。 */
  teamSplitEnabled: boolean;
  teamSplitCount: number;
  teamSplitColorIdx: number[];
  teamSplitBalanceCap: boolean;
  teamSplitMode: TeamSplitMode;
  teamSplitLockHours: number;
  /** A 社群連結：開關＋輸入框（最多 5 列，A `_eventSocialLinksMax`）。 */
  socialLinksEnabled: boolean;
  socialLinkInputs: string[];
  /** A 早鳥：開關＋消耗積分（字串，A `_setEventEarlyBirdFormData(false, 10)`，10～500）。 */
  earlyBirdEnabled: boolean;
  earlyBirdCost: string;
  /** A `ce-gps-enabled`。 */
  gpsEnabled: boolean;
}

/** 進階功能區可選的限定俱樂部（A `ce-team-select` 的 option）。 */
export interface TeamOnlyOption {
  id: string;
  name: string;
}
