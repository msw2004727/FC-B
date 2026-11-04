/**
 * 刪除活動：只走 Callable `deleteEvent`（FC functions/event-deletion.js，T-076）。
 * 伺服器只硬刪 events/{docId} 主文件並寫稽核；子集合不動（與 A 的連帶清理刻意不同，資料契約 A05）。
 */
import type { EventDoc } from './types';

/** 傳公開 event.id 優先（R-ID-009）；沒有才退回文件 ID，伺服器另有橋接與 EVENT_ID_MISMATCH 保護。 */
export function deleteEventRequestId(event: EventDoc): string {
  return String(event.id ?? '').trim() || String(event._docId ?? event.docId ?? '').trim();
}

/** 成功（含 alreadyDeleted）resolve；錯誤往外拋（CallableError）。 */
export async function deleteEventViaCallable(event: EventDoc): Promise<{ alreadyDeleted: boolean }> {
  const eventId = deleteEventRequestId(event);
  if (!eventId) throw new Error('EVENT_ID_INVALID');
  const { callFn } = await import('@/data/callables');
  const res = await callFn('deleteEvent', { eventId });
  return { alreadyDeleted: res?.alreadyDeleted === true };
}

export const DELETE_EVENT_MESSAGES = {
  done: '活動已刪除',
  failRetry: '刪除失敗，請稍後再試',
  failRefresh: '刪除失敗，請重新整理後再試',
  denied: '您只能管理自己的活動',
  courseLinked: '課程轉化的活動請回課堂管理，不能在活動端取消、結束、刪除或重新開放',
  legacyId: '此活動資料格式較舊，請聯繫管理員處理',
  auth: '請重新登入後再試',
} as const;

/**
 * 伺服器錯誤訊息碼 → 使用者文案；只看訊息碼，不顯示原始錯誤。
 * 伺服器全部 reason：AUTH_REQUIRED、EVENT_ID_INVALID、EVENT_ID_AMBIGUOUS、EVENT_ID_MISMATCH、
 * EVENT_DELETE_DENIED、COURSE_LINKED_EVENT_MANAGED_BY_COURSE、EVENT_DELETE_RETRY、EVENT_DELETE_FAILED。
 */
export function getDeleteEventErrorMessage(error: unknown): string {
  const e = error && typeof error === 'object'
    ? error as { message?: unknown; details?: unknown }
    : {};
  const message = String(e.message ?? '');
  const detailCode = e.details && typeof e.details === 'object'
    ? String((e.details as { code?: unknown }).code ?? '')
    : '';
  if (message === 'COURSE_LINKED_EVENT_MANAGED_BY_COURSE'
    || detailCode === 'COURSE_LINKED_EVENT_MANAGED_BY_COURSE') return DELETE_EVENT_MESSAGES.courseLinked;
  if (message === 'EVENT_DELETE_DENIED') return DELETE_EVENT_MESSAGES.denied;
  // 舊格式活動（文件 ID 與 id 欄位不一致或 id 重複）重試無效，不叫人重試。
  if (message === 'EVENT_ID_MISMATCH' || message === 'EVENT_ID_AMBIGUOUS') return DELETE_EVENT_MESSAGES.legacyId;
  if (message === 'EVENT_ID_INVALID') return DELETE_EVENT_MESSAGES.failRefresh;
  if (message === 'AUTH_REQUIRED') return DELETE_EVENT_MESSAGES.auth;
  // EVENT_DELETE_RETRY、EVENT_DELETE_FAILED、網路或其他未知錯誤。
  return DELETE_EVENT_MESSAGES.failRetry;
}
