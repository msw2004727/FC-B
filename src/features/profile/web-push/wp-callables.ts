// 推播訂閱的兩支 Callable（registerWebPushSubscription、unregisterWebPushSubscription，asia-east1）。
// 照 `src/features/competitions/data/cp-callables.ts` 的先例自建有型別的呼叫函式，不登錄進 CALLABLES
// （登錄會把執行期物件放進首頁主程式，顧問 §3.699 Q4）。
// - 請求只組白名單鍵：register＝endpoint、keys.p256dh、keys.auth、vapidKeyId、platform；unregister＝endpoint。
// - 錯誤一律轉成 WebPushCallError { code }；不記錄 endpoint、金鑰、uid。
// - mock：VITE_CALLABLE_MODE=mock 時走 registerWebPushMock，不連 Functions。
// - 模擬器模式：沿用 getFirebase() 的 functions 實例（firebase.ts 已接上本機 Functions emulator）。

import { getFirebase } from '@/data/firebase';
import { WEB_PUSH_CALL_TIMEOUT_MS } from './config';

export type WebPushPlatform = 'android' | 'desktop' | 'ios_pwa' | 'other';

export interface RegisterWebPushRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  vapidKeyId: string;
  platform: WebPushPlatform;
}

export interface UnregisterWebPushRequest {
  endpoint: string;
}

export type WebPushCallableName = 'registerWebPushSubscription' | 'unregisterWebPushSubscription';

export type WebPushErrorCode =
  | 'failed-precondition'
  | 'resource-exhausted'
  | 'invalid-argument'
  | 'unauthenticated'
  | 'internal'
  | 'timeout';

const KNOWN_CODES: readonly WebPushErrorCode[] = [
  'failed-precondition',
  'resource-exhausted',
  'invalid-argument',
  'unauthenticated',
  'internal',
  'timeout',
];

export class WebPushCallError extends Error {
  readonly code: WebPushErrorCode;

  constructor(code: WebPushErrorCode) {
    super(code);
    this.name = 'WebPushCallError';
    this.code = code;
  }
}

/** Firebase 錯誤碼（functions/xxx 或 xxx）轉成本模組的錯誤碼；逾時歸 timeout，其餘不認得的歸 internal。 */
export function toWebPushCallError(err: unknown): WebPushCallError {
  if (err instanceof WebPushCallError) return err;
  const raw = err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
    ? (err as { code: string }).code.replace(/^functions\//, '')
    : '';
  if (raw === 'deadline-exceeded') return new WebPushCallError('timeout');
  const hit = KNOWN_CODES.find((c) => c === raw);
  return new WebPushCallError(hit ?? 'internal');
}

export type WebPushMockHandler = (data: Record<string, unknown>) => unknown | Promise<unknown>;

const mocks = new Map<WebPushCallableName, WebPushMockHandler>();

export function registerWebPushMock(name: WebPushCallableName, handler: WebPushMockHandler): void {
  mocks.set(name, handler);
}

export function clearWebPushMocks(): void {
  mocks.clear();
}

function isMockMode(): boolean {
  return import.meta.env.VITE_CALLABLE_MODE === 'mock';
}

async function liveTransport(name: WebPushCallableName, data: Record<string, unknown>): Promise<unknown> {
  const [{ httpsCallable }, ctx] = await Promise.all([import('firebase/functions'), getFirebase()]);
  const callable = httpsCallable(ctx.functions, name, { timeout: WEB_PUSH_CALL_TIMEOUT_MS });
  const result = await callable(data);
  return result.data;
}

async function mockTransport(name: WebPushCallableName, data: Record<string, unknown>): Promise<unknown> {
  const handler = mocks.get(name);
  if (!handler) throw new WebPushCallError('internal');
  return handler(data);
}

async function call(name: WebPushCallableName, data: Record<string, unknown>): Promise<void> {
  const transport = isMockMode() ? mockTransport : liveTransport;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WebPushCallError('timeout')), WEB_PUSH_CALL_TIMEOUT_MS);
  });
  try {
    await Promise.race([transport(name, data), timeout]);
  } catch (err) {
    throw toWebPushCallError(err);
  } finally {
    clearTimeout(timer);
  }
}

export function registerWebPushSubscription(req: RegisterWebPushRequest): Promise<void> {
  return call('registerWebPushSubscription', {
    endpoint: req.endpoint,
    keys: { p256dh: req.keys.p256dh, auth: req.keys.auth },
    vapidKeyId: req.vapidKeyId,
    platform: req.platform,
  });
}

export function unregisterWebPushSubscription(req: UnregisterWebPushRequest): Promise<void> {
  return call('unregisterWebPushSubscription', { endpoint: req.endpoint });
}
