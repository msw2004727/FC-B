import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { evaluateReloadSafety } from './reload-safety';
import { dismissForcedUpdatePrompt, showSwReloadPrompt, _resetReloadSafetyForTest } from './reload-safety';
import {
  decideForceUpdate,
  isCheckinPath,
  readForceState,
  startForceUpdate,
  type ForceState,
  type ForceUpdateDeps,
} from './force-update';
import { _resetSubmitGuardForTest, beginSubmitting, isSubmitting, onSubmittingIdle } from './submit-guard';
import {
  _resetRuntimeConfigReportForTest,
  bootSwAndForceUpdate,
  parseRuntimeConfig,
  type RuntimeConfig,
  type SwControlDeps,
} from './sw-control';

vi.mock('./error-report', () => ({
  reportClientError: vi.fn(),
}));

vi.mock('./update-prompt-fx', () => ({
  applyUpdatePromptFx: () => () => {},
}));

const BUILD = 202611101200;
const MIN = 202611111200;
const MIN_NEXT = 202611111300;
const RELOAD_KEY = 'fcb:min-build-reload';
const GUARD_KEY = 'fcb:min-build-guard';

interface MemStore extends Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {}

let visibility: DocumentVisibilityState = 'visible';
let currentStop: () => void = () => {};

function memory(): MemStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

function throwingStore(): MemStore {
  return {
    getItem: () => null,
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  };
}

function advance(ms: number): Promise<unknown> {
  return vi.advanceTimersByTimeAsync(ms);
}

function fireVisible(): void {
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
}

function fireHidden(): void {
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
}

function promptEl(): HTMLElement | null {
  return document.getElementById('sw-reload-deferred-prompt');
}

interface StartOpts {
  minBuild?: number;
  buildId?: number | (() => number);
  path?: string;
  session?: MemStore | null;
  local?: Pick<Storage, 'getItem' | 'setItem'> | null;
  online?: () => boolean;
  initialConfig?: RuntimeConfig | null;
  fetchConfig?: () => Promise<RuntimeConfig | null>;
  now?: () => number;
  reload?: () => void;
  disableSw?: () => Promise<void>;
  applySwEnabled?: (enabled: boolean) => Promise<void>;
  report?: (what: string) => void;
  intervalMs?: number;
  foregroundThrottleMs?: number;
}

interface Started {
  stop: () => void;
  reload: Mock<() => void>;
  disableSw: Mock<() => Promise<void>>;
  fetchConfig: Mock<() => Promise<RuntimeConfig | null>>;
  report: Mock<(what: string) => void>;
  applySwEnabled: Mock<(enabled: boolean) => Promise<void>>;
  session: MemStore | null;
  local: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function startAt(opts: StartOpts = {}): Started {
  currentStop();
  window.history.pushState(null, '', opts.path ?? '/');
  const minBuild = opts.minBuild === undefined ? MIN : opts.minBuild;
  const session = opts.session === undefined ? memory() : opts.session;
  const local = opts.local === undefined ? memory() : opts.local;
  const reload = vi.fn(opts.reload ?? (() => {}));
  const disableSw = vi.fn(opts.disableSw ?? (async () => {}));
  const fetchConfig = vi.fn(opts.fetchConfig ?? (async () => ({ swEnabled: true, minBuild })));
  const report = vi.fn(opts.report ?? (() => {}));
  const applySwEnabled = vi.fn(opts.applySwEnabled ?? (async () => {}));
  const buildId = typeof opts.buildId === 'function'
    ? opts.buildId
    : () => {
      const fixed = opts.buildId;
      return typeof fixed === 'number' ? fixed : BUILD;
    };
  const initialConfig = opts.initialConfig === undefined
    ? { swEnabled: true, minBuild }
    : opts.initialConfig;
  const deps: ForceUpdateDeps = {
    initialConfig,
    fetchConfig,
    buildId,
    now: opts.now ?? (() => Date.now()),
    online: opts.online ?? (() => true),
    session,
    local,
    evaluateSafety: () => evaluateReloadSafety(),
    isSubmitting: () => isSubmitting(),
    onSubmittingIdle: (cb) => onSubmittingIdle(cb),
    showForcedPrompt: (onReload) => {
      showSwReloadPrompt(onReload, 'min-build', { forced: true });
    },
    dismissForcedPrompt: () => {
      dismissForcedUpdatePrompt();
    },
    disableSw,
    applySwEnabled,
    reload,
    report,
    target: { doc: document, win: window },
    intervalMs: opts.intervalMs,
    foregroundThrottleMs: opts.foregroundThrottleMs,
  };
  const stop = startForceUpdate(deps);
  currentStop = stop;
  return { stop, reload, disableSw, fetchConfig, report, applySwEnabled, session, local };
}

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T00:00:00.000Z'));
  visibility = 'visible';
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-submitting');
  window.history.pushState(null, '', '/');
  _resetReloadSafetyForTest();
  _resetSubmitGuardForTest();
  _resetRuntimeConfigReportForTest();
});

afterEach(() => {
  currentStop();
  currentStop = () => {};
  _resetReloadSafetyForTest();
  _resetSubmitGuardForTest();
  _resetRuntimeConfigReportForTest();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-submitting');
  window.history.pushState(null, '', '/');
  visibility = 'visible';
  vi.useRealTimers();
});

describe('decideForceUpdate 規則順序', () => {
  const now = 1_000_000;
  const base = {
    minBuild: MIN,
    buildId: BUILD,
    state: null as ForceState | null,
    now,
    online: true,
    sessionOk: true,
    recentGlobal: 0,
    pathname: '/',
  };

  it('依序短路，後項不能蓋過前項', () => {
    expect(decideForceUpdate({ ...base, minBuild: 0, buildId: 0 })).toEqual({ kind: 'none', why: 'no-min-build' });
    expect(decideForceUpdate({ ...base, buildId: 0 })).toEqual({ kind: 'none', why: 'no-build-id' });
    expect(decideForceUpdate({ ...base, buildId: MIN })).toEqual({ kind: 'none', why: 'up-to-date' });
    expect(decideForceUpdate({
      ...base,
      state: { m: MIN, n: 2, t: 0 },
      online: false,
      sessionOk: false,
      recentGlobal: 9,
    })).toEqual({ kind: 'exhausted' });
    expect(decideForceUpdate({ ...base, online: false, sessionOk: false, recentGlobal: 9 })).toEqual({ kind: 'offline' });
    expect(decideForceUpdate({ ...base, sessionOk: false, recentGlobal: 9 })).toEqual({
      kind: 'prompt-only',
      why: 'no-session-storage',
    });
    expect(decideForceUpdate({ ...base, localOk: false })).toEqual({ kind: 'prompt-only', why: 'no-local-storage' });
    expect(decideForceUpdate({ ...base, localOk: true })).toEqual({ kind: 'go', attempt: 1 });
    expect(decideForceUpdate({ ...base, recentGlobal: 6 })).toEqual({ kind: 'prompt-only', why: 'global-brake' });
    expect(decideForceUpdate({ ...base, recentGlobal: 5 })).toEqual({ kind: 'go', attempt: 1 });
    expect(decideForceUpdate({ ...base, state: { m: MIN, n: 1, t: now + 3_600_000 } })).toEqual({ kind: 'go', attempt: 2 });
    const t = now - 59_999;
    expect(decideForceUpdate({ ...base, state: { m: MIN, n: 1, t } })).toEqual({
      kind: 'cooldown',
      retryAt: t + 60_000,
    });
    expect(decideForceUpdate({ ...base, state: { m: MIN, n: 1, t: now - 60_000 } })).toEqual({
      kind: 'go',
      attempt: 2,
    });
    expect(decideForceUpdate(base)).toEqual({ kind: 'go', attempt: 1 });
  });

  it('顧問：/checkin 只把會重載或會跳提示改成安靜等待', () => {
    expect(isCheckinPath('/checkin')).toBe(true);
    expect(isCheckinPath('/checkin/')).toBe(true);
    expect(isCheckinPath('/checkin?eventId=1')).toBe(true);
    expect(isCheckinPath('/checking')).toBe(false);
    expect(isCheckinPath('/events/checkin')).toBe(false);
    expect(decideForceUpdate({ ...base, pathname: '/checkin' })).toEqual({ kind: 'quiet', why: 'checkin' });
    expect(decideForceUpdate({ ...base, pathname: '/checkin/', recentGlobal: 6 })).toEqual({
      kind: 'quiet',
      why: 'checkin',
    });
    expect(decideForceUpdate({ ...base, pathname: '/checkin', sessionOk: false })).toEqual({
      kind: 'quiet',
      why: 'checkin',
    });
    expect(decideForceUpdate({ ...base, pathname: '/checkin', minBuild: 0 })).toEqual({
      kind: 'none',
      why: 'no-min-build',
    });
    expect(decideForceUpdate({ ...base, pathname: '/checkin', state: { m: MIN, n: 2, t: 0 } })).toEqual({
      kind: 'exhausted',
    });
    expect(decideForceUpdate({ ...base, pathname: '/checkin', online: false })).toEqual({ kind: 'offline' });
  });
});

describe('T13 舊格式', () => {
  it('純數字字串：同值當 n:1，不同值當沒記錄', () => {
    expect(readForceState('202611101230', 202611101230)).toEqual({ m: 202611101230, n: 1, t: 0 });
    expect(readForceState('202611101230', MIN)).toBeNull();
    expect(readForceState('{"m":202611101230,"n":2,"t":5}', MIN)).toBeNull();
  });

  it('同值舊標記直接走第 2 次；不同值從第 1 次重算', async () => {
    const same = memory();
    same.setItem(RELOAD_KEY, '202611101230');
    const first = startAt({ session: same, minBuild: 202611101230, buildId: 202611100000, path: '/' });
    await advance(0);
    expect(first.disableSw).toHaveBeenCalledTimes(1);
    expect(first.reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(same.getItem(RELOAD_KEY) ?? '')).toMatchObject({ m: 202611101230, n: 2 });

    const other = memory();
    other.setItem(RELOAD_KEY, '202611101230');
    const second = startAt({ session: other, minBuild: MIN, path: '/' });
    expect(second.disableSw).not.toHaveBeenCalled();
    expect(second.reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(other.getItem(RELOAD_KEY) ?? '')).toMatchObject({ m: MIN, n: 1 });
  });
});

describe('T1 沒有離線快取仍強制更新', () => {
  it('serviceWorker 不支援、首頁、minBuild 較高：重載 1 次且不註冊', async () => {
    const calls: string[] = [];
    const sw: SwControlDeps = {
      serviceWorker: null,
      cacheStorage: null,
      register: async () => { calls.push('register'); },
    };
    await bootSwAndForceUpdate({
      config: { swEnabled: true, minBuild: MIN },
      swSupported: false,
      swDeps: sw,
      startForce: (config) => {
        startAt({
          initialConfig: config,
          path: '/',
          reload: () => { calls.push('reload'); },
          disableSw: async () => { calls.push('disable'); },
        });
      },
    });
    expect(calls).toEqual(['reload']);
  });

  it('swEnabled false 時先取消註冊、清快取，再重載', async () => {
    const calls: string[] = [];
    const sw: SwControlDeps = {
      serviceWorker: {
        getRegistrations: async () => [{
          unregister: async () => {
            calls.push('unregister');
            return true;
          },
        } as unknown as ServiceWorkerRegistration],
      },
      cacheStorage: {
        keys: async () => ['a', 'b'],
        delete: async () => {
          calls.push('cache');
          return true;
        },
      },
      register: async () => { calls.push('register'); },
    };
    await bootSwAndForceUpdate({
      config: { swEnabled: false, minBuild: MIN },
      swSupported: true,
      swDeps: sw,
      startForce: (config) => {
        startAt({
          initialConfig: config,
          path: '/',
          reload: () => { calls.push('reload'); },
          disableSw: async () => { calls.push('disable-force'); },
        });
      },
    });
    expect(calls).toEqual(['unregister', 'cache', 'cache', 'reload']);
  });
});

describe('T2 回前景與 pageshow', () => {
  it('未滿 10 分鐘不讀設定；滿 10 分鐘讀一次並重載；persisted pageshow 同樣，一般 pageshow 不算', async () => {
    const fetchConfig = vi.fn(async () => ({ swEnabled: true, minBuild: MIN }));
    const first = startAt({ minBuild: 0, path: '/', fetchConfig });
    expect(first.reload).not.toHaveBeenCalled();
    expect(fetchConfig).not.toHaveBeenCalled();
    await advance(9 * 60_000 + 59_000);
    fireVisible();
    await advance(0);
    expect(fetchConfig).not.toHaveBeenCalled();
    expect(first.reload).not.toHaveBeenCalled();
    await advance(1_000);
    fireVisible();
    await advance(0);
    expect(fetchConfig).toHaveBeenCalledTimes(1);
    expect(first.reload).toHaveBeenCalledTimes(1);

    const fetchPage = vi.fn(async () => ({ swEnabled: true, minBuild: MIN }));
    const second = startAt({ minBuild: 0, path: '/', fetchConfig: fetchPage });
    await advance(9 * 60_000 + 59_000);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await advance(0);
    expect(fetchPage).not.toHaveBeenCalled();
    await advance(1_000);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await advance(0);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(second.reload).toHaveBeenCalledTimes(1);

    const fetchPlain = vi.fn(async () => ({ swEnabled: true, minBuild: MIN }));
    const third = startAt({ minBuild: 0, path: '/', fetchConfig: fetchPlain });
    await advance(600_000);
    window.dispatchEvent(new Event('pageshow'));
    await advance(0);
    expect(fetchPlain).not.toHaveBeenCalled();
    expect(third.reload).not.toHaveBeenCalled();
  });
});

describe('T3 不安全頁先不記、安全後才重載', () => {
  it('非主頁不重載、顯示強制提示框、session 沒有新紀錄；回到首頁後 3 秒重載並記 n:1', async () => {
    const h = startAt({ path: '/events/x' });
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.session?.getItem(RELOAD_KEY)).toBeNull();
    const prompt = promptEl();
    expect(prompt).toBeTruthy();
    expect(prompt?.dataset.mode).toBe('forced');
    expect(prompt?.querySelector('[data-sw-reload-later]')).toBeNull();
    expect(prompt?.textContent).toContain('有新版本可用');
    window.history.pushState(null, '', '/');
    await advance(2_999);
    expect(h.reload).not.toHaveBeenCalled();
    await advance(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.session?.getItem(RELOAD_KEY) ?? '')).toMatchObject({ m: MIN, n: 1 });
    expect(h.disableSw).not.toHaveBeenCalled();
  });

  it('按現在更新會重載並記 n:1，且不計入跨分頁自動次數', () => {
    const h = startAt({ path: '/events/x' });
    (promptEl()?.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.session?.getItem(RELOAD_KEY) ?? '')).toMatchObject({ m: MIN, n: 1 });
    expect(h.local?.getItem(GUARD_KEY)).toBeNull();
    expect(h.disableSw).not.toHaveBeenCalled();
  });
});

describe('T4 第 2 次先清快取', () => {
  it('59 秒內不動作，60 秒到先 disableSw 再重載，紀錄 n:2', async () => {
    const session = memory();
    const local = memory();
    const first = startAt({ session, local, path: '/' });
    expect(first.reload).toHaveBeenCalledTimes(1);
    expect(first.disableSw).not.toHaveBeenCalled();
    expect(JSON.parse(session.getItem(RELOAD_KEY) ?? '')).toMatchObject({ n: 1 });
    expect(JSON.parse(local.getItem(GUARD_KEY) ?? '')).toEqual({ m: MIN, n: 1 });

    const order: string[] = [];
    const second = startAt({
      session,
      local,
      path: '/',
      disableSw: async () => { order.push('disable'); },
      reload: () => { order.push('reload'); },
    });
    expect(second.reload).not.toHaveBeenCalled();
    await advance(59_000);
    expect(order).toEqual([]);
    await advance(1_000);
    expect(order).toEqual(['disable', 'reload']);
    expect(JSON.parse(session.getItem(RELOAD_KEY) ?? '')).toMatchObject({ m: MIN, n: 2 });
    expect(JSON.parse(local.getItem(GUARD_KEY) ?? '')).toEqual({ m: MIN, n: 2 });
  });

  it('清快取期間使用者開始送出：等送出結束才重載', async () => {
    const session = memory();
    const now = Date.now();
    session.setItem(RELOAD_KEY, JSON.stringify({ m: MIN, n: 1, t: now - 60_000 }));
    let release: () => void = () => {};
    const h = startAt({
      session,
      path: '/',
      disableSw: async () => { release = beginSubmitting('attendance-save'); },
    });
    await advance(10);
    expect(h.reload).not.toHaveBeenCalled();
    release();
    await advance(10);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('跨分頁上限到了只跳提示時回報一次原因', () => {
    const local = memory();
    local.setItem(GUARD_KEY, JSON.stringify({ m: MIN, n: 6 }));
    const h = startAt({ local, path: '/' });
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.report.mock.calls.filter((c) => String(c[0]).includes('min-build-brake:global-brake'))).toHaveLength(1);
  });

  it('disableSw 一直不完成時，5 秒後仍重載', async () => {
    const session = memory();
    const now = Date.now();
    session.setItem(RELOAD_KEY, JSON.stringify({ m: MIN, n: 1, t: now - 60_000 }));
    const h = startAt({
      session,
      path: '/',
      disableSw: () => new Promise<void>(() => {}),
    });
    expect(JSON.parse(session.getItem(RELOAD_KEY) ?? '')).toMatchObject({ n: 2 });
    expect(h.reload).not.toHaveBeenCalled();
    await advance(4_999);
    expect(h.reload).not.toHaveBeenCalled();
    await advance(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });
});

describe('T5 延後後自動再試', () => {
  it('彈窗開著不重載也不顯示提示框；關掉後下一個 3 秒 tick 重載', async () => {
    document.body.innerHTML = '<div class="modal open"></div>';
    const h = startAt({ path: '/' });
    expect(h.reload).not.toHaveBeenCalled();
    expect(promptEl()).toBeNull();
    document.body.innerHTML = '';
    await advance(2_999);
    expect(h.reload).not.toHaveBeenCalled();
    await advance(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('hidden 期間 tick 停止，重新可見才重載', async () => {
    document.body.innerHTML = '<div class="modal open"></div>';
    const h = startAt({ path: '/' });
    fireHidden();
    document.body.innerHTML = '';
    await advance(60_000);
    expect(h.reload).not.toHaveBeenCalled();
    fireVisible();
    await advance(0);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('focusout、popstate、送出結束都能不等 3 秒就重載', () => {
    document.body.innerHTML = '<div class="modal open"></div>';
    const byFocus = startAt({ path: '/' });
    document.body.innerHTML = '';
    document.dispatchEvent(new Event('focusout'));
    expect(byFocus.reload).toHaveBeenCalledTimes(1);

    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    const byPop = startAt({ path: '/events/x' });
    expect(promptEl()).toBeNull();
    document.body.innerHTML = '';
    window.history.pushState(null, '', '/');
    window.dispatchEvent(new Event('popstate'));
    expect(byPop.reload).toHaveBeenCalledTimes(1);

    const release = beginSubmitting('attendance-save');
    const byIdle = startAt({ path: '/' });
    expect(byIdle.reload).not.toHaveBeenCalled();
    expect(promptEl()).toBeNull();
    release();
    expect(byIdle.reload).toHaveBeenCalledTimes(1);
  });
});

describe('T7 同一個 minBuild 兩次後停止', () => {
  it('n:2 不再重載、不顯示提示框、min-build-stuck 只回報 1 次；換更大的值從第 1 次開始', async () => {
    const session = memory();
    session.setItem(RELOAD_KEY, JSON.stringify({ m: MIN, n: 2, t: 0 }));
    const h = startAt({ session, path: '/' });
    expect(h.reload).not.toHaveBeenCalled();
    expect(promptEl()).toBeNull();
    expect(h.report).toHaveBeenCalledTimes(1);
    expect(h.report).toHaveBeenCalledWith('min-build-stuck');
    await advance(600_000);
    fireVisible();
    await advance(0);
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('popstate'));
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledTimes(1);
    expect(promptEl()).toBeNull();

    const next = memory();
    next.setItem(RELOAD_KEY, JSON.stringify({ m: MIN, n: 2, t: 0 }));
    const again = startAt({ session: next, minBuild: MIN_NEXT, path: '/' });
    expect(again.reload).toHaveBeenCalledTimes(1);
    expect(again.disableSw).not.toHaveBeenCalled();
    expect(JSON.parse(next.getItem(RELOAD_KEY) ?? '')).toMatchObject({ m: MIN_NEXT, n: 1 });
  });
});

describe('T8 跨分頁煞車不自動恢復', () => {
  it('同一個 minBuild 自動重整 6 次後只顯示按鈕；快轉 1 小時仍不自動重整；換值才重算', async () => {
    const local = memory();
    const reload = vi.fn();
    for (let i = 0; i < 6; i += 1) {
      const h = startAt({
        session: memory(),
        local,
        path: '/',
        reload: () => { reload(); },
      });
      expect(h.reload).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(i + 1);
    }
    expect(JSON.parse(local.getItem(GUARD_KEY) ?? '')).toEqual({ m: MIN, n: 6 });

    const blocked = startAt({ session: memory(), local, path: '/', reload: () => { reload(); } });
    expect(blocked.reload).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(6);
    expect(promptEl()?.dataset.mode).toBe('forced');
    expect(promptEl()?.querySelector('[data-sw-reload-later]')).toBeNull();
    (promptEl()?.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(reload).toHaveBeenCalledTimes(7);
    expect(JSON.parse(local.getItem(GUARD_KEY) ?? '')).toEqual({ m: MIN, n: 6 });

    await advance(60 * 60 * 1000);
    fireVisible();
    await advance(0);
    expect(reload).toHaveBeenCalledTimes(7);
    expect(promptEl()?.querySelector('[data-sw-reload-later]')).toBeNull();

    const fresh = memory();
    startAt({ session: fresh, local, path: '/', minBuild: MIN_NEXT, reload: () => { reload(); } });
    expect(reload).toHaveBeenCalledTimes(8);
    expect(JSON.parse(local.getItem(GUARD_KEY) ?? '')).toEqual({ m: MIN_NEXT, n: 1 });
    expect(JSON.parse(fresh.getItem(RELOAD_KEY) ?? '')).toMatchObject({ m: MIN_NEXT, n: 1 });
  });
});

describe('T9 與掃碼頁', () => {
  it('/admin 停 1 小時不自動重載，提示框只有現在更新', async () => {
    const h = startAt({ path: '/admin/users' });
    expect(h.reload).not.toHaveBeenCalled();
    expect(promptEl()?.querySelector('[data-sw-reload-later]')).toBeNull();
    expect(promptEl()?.querySelector('[data-sw-reload-now]')).toBeTruthy();
    await advance(60 * 60 * 1000);
    expect(h.reload).not.toHaveBeenCalled();
    expect(promptEl()?.querySelector('[data-sw-reload-later]')).toBeNull();
  });

  it('/checkin 不顯示強制提示框；離開該頁或掃碼送出結束後才處理', async () => {
    const quiet = startAt({ path: '/checkin' });
    expect(quiet.reload).not.toHaveBeenCalled();
    expect(promptEl()).toBeNull();
    await advance(60 * 60 * 1000);
    expect(quiet.reload).not.toHaveBeenCalled();
    expect(promptEl()).toBeNull();

    const release = beginSubmitting('checkin');
    const scanning = startAt({ path: '/checkin' });
    expect(promptEl()).toBeNull();
    release();
    expect(scanning.reload).not.toHaveBeenCalled();
    expect(promptEl()).toBeNull();
    window.history.pushState(null, '', '/admin/users');
    await advance(3_000);
    expect(scanning.reload).not.toHaveBeenCalled();
    expect(promptEl()?.querySelector('[data-sw-reload-later]')).toBeNull();
    expect(promptEl()?.querySelector('[data-sw-reload-now]')).toBeTruthy();

    const leave = startAt({ path: '/checkin/' });
    expect(promptEl()).toBeNull();
    window.history.pushState(null, '', '/');
    window.dispatchEvent(new Event('popstate'));
    expect(leave.reload).toHaveBeenCalledTimes(1);
  });
});

describe('T10 設定、meta、離線', () => {
  it('壞 minBuild、JSON 讀不到、buildId 0 都不重載；buildId 0 只回報一次', async () => {
    const bad = ['202611111200', 2026111112000, -1, null, 1.5];
    for (const minBuild of bad) {
      const cfg = parseRuntimeConfig({ swEnabled: true, minBuild });
      expect(cfg.minBuild).toBe(0);
      const h = startAt({ initialConfig: cfg, path: '/' });
      expect(h.reload).not.toHaveBeenCalled();
    }
    const missing = startAt({ initialConfig: null, path: '/' });
    expect(missing.reload).not.toHaveBeenCalled();

    const report = vi.fn();
    const zero = startAt({ buildId: 0, path: '/', report });
    expect(zero.reload).not.toHaveBeenCalled();
    expect(zero.report).toHaveBeenCalledTimes(1);
    expect(zero.report).toHaveBeenCalledWith('no-build-id');
    await advance(600_000);
    fireVisible();
    await advance(0);
    expect(zero.report).toHaveBeenCalledTimes(1);
    expect(zero.reload).not.toHaveBeenCalled();
  });

  it('離線不重載，online 事件之後才重載', () => {
    let online = false;
    const h = startAt({ path: '/', online: () => online });
    expect(h.reload).not.toHaveBeenCalled();
    expect(promptEl()).toBeNull();
    window.dispatchEvent(new Event('online'));
    expect(h.reload).not.toHaveBeenCalled();
    online = true;
    window.dispatchEvent(new Event('online'));
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('localStorage 不能讀寫就只顯示按鈕（重載若清掉分頁紀錄，就沒有任何持久煞車）；兩個都不能寫也一樣', () => {
    const localOnly = startAt({
      path: '/',
      local: {
        getItem: () => { throw new Error('no-local'); },
        setItem: () => { throw new Error('no-local'); },
      },
    });
    expect(localOnly.reload).not.toHaveBeenCalled();
    expect(promptEl()?.querySelector('[data-sw-reload-later]')).toBeNull();
    expect(promptEl()?.querySelector('[data-sw-reload-now]')).toBeTruthy();

    const both = startAt({ path: '/', session: throwingStore(), local: throwingStore() });
    expect(both.reload).not.toHaveBeenCalled();
    expect(promptEl()?.querySelector('[data-sw-reload-later]')).toBeNull();
    expect(promptEl()?.querySelector('[data-sw-reload-now]')).toBeTruthy();
  });

  it('達標或 minBuild 為 0 時刪掉分頁紀錄', () => {
    const session = memory();
    session.setItem(RELOAD_KEY, JSON.stringify({ m: MIN, n: 1, t: 1 }));
    const upToDate = startAt({ session, buildId: MIN, path: '/events/x' });
    expect(upToDate.reload).not.toHaveBeenCalled();
    expect(session.getItem(RELOAD_KEY)).toBeNull();
    expect(promptEl()).toBeNull();

    const again = memory();
    again.setItem(RELOAD_KEY, JSON.stringify({ m: MIN, n: 2, t: 1 }));
    startAt({ session: again, minBuild: 0, path: '/' });
    expect(again.getItem(RELOAD_KEY)).toBeNull();
  });
});

describe('T11 sessionStorage 不可用', () => {
  it('setItem 丟例外時不自動重載，按現在更新才重載 1 次', () => {
    const h = startAt({ path: '/', session: throwingStore() });
    expect(h.reload).not.toHaveBeenCalled();
    expect(promptEl()?.querySelector('[data-sw-reload-later]')).toBeNull();
    (promptEl()?.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('寫入後讀回不一致就改走按鈕，不自動重載', () => {
    const map = new Map<string, string>();
    const session: MemStore = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, key === RELOAD_KEY ? 'lie' : value);
      },
      removeItem: (key) => { map.delete(key); },
    };
    const h = startAt({ path: '/', session });
    expect(h.reload).not.toHaveBeenCalled();
    expect(promptEl()).toBeTruthy();
    (promptEl()?.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });
});

describe('強制框按現在更新但寫分頁紀錄失敗：SW 一般提示不遺失', () => {
  function lyingSession(): MemStore {
    const map = new Map<string, string>();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => { map.set(key, key === RELOAD_KEY ? 'lie' : value); },
      removeItem: (key) => { map.delete(key); },
    };
  }

  it('重顯強制框後 minBuild 改回 0，還原 SW 一般提示並用 SW 函式', async () => {
    const swFn = vi.fn();
    showSwReloadPrompt(swFn, 'sw-waiting');
    let minBuild = MIN;
    const h = startAt({
      path: '/events/x',
      session: lyingSession(),
      fetchConfig: async () => ({ swEnabled: true, minBuild }),
    });
    expect(promptEl()?.dataset.mode).toBe('forced');
    (promptEl()?.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(h.reload).not.toHaveBeenCalled();
    expect(promptEl()?.dataset.mode).toBe('forced');
    minBuild = 0;
    await advance(600_000);
    fireVisible();
    await advance(0);
    const prompt = promptEl();
    expect(prompt?.dataset.mode).toBeUndefined();
    expect(prompt?.querySelector('[data-sw-reload-later]')).toBeTruthy();
    (prompt?.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(swFn).toHaveBeenCalledTimes(1);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('在掃碼頁按下而改延後：立即還原 SW 一般提示', () => {
    const swFn = vi.fn();
    showSwReloadPrompt(swFn, 'sw-waiting');
    const h = startAt({ path: '/events/x', session: lyingSession() });
    expect(promptEl()?.dataset.mode).toBe('forced');
    window.history.pushState(null, '', '/checkin');
    (promptEl()?.querySelector('[data-sw-reload-now]') as HTMLButtonElement).click();
    expect(h.reload).not.toHaveBeenCalled();
    expect(swFn).not.toHaveBeenCalled();
    const prompt = promptEl();
    expect(prompt?.dataset.mode).toBeUndefined();
    expect(prompt?.querySelector('[data-sw-reload-later]')).toBeTruthy();
  });
});

describe('顧問：不需更新時收掉強制提示框', () => {
  it('先顯示強制提示框，回前景讀到 minBuild 0 後移除並停止輪詢', async () => {
    const now = vi.fn(() => Date.now());
    let minBuild = MIN;
    const h = startAt({
      path: '/admin/users',
      now,
      fetchConfig: async () => ({ swEnabled: true, minBuild }),
    });
    expect(promptEl()?.dataset.mode).toBe('forced');
    expect(h.reload).not.toHaveBeenCalled();
    minBuild = 0;
    await advance(600_000);
    fireVisible();
    await advance(0);
    expect(h.fetchConfig).toHaveBeenCalledTimes(1);
    expect(promptEl()).toBeNull();
    expect(h.reload).not.toHaveBeenCalled();
    const calls = now.mock.calls.length;
    await advance(9_000);
    expect(now.mock.calls.length).toBe(calls);
    expect(promptEl()).toBeNull();
  });

  it('建置編號追上 minBuild 時也收掉提示框並停止輪詢', async () => {
    const now = vi.fn(() => Date.now());
    let buildId = BUILD;
    const h = startAt({
      path: '/events/x',
      now,
      buildId: () => buildId,
    });
    expect(promptEl()).toBeTruthy();
    buildId = MIN;
    fireVisible();
    await advance(0);
    expect(promptEl()).toBeNull();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.fetchConfig).not.toHaveBeenCalled();
    const calls = now.mock.calls.length;
    await advance(9_000);
    expect(now.mock.calls.length).toBe(calls);
  });
});

describe('回前景停用 SW，以及設定稍後才讀到', () => {
  it('回前景讀到 swEnabled false 時先停用再重載', async () => {
    const order: string[] = [];
    startAt({
      minBuild: 0,
      path: '/',
      fetchConfig: async () => ({ swEnabled: false, minBuild: MIN }),
      applySwEnabled: async (enabled) => { order.push(enabled ? 'on' : 'off'); },
      reload: () => { order.push('reload'); },
    });
    await advance(600_000);
    fireVisible();
    await advance(0);
    expect(order).toEqual(['off', 'reload']);
  });

  it('首讀失敗（設定為 null）不做；回前景未滿 10 分鐘即重讀，成功才重載', async () => {
    const fetchConfig = vi.fn(async () => ({ swEnabled: true, minBuild: MIN }));
    const h = startAt({ initialConfig: null, path: '/', fetchConfig });
    expect(h.reload).not.toHaveBeenCalled();
    await advance(1_000);
    fireVisible();
    await advance(0);
    expect(fetchConfig).toHaveBeenCalledTimes(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('首讀失敗後重讀仍失敗：之後 10 分鐘內不再打網路', async () => {
    const fetchConfig = vi.fn(async () => null);
    startAt({ initialConfig: null, path: '/', fetchConfig });
    await advance(1_000);
    fireVisible();
    await advance(0);
    expect(fetchConfig).toHaveBeenCalledTimes(1);
    fireHidden();
    fireVisible();
    await advance(0);
    expect(fetchConfig).toHaveBeenCalledTimes(1);
  });

  it('首讀成功：未滿 10 分鐘回前景不重讀', async () => {
    const fetchConfig = vi.fn(async () => ({ swEnabled: true, minBuild: 0 }));
    startAt({ minBuild: 0, path: '/', fetchConfig });
    await advance(599_000);
    fireVisible();
    await advance(0);
    expect(fetchConfig).not.toHaveBeenCalled();
  });
});
