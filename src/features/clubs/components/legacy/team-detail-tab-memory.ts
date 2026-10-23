/**
 * M-118(a)：對應 A switchTeamDetailV2Tab／_getTeamDetailV2ActiveTab。
 * 以模組層 Map 記住各俱樂部頁籤，只活在記憶體；
 * 不寫 localStorage、sessionStorage 或 history，重新整理後清空。
 */
import type { V2TabKey } from './TeamDetailV2Header';

const MAX_REMEMBERED_TEAMS = 50;
const teamTabs = new Map<string, V2TabKey>();

/** 讀取記憶的頁籤；不在 allowedKeys 內或沒記過就回 'overview'。 */
export function getRememberedTeamTab(
  teamId: string,
  allowedKeys: readonly V2TabKey[],
): V2TabKey {
  const saved = teamTabs.get(teamId.trim());
  return saved !== undefined && allowedKeys.includes(saved) ? saved : 'overview';
}

/** 記住頁籤；teamId 以 trim 後字串為 key，空字串不記。 */
export function rememberTeamTab(teamId: string, tab: V2TabKey): void {
  const key = teamId.trim();
  if (!key) return;

  // ASSUMPTION:「最舊」指首次加入的順序；更新既有俱樂部不改變淘汰順序。
  teamTabs.set(key, tab);
  if (teamTabs.size > MAX_REMEMBERED_TEAMS) {
    const oldest = teamTabs.keys().next();
    if (!oldest.done) teamTabs.delete(oldest.value);
  }
}

export function _resetTeamTabMemoryForTest(): void {
  teamTabs.clear();
}
