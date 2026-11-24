// 推播開關的流程（設計書 §5）：開啟、關閉、開機靜默同步、換帳號清理、登出前解除。
// - 同時只跑一個流程（模組層互斥）；開機同步遇到使用者操作就讓路，連按兩次只跑一次。
// - 所有瀏覽器 API 與 Callable 由 deps 注入，測試用假物件。
// - 流程開始時記下 uid，Callable 前後比對目前登入者，變了就作廢（L-43）。
// - 只在本機判斷，0 次 Firestore 讀取；log 只記步驟與錯誤碼，不記 endpoint、金鑰、uid。

import { getLastKnownAuthUid } from '@/data/auth';
import { isIosStandalone } from '@/data/login-redirect';
import {
  WEB_PUSH_READY_TIMEOUT_MS,
  WEB_PUSH_REPORT_INTERVAL_MS,
  WEB_PUSH_RETRY_BACKOFF_MS,
  WEB_PUSH_VAPID_KEY_ID,
  WEB_PUSH_VAPID_PUBLIC_KEY,
} from './config';
import {
  clearWebPushRecord,
  hash32,
  readWebPushRecord,
  writeWebPushRecord,
  type WebPushRecord,
} from './store';
import {
  registerWebPushSubscription,
  toWebPushCallError,
  unregisterWebPushSubscription,
  type RegisterWebPushRequest,
  type UnregisterWebPushRequest,
  type WebPushPlatform,
} from './wp-callables';

export interface PushSubLike {
  readonly endpoint: string;
  readonly options?: { readonly applicationServerKey?: ArrayBuffer | null } | null;
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

export interface PushRegLike {
  readonly active?: unknown;
  readonly pushManager: {
    getSubscription(): Promise<PushSubLike | null>;
    subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<PushSubLike>;
  };
}

export type PermissionValue = 'default' | 'granted' | 'denied';

export interface WebPushDeps {
  permission(): PermissionValue;
  requestPermission(): Promise<PermissionValue>;
  getRegistration(): Promise<PushRegLike | undefined>;
  ready(): Promise<PushRegLike>;
  register(req: RegisterWebPushRequest): Promise<void>;
  unregister(req: UnregisterWebPushRequest): Promise<void>;
  /** 目前登入者；undefined＝尚未確定。 */
  currentUid(): string | null | undefined;
  platform(): WebPushPlatform;
  now(): number;
}

/** 推播平台：iOS 主畫面＝ios_pwa、UA 含 Android＝android、其他非行動裝置＝desktop、其餘 other。 */
export function webPushPlatformOf(ua: string, standalone: boolean, maxTouchPoints: number): WebPushPlatform {
  const ios = isIosStandalone(ua, true, maxTouchPoints);
  if (ios && standalone) return 'ios_pwa';
  if (/Android/i.test(ua)) return 'android';
  if (!ios && !/Mobi/i.test(ua)) return 'desktop';
  return 'other';
}

function browserPlatform(): WebPushPlatform {
  const nav = navigator as Navigator & { standalone?: boolean };
  let standalone = nav.standalone === true;
  try {
    if (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) standalone = true;
  } catch {
    /* 讀不到就當不是主畫面 */
  }
  return webPushPlatformOf(nav.userAgent || '', standalone, nav.maxTouchPoints ?? 0);
}

export function browserWebPushDeps(): WebPushDeps {
  return {
    permission: () => (typeof Notification === 'undefined' ? 'default' : Notification.permission),
    requestPermission: () => Notification.requestPermission(),
    getRegistration: () => navigator.serviceWorker.getRegistration('/') as Promise<PushRegLike | undefined>,
    ready: () => navigator.serviceWorker.ready as unknown as Promise<PushRegLike>,
    register: registerWebPushSubscription,
    unregister: unregisterWebPushSubscription,
    currentUid: getLastKnownAuthUid,
    platform: browserPlatform,
    now: () => Date.now(),
  };
}

let depsOverride: WebPushDeps | null = null;

/** 測試與截圖台用：換掉瀏覽器 API。傳 null 恢復。 */
export function _setWebPushDepsForTest(deps: WebPushDeps | null): void {
  depsOverride = deps;
}

export function webPushDeps(): WebPushDeps {
  return depsOverride ?? browserWebPushDeps();
}

function logStep(step: string, err: unknown): void {
  console.warn('[webpush]', step, toWebPushCallError(err).code);
}

// ── 互斥 ─────────────────────────────────────────────

type Owner = 'user' | 'boot';
let running: { owner: Owner; done: Promise<void> } | null = null;
let bootYield = false;

const YIELD = Symbol('yield');
const STALE = Symbol('stale');

function checkpoint(): void {
  if (bootYield) throw YIELD;
}

async function withLock<T>(owner: Owner, body: () => Promise<T>): Promise<T | 'busy'> {
  while (running) {
    if (owner === 'boot' || running.owner === 'user') return 'busy';
    // 開機同步進行中：請它讓路，等它停下來。
    bootYield = true;
    await running.done;
  }
  let release!: () => void;
  running = { owner, done: new Promise<void>((resolve) => { release = resolve; }) };
  if (owner === 'boot') bootYield = false;
  try {
    return await body();
  } finally {
    if (owner === 'boot') bootYield = false;
    running = null;
    release();
  }
}

/** 測試用：清掉互斥狀態。 */
export function _resetWebPushFlowsForTest(): void {
  running = null;
  bootYield = false;
}

// ── 工具 ─────────────────────────────────────────────

export function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** 訂閱的公鑰是否等於目前設定。舊瀏覽器沒有 options 時改看紀錄 keyId；兩者都沒有就當不同。 */
export function subscriptionKeyMatches(sub: PushSubLike, record: WebPushRecord | null): boolean {
  const key = sub.options?.applicationServerKey;
  if (key) return sameBytes(new Uint8Array(key), base64UrlToBytes(WEB_PUSH_VAPID_PUBLIC_KEY));
  return !!record && record.keyId === WEB_PUSH_VAPID_KEY_ID;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** 取 SW 註冊；有註冊但還沒 active 時等 ready（5 秒上限）。沒有註冊回 null，不自行註冊。 */
async function activeRegistration(deps: WebPushDeps): Promise<PushRegLike | null> {
  const reg = await deps.getRegistration();
  if (!reg) return null;
  if (reg.active) return reg;
  return withTimeout(deps.ready(), WEB_PUSH_READY_TIMEOUT_MS);
}

function subscribeNew(reg: PushRegLike): Promise<PushSubLike> {
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(WEB_PUSH_VAPID_PUBLIC_KEY),
  });
}

function registerRequest(sub: PushSubLike, deps: WebPushDeps): RegisterWebPushRequest {
  const keys = sub.toJSON().keys ?? {};
  const p256dh = keys.p256dh;
  const auth = keys.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') throw new Error('no-keys');
  return {
    endpoint: sub.endpoint,
    keys: { p256dh, auth },
    vapidKeyId: WEB_PUSH_VAPID_KEY_ID,
    platform: deps.platform(),
  };
}

async function newRecord(uid: string, sub: PushSubLike, deps: WebPushDeps): Promise<WebPushRecord> {
  return {
    v: 1,
    uidHash: await hash32(uid),
    endpointHash: await hash32(sub.endpoint),
    keyId: WEB_PUSH_VAPID_KEY_ID,
    reportedAt: deps.now(),
  };
}

function uidChanged(uid: string, deps: WebPushDeps): boolean {
  const current = deps.currentUid();
  return current !== undefined && current !== uid;
}

// ── 畫面狀態（只在本機查） ───────────────────────────

export type WebPushLocalState = 'hidden' | 'blocked' | 'off' | 'on' | 'needs-sync';

export async function readWebPushLocalState(uid: string, deps: WebPushDeps = webPushDeps()): Promise<WebPushLocalState> {
  const reg = await deps.getRegistration();
  if (!reg) return 'hidden';
  const permission = deps.permission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  const record = readWebPushRecord();
  if (!record || record.uidHash !== await hash32(uid)) return 'off';
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return 'needs-sync';
  if (!subscriptionKeyMatches(sub, record) || record.keyId !== WEB_PUSH_VAPID_KEY_ID) return 'needs-sync';
  if (record.endpointHash !== await hash32(sub.endpoint)) return 'needs-sync';
  if (deps.now() - record.reportedAt >= WEB_PUSH_REPORT_INTERVAL_MS) return 'needs-sync';
  return 'on';
}

// ── 開啟（§5.1） ────────────────────────────────────

export type EnableResult = 'on' | 'blocked' | 'dismissed' | 'failed' | 'stale' | 'busy';

/**
 * 只在使用者按下開關時呼叫，而且要在 onChange 處理函式內、任何 await 之前同步呼叫：
 * 權限是 default 時，本函式在回傳前就同步呼叫 requestPermission（iPhone Safari 與 Chrome 都要求在手勢當下詢問）。
 */
export function enableWebPush(uid: string, deps: WebPushDeps = webPushDeps()): Promise<EnableResult> {
  if (running?.owner === 'user') return Promise.resolve('busy');
  let permission: Promise<PermissionValue>;
  try {
    const now = deps.permission();
    permission = now === 'default' ? deps.requestPermission() : Promise.resolve(now);
  } catch (err) {
    permission = Promise.reject(err);
  }
  return withLock('user', () => runEnable(uid, permission, deps));
}

async function runEnable(uid: string, permissionPromise: Promise<PermissionValue>, deps: WebPushDeps): Promise<EnableResult> {
  let permission: PermissionValue;
  try {
    permission = await permissionPromise;
  } catch (err) {
    logStep('permission', err);
    return 'failed';
  }
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'dismissed';

  let created: PushSubLike | null = null;
  try {
    if (uidChanged(uid, deps)) throw STALE;
    const reg = await activeRegistration(deps);
    if (!reg) throw new Error('no-registration');
    let sub = await reg.pushManager.getSubscription();
    if (sub && !subscriptionKeyMatches(sub, readWebPushRecord())) {
      // 公鑰不同：先解除舊的（失敗不擋）→ 退訂 → 新訂閱。
      try {
        await deps.unregister({ endpoint: sub.endpoint });
      } catch (err) {
        logStep('unregister-old', err);
      }
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) {
      sub = await subscribeNew(reg);
      created = sub;
    }
    if (uidChanged(uid, deps)) throw STALE;
    await deps.register(registerRequest(sub, deps));
    if (uidChanged(uid, deps)) throw STALE;
    writeWebPushRecord(await newRecord(uid, sub, deps));
    return 'on';
  } catch (err) {
    // 這次新建的訂閱收回，避免瀏覽器有訂閱而伺服器沒有。
    if (created) {
      try {
        await created.unsubscribe();
      } catch (e) {
        logStep('rollback', e);
      }
    }
    if (err === STALE) return 'stale';
    logStep('enable', err);
    return 'failed';
  }
}

// ── 關閉（§5.2）：先解除 Callable，再 unsubscribe ───

export type DisableResult = 'off' | 'busy';

export function disableWebPush(deps: WebPushDeps = webPushDeps()): Promise<DisableResult> {
  if (running?.owner === 'user') return Promise.resolve('busy');
  return withLock('user', async () => {
    await releaseSubscription(deps, true);
    clearWebPushRecord();
    return 'off' as const;
  });
}

/** 解除（可選）→ 退訂；每一步失敗只記錄、不擋。 */
async function releaseSubscription(deps: WebPushDeps, callUnregister: boolean): Promise<void> {
  let sub: PushSubLike | null = null;
  try {
    const reg = await deps.getRegistration();
    sub = reg ? await reg.pushManager.getSubscription() : null;
  } catch (err) {
    logStep('get-subscription', err);
  }
  if (!sub) return;
  if (callUnregister) {
    try {
      await deps.unregister({ endpoint: sub.endpoint });
    } catch (err) {
      logStep('unregister', err);
    }
  }
  try {
    await sub.unsubscribe();
  } catch (err) {
    logStep('unsubscribe', err);
  }
}

// ── 登出前（§5.3，顧問 §3.699 Q3 (B)） ──────────────

/**
 * 有本機紀錄且屬於目前登入者 → 先記下 endpoint，本機退訂與解除 Callable 並行跑 → 退訂完就刪紀錄。
 * 呼叫端有時間上限（右上角登出 2 秒）：Callable 卡住時本機退訂仍已完成，共用裝置登出後馬上關瀏覽器也不會再收到前一位的通知
 * （審查 P2-1；取代原「先解除再退訂」，那個順序在逾時時退訂還沒輪到）。開關頁的「關閉」維持先解除再退訂。
 */
export async function releaseBeforeSignOut(deps: WebPushDeps = webPushDeps()): Promise<void> {
  const record = readWebPushRecord();
  if (!record) return;
  const uid = deps.currentUid();
  if (!uid || record.uidHash !== await hash32(uid)) return;
  let sub: PushSubLike | null = null;
  try {
    const reg = await deps.getRegistration();
    sub = reg ? await reg.pushManager.getSubscription() : null;
  } catch (err) {
    logStep('get-subscription', err);
  }
  if (!sub) {
    clearWebPushRecord();
    return;
  }
  const endpoint = sub.endpoint;
  const unregister = deps.unregister({ endpoint }).catch((err: unknown) => logStep('unregister', err));
  const unsubscribe = sub.unsubscribe()
    .catch((err: unknown) => logStep('unsubscribe', err))
    .then(() => clearWebPushRecord());
  await Promise.all([unregister, unsubscribe]);
}

/** 目前沒有流程在跑時 resolve（開機同步回 busy 後，等使用者流程結束再補跑）。 */
export function whenWebPushIdle(): Promise<void> {
  return running ? running.done : Promise.resolve();
}

// ── 換帳號與共用裝置（§5.6） ────────────────────────

/** 紀錄不屬於 uid（含沒人登入）→ 退訂、刪紀錄；不替新登入者註冊，也不呼叫解除（沒有前一位的登入身分）。 */
export async function dropForeignSubscription(uid: string | null, deps: WebPushDeps = webPushDeps()): Promise<boolean> {
  const record = readWebPushRecord();
  if (!record) return false;
  if (uid && record.uidHash === await hash32(uid)) return false;
  await releaseSubscription(deps, false);
  clearWebPushRecord();
  return true;
}

// ── 開機靜默同步（§5.4、§5.5、§5.7） ────────────────

export type BootSyncResult = 'noop' | 'dropped' | 'cleared' | 'reported' | 'failed' | 'busy' | 'yield' | 'stale';

export function syncWebPushOnBoot(uid: string | null, deps: WebPushDeps = webPushDeps()): Promise<BootSyncResult> {
  return withLock('boot', () => runBootSync(uid, deps));
}

async function runBootSync(uid: string | null, deps: WebPushDeps): Promise<BootSyncResult> {
  const record = readWebPushRecord();
  if (!record) return 'noop';
  if (!uid || record.uidHash !== await hash32(uid)) {
    await dropForeignSubscription(uid, deps);
    return 'dropped';
  }
  const now = deps.now();
  if (record.failAt !== undefined && now - record.failAt < WEB_PUSH_RETRY_BACKOFF_MS) return 'noop';
  if (record.rejectedKeyId === WEB_PUSH_VAPID_KEY_ID) return 'noop';

  let reg: PushRegLike | null;
  let sub: PushSubLike | null;
  try {
    checkpoint();
    reg = await activeRegistration(deps);
    if (!reg) return 'noop';
    sub = await reg.pushManager.getSubscription();
  } catch (err) {
    if (err === YIELD) return 'yield';
    logStep('boot-read', err);
    writeWebPushRecord({ ...record, failAt: now });
    return 'failed';
  }

  // 使用者在瀏覽器撤銷權限：有訂閱就先解除再退訂，刪紀錄。
  if (deps.permission() !== 'granted') {
    if (sub) await releaseSubscription(deps, true);
    clearWebPushRecord();
    return 'cleared';
  }

  let unsubscribed = false;
  try {
    checkpoint();
    if (!sub) {
      // 瀏覽器訂閱不見了（救援開關、清資料）：不在手勢內重新訂閱；被拒（例如 iPhone）就刪紀錄，畫面回到可開啟。
      try {
        sub = await subscribeNew(reg);
      } catch (err) {
        logStep('boot-subscribe', err);
        clearWebPushRecord();
        return 'cleared';
      }
    } else if (!subscriptionKeyMatches(sub, record) || record.keyId !== WEB_PUSH_VAPID_KEY_ID) {
      // 公鑰換版（§5.5）：解除舊的 → 退訂 → 新公鑰訂閱 → 回報。
      await deps.unregister({ endpoint: sub.endpoint });
      checkpoint();
      await sub.unsubscribe();
      unsubscribed = true;
      sub = await subscribeNew(reg);
      unsubscribed = false;
    } else if (record.endpointHash === await hash32(sub.endpoint) && now - record.reportedAt < WEB_PUSH_REPORT_INTERVAL_MS) {
      return 'noop';
    }
    checkpoint();
    if (uidChanged(uid, deps)) return 'stale';
    await deps.register(registerRequest(sub, deps));
    if (uidChanged(uid, deps)) return 'stale';
    writeWebPushRecord(await newRecord(uid, sub, deps));
    return 'reported';
  } catch (err) {
    if (err === YIELD) return 'yield';
    if (unsubscribed) {
      // 已退訂但沒訂到新的：刪紀錄（畫面回到可開啟）。
      clearWebPushRecord();
      return 'failed';
    }
    const code = toWebPushCallError(err).code;
    logStep('boot-sync', err);
    if (code === 'unauthenticated') return 'failed';
    if (code === 'invalid-argument') {
      await releaseSubscription(deps, false);
      clearWebPushRecord();
      return 'failed';
    }
    if (code === 'failed-precondition') {
      writeWebPushRecord({ ...record, rejectedKeyId: WEB_PUSH_VAPID_KEY_ID });
      return 'failed';
    }
    writeWebPushRecord({ ...record, failAt: now });
    return 'failed';
  }
}
