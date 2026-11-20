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
  'score-pre': '開賽前，畫面上 0 筆',
};

/**
 * 已被接受、不到四列的狀態（顧問裁定）。值是理由與出處；量到不到四列時記成「已接受」而不是違規。
 * 只放顧問明文接受過的；其餘不到四列的一律算違規，交給顧問裁定。
 */
export const ACCEPTED_SHORT = {
  'score-cap': '紀錄達上限、不能記分：顧問已接受（施工-第2批 3.17，舊規格 3.38 列）',
  'u2-storage-unavailable': '要接手＋離線紀錄無法保存、不能記分：顧問已接受（3.17，3.38 列）',
  'score-offline': '離線無法保存＋鎖定提醒：顧問已接受（3.17，3.77 列；卡 2-3(c) 之後 4.44 列）',
  'u2-crowded': '最擠（停錶＋離線＋鎖定提醒＋暫停條）：顧問已接受（3.17，2.71 列；卡 2-3(b)(c) 之後 4.10 列）',
  'a1-held-timeout': '紅色列＋球隊暫停展開：顧問夜誌 §3.468 接受（約 3.0 列，實量 3.04）',
  'a1-held-timeout-collapsed': '紅色列＋球隊暫停收合：比照 §3.468「紅色列＋球隊暫停條」（3.42 列）',
  'u2-fulltime-undo': '正式頁終場可撤回（多「離開記分」）、不能記分：顧問夜誌 §3.468 接受（約 2.8 列）',
};

/** 這個狀態要不要判四列；回傳 { check, reason }。 */
export function rowRule(screen) {
  if (OVERLAY_SCREENS.has(screen)) return { check: false, reason: '面板／對話框／亮牌／選單開著，不列入' };
  if (NO_BOARD_SCREENS.has(screen)) return { check: false, reason: '沒有記分板，不適用' };
  if (NO_ROWS[screen]) return { check: false, reason: NO_ROWS[screen] };
  return { check: true, reason: null };
}
