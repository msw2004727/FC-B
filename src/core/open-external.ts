// 外連共用同一個分頁（視窗名稱 toosterx_external）。
// 必須在點擊事件裡同步呼叫，不能先 await，否則瀏覽器會擋彈窗。

import { isLikelyMiniAppUserAgent } from '@/data/login-redirect';

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

function assignLocation(url: string): void {
  window.location.assign(url);
}

/** jsdom 的 location.assign 不可覆寫。測試換成這個；正式路徑仍是 window.location.assign。 */
let assignImpl: (url: string) => void = assignLocation;

export function _setLocationAssignForTest(fn: ((url: string) => void) | null): void {
  assignImpl = fn ?? assignLocation;
}

export function _resetOpenExternalForTest(): void {
  getLiff = () => null;
  assignImpl = assignLocation;
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/** line.me、*.line.me（含 liff.line.me、miniapp.line.me）、lin.ee。 */
function isLineOwnedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'line.me' || host.endsWith('.line.me') || host === 'lin.ee';
}

/**
 * 在 hash 前接上 openExternalBrowser=1。
 * 不用 URLSearchParams：那會把 %20 編成 +、把 ?a 編成 ?a=。
 */
function addOpenExternalBrowser(href: string): string {
  const hashAt = href.indexOf('#');
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  const joiner = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${joiner}openExternalBrowser=1${hash}`;
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

/** 已處理、非左鍵、或修飾鍵：留給瀏覽器（另開分頁、選取文字）。 */
export function shouldLeaveAnchorClick(event: {
  defaultPrevented?: boolean;
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): boolean {
  return Boolean(
    event.defaultPrevented
    || event.button !== 0
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || event.altKey,
  );
}

/**
 * 只開 http(s)。其他協定什麼都不做。
 * LINE 自家網址留在 LINE：同分頁 assign，不加 openExternalBrowser、不呼叫 openWindow external。
 * 與目前頁面同源：站內頁，同分頁 assign，不當外連。
 * Mini App（LIFF 已初始化且 isInClient）走 liff.openWindow external；丟錯則退回一般開法。
 * LINE 內建瀏覽器、或還不能判斷是不是 Mini App：網址加 openExternalBrowser=1 後開具名視窗。
 * 一般瀏覽器：同一個具名視窗。
 */
export function openExternal(url: string): void {
  const raw = String(url ?? '').trim();
  const parsed = httpUrl(raw);
  if (!parsed) return;

  if (isLineOwnedHost(parsed.hostname) || parsed.origin === location.origin) {
    assignImpl(raw);
    return;
  }

  const safe = parsed.href;
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
    openNamed(addOpenExternalBrowser(raw));
    return;
  }
  openNamed(safe);
}

/** http(s) 錨點改走 openExternal；line:、LINE 自家網址、同源連結不攔。修飾鍵與非左鍵保留瀏覽器另開。 */
export function openHttpAnchor(
  event: {
    preventDefault: () => void;
    defaultPrevented?: boolean;
    button?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  },
  href: string,
): void {
  if (shouldLeaveAnchorClick(event)) return;
  const parsed = httpUrl(href);
  if (!parsed) return;
  if (isLineOwnedHost(parsed.hostname) || parsed.origin === location.origin) return;
  event.preventDefault();
  openExternal(href);
}

function staticPageInNewTab(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  if (isLikelyMiniAppUserAgent(ua)) return true;
  try {
    if (
      typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    if (nav.standalone === true) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * 說明書、角色說明、隱私、條款。
 * Mini App 或 PWA 全螢幕沒有站內返回，維持另開；其他環境整頁過去。
 */
export function openStaticPage(path: string): void {
  if (staticPageInNewTab()) {
    window.open(path, '_blank', 'noopener,noreferrer');
    return;
  }
  assignImpl(path);
}
