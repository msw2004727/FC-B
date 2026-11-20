// 記分頁 360×640「至少四列」的共用判準（新外觀第 2 批卡 2-0；施工-第2批 3.17）。
// cp-scoreboard-fit360.mjs 與 cp-step4a-shots.mjs 都讀這一支，例外清單只維護一份。

/** 一屏至少完整容得下幾列紀錄（列高 48，四列＝192px）。 */
export const ROW_TARGET = 4;

/** PK 進行中：不顯示時鐘與節次（3.2）；一般進球鈕換成四顆 PK 鈕。 */
export const PK_SCREENS = new Set(['u2-pk-live', 'u2-pk-goal-locked', 'score-pk']);

/**
 * 面板、對話框、亮牌、選單開著：底下的東西本來就被蓋住，不列入四列與點得到的檢查（final-check.md 第 2 節第 3 點）。
 * 量測照樣記錄區塊位置，只是不判違規。
 */
export const OVERLAY_SCREENS = new Set([
  'u2-pk-confirm',
  'u2-pk-goal-locked',
  'a1-held-sheet',
  'a1-pk-confirm-wait',
  'a1-pk-confirm-armed',
  'a1-kickoff-confirm',
  'a1-takeover-confirm',
  'a1-showcard',
  'a1-undo-confirm',
  'a1-amend-confirm',
  'u2-menu',
  // 設計總監 04:20：選單開著、含停用的列（同 u2-menu 一類）
  'u2-menu-disabled',
  'u2-timeout-sheet',
  'u2-amend-card',
  'score-pick-player',
  'score-pick-player-long',
  'score-card-yellow',
  'score-card-red-auto',
  'score-unapplied',
  'score-takeover',
  'score-amend',
]);

/** 沒有記分板（一句話＋回去的鈕）：條件不適用（final-check.md 第 2 節第 4 點）。 */
export const NO_BOARD_SCREENS = new Set([
  'u2-no-permission',
  'u2-no-permission-host',
  'u2-load-failed-network',
  'u2-load-failed-error',
]);

/** 開賽前不可能有紀錄：不判四列（3.17 表「開賽前 140，—」）。四列是看紀錄區容量（高÷列高），不是畫面上實際幾筆。 */
export const NO_ROWS = {
  'u2-pre': '開賽前，畫面上 0 筆',
  'u2-pre-wake-off': '開賽前，畫面上 0 筆',
  'u2-pre-disabled': '開賽前（開賽鈕停用），畫面上 0 筆',
  'score-pre': '開賽前，畫面上 0 筆',
};

/**
 * 已被接受、不到四列的狀態。照施工-第2批 3.17b 兩張表（11-21 02:36 彙整，夜誌 §3.468、§3.488）逐列對：
 * 表上有、這裡有示範狀態的組合才列；表上有、沒有示範狀態的不補（能記分表第 3、5、7、8 列）；
 * 不在表上又量到不到四列＝違規（交顧問裁定）。值是對應的表列與依據；量到不到四列時記成「已接受」。
 * cp-scoreboard-fit360.mjs 與 cp-step4a-shots.mjs（firstScreenAccepted）都讀這一份。
 */
export const ACCEPTED_SHORT = {
  // ── 3.17b「能記分而不到四列的」──
  'a1-held-timeout': '3.17b 能記分表第 1 列：紅色列＋球隊暫停條展開（顧問 §3.468）',
  'a1-held-timeout-collapsed': '3.17b 能記分表第 2 列：紅色列＋球隊暫停條收合（顧問 §3.488）',
  'score-offline': '3.17b 能記分表第 4 列：兩條提示、沒有紅色列（舊規格已接受的 score-offline 那一類）',
  'u2-near-cap': '3.17b 能記分表第 4 列：兩條提示、沒有紅色列（離線已存＋接近上限）',
  'u2-crowded': '3.17b 能記分表第 6 列：兩條提示＋球隊暫停條展開（舊規格已接受「最擠」）',
  // ── 3.17b「不能記分而不到四列的」──
  'score-cap': '3.17b 不能記分表：紀錄達上限（舊規格已接受）',
  'u2-storage-unavailable': '3.17b 不能記分表：要接手＋離線紀錄無法保存（舊規格已接受）',
  'u2-fulltime-undo': '3.17b 不能記分表：正式頁終場已送出、可撤回（顧問 §3.468）',
  'u2-fulltime-undo-blocked': '3.17b 不能記分表：正式頁終場可撤回＋撤回被擋（顧問 §3.488）',
  'u2-reader-cap': '3.17b 不能記分表：另一分頁在記＋紀錄達上限（顧問 §3.488）',
  // 表上「開賽前（u2-pre）」不在這裡：開賽前不判四列，見上面 NO_ROWS。
};

/** 這個狀態要不要判四列；回傳 { check, reason }。 */
export function rowRule(screen) {
  if (OVERLAY_SCREENS.has(screen)) return { check: false, reason: '面板／對話框／亮牌／選單開著，不列入' };
  if (NO_BOARD_SCREENS.has(screen)) return { check: false, reason: '沒有記分板，不適用' };
  if (NO_ROWS[screen]) return { check: false, reason: NO_ROWS[screen] };
  return { check: true, reason: null };
}
