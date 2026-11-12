/**
 * 登入者全歷史報名的模組層共用快取（優化盤點 O5）。
 *
 * 活動列表、俱樂部頁、收藏、個人頁每換一頁都讀一次 collectionGroup 全歷史（重度帳號約 300 筆），
 * 這裡讓同一 uid 在短時間內共用同一份結果：
 * - TTL 30 秒（從開始讀取起算，偏保守）；過期重讀。
 * - 進行中請求合併（inflight）；成功、失敗都清掉（L-08），失敗不留快取，下次重新呼叫 loader。
 * - 登出或換帳號（auth:changed 帶不同 uid）立即全部清除；清除後才回來的舊請求不寫入快取（L-43）。
 * - 報名、取消、名單移除／升降、團隊名額、人數調整的寫入呼叫一結束（成功、失敗、逾時都算）由資料層呼叫 invalidateViewerRegistrations()。
 *
 * 本檔刻意不 import firebase/firestore：報名資料層要能靜態引用失效函式，不把 Firestore 拉進它們的靜態依賴鏈。
 * 報名判斷（signup-context）不走這份快取，維持即時讀。
 */
import { on } from '@/core/events';
import type { RegistrationDoc } from './types';

export const VIEWER_REGISTRATIONS_TTL_MS = 30_000;

interface Entry {
  docs: readonly RegistrationDoc[];
  at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<readonly RegistrationDoc[]>>();

/** 清掉所有快取與進行中請求；進行中的請求回來後不再寫入快取。 */
export function invalidateViewerRegistrations(): void {
  cache.clear();
  inflight.clear();
}

/**
 * 依 uid 讀快取；未命中或過期才呼叫 loader，同 uid 進行中只呼叫一次。
 * 每次回傳新陣列，且每筆報名物件做一層淺複製（{...r}）：呼叫端改陣列或改單筆頂層欄位不會汙染快取。
 * 只複製一層；巢狀物件（如 Timestamp）仍共用，呼叫端不得就地改巢狀內容。
 */
export function readViewerRegistrationsCached(
  uid: string,
  loader: (uid: string) => Promise<RegistrationDoc[]>,
  now: () => number = Date.now,
): Promise<RegistrationDoc[]> {
  const startedAt = now();
  const hit = cache.get(uid);
  if (hit && startedAt - hit.at < VIEWER_REGISTRATIONS_TTL_MS) {
    return Promise.resolve(copyDocs(hit.docs));
  }
  if (hit) cache.delete(uid);

  let request = inflight.get(uid);
  if (!request) {
    const started: Promise<readonly RegistrationDoc[]> = (async () => loader(uid))();
    request = started;
    inflight.set(uid, started);
    started.then(
      (docs) => {
        // 已被失效、換帳號或換成新請求：這次結果只交給原呼叫端，不寫入快取。
        if (inflight.get(uid) !== started) return;
        inflight.delete(uid);
        cache.set(uid, { docs, at: startedAt });
      },
      () => {
        if (inflight.get(uid) === started) inflight.delete(uid);
      },
    );
  }
  return request.then(copyDocs);
}

function copyDocs(docs: readonly RegistrationDoc[]): RegistrationDoc[] {
  return docs.map((r) => ({ ...r }));
}

on('auth:changed', ({ uid }) => {
  if (uid === null || [...cache.keys(), ...inflight.keys()].some((key) => key !== uid)) {
    invalidateViewerRegistrations();
  }
});
