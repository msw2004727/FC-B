// 前端錯誤最小上報（換站 J-03）。
//
// 沿用舊站 A 的 Firestore 集合 `errorLogs`（不改 Rules、不加集合）。
// 只在已登入時寫入；訪客不上報。Firestore SDK 在真的要寫的時候才動態載入，
// 避免首屏多載一套 SDK。
//
// 節流：同一 context|errorCode|errorMessage 這一頁只寫一次；
// 每裝置每小時最多 5 筆（localStorage `fcb:errlog-budget`）。
// 全程吞掉例外，寫入失敗只 console.warn，且不會再觸發自己。

import type { Firestore } from 'firebase/firestore';

import { isGestureForeground, RELOAD_AT_KEY, type DeferredChunkFailure } from './chunk-reload';
import { formatTaipei } from './taipei-time';
import { readAppVersion } from './app-meta';

const ERROR_LOGS = 'errorLogs';
const BUDGET_KEY = 'fcb:errlog-budget';
const HOUR_MS = 60 * 60 * 1000;
const HOUR_LIMIT = 5;
const STACK_LIMIT = 1500;
/** 與 auth.ts 等待 Auth 還原的上限相同：啟動錯誤常發生在 currentUser 還原之前。 */
const AUTH_READY_MS = 8000;

const seen = new Set<string>();
let installed = false;
let guard = 0;
let writing = 0;
let storageBroken = false;
/** 已決定要寫、但 localStorage 還沒加上的筆數。同步佔位，避免同一輪錯誤一起通過上限。 */
let reserved = 0;
/** 一筆寫完再寫下一筆，避免同時動態 import 卡住。 */
let chain: Promise<void> = Promise.resolve();

interface ParsedError {
  errorCode: string;
  errorMessage: string;
  errorStack: string;
}

interface SignedIn {
  uid: string;
  displayName: string | null;
  db: unknown;
}

interface AuthLike {
  currentUser: { uid: string; displayName?: string | null } | null;
  authStateReady?: () => Promise<void>;
}

function warnFailure(err: unknown): void {
  guard += 1;
  try {
    // eslint-disable-next-line no-console
    console.warn('[error-report] 寫入失敗', err);
  } catch {
    // 記錄失敗也不能再拋
  } finally {
    guard -= 1;
  }
}

function readCode(err: object): string {
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function parseError(err: unknown): ParsedError {
  let errorCode = '';
  let errorMessage = '';
  let errorStack = '';
  if (typeof err === 'string') {
    errorMessage = err;
  } else if (err instanceof Error) {
    errorCode = readCode(err);
    errorMessage = err.message;
    errorStack = typeof err.stack === 'string' ? err.stack : '';
  } else if (err && typeof err === 'object') {
    errorCode = readCode(err);
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') errorMessage = message;
    else {
      try {
        errorMessage = JSON.stringify(err);
      } catch {
        errorMessage = Object.prototype.toString.call(err);
      }
    }
    const stack = (err as { stack?: unknown }).stack;
    if (typeof stack === 'string') errorStack = stack;
  } else if (err != null) {
    errorMessage = String(err);
  }
  // iOS 內嵌 script 的 stack 會帶整個頁面網址（含 LINE 憑證）；非 Error 的 rejection 也可能夾帶。
  errorMessage = scrubSecrets(errorMessage);
  errorStack = scrubSecrets(errorStack);
  if (errorStack.length > STACK_LIMIT) errorStack = errorStack.slice(0, STACK_LIMIT);
  // 訊息也截斷：JSON.stringify 的錯誤物件可能很大（Firestore 文件上限 1MB），也避免夾帶過多內容（Opus 審 P2）
  if (errorMessage.length > STACK_LIMIT) errorMessage = errorMessage.slice(0, STACK_LIMIT);
  return { errorCode, errorMessage, errorStack };
}

/** A 會洗版、且沒有除錯價值的瀏覽器訊息。略過、不寫入。 */
function isNoise(message: string): boolean {
  return message === 'Script error.' || message.startsWith('ResizeObserver loop');
}

function readStamps(now: number): number[] {
  const raw = localStorage.getItem(BUDGET_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const cutoff = now - HOUR_MS;
  const stamps: number[] = [];
  for (const item of parsed) {
    if (typeof item === 'number' && Number.isFinite(item) && item > cutoff) stamps.push(item);
  }
  return stamps;
}

/** 預算讀寫失敗時視為不能再寫（無法計數就不能保證每小時 5 筆）。 */
function isBudgetClosed(now: number): boolean {
  if (storageBroken) return true;
  try {
    return readStamps(now).length + reserved >= HOUR_LIMIT;
  } catch {
    storageBroken = true;
    return true;
  }
}

function tryConsumeBudget(now: number): 'ok' | 'full' | 'broken' {
  if (storageBroken) return 'broken';
  try {
    const stamps = readStamps(now);
    if (stamps.length >= HOUR_LIMIT) return 'full';
    stamps.push(now);
    localStorage.setItem(BUDGET_KEY, JSON.stringify(stamps));
    return 'ok';
  } catch {
    storageBroken = true;
    return 'broken';
  }
}

/** LINE 開頁會把 access_token 等憑證放在網址片段／參數；只留鍵名，值一律遮掉。 */
const SECRET_PARAM_RE = /token|code|state|secret|challenge|client_id|password|key/i;

/** 文字裡任何 `?key=` `&key=` `#key=` `;key=`（或開頭、空白、引號後）且 key 像憑證的值都遮掉；JWT 形狀的字串也遮（errorMessage／errorStack 用）。 */
const SECRET_WORDS = 'token|code|state|secret|challenge|client_id|password|key';
const SECRET_IN_TEXT_RE = new RegExp(String.raw`((?:^|[?&#;\s'"(])[\w.%-]*(?:${SECRET_WORDS})=)[^&#;\s'"<>)]*`, 'gi');
/** 非 Error 的 rejection 經 JSON.stringify 後是 "access_token":"…"。 */
const SECRET_IN_JSON_RE = new RegExp(String.raw`("[\w.-]*(?:${SECRET_WORDS})"\s*:\s*")[^"]*`, 'gi');
const JWT_RE = /eyJ[\w-]{8,}\.[\w.-]+/g;

export function scrubSecrets(text: string): string {
  return text.replace(SECRET_IN_TEXT_RE, '$1***').replace(SECRET_IN_JSON_RE, '$1***').replace(JWT_RE, '***');
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function redactPairs(raw: string, mask: (key: string) => boolean): string {
  return raw.split(/([&;])/).map((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return pair;
    const key = pair.slice(0, eq);
    const value = safeDecode(pair.slice(eq + 1));
    // 值裡夾帶編碼過的網址（next=…%3Fcode%3D…）也算。
    return mask(safeDecode(key)) || scrubSecrets(value) !== value ? `${key}=***` : pair;
  }).join('');
}

/** B 不用片段路由：有 key=value 的片段全部遮值；沒有 = 的只留短錨點，其餘整段遮掉。 */
export function redactHash(hash: string): string {
  if (!hash.includes('=')) return /^#?[\w-]{0,40}$/.test(hash) ? hash : '#***';
  return '#' + redactPairs(hash.replace(/^#/, ''), () => true);
}

export function redactUrl(href: string): string {
  const hashAt = href.indexOf('#');
  const base = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : redactHash(href.slice(hashAt));
  const queryAt = base.indexOf('?');
  if (queryAt < 0) return base + hash;
  return base.slice(0, queryAt + 1)
    + redactPairs(base.slice(queryAt + 1), (key) => SECRET_PARAM_RE.test(key)) + hash;
}

function readLocation(): { page: string; url: string; hash: string } {
  try {
    return {
      page: location.pathname || '',
      url: scrubSecrets(redactUrl(location.href || '')),
      hash: scrubSecrets(redactHash(location.hash || '')),
    };
  } catch {
    return { page: '', url: '', hash: '' };
  }
}

const MODULE_LOAD_FAILURE_RE = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

const DIAG_ASSET_LIMIT = 8;
/** pagehide 之後才發生的錯誤多半是跳頁中斷，不是真的載入失敗。 */
let leaving = false;

function readSwState(): string {
  try {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    return navigator.serviceWorker?.controller ? 'controlled' : 'none';
  } catch {
    return 'error';
  }
}

function readSinceChunkReload(): number | null {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_AT_KEY) || 0);
    return at ? Date.now() - at : null;
  } catch {
    return null;
  }
}

/**
 * 程式檔載入失敗時的診斷（2026-11-08 iOS LINE 首頁大量載入失敗，原訊息不含檔名）。
 * iOS 沒有 responseStatus、失敗的檔常常不留 timing，所以不判斷哪個失敗，只列最後幾個同源 /assets 檔讓人對照。
 */
function readModuleLoadDiag(deferred?: DeferredChunkFailure): string {
  let assets: { f: string; b: number | null; ts: number | null; it: string }[] = [];
  let n = 0;
  try {
    const prefix = `${location.origin}/assets/`;
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const code = entries.filter((e) => e.name.startsWith(prefix) && /\.(?:js|css)(?:$|\?)/.test(e.name));
    n = code.length;
    assets = code
      .slice(-DIAG_ASSET_LIMIT)
      .map((e) => ({
        f: e.name.slice(prefix.length, prefix.length + 80),
        b: typeof e.decodedBodySize === 'number' ? e.decodedBodySize : null,
        ts: typeof e.transferSize === 'number' ? e.transferSize : null,
        it: e.initiatorType || '',
      }));
  } catch {
    // 沒有 Resource Timing：其餘欄位照寫
  }
  try {
    return JSON.stringify({
      sw: readSwState(),
      rs: document.readyState,
      vis: document.visibilityState,
      leaving,
      t: Math.round(performance.now()),
      rl: readSinceChunkReload(),
      n,
      assets,
      // 背景中延後的失敗（context chunk-deferred）：延後當下的 vis／leaving 與延後到回前景的毫秒數。
      ...(deferred ? { dvis: deferred.vis, dleaving: deferred.leaving, dwait: deferred.waitMs } : {}),
    });
  } catch {
    return '';
  }
}

function isBackground(): boolean {
  // 使用者按過重試（手勢）：一律視為前景，iOS 可能不送 visible、visibilityState 卡在 hidden（Opus 終審 P2-2）。
  if (isGestureForeground()) return false;
  if (leaving) return true;
  try {
    return document.visibilityState === 'hidden';
  } catch {
    return false;
  }
}

function readUserAgent(): string {
  try {
    return navigator.userAgent || '';
  } catch {
    return '';
  }
}

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('auth-ready-timeout')), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function readSignedIn(): Promise<SignedIn | null> {
  const { getFirebase } = await import('@/data/firebase');
  const ctx = await getFirebase();
  const auth = ctx.auth as AuthLike;
  if (typeof auth.authStateReady === 'function') {
    try {
      await withTimeout(auth.authStateReady(), AUTH_READY_MS);
    } catch {
      // 還原逾時或失敗：下面改看當下的 currentUser（通常是 null，就不上報）。
    }
  }
  const user = auth.currentUser;
  if (!user?.uid) return null;
  const displayName = user.displayName ? user.displayName : null;
  return { uid: user.uid, displayName, db: ctx.db };
}

async function persist(context: string, parsed: ParsedError, key: string, diag: string): Promise<void> {
  try {
    const session = await readSignedIn();
    if (!session) return;
    const now = Date.now();
    const slot = tryConsumeBudget(now);
    if (slot === 'full') {
      // 這一小時已滿，沒寫成。放開去重，下個小時同一則還能寫。
      seen.delete(key);
      return;
    }
    if (slot !== 'ok') return;
    const where = readLocation();
    const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
    const payload = {
      time: formatTaipei(now),
      clientTimeIso: new Date(now).toISOString(),
      uid: session.uid,
      userName: session.displayName || session.uid,
      // B 的角色在 viewer hook／非同步快取裡，沒有可同步讀的現成值。
      role: '',
      context,
      errorCode: parsed.errorCode,
      errorMessage: parsed.errorMessage,
      errorStack: parsed.errorStack,
      errorCategory: '',
      severityHint: '',
      noise: false,
      page: where.page,
      appVersion: readAppVersion(),
      url: where.url,
      hash: where.hash,
      userAgent: readUserAgent(),
      ...(diag ? { diag } : {}),
      createdAt: serverTimestamp(),
      source: 'fcb' as const,
    };
    writing += 1;
    try {
      await addDoc(collection(session.db as Firestore, ERROR_LOGS), payload);
    } finally {
      writing -= 1;
    }
  } catch (err) {
    warnFailure(err);
  }
}

function enqueue(context: string, err: unknown, deferred?: DeferredChunkFailure): void {
  const parsed = parseError(err);
  if (isNoise(parsed.errorMessage)) return;
  // DIAG-IOS-IMPORT 修法 B：背景中（vis=hidden 或 pagehide 之後）的程式檔載入失敗是切背景中斷的雜訊，不寫、也不記去重；
  // 回前景後再失敗照常上報；回前景後停在重試畫面的，由 chunk-reload 補送 chunk-deferred 一筆（不受這裡略過）。
  if (!deferred && MODULE_LOAD_FAILURE_RE.test(parsed.errorMessage) && isBackground()) return;
  const key = `${context}|${parsed.errorCode}|${parsed.errorMessage}`;
  if (seen.has(key)) return;
  if (isBudgetClosed(Date.now())) return;
  seen.add(key);
  reserved += 1;
  // 出錯當下就讀：persist 前要等登入還原（最多 8 秒），那時頁面狀態已經變了。
  const diag = deferred || MODULE_LOAD_FAILURE_RE.test(parsed.errorMessage) ? readModuleLoadDiag(deferred) : '';
  const run = chain.then(() => persist(context, parsed, key, diag));
  chain = run.then(() => undefined, () => undefined);
  void run.finally(() => {
    reserved = Math.max(0, reserved - 1);
  });
}

export function installErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
  } catch (err) {
    installed = false;
    warnFailure(err);
  }
}

function onPageHide(): void {
  leaving = true;
}

/** 從 bfcache 還原時重設。 */
function onPageShow(): void {
  leaving = false;
}

function onWindowError(event: Event): void {
  try {
    if (guard > 0) return;
    if (!(event instanceof ErrorEvent)) return;
    reportClientError('error', event.error ?? event.message);
  } catch {
    // 上報器本身不得拋出
  }
}

function onUnhandledRejection(event: Event): void {
  try {
    if (guard > 0) return;
    const reason = 'reason' in event ? (event as PromiseRejectionEvent).reason : undefined;
    reportClientError('unhandledrejection', reason);
  } catch {
    // 上報器本身不得拋出
  }
}

/** 給啟動失敗與錯誤邊界呼叫。未登入、雜訊、重複、超過每小時上限時不寫。絕不拋錯。 */
export function reportClientError(context: string, err: unknown): void {
  if (guard > 0 || writing > 0) return;
  guard += 1;
  try {
    enqueue(context, err);
  } catch (failure) {
    warnFailure(failure);
  } finally {
    guard -= 1;
  }
}

export const CHUNK_DEFERRED_CONTEXT = 'chunk-deferred';

/**
 * 背景中延後的程式檔載入失敗，回前景處理時沒有重載（畫面停在重試）時由 chunk-reload 呼叫，補送一筆（Opus 終審 P2-1）。
 * context 用 chunk-deferred，和 render／unhandledrejection 分開去重；呼叫時已在前景，不受背景略過。
 */
export function reportDeferredChunkFailure(failure: DeferredChunkFailure): void {
  if (guard > 0) return;
  guard += 1;
  try {
    enqueue(CHUNK_DEFERRED_CONTEXT, failure.error, failure);
  } catch (err) {
    warnFailure(err);
  } finally {
    guard -= 1;
  }
}

/** 測試用：清掉這一頁的去重、預算記憶與全域監聽。 */
export function _resetErrorReporterForTest(): void {
  seen.clear();
  storageBroken = false;
  reserved = 0;
  writing = 0;
  guard = 0;
  chain = Promise.resolve();
  leaving = false;
  if (installed && typeof window !== 'undefined') {
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  }
  installed = false;
}
