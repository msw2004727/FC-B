// loadTeamsForUser 已經查過的隊伍文件。賽事代表清單沿用這份，只補查缺的欄位。
// 登出或換帳號就清掉，下一個 uid 不會讀到上一個人的隊伍：由 viewer.ts 負責（beginViewerLoad 換人或登出、
// resetViewerIdle 訂閱全部解除），scan 也只在 viewer 訂閱存在時寫入。
// 2026-11-18 入口瘦身（顧問 §3.256）：取代本檔頂層重複的 auth:changed 監聽。
// ASSUMPTION: 只留這一頁 viewer 最近一次成功讀到的結果，沒有另外的 TTL。

/** 與 viewer.ts loadTeamsForUser 的四個查詢對齊。coachUids 不是代表欄位。 */
export const VIEWER_TEAM_QUERY_FIELDS = ['captainUid', 'leaderUid', 'leaderUids', 'coachUids'] as const;
export type ViewerTeamQueryField = (typeof VIEWER_TEAM_QUERY_FIELDS)[number];

export interface ViewerTeamScanDoc {
  /** Firestore 路徑 id。賽事代表清單只用這個，不讀欄位 id。 */
  docId: string;
  data: Record<string, unknown>;
}

export interface ViewerTeamScan {
  fields: ReadonlySet<ViewerTeamQueryField>;
  docs: readonly ViewerTeamScanDoc[];
}

let scanUid: string | null = null;
let scan: ViewerTeamScan | null = null;

/** 這個 uid 還沒被 viewer 查過時回 null。空 Set 表示查過、但沒有成功的欄位。 */
export function peekViewerTeamScan(uid: string): ViewerTeamScan | null {
  if (!uid || scanUid !== uid || !scan) return null;
  return scan;
}

export function rememberViewerTeamScan(uid: string, next: ViewerTeamScan): void {
  if (!uid) return;
  scanUid = uid;
  scan = {
    fields: new Set(next.fields),
    docs: next.docs.map((doc) => ({ docId: doc.docId, data: doc.data })),
  };
}

export function clearViewerTeamScan(): void {
  scanUid = null;
  scan = null;
}

/** 測試用：種入 viewer 已查過的欄位，不必真的跑 loadViewer。 */
export function seedViewerTeamScanForTest(uid: string, next: ViewerTeamScan): void {
  rememberViewerTeamScan(uid, next);
}

export function resetViewerTeamScanForTest(): void {
  clearViewerTeamScan();
}
