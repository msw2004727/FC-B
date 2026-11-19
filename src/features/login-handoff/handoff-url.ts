// 轉交回跳網址的解析。fcbHandoff 可能在兩處（站長 11-20 實機截圖）：
// - 最外層：?fcbHandoff=<id>&code=…&liffClientId=…&liffRedirectUri=…
// - 跳 LINE App 授權再回瀏覽器時，LIFF 把發起時 redirectUri 的 query 包進 liff.state：
//   ?liff.state=%3FfcbHandoff%3D<id>&state=…&liffClientId=…&liffRedirectUri=https%3A%2F%2F…%2F%3Fliff.state%3D…&code=…
//   code、liffClientId、liffRedirectUri 仍在最外層；liffRedirectUri 本身也是包過的形式，換 token 時必須原樣使用。

const HANDOFF_ID = /^[0-9a-f]{64}$/;

export interface HandoffParams {
  /** 網址上有 fcbHandoff（最外層或 liff.state 內），不論格式。 */
  present: boolean;
  /** 只認 64 位小寫十六進位；格式不對為 null。 */
  handoffId: string | null;
  code: string | null;
  liffClientId: string | null;
  liffRedirectUri: string | null;
}

function innerParams(params: URLSearchParams, origin: string): URLSearchParams | null {
  const state = params.get('liff.state');
  if (!state) return null;
  try {
    const inner = new URL(state, origin);
    return inner.origin === origin ? inner.searchParams : null;
  } catch {
    return null;
  }
}

export function readHandoffParams(href: string): HandoffParams {
  try {
    const url = new URL(href);
    const top = url.searchParams;
    const inner = innerParams(top, url.origin);
    const pick = (key: string): string | null => top.get(key) ?? inner?.get(key) ?? null;
    const raw = pick('fcbHandoff');
    return {
      present: raw !== null,
      handoffId: raw !== null && HANDOFF_ID.test(raw) ? raw : null,
      code: pick('code'),
      liffClientId: pick('liffClientId'),
      liffRedirectUri: pick('liffRedirectUri'),
    };
  } catch {
    return { present: false, handoffId: null, code: null, liffClientId: null, liffRedirectUri: null };
  }
}

/**
 * 還原成真正要去的頁面網址：有 liff.state 時以它的路徑與 query 為準，再補回最外層其他參數；
 * 一律拿掉 fcbHandoff 與 liff.state（避免 LIFF SDK 在 liff.init 時依 liff.state 換頁而丟掉 code）。
 * 不同源回 null。
 */
export function unwrapPageUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    const state = url.searchParams.get('liff.state');
    const target = state ? new URL(state, url.origin) : new URL(url.href);
    if (target.origin !== url.origin) return null;
    if (state) {
      for (const [key, value] of url.searchParams) {
        if (key !== 'liff.state' && !target.searchParams.has(key)) target.searchParams.append(key, value);
      }
    }
    target.searchParams.delete('fcbHandoff');
    target.searchParams.delete('liff.state');
    return target;
  } catch {
    return null;
  }
}
