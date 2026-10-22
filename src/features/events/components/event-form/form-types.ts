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
