/**
 * 開團表單（EventFormModal，約 105 KB JS＋activity.css）的延遲載入。
 * 首頁關鍵路徑不載入它：點「我要開團」或有建立權限的人在瀏覽器空閒時才下載。
 * 本檔只能用動態 import 取得表單，不得靜態 import 表單模組（HomePage.test 有原始碼守門）。
 */

export type EventFormModalComponent =
  typeof import('@/features/events/components/EventFormModal').EventFormModal;

let loading: Promise<EventFormModalComponent> | null = null;

/** 取得（單例）表單元件；失敗時清掉快取以便重試（L-08）。 */
export function loadEventFormModal(): Promise<EventFormModalComponent> {
  if (!loading) {
    const promise = import('@/features/events/components/EventFormModal').then(
      (mod) => mod.EventFormModal,
    );
    loading = promise;
    promise.catch(() => {
      if (loading === promise) loading = null;
    });
  }
  return loading;
}

/** 瀏覽器空閒時預載表單（只給有建立權限的人）；回傳取消函式。預載失敗不打擾使用者，點擊時會重試。 */
export function scheduleEventFormPrefetch(): () => void {
  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  const run = (): void => {
    loadEventFormModal().catch(() => undefined);
  };
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const id = idleWindow.requestIdleCallback(run, { timeout: 4000 });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const timer = setTimeout(run, 2000);
  return () => clearTimeout(timer);
}

/** 測試用。 */
export function _resetEventFormLoaderForTest(): void {
  loading = null;
}
