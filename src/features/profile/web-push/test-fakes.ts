// 測試與截圖台共用的假瀏覽器推播物件（不進產品分塊：只有 *.test.* 與 dev-harness 會 import）。
import { WEB_PUSH_VAPID_PUBLIC_KEY } from './config';
import { base64UrlToBytes, type PermissionValue, type PushRegLike, type PushSubLike, type WebPushDeps } from './flows';

export interface FakeSub extends PushSubLike {
  unsubscribed: boolean;
}

export function fakeSub(endpoint: string, key: Uint8Array | null = base64UrlToBytes(WEB_PUSH_VAPID_PUBLIC_KEY)): FakeSub {
  const sub: FakeSub = {
    endpoint,
    options: key ? { applicationServerKey: key.buffer.slice(0) as ArrayBuffer } : null,
    unsubscribed: false,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256-' + endpoint.length, auth: 'auth-x' } }),
    unsubscribe: async () => {
      sub.unsubscribed = true;
      return true;
    },
  };
  return sub;
}

export interface FakeWorld {
  deps: WebPushDeps;
  calls: string[];
  state: {
    permission: PermissionValue;
    /** requestPermission 的結果。 */
    answer: PermissionValue;
    sub: FakeSub | null;
    hasRegistration: boolean;
    active: boolean;
    uid: string | null | undefined;
    now: number;
    nextEndpoint: number;
    subscribeError: Error | null;
    registerError: unknown;
    unregisterError: unknown;
  };
}

export function fakeWorld(overrides: Partial<FakeWorld['state']> = {}): FakeWorld {
  const calls: string[] = [];
  const state: FakeWorld['state'] = {
    permission: 'default',
    answer: 'granted',
    sub: null,
    hasRegistration: true,
    active: true,
    uid: 'u1',
    now: 1_800_000_000_000,
    nextEndpoint: 1,
    subscribeError: null,
    registerError: null,
    unregisterError: null,
    ...overrides,
  };
  const reg = (): PushRegLike => ({
    active: state.active ? {} : null,
    pushManager: {
      getSubscription: async () => {
        calls.push('getSubscription');
        return state.sub && !state.sub.unsubscribed ? state.sub : null;
      },
      subscribe: async () => {
        calls.push('subscribe');
        if (state.subscribeError) throw state.subscribeError;
        const sub = fakeSub(`https://fcm.googleapis.com/fcm/send/e${state.nextEndpoint++}`);
        const unsub = sub.unsubscribe;
        sub.unsubscribe = async () => {
          calls.push('unsubscribe');
          return unsub();
        };
        state.sub = sub;
        return sub;
      },
    },
  });
  const deps: WebPushDeps = {
    permission: () => state.permission,
    requestPermission: async () => {
      calls.push('requestPermission');
      state.permission = state.answer;
      return state.answer;
    },
    getRegistration: async () => (state.hasRegistration ? reg() : undefined),
    ready: async () => {
      calls.push('ready');
      return { ...reg(), active: {} };
    },
    register: async (req) => {
      calls.push('register');
      if (state.registerError) throw state.registerError;
      void req;
    },
    unregister: async () => {
      calls.push('unregister');
      if (state.unregisterError) throw state.unregisterError;
    },
    currentUid: () => state.uid,
    platform: () => 'desktop',
    now: () => state.now,
  };
  return { deps, calls, state };
}

/** 讓現有訂閱的 unsubscribe 也記錄到 calls。 */
export function trackedSub(world: FakeWorld, endpoint: string, key?: Uint8Array | null): FakeSub {
  const sub = fakeSub(endpoint, key === undefined ? base64UrlToBytes(WEB_PUSH_VAPID_PUBLIC_KEY) : key);
  const unsub = sub.unsubscribe;
  sub.unsubscribe = async () => {
    world.calls.push('unsubscribe');
    return unsub();
  };
  world.state.sub = sub;
  return sub;
}
