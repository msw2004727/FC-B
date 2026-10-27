// vitest 共用 setup（vite.config.ts 的 test.setupFiles）。
// 整包平行跑時，findBy*／waitFor 的預設 1 秒等待會偶發逾時（2026-10-22 M-071、M-090 各發生一次，單跑都在 1 秒內）；
// 統一放寬到 10 秒，取代逐個測試加 timeout；testTimeout 另在 vite.config.ts 設 15 秒。
import { configure } from '@testing-library/preact';

configure({ asyncUtilTimeout: 10_000 });

// T-042c：首頁冷啟動會對 Firestore REST（firestore.googleapis.com）發匿名 POST（features/home/data/banners-rest.ts）。
// 測試一律不得連線到線上端點：對該網域的請求立即失敗（呼叫端靜默退回 SDK 路徑），其他網址原樣交給原本的 fetch。
// 要驗證請求內容或回應的測試，在測試內用 vi.stubGlobal('fetch', …) 覆寫。
const realFetch = globalThis.fetch;
if (typeof realFetch === 'function') {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/^https?:\/\/firestore\.googleapis\.com(?:[:/?#]|$)/i.test(url)) {
      return Promise.reject(new TypeError('test-setup: 測試不得連線 Firestore REST（請在測試內 stub fetch）'));
    }
    return realFetch(input, init);
  }) as typeof fetch;
}
