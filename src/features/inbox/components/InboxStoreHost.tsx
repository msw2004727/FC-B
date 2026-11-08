// App 層收件匣訂閱主機：登入後啟動共用訂閱，登出／換帳號時退訂（照 A 登入後常駐 inbox 與 pmThreads 監聽）。
// 由 App 以 lazy 動態載入，避免首屏帶入收件匣資料層與 Firestore。

import { useEffect } from 'preact/hooks';

import { startInboxStore, stopInboxStore } from '../data/inbox-store';

export function InboxStoreHost({ uid }: { uid: string | null }): null {
  useEffect(() => {
    if (!uid) {
      stopInboxStore();
      return undefined;
    }
    startInboxStore(uid);
    return () => {
      stopInboxStore();
    };
  }, [uid]);
  return null;
}
