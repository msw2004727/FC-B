// 共用提示文字常數（M-039、U-020）：
// - LOCKED_FEATURE_MSG：A 本身就停用／鎖住的入口（照 A `js/modules/role.js:276,285`）
// - UNAVAILABLE_FEATURE_MSG：B 尚未搬完、請先去舊版的入口
// - 其他全站導覽／登入／狀態提示文字（照 A `js/core/navigation.js`、`js/line-auth.js`）

/** A 本身就停用或鎖定的入口（例如抽屜 🔒 項目、coming-soon、新手友善、高強度、活動連結等） */
export const LOCKED_FEATURE_MSG = '功能尚未開放';

/** B 尚未搬完的功能入口 */
export const UNAVAILABLE_FEATURE_MSG = '此功能尚未開放，請先使用舊版';

/** A `js/core/navigation.js:399` 帳號限制中提示 */
export const RESTRICTED_ACCOUNT_MSG = '帳號限制中';

/** A `js/core/navigation.js` 未登入提示 */
export const LOGIN_REQUIRED_MSG = '請先登入LINE帳號';

/** A `js/core/navigation.js:420` LINE 登入確認中提示 */
export const LOGIN_PENDING_MSG = 'LINE 登入確認中，請稍候...';

/** A `js/core/navigation.js:95,500,504` 換頁失敗提示 */
export const ROUTE_LOAD_FAILED_MSG = '頁面載入失敗，請稍後再試';

/** A `js/core/navigation.js:90-92` 換頁逾時提示 */
export const ROUTE_TIMEOUT_MSG = '網路較慢，頁面暫時無法開啟，請稍後再試';
export const ROUTE_ACTIVITIES_TIMEOUT_MSG = '網路較慢，活動頁暫時無法開啟，請稍後再試';

/** A `js/modules/sync-status.js:58` 離線提示 */
export const OFFLINE_SYNC_MSG = '目前離線，資料將在連線後同步';

/** U-013：離線時攔截寫入／送出提示 */
export const OFFLINE_WRITE_BLOCKED_MSG = '目前離線，請恢復網路連線後再試';
