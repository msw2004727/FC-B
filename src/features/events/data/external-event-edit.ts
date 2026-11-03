import { getFirebase } from '@/data/firebase';
import type { EventLocationValue } from '../components/event-form/use-event-location';
import { uploadImageDataUrl } from './event-cover-upload';
import { canEditOwnActivityBasic, type OperateContext } from './operate-permissions';
import { eventSportTag, getSportKeySafe } from './sports';
import type { EventDoc } from './types';

export interface ExternalEventEditForm {
  title: string;
  dateVal: string;
  startTime: string;
  endTime: string;
  location: string;
  externalUrl: string;
  sportTag: string;
  image: string | null;
}

export const EXTERNAL_EDIT_FAILED = '更新失敗，請稍後再試';
export class ExternalEventEditError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = 'ExternalEventEditError';
  }
}

/** A openCreateExternalEventModal(editId)：只拆牆鐘字串，不做時區轉換。 */
export function externalEventEditForm(event: EventDoc): ExternalEventEditForm {
  const [date = '', time = ''] = (event.date || '').split(' ');
  const parts = date.split('/');
  const [startTime, endTime] = time.split('~');
  return {
    title: event.title || '',
    dateVal: parts.length === 3
      ? `${parts[0]}-${parts[1]!.padStart(2, '0')}-${parts[2]!.padStart(2, '0')}` : '',
    startTime: startTime || '14:00',
    endTime: endTime || '16:00',
    location: event.location || '',
    externalUrl: event.externalUrl || '',
    sportTag: getSportKeySafe(eventSportTag(event)),
    image: event.image || null,
  };
}

/** A 的順序與文案；編輯允許過去日期。 */
export function validateExternalEventEdit(form: ExternalEventEditForm): string | null {
  const title = form.title.trim();
  if (!title) return '請輸入活動名稱';
  if (title.length > 16) return '活動名稱不可超過 16 字';
  if (!form.dateVal) return '請選擇活動日期';
  if (!form.startTime || !form.endTime) return '請選擇開始與結束時間';
  if (form.endTime <= form.startTime) return '結束時間必須晚於開始時間';
  if (!getSportKeySafe(form.sportTag)) return '請先選擇運動 / 場景標籤（必選）';
  if (!form.externalUrl.trim()) return '請輸入活動連結';
  if (!/^https:\/\/.+/.test(form.externalUrl.trim())) return '活動連結必須以 https:// 開頭';
  return null;
}

export function buildExternalEventUpdates(
  form: ExternalEventEditForm,
  location: EventLocationValue,
): Record<string, unknown> {
  const error = validateExternalEventEdit(form);
  if (error) throw new ExternalEventEditError(error);
  const updates: Record<string, unknown> = {
    title: form.title.trim(),
    date: `${form.dateVal.replace(/-/g, '/')} ${form.startTime}~${form.endTime}`,
    location: form.location.trim(),
    externalUrl: form.externalUrl.trim(),
    sportTag: getSportKeySafe(form.sportTag),
    image: form.image,
    gradient: 'linear-gradient(135deg,#6b7280,#4b5563)',
  };
  // 重用 useEventLocation 的 A 草稿驗證結果；cee 一律視為 GPS 開，不寫 gpsEnabled。
  // 旗標關時完全不動舊座標。白名單避免未來 hook 加欄位意外擴大寫入。
  if (location.mapPickerEnabled) {
    Object.assign(updates, {
      lat: location.lat, lng: location.lng,
      mapAddress: location.mapAddress, mapPlaceId: location.mapPlaceId,
      mapProvider: location.mapProvider,
      mapLocationConfirmed: location.mapLocationConfirmed,
      mapLocationUpdatedAt: location.mapLocationUpdatedAt,
    });
  }
  return updates;
}

export interface ExternalEventEditActor {
  context: OperateContext;
  operator: string;
}

/**
 * ②a：events/{實際 docId} update + operationLogs 一筆；不建立活動、不寫時間戳或 GPS 開關。
 * 已知 docId：1 次 server read；只有 public id：最多 1 次直讀 + 1 次 limit(1) 查詢。
 * 要求最新權限資料，故不使用 paths.ts 的可離線 getDoc，也不把解析結果重讀第二次。
 */
export async function saveExternalEventEdit(
  existing: EventDoc,
  form: ExternalEventEditForm,
  location: EventLocationValue,
  getActor: () => ExternalEventEditActor,
): Promise<{ title: string }> {
  const initialActor = getActor();
  const allowed = (event: EventDoc): ExternalEventEditActor => {
    const actor = getActor();
    if (!actor.context.uid || actor.context.uid !== initialActor.context.uid
      || event.type !== 'external' || !canEditOwnActivityBasic(actor.context, event)) {
      throw new ExternalEventEditError('權限不足');
    }
    return actor;
  };
  allowed(existing);
  const updates = buildExternalEventUpdates(form, location);
  const [sdk, { db }] = await Promise.all([import('firebase/firestore'), getFirebase()]);
  const knownId = (existing._docId || existing.docId || '').trim();
  const publicId = (existing.id || '').trim();
  const targetId = knownId || publicId;
  if (!targetId || targetId.includes('/')) throw new ExternalEventEditError(EXTERNAL_EDIT_FAILED);
  let snapshot = await sdk.getDocFromServer(sdk.doc(db, 'events', targetId));
  if (!snapshot.exists() && !knownId) {
    const result = await sdk.getDocsFromServer(sdk.query(
      sdk.collection(db, 'events'), sdk.where('id', '==', publicId), sdk.limit(1),
    ));
    const found = result.docs[0];
    if (found) snapshot = found;
  }
  if (!snapshot.exists()) throw new ExternalEventEditError(EXTERNAL_EDIT_FAILED);
  const latest = snapshot.data() as EventDoc;
  allowed(latest);
  if (typeof updates.image === 'string' && updates.image.startsWith('data:')) {
    const image = await uploadImageDataUrl(updates.image, `events/${publicId || snapshot.id}`);
    if (image) updates.image = image;
    else delete updates.image; // A：上傳失敗保留既有封面，其餘修改照存。
  }
  const actor = allowed(latest); // 等讀取／上傳期間若 viewer 改變，不沿用過期權限。
  await sdk.updateDoc(sdk.doc(db, 'events', snapshot.id), {
    ...updates, updatedAt: sdk.serverTimestamp(),
  });
  const title = form.title.trim();
  // A 的 event_update；日誌失敗不影響已成功的活動更新，也不輸出原始錯誤。
  void import('@/data/op-log').then(({ writeOpLog }) => writeOpLog({
    type: 'event_update', typeName: '更新活動連結', content: `更新「${title}」`,
    actorUid: actor.context.uid, operator: actor.operator,
  }, () => undefined)).catch(() => undefined);
  return { title };
}
