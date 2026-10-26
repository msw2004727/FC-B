import { useEffect, useRef } from 'preact/hooks';

/**
 * 首屏快照撤掉用（T-042）：快照只在讀取當下檢查過期，頁面掛載後要自己在到期時撤掉，
 * 否則 29 分 59 秒開啟、之後更新一直失敗的頁面，會在超過 30 分鐘後繼續顯示舊標題與「N 活動」。
 *
 * `expiresAt` 為毫秒時間戳（`null`＝沒有需要盯的快照，例如已被伺服器資料取代）。到期時呼叫一次 `onExpire`。
 * 三條路徑，任一條先發現就撤：
 * - 計時器（`setTimeout`，到期時間減現在；醒來時仍會重新比對，提早醒來就再排一次）；
 * - 頁面回到可見（`visibilitychange`）——背景分頁的計時器會被瀏覽器延後；
 * - 從 bfcache 還原（`pageshow`）。
 */
export function useSnapshotExpiry(expiresAt: number | null, onExpire: () => void): void {
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (expiresAt === null) return undefined;
    let timer: number | null = null;
    let done = false;

    const expireIfDue = (): boolean => {
      if (done) return true;
      if (Date.now() < expiresAt) return false;
      done = true;
      onExpireRef.current();
      return true;
    };
    const schedule = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        if (!expireIfDue()) schedule();
      }, Math.max(0, expiresAt - Date.now()));
    };
    const onWake = (): void => {
      if (document.visibilityState === 'hidden') return;
      if (!expireIfDue()) schedule();
    };

    if (expireIfDue()) return undefined;
    schedule();
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('pageshow', onWake);
    return () => {
      done = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('pageshow', onWake);
    };
  }, [expiresAt]);
}
