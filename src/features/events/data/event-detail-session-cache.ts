/**
 * 活動詳情第一次載入的短時效 promise 快取（T-093 批 5）。
 *
 * 掛在頁面父層，不放進 `loadEventDetail`：簽到、收藏、重新整理與其他呼叫端維持每次真的讀。
 * 只服務新 session 的 `reload === 0`。進行中與剛完成都算；拒絕不快取；resolve `null`（找不到）要快取。
 */

export const EVENT_DETAIL_SESSION_TTL_MS = 30_000;

export interface SessionDetailCacheEntry<T> {
  at: number;
  promise: Promise<T | null>;
}

export function loadEventDetailThroughSessionCache<T>(
  cache: Map<string, SessionDetailCacheEntry<T>>,
  publicId: string,
  reload: number,
  load: (publicId: string) => Promise<T | null>,
  now: number = Date.now(),
): Promise<T | null> {
  if (reload !== 0) return load(publicId);
  const hit = cache.get(publicId);
  if (hit) {
    const age = now - hit.at;
    if (age >= 0 && age < EVENT_DETAIL_SESSION_TTL_MS) return hit.promise;
  }
  let promise: Promise<T | null>;
  try {
    promise = load(publicId);
  } catch (error) {
    return Promise.reject(error);
  }
  const entry: SessionDetailCacheEntry<T> = { at: now, promise };
  cache.set(publicId, entry);
  void promise.then(
    () => undefined,
    () => {
      if (cache.get(publicId) === entry) cache.delete(publicId);
    },
  );
  return promise;
}
