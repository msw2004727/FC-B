// 外連共用同一個分頁（視窗名稱 toosterx_external）。
// 必須在點擊事件裡同步呼叫，不能先 await，否則瀏覽器會擋彈窗。

export const EXTERNAL_WINDOW_NAME = 'toosterx_external';

export interface ExternalLiffClient {
  isInClient: () => boolean;
  openWindow: (params: { url: string; external: boolean }) => void;
}

type LiffGetter = () => ExternalLiffClient | null;

let getLiff: LiffGetter = () => null;

/** LIFF 已初始化後由 liff-init 註冊。沒註冊或尚未完成時回 null，點擊路徑不 await。 */
export function setExternalLiffGetter(getter: LiffGetter): void {
  getLiff = getter;
}

export function _resetOpenExternalForTest(): void {
  getLiff = () => null;
}

function parseHttpUrl(value: string): string | null {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function addOpenExternalBrowser(href: string): string {
  const url = new URL(href);
  url.searchParams.set('openExternalBrowser', '1');
  return url.toString();
}

function lineUserAgent(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  return /\bLine\//i.test(ua);
}

function readLiff(): ExternalLiffClient | null {
  try {
    return getLiff();
  } catch {
    return null;
  }
}

function inMiniApp(liff: ExternalLiffClient): boolean {
  try {
    return liff.isInClient() === true;
  } catch {
    return false;
  }
}

/** 不帶 noopener 特性字串，具名視窗才能重用；開完立刻清 opener。 */
function openNamed(url: string): void {
  const opened = window.open(url, EXTERNAL_WINDOW_NAME);
  try {
    if (opened) opened.opener = null;
  } catch {
    // 跨來源時有些瀏覽器不允許寫 opener。開窗已經完成。
  }
}

/**
 * 只開 http(s)。其他協定什麼都不做。
 * Mini App（LIFF 已初始化且 isInClient）走 liff.openWindow external；丟錯則退回一般開法。
 * LINE 內建瀏覽器、或還不能判斷是不是 Mini App：網址加 openExternalBrowser=1 後開具名視窗。
 * 一般瀏覽器：同一個具名視窗。
 */
export function openExternal(url: string): void {
  const safe = parseHttpUrl(url);
  if (!safe) return;

  const liff = readLiff();
  if (liff && inMiniApp(liff)) {
    try {
      liff.openWindow({ url: safe, external: true });
      return;
    } catch {
      openNamed(safe);
      return;
    }
  }

  // 尚未初始化時無法呼叫 isInClient，走 LINE 內建瀏覽器這條，不在點擊時 await init。
  if (lineUserAgent()) {
    openNamed(addOpenExternalBrowser(safe));
    return;
  }
  openNamed(safe);
}

/** http(s) 錨點改走 openExternal；line: 等其他協定不攔，留給系統。 */
export function openHttpAnchor(event: { preventDefault: () => void }, href: string): void {
  if (!parseHttpUrl(href)) return;
  event.preventDefault();
  openExternal(href);
}
