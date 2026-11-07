/**
 * 聯繫站長彈窗的延遲載入。首頁只掛浮球；點擊且已登入才下載彈窗與 Callable。
 * 本檔不得靜態 import 彈窗或 callables。
 */

export type ContactOwnerModalComponent =
  typeof import('../components/ContactOwnerModal').ContactOwnerModal;

let loading: Promise<ContactOwnerModalComponent> | null = null;

export function loadContactOwnerModal(): Promise<ContactOwnerModalComponent> {
  if (!loading) {
    const promise = import('../components/ContactOwnerModal').then((mod) => mod.ContactOwnerModal);
    loading = promise;
    promise.catch(() => {
      if (loading === promise) loading = null;
    });
  }
  return loading;
}

/** 測試用。 */
export function _resetContactOwnerLoaderForTest(): void {
  loading = null;
}
