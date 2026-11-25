// 營運儀表板 W6 截圖台：Firebase 一律拒絕初始化，萬一有程式要連 Firestore 會直接失敗，不會連到正式站。其他匯出照原模組。
export * from '../data/firebase';

export function getFirebase(): Promise<never> {
  return Promise.reject(new Error('ops-w6 harness: Firebase is blocked'));
}

export function getFirebaseCore(): Promise<never> {
  return Promise.reject(new Error('ops-w6 harness: Firebase is blocked'));
}
