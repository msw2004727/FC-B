/**
 * 帶筆數上限的 Firestore 查詢登記表（批次 C-1）。
 *
 * - 範圍：`src/` 底下正式碼裡所有 `limit(`／`fs.limit(`／`sdk.limit(`（含 `limitToLast(`）呼叫；
 *   不含測試檔、`src/dev/`、`__fixtures__`、註解與字串裡的文字。
 * - `query-limit-registry.test.ts` 掃實際原始碼，逐檔比對呼叫數；新增或刪除查詢沒同步登記就紅燈。
 * - 不記行號（會漂移），只記「檔案＋呼叫數」。每一筆的 `sites` 是這一筆涵蓋的呼叫數
 *   （同一條查詢寫成三元運算兩支時記 2），一個檔所有筆的 `sites` 加總必須等於該檔呼叫數。
 * - 只給測試讀；正式碼不得 import 本檔（不進打包）。
 *
 * 狀態：
 * - `ok`：有明確排序且截掉的是最不重要的一端、多抓一筆偵測、單筆查找、游標分頁，或建立端有不大於讀取上限的硬上限。
 * - `known-gap-batch-D`／`known-gap-batch-E`：已知會漏或會隨歷史變大，排在計畫書批次 D／E。
 * - `known-gap-other`：已知問題但不在批次 D／E，`reason` 必填。
  *
 * 範圍與已知盲點（審查 P3-2、P3-3）：只認 `limit(`、`fs.limit(`、`sdk.limit(` 呼叫；不含 REST structuredQuery 的
 * `limit` 欄位（例如 src/features/home/data/banners-rest.ts 與 index.html 的首頁橫幅預讀，和 banners.ts 同一條查詢）。
 * 可選呼叫 `fs.limit?.(n)` 照樣算。掃描器數不到的解構改名（`const { limit: l } = fs`）與中括號呼叫（`fs['limit'](n)`）
 * 由測試另行擋下。仍不認得：函式參數解構改名、同一行 JSX 文字裡的 `//` 或落單引號、`if (x) /re/` 這類正規式；
 * 零參數的方法簽章 `limit(): T` 會被誤算成呼叫（只會假紅，不會漏算）。寫查詢時避免這些寫法。
 */

export type QueryLimitStatus = 'ok' | 'known-gap-batch-D' | 'known-gap-batch-E' | 'known-gap-other';

/** 依 `date` 字串排序或篩選的查詢必須帶這段註記（11-24 唯讀量測：871 場都是補零格式）。 */
export const PADDED_DATE_NOTE = '依賴 date 補零格式 YYYY/MM/DD';

export interface QueryLimitEntry {
  /** 這一筆涵蓋的呼叫數，預設 1。 */
  sites?: number;
  /** 查什麼、給誰用。 */
  purpose: string;
  /** 明確的排序欄位，或「無排序」。 */
  orderBy: string;
  /** 超過上限時怎麼處理（多抓一筆偵測、有排序截最不重要端、單筆查找 limit(1)、游標分頁、建立端硬上限、已知未處理）。 */
  overflow: string;
  status: QueryLimitStatus;
  /** `known-gap-other` 必填：為什麼不在批次 D／E。 */
  reason?: string;
  /** 依字串日期排序或篩選時的格式依賴（`date` 用 PADDED_DATE_NOTE）。 */
  dateFormat?: string;
}

export interface QueryLimitFile {
  /** 這個檔裡實際的 limit 呼叫數。 */
  calls: number;
  entries: readonly QueryLimitEntry[];
}

const SINGLE_LOOKUP = '單筆查找 limit(1)';

export const QUERY_LIMIT_REGISTRY: Readonly<Record<string, QueryLimitFile>> = {
  'src/data/notify.ts': {
    calls: 1,
    entries: [
      { purpose: '通知範本依 key 找一份（notifTemplates）', orderBy: '無排序', overflow: SINGLE_LOOKUP, status: 'ok' },
    ],
  },
  'src/data/paths.ts': {
    calls: 1,
    entries: [
      { purpose: '直讀找不到活動文件時，依公開代號 id 找活動', orderBy: '無排序', overflow: SINGLE_LOOKUP, status: 'ok' },
    ],
  },
  'src/data/user-doc-sync.ts': {
    calls: 1,
    entries: [
      { purpose: '登入同步時依 lineUserId 找舊格式 users 文件', orderBy: '無排序', overflow: SINGLE_LOOKUP, status: 'ok' },
    ],
  },
  'src/data/user-identity-key.ts': {
    calls: 1,
    entries: [
      {
        purpose: '確認一批 users 正本是否存在（documentId in，每批 30 個）',
        orderBy: '無排序',
        overflow: '上限等於本批查詢鍵數（limit(chunk.length)），結果不可能超過，不會截斷',
        status: 'ok',
      },
    ],
  },
  'src/features/admin-banners/data/banner-admin.ts': {
    calls: 1,
    entries: [
      {
        purpose: '後台橫幅管理讀全部橫幅位（banners 集合，照 A _buildCollectionQuery）',
        orderBy: '無排序',
        overflow: '集合是固定的橫幅位，新站只 update 不新增文件（本檔不 setDoc／addDoc），筆數遠低於 200',
        status: 'ok',
      },
    ],
  },
  'src/features/admin-inactive/data/inactive-data.ts': {
    calls: 2,
    entries: [
      {
        sites: 2,
        purpose: '不活躍名單（活動依 createdAt、用戶依 lastLogin）分頁',
        orderBy: '呼叫端傳入：createdAt desc 或 lastLogin asc',
        overflow: '游標分頁（startAfter），可讀完',
        status: 'ok',
      },
    ],
  },
  'src/features/admin-users/data/admin-users.ts': {
    calls: 2,
    entries: [
      {
        sites: 2,
        purpose: '後台用戶管理分批讀 users（每批 ADMIN_USERS_CHUNK_SIZE）',
        orderBy: 'documentId()',
        overflow: '游標分頁（startAfter），可讀完',
        status: 'ok',
      },
    ],
  },
  'src/features/clubs/data/teams-repo.ts': {
    calls: 1,
    entries: [
      { purpose: '直讀找不到俱樂部文件時，依公開代號 id 找俱樂部', orderBy: '無排序', overflow: SINGLE_LOOKUP, status: 'ok' },
    ],
  },
  'src/features/competitions/data/audience-watch.ts': {
    calls: 2,
    entries: [
      {
        sites: 2,
        purpose: '觀眾端讀單場時間軸與作廢紀錄（timeline、voids）',
        orderBy: 'seq asc',
        overflow: '游標分頁（pageLoop＋startAfter），可讀完',
        status: 'ok',
      },
    ],
  },
  'src/features/competitions/data/cp-repo.ts': {
    calls: 15,
    entries: [
      {
        purpose: '我的賽事索引（cpMine/{uid}/items，CP_READ_LIMIT.mine 50）',
        orderBy: '無排序',
        overflow: '已知未處理：個人主辦有進行中上限（HOST_QUOTA.personalActiveMax），但歷史賽事與參賽索引只增不減，超過 50 依文件代號截斷',
        status: 'known-gap-batch-D',
      },
      {
        purpose: '公開賽事清單（CP_READ_LIMIT.publicList 30）',
        orderBy: '無排序',
        overflow: '已知未處理：超過 30 場依文件代號截斷（計畫書 D-3 改依開始日排序）',
        status: 'known-gap-batch-D',
      },
      {
        purpose: '俱樂部主辦的賽事（CP_READ_LIMIT.hostTeam 50）',
        orderBy: '無排序',
        overflow: '已知未處理：俱樂部有進行中上限（HOST_QUOTA.clubActiveMax 10），歷史賽事不設限，超過 50 依文件代號截斷',
        status: 'known-gap-batch-D',
      },
      {
        purpose: '單一賽事的組別（CP_READ_LIMIT.divisions 8）',
        orderBy: '無排序（讀回後依 order 排）',
        overflow: '建賽端限制最多 8 組，見 FC functions-cp/src/cp/validate.ts:divisionsOf（LIMITS.divisionsMax 8），不大於讀取上限',
        status: 'ok',
      },
      {
        purpose: '單一賽事的報隊（CP_READ_LIMIT.entries 100）',
        orderBy: '無排序',
        overflow:
          '已知未處理：建賽端每組報隊（含待審）上限是 maxTeams×2（FC functions-cp/src/cp/entry.ts:PENDING_FACTOR；maxTeams ≤ 64，validate.ts:LIMITS.teamsMax），最多 8 組，總數可超過 100；Rules list 上限 100',
        status: 'known-gap-batch-D',
      },
      {
        purpose: '單一報隊的公開球員名單（CP_READ_LIMIT.roster 60）',
        orderBy: '無排序',
        overflow: '建賽端每隊名單上限 rosterMax ≤ 40，見 FC functions-cp/src/cp/validate.ts:divisionOf（LIMITS.rosterMaxCap 40）與 entry.ts 的 ROSTER_FULL 檢查，不大於讀取上限',
        status: 'ok',
      },
      {
        purpose: '主辦讀報隊私密資料（entryPrivate，CP_READ_LIMIT.private 100；管理頁不帶 teamId）',
        orderBy: '無排序',
        overflow: '已知未處理：一隊一份，數量與報隊相同，可超過 100',
        status: 'known-gap-batch-D', // 顧問 §3.679：併入 D-3 賽事讀取
      },
      {
        purpose: '球員私密資料（rosterPrivate，CP_READ_LIMIT.private 100；帶 uid 時只查本人）',
        orderBy: '無排序',
        overflow: '帶 uid 時筆數很小；不帶 uid 時整賽事名單可超過 100，已知未處理',
        status: 'known-gap-other',
        reason: '盤點文件未列；目前 src 正式碼沒有呼叫端，顧問 §3.679 裁定維持登記、不處理',
      },
      {
        purpose: '單一賽事的人員清單（staff，STAFF_LIST_LIMIT 100）',
        orderBy: '無排序（讀回後依 uid 排）',
        overflow: '建立端：建賽時主辦 1 份，其餘來自邀請，每賽事最多 30 張且只增不減（FC functions-cp/src/cp/staff-host.ts:INVITE_MAX），合計不大於讀取上限；共同主辦另一路未逐一查證',
        status: 'ok',
      },
      {
        purpose: '單一賽事的賽程（matches，CP_READ_LIMIT.matches 100）',
        orderBy: '無排序（讀回後 compareMatch 排）',
        overflow:
          '已知未處理：建賽端沒有全賽事場次上限（每組 ≤ 240 場，FC functions-cp/src/cp/rules-host.ts:GROUP_MATCH_MAX；每日 ≤ 200 場，schedule-flex.ts:DAY_MATCH_MAX；每組最多 64 隊），超過 100 場賽程會缺場；Rules list 上限 100',
        status: 'known-gap-batch-D',
      },
      {
        purpose: '賽事摘要片（summary，一個比賽日一片，CP_READ_LIMIT.summary 14）',
        orderBy: '無排序（讀回後 compareSummary 排）',
        overflow: '已知未處理：建賽端比賽期間最長 180 天（validate.ts:LIMITS.matchSpanMaxDays），沒有限制比賽日數，超過 14 個比賽日會缺日',
        status: 'known-gap-batch-D', // 顧問 §3.679：併入 D-3 賽事讀取
      },
      {
        purpose: '積分榜（standings，一組別一分組一份，CP_READ_LIMIT.standings 8）',
        orderBy: '無排序（讀回後依 id 排）',
        overflow: '已知未處理：文件是每個組別×階段×分組一份（match-trigger.ts:standingRef），分組數最多 16（engine/validate-config.ts groupCount ≤ 26 且為 2 的冪），加上最多 8 個組別，可超過 8',
        status: 'known-gap-batch-D', // 顧問 §3.679：併入 D-3 賽事讀取
      },
      {
        purpose: '隊徽用的已核准報隊（entries status == approved，CP_READ_LIMIT.crest 32）',
        orderBy: '無排序',
        overflow: '已知未處理：已核准隊數上限是每組 maxTeams（≤ 64）× 最多 8 組，可超過 32，超過的隊伍沒有隊徽',
        status: 'known-gap-batch-D', // 顧問 §3.679：併入 D-3 賽事讀取
      },
      {
        purpose: '尚未使用的邀請（invites status == open，CP_INVITE_LIST_LIMIT 30）',
        orderBy: '無排序（讀回後依 createdAt 排）',
        overflow: '建立端每賽事最多發 30 張且撤銷不退額度，見 FC functions-cp/src/cp/staff-host.ts:INVITE_MAX，不大於讀取上限',
        status: 'ok',
      },
      {
        purpose: '檢舉紀錄（reports，CP_REPORT_LIST_LIMIT 50，管理員）',
        orderBy: 'lastAt desc',
        overflow: '有排序，截掉最舊的檢舉',
        status: 'ok',
      },
    ],
  },
  'src/features/competitions/live/data/live-repo.ts': {
    calls: 3,
    entries: [
      {
        sites: 2,
        purpose: '記分端讀單場時間軸（每頁 100，最多 2 頁）',
        orderBy: 'seq asc',
        overflow: '游標分頁；伺服器每場時間軸上限 200（FC functions-cp/src/cp/match-host.ts:TIMELINE_MAX），兩頁讀得完',
        status: 'ok',
      },
      {
        purpose: '記分端讀單一報隊的公開名單（ROSTER_LIMIT 60）',
        orderBy: '無排序',
        overflow: '建賽端每隊名單上限 rosterMax ≤ 40（FC functions-cp/src/cp/validate.ts:LIMITS.rosterMaxCap），不大於讀取上限',
        status: 'ok',
      },
    ],
  },
  'src/features/events/data/comment-badge.ts': {
    calls: 3,
    entries: [
      {
        purpose: '留言紅點備援數法：管理者讀全部留言（COMMENT_LIMIT 80）',
        orderBy: '無排序',
        overflow: '多抓一筆偵測超量：超過時只取上限筆數並送錯誤回報（內容固定，不帶 uid、活動代號、留言；顧問 §3.682 D-1／D-2 採甲）',
        status: 'ok',
      },
      {
        purpose: '留言紅點備援數法：公開留言（60）',
        orderBy: '無排序',
        overflow: '多抓一筆偵測超量：超過時只取上限筆數並送錯誤回報（內容固定，不帶 uid、活動代號、留言；顧問 §3.682 D-1／D-2 採甲）',
        status: 'ok',
      },
      {
        purpose: '留言紅點備援數法：本人留言（30）',
        orderBy: '無排序',
        overflow: '多抓一筆偵測超量：超過時只取上限筆數並送錯誤回報（內容固定，不帶 uid、活動代號、留言；顧問 §3.682 D-1／D-2 採甲）',
        status: 'ok',
      },
    ],
  },
  'src/features/events/data/event-comments.ts': {
    calls: 6,
    entries: [
      {
        purpose: '舊留言沒有按讚摘要時讀按讚者（likes，32）',
        orderBy: 'createdAt desc',
        overflow: '有排序，截掉最舊的按讚',
        status: 'ok',
      },
      {
        purpose: '同上，排序查詢失敗時的備援（likes，32）',
        orderBy: '無排序',
        overflow: '已知未處理：超過 32 個讚時顯示哪些按讚者由文件代號決定',
        status: 'known-gap-other',
        reason: '只影響按讚者頭像；顧問 §3.679 裁定維持登記、不處理',
      },
      {
        purpose: '活動留言：管理者讀全部（80）',
        orderBy: '無排序（讀回後依建立時間排）',
        overflow: '多抓一筆偵測超量：超過時只取上限筆數並送錯誤回報（內容固定，不帶 uid、活動代號、留言；顧問 §3.682 D-1／D-2 採甲）',
        status: 'ok',
      },
      {
        purpose: '活動留言：公開留言（60）',
        orderBy: '無排序（讀回後依建立時間排）',
        overflow: '多抓一筆偵測超量：超過時只取上限筆數並送錯誤回報（內容固定，不帶 uid、活動代號、留言；顧問 §3.682 D-1／D-2 採甲）',
        status: 'ok',
      },
      {
        purpose: '活動留言：本人留言（30）',
        orderBy: '無排序（讀回後依建立時間排）',
        overflow: '多抓一筆偵測超量：超過時只取上限筆數並送錯誤回報（內容固定，不帶 uid、活動代號、留言；顧問 §3.682 D-1／D-2 採甲）',
        status: 'ok',
      },
      {
        purpose: '每則留言的回覆（replies，20）',
        orderBy: '無排序（讀回後依建立時間排）',
        overflow: '多抓一筆偵測超量：超過時只取上限筆數並送錯誤回報（內容固定，不帶 uid、活動代號、留言；顧問 §3.682 D-1／D-2 採甲）',
        status: 'ok',
      },
    ],
  },
  'src/features/events/data/event-templates.ts': {
    calls: 1,
    entries: [
      {
        purpose: '本人活動範本（eventTemplates ownerUid ==，100）',
        orderBy: '無排序（讀回後依 updatedAt 排）',
        overflow:
          '建立端限制每人 30 組（B：src/features/events/components/event-form/use-event-templates.tsx 儲存前以 MAX_EVENT_TEMPLATES 檢查；A：js/modules/event/event-create-external.js 的 _MAX_TEMPLATES），不大於讀取上限；Rules（FC firestore.rules eventTemplates create）與 Functions 沒有數量上限，只有繞過前端才會超過，影響限於本人清單',
        status: 'ok',
      },
    ],
  },
  'src/features/events/data/events-repo.ts': {
    calls: 4,
    entries: [
      {
        purpose: '歷史活動（已結束／取消）第一頁',
        orderBy: 'date desc',
        overflow: '有排序，截掉最舊的活動；之後以「載入更多」游標分頁',
        status: 'ok',
        dateFormat: PADDED_DATE_NOTE,
      },
      {
        purpose: '歷史活動第一頁的備援（排序查詢失敗時）',
        orderBy: '無排序',
        overflow: '游標分頁：依文件代號順序，可用「載入更多」讀完',
        status: 'ok',
      },
      {
        purpose: '進行中活動清單（ACTIVE_EVENTS_LIMIT 200）',
        orderBy: '無排序',
        overflow: '多抓一筆偵測（ACTIVE_EVENTS_LIMIT + 1），超過時送錯誤回報 events-active-limit（批次 B）',
        status: 'ok',
      },
      {
        purpose: '歷史活動「載入更多」',
        orderBy: 'date desc（第一頁走備援時無排序）',
        overflow: '游標分頁（startAfter），可讀完',
        status: 'ok',
        dateFormat: PADDED_DATE_NOTE,
      },
    ],
  },
  'src/features/events/data/external-event-edit.ts': {
    calls: 1,
    entries: [
      { purpose: '編輯外部活動時依公開代號 id 找活動', orderBy: '無排序', overflow: SINGLE_LOOKUP, status: 'ok' },
    ],
  },
  'src/features/home/data/banners.ts': {
    calls: 1,
    entries: [
      {
        purpose: '首頁輪播讀上架中的橫幅（status == active，200）',
        orderBy: '無排序（讀回後 filterAndSortBanners）',
        overflow: '集合是固定的橫幅位，新站只 update 不新增文件，筆數遠低於 200',
        status: 'ok',
      },
    ],
  },
  'src/features/home/data/next-activity-load.ts': {
    calls: 3,
    entries: [
      {
        purpose: '首頁下一場：本人建立／擁有的未結束活動（同一支 helper 發兩條，EVENT_QUERY_LIMIT 80）',
        orderBy: '無排序',
        overflow: '打到上限即送錯誤回報 next-activity-managed-limit（批次 A、B）',
        status: 'ok',
      },
      {
        purpose: '首頁下一場：本人被委託的未結束活動（EVENT_QUERY_LIMIT 80）',
        orderBy: '無排序',
        overflow: '打到上限即送錯誤回報 next-activity-managed-limit（批次 A、B）',
        status: 'ok',
      },
      {
        purpose: '首頁下一場：本人進行中報名（REGISTRATION_QUERY_LIMIT 1,000）',
        orderBy: '無排序',
        overflow: '打到上限即送錯誤回報 next-activity-registration-limit；上限 1,000（批次 S、A、B）',
        status: 'ok',
      },
    ],
  },
  'src/features/inbox/admin/data/admin-message-send.ts': {
    calls: 3,
    entries: [
      {
        sites: 2,
        purpose: '後台推播對象：俱樂部成員（teamIds、teamId 兩條，LINE_PUSH_TEAM_LIMIT 200）',
        orderBy: '無排序',
        overflow: '多抓一筆偵測（LIMIT + 1），超過就回 overLimit 不推',
        status: 'ok',
      },
      {
        purpose: '後台推播對象：依角色（LINE_PUSH_ROLE_LIMIT 500）',
        orderBy: '無排序',
        overflow: '多抓一筆偵測（LIMIT + 1），超過就回 overLimit 不推',
        status: 'ok',
      },
    ],
  },
  'src/features/inbox/admin/data/admin-messages-repo.ts': {
    calls: 3,
    entries: [
      {
        sites: 2,
        purpose: '後台訊息清單分頁（ADMIN_MESSAGES_PAGE_SIZE 50）',
        orderBy: 'createdAt desc',
        overflow: '游標分頁（startAfter），可讀完',
        status: 'ok',
      },
      {
        purpose: '排程訊息掃描（status == scheduled，SCHEDULED_SCAN_LIMIT 20）',
        orderBy: '無排序',
        overflow: '多抓一筆偵測超量：超過時只處理前 20 筆並送錯誤回報；無排序，其餘可能延後甚至一直沒被處理，靠錯誤回報發現（顧問 §3.682 採甲的已知取捨）',
        status: 'known-gap-other',
        reason: '超過 20 筆時其餘排程訊息可能一直沒被處理；顧問 §3.682 採甲（偵測＋回報，不分頁），不在批次 D／E（顧問 §3.719 依 Opus P3-4 改標）',
      },
    ],
  },
  'src/features/inbox/admin/data/notif-templates-admin.ts': {
    calls: 1,
    entries: [
      {
        purpose: '後台通知範本編輯讀全部範本（NOTIF_TEMPLATES_READ_LIMIT 20）',
        orderBy: '無排序（讀回後依 TEMPLATE_PLACEHOLDER_HINTS 排）',
        overflow: '範本是固定的 key 集合（TEMPLATE_PLACEHOLDER_HINTS 10 個），不大於讀取上限',
        status: 'ok',
      },
    ],
  },
  'src/features/inbox/data/inbox-repo.ts': {
    calls: 1,
    entries: [
      {
        purpose: '收件匣監聽（INBOX_LISTEN_LIMIT 200）',
        orderBy: 'createdAt desc',
        overflow: '有排序，截掉最舊的訊息',
        status: 'ok',
      },
    ],
  },
  'src/features/inbox/data/pm-repo.ts': {
    calls: 2,
    entries: [
      {
        purpose: '私訊對話清單監聽（PM_THREAD_LIMIT 50）',
        orderBy: 'lastMessageAt desc',
        overflow: '有排序，截掉最久沒動的對話',
        status: 'ok',
      },
      {
        purpose: '單一對話訊息監聽（PM_MESSAGE_LIMIT 50）',
        orderBy: 'createdAt desc',
        overflow: '有排序，截掉最舊的訊息',
        status: 'ok',
      },
    ],
  },
  'src/features/logs/data/audit-logs.ts': {
    calls: 2,
    entries: [
      {
        sites: 2,
        purpose: '稽核紀錄（每日 auditEntries）',
        orderBy: 'createdAt desc',
        overflow: '多抓一筆偵測＋游標分頁（limit + 1、startAfter）',
        status: 'ok',
      },
    ],
  },
  'src/features/logs/data/error-logs.ts': {
    calls: 1,
    entries: [
      {
        purpose: '錯誤紀錄區間查詢（ERROR_LOGS_RANGE_CAP 500）',
        orderBy: 'createdAt desc',
        overflow: '多抓一筆偵測，回傳 truncated',
        status: 'ok',
      },
    ],
  },
  'src/features/logs/data/operation-logs.ts': {
    calls: 1,
    entries: [
      {
        purpose: '操作紀錄區間查詢（OPERATION_LOGS_RANGE_CAP 500）',
        orderBy: 'createdAt desc',
        overflow: '多抓一筆偵測，回傳 truncated',
        status: 'ok',
      },
    ],
  },
  'src/features/ops-dashboard/data/participants-data.ts': {
    calls: 1,
    entries: [
      {
        purpose: '營運儀表板：每日參與人數（opsParticipantDays 依日期文件代號區間）',
        orderBy: 'documentId()',
        overflow: '區間最多 MAX_RANGE_DAYS 天，一天一份，上限 MAX_RANGE_DAYS + 1 不會截斷',
        status: 'ok',
      },
    ],
  },
  'src/features/profile/components/legacy/LegacyApplicationsCard.tsx': {
    calls: 1,
    entries: [
      {
        purpose: '個人頁申請紀錄（users/{uid}/inbox，200）',
        orderBy: 'createdAt desc',
        overflow: '有排序，截掉最舊的訊息',
        status: 'ok',
      },
    ],
  },
  'src/features/profile/data/profile-model.ts': {
    calls: 1,
    entries: [
      { purpose: '直讀找不到個人資料時，依 uid／lineUserId 找舊格式 users 文件', orderBy: '無排序', overflow: SINGLE_LOOKUP, status: 'ok' },
    ],
  },
  'src/features/tournaments/data/cards-repo.ts': {
    calls: 1,
    entries: [
      {
        purpose: '外部賽事卡片（TOURNAMENT_CARDS_LIMIT 100）',
        orderBy: 'startDate desc',
        overflow: '有排序，截掉最舊的賽事',
        status: 'ok',
        dateFormat: '依賴 startDate 補零格式 YYYY-MM-DD（card-model.ts:isValidDateKey 驗證）',
      },
    ],
  },
};

/**
 * 沒有筆數上限、讀取量會隨個人或全站歷史一直變大的查詢（盤點文件第二節）。
 * 不屬於 limit 登記，但一併列管；測試只確認檔案還在、欄位不空白。
 */
export interface UnboundedQueryEntry {
  file: string;
  purpose: string;
  status: QueryLimitStatus;
  reason?: string;
  dateFormat?: string;
}

export const UNBOUNDED_QUERY_WATCH: readonly UnboundedQueryEntry[] = [
  {
    file: 'src/features/events/data/range-stats.ts',
    purpose: '主辦人活動統計：非全站管理者把本人主辦／擁有／隊長／委託的活動全部讀回再篩日期（全站管理者那條已用 date 範圍篩）',
    status: 'known-gap-batch-E',
    dateFormat: PADDED_DATE_NOTE,
  },
  {
    file: 'src/features/profile/data/related-activities.ts',
    purpose: '個人頁相關活動：本人所有報名紀錄全部讀回',
    status: 'known-gap-other',
    reason: '計畫書批次 F，資料同時用來算統計，先設計統計來源才能動，現階段不派工',
  },
  {
    file: 'src/features/profile/data/activity-records.ts',
    purpose: '個人頁活動紀錄：本人所有出席與活動紀錄全部讀回',
    status: 'known-gap-other',
    reason: '計畫書批次 F，牽涉出席與放鴿子統計，現階段不派工',
  },
  {
    file: 'src/features/clubs/data/teams-repo.ts',
    purpose: '俱樂部清單整個集合讀回',
    status: 'known-gap-other',
    reason: '盤點文件第七節：俱樂部數量小，數量上百再處理',
  },
];
