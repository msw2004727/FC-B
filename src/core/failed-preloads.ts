// 本檔不得 import 任何模組。
// 用途：在 document 擷取階段記下載入失敗的 <link>（modulepreload／preload／stylesheet、同源 /assets/*.js|css）。
// iOS／桌面 WebKit 會把 5xx 的失敗結果帶過 location.reload()；重載前要先刷新這些網址。

export const MAX_FAILED = 30;
// 冷開 `/events/<id>` 的同源 /assets/ 預載約 57 個（index.html 24＋開機預載），80 留餘裕；
// 超過代表已在站內換頁很久、累積大量 link，全部刷新成本高且不一定刷到真兇，直接重整較穩。
// 只收同源 /assets/*.js|css。合格候選超過 MAX_ALL 就整批不刷新（回空陣列），不再取前 N 個。
export const MAX_ALL = 80;

/** 同源、路徑符合這條才刷新。new URL 失敗回 false。 */
const ASSET_PATH = /^\/assets\/[\w.-]+\.(?:js|css)$/;
const REFRESHABLE_REL = new Set(['modulepreload', 'preload', 'stylesheet']);

const failedUrls: string[] = [];
let installed = false;
let listeningDoc: Document | null = null;

/** 同源、路徑符合 /^\/assets\/[\w.-]+\.(?:js|css)$/ 才算；new URL 失敗回 false。 */
export function isRefreshableAssetUrl(href: string): boolean {
  try {
    const base = typeof location !== 'undefined' ? location.href : undefined;
    const url = base !== undefined ? new URL(href, base) : new URL(href);
    if (typeof location === 'undefined' || url.origin !== location.origin) return false;
    return ASSET_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

function relAllowed(rel: string): boolean {
  for (const token of rel.toLowerCase().split(/\s+/)) {
    if (REFRESHABLE_REL.has(token)) return true;
  }
  return false;
}

function onResourceError(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLLinkElement)) return;
  if (!relAllowed(target.rel)) return;
  const href = target.href;
  if (!href || failedUrls.includes(href) || failedUrls.length >= MAX_FAILED) return;
  if (!isRefreshableAssetUrl(href)) return;
  failedUrls.push(href);
}

/** 在 document 掛一次 capture 'error' 監聽（重複呼叫不重掛）。target 是 HTMLLinkElement 且 rel 為 modulepreload／preload／stylesheet、href 通過 isRefreshableAssetUrl 才記；去重；最多 MAX_FAILED 個。 */
export function installFailedPreloadRecorder(doc?: Document): void {
  const targetDoc = doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!targetDoc || installed) return;
  targetDoc.addEventListener('error', onResourceError, true);
  installed = true;
  listeningDoc = targetDoc;
}

/** 回傳目前記到的網址（複本，不清空）。 */
export function getFailedPreloads(): string[] {
  return failedUrls.slice();
}

/** 退回用：文件中所有 rel=modulepreload／preload／stylesheet 且通過 isRefreshableAssetUrl 的 link.href，去重。合格候選超過 MAX_ALL 就回空陣列（整批不刷新）。 */
export function allPreloadAssetUrls(doc?: Document): string[] {
  const targetDoc = doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!targetDoc) return [];
  const out: string[] = [];
  for (const link of targetDoc.querySelectorAll('link')) {
    if (!relAllowed(link.rel)) continue;
    const href = link.href;
    if (!href || out.includes(href) || !isRefreshableAssetUrl(href)) continue;
    out.push(href);
    if (out.length > MAX_ALL) return [];
  }
  return out;
}

export function _resetFailedPreloadsForTest(): void {
  failedUrls.length = 0;
  if (listeningDoc) {
    listeningDoc.removeEventListener('error', onResourceError, true);
    listeningDoc = null;
  }
  installed = false;
}
