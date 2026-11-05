// vitest 共用 setup（vite.config.ts 的 test.setupFiles）。
//
// 測試一律不得連線正式 Firebase（2026-11-05 查到 vitest 下 data/firebase.ts 會用正式設定初始化：
// SideDrawer 測試曾對正式站送 updateDoc、多個頁面測試會讀正式資料）。三道防線，全部 fail-closed：
//   1) gRPC：Node 端 Firestore SDK 走 gRPC（不經 fetch），把 grpc-js 的代理指向不可達位址；
//   2) data/firebase.ts 的連線 getter 全域換成立即 reject（測試要用 Firebase 必須自己 mock）；
//   3) fetch：Firestore REST、Functions、Auth、Storage 網域一律立即失敗。
import { configure } from '@testing-library/preact';
import { vi } from 'vitest';

// 1) gRPC 第二道保險（getter 被繞過時仍連不出去）。@grpc/grpc-js 在「建立 channel 時」才讀 grpc_proxy
//    （優先於 https_proxy／http_proxy），setup 又先於每個測試檔執行，所以對之後任何 Firestore 連線都生效；
//    只設 grpc_proxy、不碰 http(s)_proxy，不影響 fetch。127.0.0.1:9（discard 埠）不會有服務在聽，連線立即被拒。
//    no_grpc_proxy 是逐一比對主機名（不支援萬用字元），放行本機 emulator 的三種寫法；
//    它優先於 no_proxy，這裡強制覆寫，避免環境變數裡的 no_proxy 意外放行正式網域。
process.env.grpc_proxy = 'http://127.0.0.1:9';
process.env.no_grpc_proxy = 'localhost,127.0.0.1,::1';

// 2) Firebase 連線入口：會建立連線的 getter（data/firebase.ts 只匯出這兩個；auth／functions 由 getFirebase 一併取得）
//    換成立即 reject，其他匯出（auth-hold、目標檢查、測試用 reset 等）維持真實實作。
//    測試檔自己的 vi.mock('@/data/firebase', …) 會覆蓋這裡；直接測 firebase.ts 本身的檔在檔頭 vi.unmock('@/data/firebase')。
vi.mock('@/data/firebase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/firebase')>();
  const blocked = (name: string) => () => Promise.reject(new Error(`測試未 mock Firebase：${name}`));
  return {
    ...actual,
    getFirebase: blocked('getFirebase'),
    getFirebaseCore: blocked('getFirebaseCore'),
  };
});

// 整包平行跑時，findBy*／waitFor 的預設 1 秒等待會偶發逾時（2026-10-22 M-071、M-090 各發生一次，單跑都在 1 秒內）；
// 統一放寬到 10 秒，取代逐個測試加 timeout；testTimeout 另在 vite.config.ts 設 15 秒。
configure({ asyncUtilTimeout: 10_000 });

// 3) fetch 擋網。T-042c 起首頁冷啟動會對 Firestore REST 發匿名 POST（features/home/data/banners-rest.ts，呼叫端失敗時靜默退回 SDK 路徑）；
//    2026-11-05 擴大到 Functions（cloudfunctions.net、*.run.app）、Auth（identitytoolkit、securetoken）、Storage。
//    其他網址原樣交給原本的 fetch。要驗證請求內容或回應的測試，在測試內用 vi.stubGlobal('fetch', …) 覆寫。
const BLOCKED_HOSTS: readonly string[] = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebasestorage.googleapis.com',
];
const BLOCKED_HOST_SUFFIXES: readonly string[] = ['.cloudfunctions.net', '.run.app'];

function isBlockedUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false; // 相對網址等：不是線上端點
  }
  return BLOCKED_HOSTS.includes(host) || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const realFetch = globalThis.fetch;
if (typeof realFetch === 'function') {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (isBlockedUrl(url)) {
      return Promise.reject(new TypeError(`test-setup: 測試不得連線 Firebase 線上端點（${url.split('?')[0]}；請在測試內 stub fetch）`));
    }
    return realFetch(input, init);
  }) as typeof fetch;
}
