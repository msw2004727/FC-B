/**
 * Firestore SDK（約 160 KB gz）的單例動態載入。
 *
 * 會被首頁路由靜態引用的資料模組（公告、橫幅、下一場活動）不得靜態 import `firebase/firestore`，
 * 否則 SDK 會進入首頁路由的靜態相依，HomePage 得等它下載完才能畫（T-041 A2）。
 * 它們改用本函式在查詢當下才取得 SDK；多次呼叫共用同一個 Promise，失敗時清掉以便重試（L-08）。
 */
export type FirestoreSdk = typeof import('firebase/firestore');

let loading: Promise<FirestoreSdk> | null = null;

export function loadFirestoreSdk(): Promise<FirestoreSdk> {
  if (!loading) {
    const promise = import('firebase/firestore');
    loading = promise;
    promise.catch(() => {
      if (loading === promise) loading = null;
    });
  }
  return loading;
}
