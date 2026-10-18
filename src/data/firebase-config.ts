// Firebase 公開用戶端設定。
//
// 這些欄位（apiKey、authDomain、projectId、storageBucket、messagingSenderId、appId、
// measurementId）為 **公開識別碼**，不是秘密（R-CTX-003）。
// 安全性由 Firestore Security Rules 與 Cloud Functions 授權邏輯控制；
// 任何需要保密的資料（LINE Channel Secret、Service Account 私鑰等）一律不得出現在本檔。

export interface FirebaseClientConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
  readonly measurementId?: string;
}

/** 與 A 版 `js/firebase-config.js` 完全一致的公開 client 設定。 */
export const FIREBASE_CONFIG: FirebaseClientConfig = {
  apiKey: 'AIzaSyA5TzRM_7XHaD8iQlrr3jZXrtXc-a5RXkE',
  authDomain: 'fc-football-6c8dc.firebaseapp.com',
  projectId: 'fc-football-6c8dc',
  storageBucket: 'fc-football-6c8dc.firebasestorage.app',
  messagingSenderId: '468419387978',
  appId: '1:468419387978:web:7975c83c9ce7eb60d2bcb3',
  measurementId: 'G-2673ME04J7',
} as const;
