// 右上角鈴鐺的未讀數（照 A `updateNotifBadge`／`_syncPmUnreadIndicators`）。
//
// 只放數字與訂閱，不 import 任何資料層：TopBar 在首屏就會載入，這裡不能把 Firestore／收件匣資料層帶進入口。
// 數字由 `inbox-store`（lazy 載入）在每次收件匣或私訊對話更新時寫入；登出時歸零。

import { useEffect, useState } from 'preact/hooks';

export interface InboxBadgeCounts {
  /** 收件匣未讀數（照 A `_isMessageUnread`）。 */
  inboxUnread: number;
  /** 私訊未讀合計（照 A `_pmUnreadTotal`）。 */
  pmUnread: number;
}

type Listener = (counts: InboxBadgeCounts) => void;

const ZERO: InboxBadgeCounts = { inboxUnread: 0, pmUnread: 0 };

let current: InboxBadgeCounts = ZERO;
const listeners = new Set<Listener>();

function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** 寫入目前未讀數；與現值相同時不通知。 */
export function setInboxBadgeCounts(next: InboxBadgeCounts): void {
  const inboxUnread = safeCount(next.inboxUnread);
  const pmUnread = safeCount(next.pmUnread);
  if (inboxUnread === current.inboxUnread && pmUnread === current.pmUnread) return;
  current = inboxUnread === 0 && pmUnread === 0 ? ZERO : { inboxUnread, pmUnread };
  const snapshot = Array.from(listeners);
  for (const listener of snapshot) {
    try {
      listener(current);
    } catch (err) {
      console.error('[inbox-badge] listener failed', err);
    }
  }
}

export function getInboxBadgeCounts(): InboxBadgeCounts {
  return current;
}

export function subscribeInboxBadge(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Preact hook；照 L-04：effect 訂閱後補讀一次目前值。 */
export function useInboxBadgeCounts(): InboxBadgeCounts {
  const [counts, setCounts] = useState<InboxBadgeCounts>(current);
  useEffect(() => {
    setCounts(current);
    return subscribeInboxBadge(setCounts);
  }, []);
  return counts;
}
