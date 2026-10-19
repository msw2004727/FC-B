// 收件匣的可操作訊息登錄表。
//
// 目的：收件匣 UI 只查表（actionType → handler），不 import 任何功能模組，
// 讓俱樂部等功能的核准／拒絕動作可以獨立登錄、可在此模組之外擴充。
//
// ASSUMPTION: spec 原文寫 `canAct(viewer, message): boolean`（同步）；但真實的
// 權限檢查需要讀俱樂部檔案（`loadTeam`），本質上非同步。這裡放寬為
// `boolean | Promise<boolean>`——同步回傳 boolean 仍合法，呼叫端以 `await` 統一處理。

import { getActiveManifests } from './feature-registry';

export interface MessageActionViewer {
  uid: string | null;
  role?: string;
  displayName?: string;
  hasPermission?: (code: string) => boolean;
}

export interface InboxMessageLike {
  id: string;
  _docId?: string;
  actionType?: string;
  actionStatus?: string;
  meta?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface MessageActionEntry {
  key: string;
  labelKey: string;
  run(message: InboxMessageLike, viewer: MessageActionViewer): Promise<void>;
}

export interface MessageActionHandler {
  canAct(
    viewer: MessageActionViewer,
    message: InboxMessageLike,
  ): boolean | Promise<boolean>;
  actions: MessageActionEntry[];
}

const registry = new Map<string, MessageActionHandler>();
const inflightLoads = new Map<string, Promise<MessageActionHandler | null>>();
const loadedActionTypes = new Set<string>();

/** 登錄某個 actionType 的可操作訊息處理器。多次登錄同 key 以最後一次為準。 */
export function registerMessageAction(
  actionType: string,
  handler: MessageActionHandler,
): void {
  const key = String(actionType ?? '').trim();
  if (!key) {
    throw new Error('registerMessageAction: actionType is required');
  }
  registry.set(key, handler);
}

/** 查表；找不到回 `null`。 */
export function getMessageAction(actionType: string): MessageActionHandler | null {
  const key = String(actionType ?? '').trim();
  if (!key) return null;
  return registry.get(key) ?? null;
}

/**
 * 確保 actionType 已載入並回傳 handler：
 * - 若已登錄直接回傳；
 * - 若未登錄，從已啟用功能的 manifest 尋找 `messageActions[actionType]` 動態載入（同 key 只載一次）；
 * - 失敗或找不到時回傳 `null`，不拋出例外。
 */
export async function ensureMessageAction(
  actionType: string,
): Promise<MessageActionHandler | null> {
  const key = String(actionType ?? '').trim();
  if (!key) return null;

  const existing = registry.get(key);
  if (existing) return existing;

  // ASSUMPTION: 依規格「只載一次，失敗回 null，不拋錯」，同一 actionType 嘗試載入過後不再重試動態載入。
  if (loadedActionTypes.has(key)) {
    return registry.get(key) ?? null;
  }

  const inflight = inflightLoads.get(key);
  if (inflight) return inflight;

  let loader: (() => Promise<unknown>) | undefined;
  for (const manifest of getActiveManifests()) {
    const candidate = manifest.messageActions?.[key];
    if (typeof candidate === 'function') {
      loader = candidate;
      break;
    }
  }

  if (!loader) {
    return null;
  }

  const promise = (async (): Promise<MessageActionHandler | null> => {
    loadedActionTypes.add(key);
    try {
      await loader();
      return registry.get(key) ?? null;
    } catch {
      return null;
    } finally {
      inflightLoads.delete(key);
    }
  })();

  inflightLoads.set(key, promise);
  return promise;
}

/** 測試用：清空登錄表與載入快取。 */
export function clearMessageActions(): void {
  registry.clear();
  inflightLoads.clear();
  loadedActionTypes.clear();
}
