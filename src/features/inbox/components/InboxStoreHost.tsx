// App 層收件匣訂閱主機：登入後啟動共用訂閱，登出／換帳號時退訂（照 A 登入後常駐 inbox 與 pmThreads 監聽）。
// 由 App 以 lazy 動態載入，避免首屏帶入收件匣資料層與 Firestore。
// 啟動延到瀏覽器閒置（沒有 requestIdleCallback 時 1.5 秒後），讓登入當下的收件匣初讀不和首頁首屏讀取搶連線；
// 進收件匣頁不受影響（InboxPage 會立即啟動）。
// 會員文件同步（照 A createOrUpdateUser）也借這個登入後才載入的延遲 chunk 掛載，不加首頁主程式；
// 它要趕在首次資料表單與報名之前，所以不等閒置（2026-11-09 P1）。

import { useEffect } from 'preact/hooks';

import { startUserDocSync } from '@/data/user-doc-sync';

import { startInboxStore, stopInboxStore } from '../data/inbox-store';

/** 沒有 requestIdleCallback 時的退回延遲；也是閒置等待的上限。 */
export const INBOX_START_DELAY_MS = 1500;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

function scheduleIdle(run: () => void): () => void {
  let cancelled = false;
  const guarded = (): void => {
    if (!cancelled) run();
  };
  const idleWindow = (typeof window === 'undefined' ? undefined : window) as IdleWindow | undefined;
  if (idleWindow && typeof idleWindow.requestIdleCallback === 'function') {
    const id = idleWindow.requestIdleCallback(guarded, { timeout: INBOX_START_DELAY_MS });
    return () => {
      cancelled = true;
      idleWindow.cancelIdleCallback?.(id);
    };
  }
  const timer = setTimeout(guarded, INBOX_START_DELAY_MS);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

export function InboxStoreHost({ uid }: { uid: string | null }): null {
  useEffect(() => {
    if (uid) void startUserDocSync(uid);
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      stopInboxStore();
      return undefined;
    }
    const cancelStart = scheduleIdle(() => startInboxStore(uid));
    return () => {
      cancelStart();
      stopInboxStore();
    };
  }, [uid]);
  return null;
}
