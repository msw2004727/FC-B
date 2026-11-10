// vitest 共用 setup（vite.config.ts 的 test.setupFiles）。
//
// 測試一律不得連線正式 Firebase（2026-11-05 查到 vitest 下 data/firebase.ts 會用正式設定初始化：
// SideDrawer 測試曾對正式站送 updateDoc、多個頁面測試會讀正式資料）。三道防線，全部 fail-closed：
//   1) gRPC：Node 端 Firestore SDK 走 gRPC（不經 fetch），把 grpc-js 的代理指向不可達位址；
//   2) data/firebase.ts 的連線 getter 全域換成立即 reject（測試要用 Firebase 必須自己 mock）；
//   3) fetch：Firestore REST、Functions、Auth、Storage 網域一律立即失敗。
import { configure } from '@testing-library/preact';
import { options } from 'preact';
import { afterEach, vi } from 'vitest';

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

// 4) Preact 的 useEffect 排程（hooks 的 afterNextFrame）會同時掛 35ms 計時器與 requestAnimationFrame，
//    任一個觸發時都會呼叫 cancelAnimationFrame 與 setTimeout(flush)。測試裡 act() 之外的非同步 setState
//    （例如 mock 的 getDocs 解析後更新狀態）會把這串排進去；測試一結束 jsdom 就被拆掉，
//    計時器晚到時就報 ReferenceError（cancelAnimationFrame／document is not defined），
//    CI 顯示「Unhandled errors」而測試全過（2026-11-09 useRosterNoShow、App.recovery 各見一次）。
//    做法：用 Preact 官方的 options.requestAnimationFrame 掛鉤，改成立即的 setTimeout(0)，
//    並在每個測試結束時把還沒觸發的排程同步跑完，不留任何晚到的計時器。
//    取代：先前沒有任何處理，靠運氣。
const pendingFrames = new Set<{ timer: ReturnType<typeof setTimeout>; run: () => void }>();
options.requestAnimationFrame = (flush: () => void) => {
  const entry = {
    timer: setTimeout(() => {
      pendingFrames.delete(entry);
      flush();
    }, 0),
    run: flush,
  };
  pendingFrames.add(entry);
};
afterEach(() => {
  // 沖掉時 effect 可能再 setState、又排新的一輪，所以反覆沖到清空（上限 50 輪防無限迴圈）；
  // 單一 flush 拋錯不得中斷其餘清理，全部沖完後再丟出第一個錯誤。
  let firstError: unknown;
  for (let round = 0; round < 50 && pendingFrames.size > 0; round++) {
    for (const entry of [...pendingFrames]) {
      clearTimeout(entry.timer);
      pendingFrames.delete(entry);
      try {
        entry.run();
      } catch (error) {
        firstError ??= error;
      }
    }
  }
  if (firstError !== undefined) throw firstError;
});
