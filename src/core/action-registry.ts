// 收件匣的可操作訊息登錄表。
//
// 目的：收件匣 UI 只查表（actionType → handler），不 import 任何功能模組，
// 讓俱樂部等功能的核准／拒絕動作可以獨立登錄、可在此模組之外擴充。
//
// ASSUMPTION: spec 原文寫 `canAct(viewer, message): boolean`（同步）；但真實的
// 權限檢查需要讀俱樂部檔案（`loadTeam`），本質上非同步。這裡放寬為
// `boolean | Promise<boolean>`——同步回傳 boolean 仍合法，呼叫端以 `await` 統一處理。

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

/** 測試用：清空登錄表。 */
export function clearMessageActions(): void {
  registry.clear();
}
