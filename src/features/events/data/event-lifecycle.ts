/**
 * 活動的生命週期寫入（取消／重新開放／重新上架）。
 *
 * 對應 A `js/modules/event/event-manage-lifecycle.js`：
 *   - `cancelMyActivity`（第 214～253 行）
 *   - `reopenMyActivity`（第 256～280 行）
 *   - `relistMyActivity`（第 283～316 行）
 *   - `_isCourseLinkedEventLifecycleLocked`（第 9～17 行）
 *   - `js/modules/event/event-list-stats.js` 的 `_parseEventStartDate`（第 258～272 行）
 *
 * 刻意偏離 A：
 *   - 不做 A `_cleanupCancelledRecords`（Rules 只允許 admin 刪除；一般主辦方刪不掉）。
 *   - 不做 A 內部的 confirm 對話框（UI 層負責）。
 *   - 通知改由 `loadEventNotifyRecipientUids`＋`sendTemplateNotification` 逐人送。
 *
 * 順序：課程連結 → 權限 →（重開／上架）時間已過 → 內測守衛 → 寫入 → 通知與操作日誌（取消：通知→日誌；上架：日誌→通知，照 A）。
 */

import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { parseEventStartMs } from '@/core/event-time';
import { getFirebase } from '@/data/firebase';
import { sendTemplateNotification } from '@/data/notify';
import { writeOpLog } from '@/data/op-log';
import type { ViewerView } from '@/features/profile/data/viewer';

import { loadEventNotifyRecipientUids } from './event-change-notify';
import { operateContextFromViewer } from './event-create-context';
import { roleLabelOf } from './event-form-model';
import { loadEventRegistrations } from './event-detail';
import { canCancelOwnActivity, canReopenOrRelistActivity } from './operate-permissions';
import { isEventTrulyFull } from './participant-stats';
import type { EventDoc, RegistrationDoc } from './types';

// ── 錯誤類型 ─────────────────────────────────────────

export type EventLifecycleErrorCode =
  | 'COURSE_LINKED'
  | 'NOT_ALLOWED'
  | 'START_PASSED'
  | 'WRITE_FAILED';

export class EventLifecycleError extends Error {
  readonly code: EventLifecycleErrorCode;
  constructor(code: EventLifecycleErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'EventLifecycleError';
    this.code = code;
  }
}

// ── 輸入型別 ─────────────────────────────────────────

export interface LifecycleInput {
  event: EventDoc;
  eventDocId: string;
  viewer: ViewerView;
  now?: Date;
}

// ── 課程連結守衛（A `_isCourseLinkedEventLifecycleLocked`） ──

type EventLifecycleFields = EventDoc & {
  courseLinked?: unknown;
  courseLinkId?: unknown;
  courseLinkSource?: unknown;
  source?: unknown;
};

/**
 * A `_isCourseLinkedEventLifecycleLocked`：任一條件成立即 true。
 * 注意：A 尚有一個 `this._isCourseLinkedEvent?.(eventRecord)` fallback，未在附件中提供，
 * 依「不發明」原則不移植（上面的三條件已涵蓋附件所述規則）。
 */
export function isCourseLinkedLifecycleLocked(event: EventDoc | null | undefined): boolean {
  if (!event) return false;
  const e = event as EventLifecycleFields;
  const source = String(e.courseLinkSource || e.source || '').trim();
  return (
    e.courseLinked === true
    || String(e.courseLinkId || '').trim() !== ''
    || source === 'eduCourseLesson'
  );
}

/** A 重開／上架前的判斷 `startDate && startDate <= new Date()`；UI 先用它決定是否顯示提示。 */
export function isEventStartPassed(event: EventDoc, now: Date = new Date()): boolean {
  // 保留消費端只收斜線日期的限制；日期運算委派共用 helper。
  if (typeof event.date !== 'string' || (event.date.split(' ')[0] ?? '').split('/').length < 3) return false;
  const startMs = parseEventStartMs(event.date);
  return startMs !== null && startMs <= now.getTime();
}

// ── operator（A `api-service.js#_writeOpLog`：`curUser?.displayName || ROLES[role]?.label || '系統'`） ──

export function resolveOperator(viewer: ViewerView): string {
  return viewer.displayName || roleLabelOf(viewer.role, viewer.permissionSources?.customRoles ?? []) || '系統';
}

// ── 通知收件人（A `_collectEventNotifyRecipientUids` 改由 B 讀取） ──

async function safelyLoadRecipients(eventDocId: string): Promise<string[]> {
  try {
    return await loadEventNotifyRecipientUids(eventDocId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[event-lifecycle] load recipients failed', err);
    return [];
  }
}

/** 一批同時送幾人。 */
export const NOTIFY_CONCURRENCY = 5;
/**
 * 收件人超過這個數就退回逐人送。理由：Functions `notification-guard-limits.js` 對一般層呼叫者
 * （教練以下，自訂角色也算）有每分鐘上限——LINE 入列 150 次、站內信 300 次，且入列的分鐘計數連
 * 被略過（未綁 LINE）的收件人也算。逐人送每人 4 次往返，一分鐘到不了上限；並行後大活動可能超過，
 * 讓後段收件人的 LINE 被擋。100 人以內這次操作的總呼叫數不超過 100，並行也碰不到 150／300。
 * （11-12 取代原本一律逐人送：10 人約要 7～25 秒才刷新，站長回報按了像沒反應。）
 */
export const NOTIFY_PARALLEL_MAX_RECIPIENTS = 100;

async function notifyRecipients(
  senderUid: string | null,
  recipientUids: readonly string[],
  templateKey: 'event_cancelled' | 'event_relisted',
  event: EventDoc,
): Promise<void> {
  const vars = {
    eventName: event.title ?? '',
    date: event.date ?? '',
    location: event.location ?? '',
  };
  const sendOne = async (uid: string): Promise<void> => {
    try {
      await sendTemplateNotification({
        key: templateKey,
        vars,
        targetUid: uid,
        category: 'activity',
        categoryName: '活動',
        senderUid,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[event-lifecycle] notify failed', { templateKey, uid, err });
    }
  };
  // 單人失敗只 warn、不影響同批其他人；一批全部結束才送下一批，全部送完才回到呼叫端寫操作日誌（照 A 順序）。
  const batchSize = recipientUids.length <= NOTIFY_PARALLEL_MAX_RECIPIENTS ? NOTIFY_CONCURRENCY : 1;
  for (let start = 0; start < recipientUids.length; start += batchSize) {
    await Promise.allSettled(recipientUids.slice(start, start + batchSize).map(sendOne));
  }
}

// ── 寫入輔助 ─────────────────────────────────────────

async function writeEventStatus(
  eventDocId: string,
  status: 'cancelled' | 'open' | 'full',
): Promise<void> {
  const { db } = await getFirebase();
  await updateDoc(doc(db, 'events', eventDocId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

// ── 取消活動（A `cancelMyActivity`） ──────────────────

export async function cancelEvent(input: LifecycleInput): Promise<void> {
  const { event, eventDocId, viewer } = input;
  const now = input.now ?? new Date();

  if (isCourseLinkedLifecycleLocked(event)) {
    throw new EventLifecycleError(
      'COURSE_LINKED',
      '課程轉化的活動請回課堂管理，不能在活動端取消、結束、刪除或重新開放',
    );
  }

  const ctx = operateContextFromViewer(viewer);
  if (!canCancelOwnActivity(ctx, event)) {
    throw new EventLifecycleError('NOT_ALLOWED', '您只能管理自己的活動');
  }


  try {
    await writeEventStatus(eventDocId, 'cancelled');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[cancelEvent] Firestore write failed', err);
    throw new EventLifecycleError('WRITE_FAILED', '取消失敗，請重試');
  }

  const recipients = await safelyLoadRecipients(eventDocId);
  await notifyRecipients(viewer.uid, recipients, 'event_cancelled', event);

  await writeOpLog({
    type: 'event_cancel',
    typeName: '取消活動',
    content: `取消「${event.title ?? ''}」`,
    eventId: event.id,
    actorUid: viewer.uid,
    operator: resolveOperator(viewer),
    now,
  });
}

// ── 重新開放（A `reopenMyActivity`） ──────────────────

export async function reopenEvent(input: LifecycleInput): Promise<void> {
  const { event, eventDocId, viewer } = input;
  const now = input.now ?? new Date();

  if (isCourseLinkedLifecycleLocked(event)) {
    throw new EventLifecycleError(
      'COURSE_LINKED',
      '課程轉化的活動請回課堂管理，不能在活動端取消、結束、刪除或重新開放',
    );
  }

  const ctx = operateContextFromViewer(viewer);
  if (!canReopenOrRelistActivity(ctx, event)) {
    throw new EventLifecycleError('NOT_ALLOWED', '您只能管理自己的活動');
  }

  if (isEventStartPassed(event, now)) {
    throw new EventLifecycleError(
      'START_PASSED',
      '活動時間已過，請先編輯活動並更新時間後再重新開放。',
    );
  }


  let registrations: RegistrationDoc[] = [];
  try {
    registrations = await loadEventRegistrations(eventDocId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[reopenEvent] load registrations failed; fallback to event fields', err);
  }
  const newStatus = isEventTrulyFull(event, registrations) ? 'full' : 'open';

  try {
    await writeEventStatus(eventDocId, newStatus);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[reopenEvent] Firestore write failed', err);
    throw new EventLifecycleError('WRITE_FAILED', '重新開放失敗，請重試');
  }

  await writeOpLog({
    type: 'event_reopen',
    typeName: '重開活動',
    content: `重開「${event.title ?? ''}」`,
    eventId: event.id,
    actorUid: viewer.uid,
    operator: resolveOperator(viewer),
    now,
  });
}

// ── 重新上架（A `relistMyActivity`） ──────────────────

export async function relistEvent(input: LifecycleInput): Promise<void> {
  const { event, eventDocId, viewer } = input;
  const now = input.now ?? new Date();

  if (isCourseLinkedLifecycleLocked(event)) {
    throw new EventLifecycleError(
      'COURSE_LINKED',
      '課程轉化的活動請回課堂管理，不能在活動端取消、結束、刪除或重新開放',
    );
  }

  const ctx = operateContextFromViewer(viewer);
  if (!canReopenOrRelistActivity(ctx, event)) {
    throw new EventLifecycleError('NOT_ALLOWED', '您只能管理自己的活動');
  }

  if (isEventStartPassed(event, now)) {
    throw new EventLifecycleError(
      'START_PASSED',
      '活動時間已過，請先編輯活動並更新時間後再上架。',
    );
  }


  let registrations: RegistrationDoc[] = [];
  try {
    registrations = await loadEventRegistrations(eventDocId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[relistEvent] load registrations failed; fallback to event fields', err);
  }
  const newStatus = isEventTrulyFull(event, registrations) ? 'full' : 'open';

  try {
    await writeEventStatus(eventDocId, newStatus);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[relistEvent] Firestore write failed', err);
    throw new EventLifecycleError('WRITE_FAILED', '重新上架失敗，請重試');
  }

  // A relistMyActivity：先寫操作日誌，再通知。
  await writeOpLog({
    type: 'event_relist',
    typeName: '重新上架',
    content: `重新上架「${event.title ?? ''}」`,
    eventId: event.id,
    actorUid: viewer.uid,
    operator: resolveOperator(viewer),
    now,
  });

  const recipients = await safelyLoadRecipients(eventDocId);
  await notifyRecipients(viewer.uid, recipients, 'event_relisted', event);
}
