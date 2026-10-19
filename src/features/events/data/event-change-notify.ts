/**
 * 活動變更通知（對應 A `js/modules/event/event-create.js` 的
 * `_EVENT_CHANGE_NOTIFY_FIELDS`／`_normalizeEventChangeNotifyValue`／
 * `_getEventChangeNotifySnapshot`／`_hasEventChangeNotificationDiff`／
 * `_hashEventChangeNotifyString`／`_getEventChangeNotificationDedupeKey`，
 * 以及 `js/modules/event/event-manage.js` 的 `_collectEventNotifyRecipientUids`）。
 *
 * 刻意偏離 A：
 * - A 的 `_collectEventNotifyRecipientUids` 會用參與者暱稱反查 UID 作備援；
 *   本檔 **不移植** 此分支（違反 R-ID-002：身分只認 UID），只取 `registrations` 中的 `userId`。
 * - 通知發送委派給 `@/data/notify` 的 `sendTemplateNotification`。
 */

import { collection, getDocs } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { sendTemplateNotification } from '@/data/notify';
import { registrations } from '@/data/paths';

import type { RegistrationDoc } from './types';

// ── 通知欄位集合（照 A `_EVENT_CHANGE_NOTIFY_FIELDS`） ──

export const EVENT_CHANGE_NOTIFY_FIELDS = [
  'title',
  'type',
  'location',
  'date',
  'fee',
  'feeEnabled',
  'max',
  'minAge',
  'notes',
  'sportTag',
  'regOpenTime',
  'teamOnly',
  'genderRestrictionEnabled',
  'allowedGender',
  'privateEvent',
  'creatorTeamId',
  'creatorTeamName',
  'creatorTeamIds',
  'creatorTeamNames',
  'delegateUids',
  'socialLinksEnabled',
  'socialLinks',
  'earlyBirdEnabled',
  'earlyBirdCost',
  'earlyBirdPolicyVersion',
  'gpsEnabled',
  'lat',
  'lng',
  'mapAddress',
  'mapPlaceId',
  'mapProvider',
  'mapLocationConfirmed',
  'mapLocationUpdatedAt',
] as const;

type EventChangeNotifySnapshot = Partial<Record<typeof EVENT_CHANGE_NOTIFY_FIELDS[number], unknown>>;

// ── 純函式 ────────────────────────────────────────

/** A `_normalizeEventChangeNotifyValue`。 */
export function normalizeEventChangeNotifyValue(value: unknown): unknown {
  if (value == null) return '';
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : '';
  }
  const maybeTimestamp = value as { toDate?: () => Date } | null;
  if (typeof maybeTimestamp?.toDate === 'function') {
    const date = maybeTimestamp.toDate();
    return Number.isFinite(date?.getTime?.()) ? date.toISOString() : '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeEventChangeNotifyValue(item));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      result[key] = normalizeEventChangeNotifyValue(obj[key]);
    }
    return result;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value;
  return String(value || '').trim();
}

/** A `_getEventChangeNotifySnapshot`：用固定欄位順序建 snapshot。 */
export function getEventChangeNotifySnapshot(
  eventData: Record<string, unknown> | null | undefined,
): EventChangeNotifySnapshot {
  const source = eventData || {};
  const result: EventChangeNotifySnapshot = {};
  for (const key of EVENT_CHANGE_NOTIFY_FIELDS) {
    result[key] = normalizeEventChangeNotifyValue(source[key]);
  }
  return result;
}

/** A `_hasEventChangeNotificationDiff`。 */
export function hasEventChangeNotificationDiff(
  existingEvent: Record<string, unknown> | null | undefined,
  updates: Record<string, unknown> | null | undefined,
): boolean {
  if (!existingEvent) return true;
  const before = getEventChangeNotifySnapshot(existingEvent);
  const after = getEventChangeNotifySnapshot({
    ...existingEvent,
    ...(updates || {}),
  });
  return JSON.stringify(before) !== JSON.stringify(after);
}

/** A `_hashEventChangeNotifyString`（32-bit 有號累加，輸出 base36）。 */
export function hashEventChangeNotifyString(text: string): string {
  let hash = 0;
  const input = String(text || '');
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** A `_getEventChangeNotificationDedupeKey`。 */
export function getEventChangeNotificationDedupeKey(
  eventId: string,
  uid: string,
  eventData: Record<string, unknown>,
): string {
  const snapshot = getEventChangeNotifySnapshot(eventData);
  const hash = hashEventChangeNotifyString(JSON.stringify(snapshot));
  return `event_changed:${String(eventId || '').trim()}:${String(uid || '').trim()}:${hash}`;
}

// ── 讀取收件人 ────────────────────────────────────

/**
 * 讀 `events/{eventDocId}/registrations`，取狀態不是 `cancelled`／`removed` 的 `userId`，去重。
 *
 * 刻意偏離 A：不移植 `_collectEventNotifyRecipientUids` 的暱稱反查分支（R-ID-002）。
 */
export async function loadEventNotifyRecipientUids(eventDocId: string): Promise<string[]> {
  const { db } = await getFirebase();
  const snap = await getDocs(collection(db, registrations(eventDocId)));
  const uids = new Set<string>();
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as RegistrationDoc;
    const status = String(data.status ?? '').trim();
    if (status === 'cancelled' || status === 'removed') continue;
    const uid = String(data.userId ?? '').trim();
    if (uid) uids.add(uid);
  }
  return [...uids];
}

// ── 通知發送 ──────────────────────────────────────

export interface NotifyEventChangedInput {
  eventId: string;
  title: string;
  date: string;
  location: string;
  recipientUids: readonly string[];
  eventData: Record<string, unknown>;
  senderUid: string | null;
}

/**
 * 對每位收件人送 `event_changed`；單一失敗不影響其他人。回傳成功送達人數。
 * dedupeKey 走 `getEventChangeNotificationDedupeKey(eventId, uid, eventData)`。
 */
export async function notifyEventChanged(
  input: NotifyEventChangedInput,
): Promise<number> {
  const { eventId, title, date, location, recipientUids, eventData, senderUid } = input;
  let successCount = 0;

  for (const uid of recipientUids) {
    try {
      const dedupeKey = getEventChangeNotificationDedupeKey(eventId, uid, eventData);
      const result = await sendTemplateNotification({
        key: 'event_changed',
        vars: { eventName: title, date, location },
        targetUid: uid,
        category: 'activity',
        categoryName: '活動',
        senderUid,
        extra: { dedupeKey },
      });
      if (result.delivered) successCount += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[event-change-notify] send failed', { eventId, error: err });
    }
  }

  return successCount;
}
