// M-049、U-013：同步／離線狀態條與離線鎖寫入（照 A `index.html:1131-1137`、`js/modules/sync-status.js:48-85`）

import { emit } from './events';
import { OFFLINE_WRITE_BLOCKED_MSG } from './unavailable';
import { toast } from '@/ui/Toast';

export type SyncBarState = 'idle' | 'syncing' | 'done' | 'error' | 'offline';

let currentOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

export function isBrowserOnline(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return currentOnline;
}

export function setSyncBarState(
  state: SyncBarState,
  opts: { text?: string; retry?: (() => void) | null } = {},
): void {
  emit('sync:state', { state, text: opts.text, retry: opts.retry ?? null });
}

/**
 * U-013：寫入前檢查是否離線；若離線則顯示狀態條與提示並回傳 false（呼叫端應中止送出）。
 */
export function guardOnlineForWrite(): boolean {
  if (isBrowserOnline()) return true;
  setSyncBarState('offline');
  toast.show({ message: OFFLINE_WRITE_BLOCKED_MSG, tone: 'warning' });
  return false;
}

/**
 * U-013：全域攔截離線時的表單 submit 與標記 `[data-write-action]`／`button[type="submit"]` 的點擊，
 * 讓所有頁面的送出鈕在斷網時不會白按送出。
 */
export function installOfflineWriteGuard(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined;
  }

  const syncBodyOfflineAttr = (offline: boolean): void => {
    currentOnline = !offline;
    if (document.body) {
      if (offline) document.body.setAttribute('data-offline', 'true');
      else document.body.removeAttribute('data-offline');
    }
  };

  syncBodyOfflineAttr(!isBrowserOnline());

  const handleOffline = (): void => {
    syncBodyOfflineAttr(true);
    setSyncBarState('offline');
  };

  const handleOnline = (): void => {
    syncBodyOfflineAttr(false);
  };

  const handleSubmitCapture = (e: Event): void => {
    if (!isBrowserOnline()) {
      e.preventDefault();
      e.stopPropagation();
      guardOnlineForWrite();
    }
  };

  const handleClickCapture = (e: MouseEvent): void => {
    if (isBrowserOnline()) return;
    const target = e.target as Element | null;
    if (!target || typeof target.closest !== 'function') return;
    const submitBtn = target.closest(
      'button[type="submit"], [data-write-action], .companion-signup-toolbar-action, #detail-action-primary button',
    );
    if (submitBtn) {
      e.preventDefault();
      e.stopPropagation();
      guardOnlineForWrite();
    }
  };

  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);
  document.addEventListener('submit', handleSubmitCapture, true);
  document.addEventListener('click', handleClickCapture, true);

  return () => {
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('submit', handleSubmitCapture, true);
    document.removeEventListener('click', handleClickCapture, true);
  };
}
