// 查詢超量回報（R-QUERY-001 多抓一筆偵測）：同一則每台裝置每個台北日最多送一次（顧問 §3.719）。
// reportClientError 的去重只管同一次頁面載入；熱門活動會讓每位會員每次開頁都送一筆，吃掉每小時 5 筆的真錯誤額度。
// localStorage 讀寫失敗時退回只靠 reportClientError 的頁內去重。

import { reportClientError } from './error-report';
import { taipeiDateKey } from './taipei-time';

export const LIMIT_REPORT_KEY = 'fcb:limit-report';

function readSeen(day: string): string[] {
  const raw = localStorage.getItem(LIMIT_REPORT_KEY);
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return []; // 壞資料當作沒送過，下面整筆覆寫
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const { day: savedDay, ids } = parsed as { day?: unknown; ids?: unknown };
  if (savedDay !== day || !Array.isArray(ids)) return [];
  return ids.filter((x): x is string => typeof x === 'string');
}

export function reportLimitOncePerDay(context: string, message: string, now: number = Date.now()): void {
  const day = taipeiDateKey(now);
  const id = `${context}|${message}`;
  try {
    const seen = readSeen(day);
    if (seen.includes(id)) return;
    localStorage.setItem(LIMIT_REPORT_KEY, JSON.stringify({ day, ids: [...seen, id] }));
  } catch {
    // 讀寫失敗（隱私模式、配額、壞資料）：照送，交給 reportClientError 的頁內去重與每小時上限
  }
  reportClientError(context, new Error(message));
}
