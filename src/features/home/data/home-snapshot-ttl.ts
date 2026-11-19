/**
 * 首頁快照的格式版本與期限。提早腳本（index.html）與 home-snapshot.ts 只准從這裡拿，
 * 不要在 HTML 裡再寫一份毫秒數。
 *
 * 格式或語意改變時把 HOME_SNAPSHOT_FORMAT_V 加 1（舊快照自動作廢），並更新
 * home-snapshot.format-lock.json。
 */

/** 資料格式版本。不看 app 版號。 */
export const HOME_SNAPSHOT_FORMAT_V = 1;

/** 橫幅首屏快照可沿用的時間（站長 2026-11-10：24 小時）。 */
export const BANNERS_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 運動統計（「N 活動」）可沿用的時間：7 天（站長 2026-11-19 定案）。
 * 取代原「30 分鐘就作廢、改顯示載入中」：隔一段時間再開首頁時運動入口整塊空白；改為超過
 * SPORTS_SNAPSHOT_FRESH_MS 仍顯示上次數字，但以舊資訊樣式（數字變淡＋「更新中」）呈現，新資料一到就換。
 */
export const SPORTS_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** 運動統計在這段時間內照一般樣式顯示（沿用 A 的 publicBootSnapshotMaxAgeMs 30 分鐘）；超過改舊資訊樣式。 */
export const SPORTS_SNAPSHOT_FRESH_MS = 30 * 60 * 1000;

/** 運動統計期限的既有名稱。橫幅請用 BANNERS_SNAPSHOT_MAX_AGE_MS。 */
export const HOME_SNAPSHOT_MAX_AGE_MS = SPORTS_SNAPSHOT_MAX_AGE_MS;

/** 寫入時間比現在晚超過這個值，視為時鐘不可信。 */
export const HOME_SNAPSHOT_FUTURE_SKEW_MS = 60_000;
