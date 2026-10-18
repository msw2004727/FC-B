// 型別安全事件匯流排。
// 核心只發事件、不直接呼叫附加功能——附加功能關閉時就只是沒有訂閱者。

import type { Locale } from '@/i18n/locales';

export interface AppEvents {
  'registration:created': { eventId: string; userId: string };
  'registration:cancelled': { eventId: string; userId: string };
  'checkin:recorded': { eventId: string; uid: string };
  'locale:changed': { locale: Locale };
  'theme:changed': { theme: 'light' | 'dark' | 'system' };
  /** Firebase Auth 登入狀態變更；uid 為 null 代表登出。 */
  'auth:changed': { uid: string | null };
  /** 重讀目前使用者的身分與權限；不改變登入帳號。 */
  'viewer:refresh': Record<string, never>;
  /** 頂部列運動項目切換鈕被點擊（功能待活動模組實作）。 */
  'sport:picker-open': Record<string, never>;
}

type Handler<K extends keyof AppEvents> = (payload: AppEvents[K]) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = Handler<any>;
export type EventErrorReporter = (error: unknown) => void;

const handlers = new Map<keyof AppEvents, Set<AnyHandler>>();

const defaultErrorReporter: EventErrorReporter = (error) => {
  console.error('[events] listener error', error);
};

let errorReporter: EventErrorReporter = defaultErrorReporter;

/** 替換 listener 例外的錯誤回報入口。 */
export function setEventErrorReporter(reporter: EventErrorReporter): void {
  errorReporter = reporter;
}

/** 訂閱事件，回傳取消訂閱函式。 */
export function on<K extends keyof AppEvents>(type: K, handler: Handler<K>): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler as AnyHandler);
  return () => off(type, handler);
}

/** 取消訂閱。 */
export function off<K extends keyof AppEvents>(type: K, handler: Handler<K>): void {
  const set = handlers.get(type);
  if (!set) return;
  set.delete(handler as AnyHandler);
  if (set.size === 0) handlers.delete(type);
}

/**
 * 發送事件。
 *
 * 快照語意：emit 開始時先複製 listener 清單，因此：
 * - emit 期間被移除的 listener 本次仍會收到。
 * - emit 期間新增的 listener 本次不會收到。
 *
 * 每個 listener 的例外都獨立隔離，交給我方錯誤回報入口，
 * 不得中斷其他 listener，也不得拋回呼叫端。
 */
export function emit<K extends keyof AppEvents>(type: K, payload: AppEvents[K]): void {
  const set = handlers.get(type);
  if (!set) return;

  const snapshot = Array.from(set);
  for (const handler of snapshot) {
    try {
      handler(payload);
    } catch (err) {
      try {
        errorReporter(err);
      } catch {
        // 錯誤回報入口本身也不能影響 emit。
      }
    }
  }
}
