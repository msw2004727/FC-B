import { callFn } from '@/data/callables';
import type { IncrementEventViewCountResponse } from '@/data/contract/callables';

const inFlight = new Map<string, Promise<IncrementEventViewCountResponse | null>>();

/** 照 A `_incrementEventViewCount`；驗證回傳值後才更新畫面。 */
export function validViewCountResponse(value: unknown): value is IncrementEventViewCountResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.incremented === 'boolean'
    && typeof record.viewCount === 'number'
    && Number.isSafeInteger(record.viewCount)
    && record.viewCount >= 0;
}

/** 照 A `_incrementEventViewCount`，畫面只增不減。 */
export function mergeViewCount(...values: unknown[]): number {
  return Math.max(0, ...values.map(value => {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
  }));
}

/** 照 A `_incrementEventViewCount`；同 UID＋public ID 僅合併飛行中的呼叫。 */
export function incrementEventViewCount(
  uid: string | null,
  eventId: string,
  docId: string,
): Promise<IncrementEventViewCountResponse | null> {
  const expectedUid = String(uid || '').trim();
  const publicId = eventId.trim();
  const documentId = docId.trim();
  if (!expectedUid || !publicId || !documentId) return Promise.resolve(null);
  const key = JSON.stringify([expectedUid, publicId]);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const work = (async (): Promise<IncrementEventViewCountResponse | null> => {
    try {
      // 照 A 呼叫前再次核對登入 UID；避免新增首屏 auth 靜態依賴。
      const { getCurrentUser } = await import('@/data/auth');
      if ((await getCurrentUser())?.uid !== expectedUid) return null;
      const result = await callFn('incrementEventViewCount', {
        eventId: publicId,
        docId: documentId,
      });
      if ((await getCurrentUser())?.uid !== expectedUid || !validViewCountResponse(result)) return null;
      return result;
    } catch {
      // 照 A：計數失敗不阻止詳情頁。
      return null;
    }
  })();
  inFlight.set(key, work);
  const release = (): void => {
    if (inFlight.get(key) === work) inFlight.delete(key);
  };
  work.then(release, release);
  return work;
}
