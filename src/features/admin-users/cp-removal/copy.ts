// 「賽事個資移除」後台工具的文字（設計 §4.8；顧問 §3.816②）。
// 後台工具只做繁中（R-UI-037）。不放進 admin-users/locales：那份 zh-TW 會打包進首頁入口，
// 這裡跟著用戶管理頁（延遲載入）與移除面板（再延遲載入）走，不佔首頁大小。寫法同 competitions/live/copy.ts。

export const CP_REMOVAL_COPY = {
  entry: '賽事個資移除',
  title: '賽事個資移除',
  member: '會員',
  reason: '原因',
  reasonSubject: '本人申請',
  reasonAccount: '帳號刪除',
  dryRun: '產生試算',
  dryRunBusy: '試算中…',
  noComps: '這位會員在賽事系統沒有需要處理的資料',
  later: '之後',
  laterSuffix: '後處理',
  total: '合計',
  irreversible: '不可復原',
  limitations: '限制說明',
  warnings: '注意',
  expires: '確認碼有效到',
  run: '執行',
  runBusy: '處理中…',
  runAsk: '會永久移除這位會員的賽事個資，\n無法復原。確定執行？',
  runOk: '永久移除',
  adminOnly: '執行需由站長本人操作',
  close: '關閉',
  done: '已移除這位會員的賽事個資',
  stale: '資料已變更或試算已過期，請重新產生試算',
  required: '請先產生試算',
  tooLarge: '資料太多，這次無法執行',
  superOnly: '執行需由站長本人操作',
  failed: '操作失敗，請稍後再試',
} as const;

/** 合計那一行。 */
export function totalsText(t: { competitions: number; writesNow: number; writesLater: number }): string {
  return `${t.competitions} 場・現在處理 ${t.writesNow} 筆・之後處理 ${t.writesLater} 場`;
}

/** 部分完成的提示。N＝等待中的不同賽事數。 */
export function laterDoneText(n: number): string {
  return n > 0
    ? `已移除大部分資料，\n其餘 ${n} 場會在賽事結束或指派到期後自動處理`
    : '已移除大部分資料，\n其餘會在賽事結束或指派到期後自動處理';
}

/** 「現在會做什麼」各項的白話名稱；沒列到的鍵不顯示（不露代碼）。 */
export const NOW_LABELS: Readonly<Record<string, string>> = {
  rosterDelete: '名單移除',
  rosterDeidentify: '名單去識別',
  statsNameReplace: '數據名字改「球員」',
  entryRegistrantClear: '報隊人清除',
  entryContactClear: '報隊聯絡資料清除',
  addedByClear: '代填紀錄清除',
  staffNameClear: '記分員顯示名清除',
  staffDelete: '記分員指派刪除',
  controlDelete: '記分權刪除',
  hostDisplayReset: '主辦名稱改「主辦」',
  publicByClear: '公告署名清除',
  auditPseudonymize: '操作紀錄上的代碼換成假名',
  scorerAuditRekey: '記分接手紀錄上的代碼換成假名',
  invitePseudonymize: '邀請紀錄上的發出人代碼換成假名',
  cpMineDelete: '「我的賽事」索引刪除',
};

export const ROLE_LABELS: Readonly<Record<string, string>> = {
  host: '主辦',
  coHost: '共同主辦',
  rep: '隊伍代表',
  player: '球員',
  scorer: '記分員',
  referee: '裁判',
};

export const PHASE_LABELS: Readonly<Record<string, string>> = {
  roster_open: '報名中',
  started: '已開賽',
  ended: '已結束',
};

/** warnings 代碼 → 白話；同類合併計數，不顯示賽事代號。 */
export function warningTexts(codes: readonly string[]): string[] {
  const count = (prefix: string): number => codes.filter((c) => c === prefix || c.startsWith(`${prefix}:`)).length;
  const out: string[] = [];
  if (codes.includes('SUMMARY_TRUNCATED')) out.push('資料太多，試算只列出一部分，這次不能執行');
  if (codes.includes('PENDING_TRUNCATED')) out.push('賽事超過 200 場，只列出前 200 場');
  const index = count('INDEX_MISSING');
  if (index > 0) out.push(`${index} 場查詢失敗（缺索引），請先處理再執行`);
  const failed = count('QUERY_FAILED');
  if (failed > 0) out.push(`${failed} 場查詢失敗，結果可能不完整`);
  const known = new Set(['SUMMARY_TRUNCATED', 'PENDING_TRUNCATED']);
  const other = codes.filter((c) => !known.has(c) && !c.startsWith('INDEX_MISSING') && !c.startsWith('QUERY_FAILED')).length;
  if (other > 0) out.push(`另有 ${other} 項提醒，請找工程確認`);
  return out;
}

/** 2026-12-04T04:00:00+08:00 → 2026/12/04 04:00（伺服器已給台北時間，直接取字）。 */
export function taipeiText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : iso;
}
