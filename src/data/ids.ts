// ID 產生與驗證。演算法完全對齊 A 版 `a-generateId.js`。
//
// 決策：
// - `generateId(prefix)` 格式固定為 `prefix + Date.now() + '_' + random6`。
// - `taApplicationId(teamId)` 決定性（R-ID-006）。
// - `isValidEventId(id)` 依 R-ID-007：`^[A-Za-z0-9_-]{1,120}$`。

/** 產生新 ID：`<prefix><毫秒時間戳>_<6 碼 base36>`。 */
export function generateId(prefix: string): string {
  return (
    (prefix || '') + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
  );
}

/** 各實體使用的固定前綴（與 A 版一致，不得更改）。 */
export const ID_PREFIX = {
  team: 'tm_',
  tournament: 'ct_',
  event: 'ce_',
  registration: 'reg_',
  match: 'cm_',
} as const;

export type IdPrefixKey = keyof typeof ID_PREFIX;

/** 團隊申請文件 ID：決定性（R-ID-006）。 */
export function taApplicationId(teamId: string): string {
  return `ta_${teamId}`;
}

/** 活動 ID 格式驗證（R-ID-007）。 */
export function isValidEventId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,120}$/.test(id);
}
