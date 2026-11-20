// useScoring：訂閱記分工作階段。預設依賴只在 effect 裡接上，測試可整包注入。

import { useEffect, useState } from 'preact/hooks';
import { IndexedDbActionLog, openScoringDatabase, type ActionLog } from './data/action-log';
import { createFirestoreBackend, type ScoringBackend } from './data/live-repo';
import { isOfflineError } from './data/sender';
import { createScoringSession, loadingView, type ScoringSession, type ScoringView, type SessionOptions } from './data/session';
import { idbSidStore, type SidStore } from './data/sid';
import type { LockManager, TabChannel } from './data/tab-lock';
import type { WakeHandle } from './data/wake-lock';

export interface ScoringDeps {
  uid?: string;
  backend?: ScoringBackend;
  log?: ActionLog;
  sids?: SidStore;
  now?: SessionOptions['now'];
  randomBytes?: SessionOptions['randomBytes'];
  online?: SessionOptions['online'];
  watchOnline?: SessionOptions['watchOnline'];
  visible?: SessionOptions['visible'];
  watchVisible?: SessionOptions['watchVisible'];
  locks?: LockManager | null;
  channel?: TabChannel | null;
  wakeRequest?: (() => Promise<WakeHandle>) | null;
  tick?: boolean;
  /** null 表示不要用 IndexedDB。未給就用瀏覽器的 indexedDB。 */
  idb?: IDBFactory | null;
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function browserVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

function browserWatchOnline(cb: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const on = () => cb(true);
  const off = () => cb(false);
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  return () => {
    window.removeEventListener('online', on);
    window.removeEventListener('offline', off);
  };
}

function browserWatchVisible(cb: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}

function browserLocks(): LockManager | null {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const locks = (nav as Navigator & { locks?: LockManager } | undefined)?.locks;
  return locks ?? null;
}

function browserChannel(cid: string, mtId: string): TabChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    return new BroadcastChannel(`cp-scoring-${cid}-${mtId}`) as TabChannel;
  } catch {
    return null;
  }
}

function browserWake(): (() => Promise<WakeHandle>) | null {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const wake = (nav as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeHandle> } } | undefined)?.wakeLock;
  if (!wake) return null;
  return () => wake.request('screen');
}

function unavailableLog(): ActionLog {
  return {
    async probe() { return false; },
    async put() { /* 工作階段會改走記憶體 */ },
    async get() { return null; },
    async list() { return []; },
    async patch() { return null; },
    async remove() {},
    async removeMatch() {},
    async purgeOlderThan() {},
  };
}

async function resolveStorage(deps: ScoringDeps | undefined): Promise<{ log?: ActionLog; sids?: SidStore }> {
  if (deps?.log || deps?.sids) return { log: deps.log, sids: deps.sids };
  const factory = deps && 'idb' in deps ? (deps.idb ?? null) : (globalThis.indexedDB ?? null);
  if (!factory) return { log: unavailableLog() };
  try {
    const db = await openScoringDatabase(factory);
    return { log: new IndexedDbActionLog(async () => db), sids: idbSidStore(db) };
  } catch {
    return { log: unavailableLog() };
  }
}

async function defaultBackend(cid: string, mtId: string, uid: string): Promise<ScoringBackend> {
  const { getCpFirebase } = await import('../data/cp-firebase');
  const { db } = await getCpFirebase();
  return createFirestoreBackend(db, cid, mtId, uid);
}

/**
 * 進場失敗的種類。network＝網路類（unavailable、deadline-exceeded、client is offline），會自動重試；
 * error＝其他錯誤，只給重試鈕。讀取成功但沒有指派、或 Rules 拒讀（permission-denied）都不算失敗：
 * 記分頁照舊顯示「沒有記分權限」，不重試。
 */
export type ScoringLoadError = 'network' | 'error';

/** 記分頁看到的狀態：工作階段畫面，進場失敗時另帶失敗種類與重試。 */
export type ScoringScreenView = ScoringView & {
  loadError?: ScoringLoadError;
  retry?: () => void;
};

/** 網路類失敗的自動重試間隔：5、10、20 秒，之後每 30 秒。 */
export const BOOT_RETRY_MS: readonly number[] = [5_000, 10_000, 20_000, 30_000];

/** 進場失敗後等分頁鎖真的放掉的上限。逾時照樣打開進場門，避免放鎖訊號不回來時重試全失效（顧問 §3.467）。 */
export const RELEASE_WAIT_MS = 1_000;

/** 等 released 完成，最多 ms 毫秒。 */
function waitAtMost(released: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([released, limit]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}

/** Rules 拒讀（例如沒有指派的人讀 control/scorer）：伺服器已回答「沒有權限」，照原本顯示沒有記分權限、不重試。 */
export function isDeniedBootError(err: unknown): boolean {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
  return code === 'permission-denied' || code.endsWith('/permission-denied');
}

export function isNetworkBootError(err: unknown): boolean {
  if (isOfflineError(err)) return true;
  const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message) : '';
  return /client is offline/i.test(message);
}

/**
 * 記分資料層。deps 只在這場 cid／mtId 生效時讀一次，避免每輪 render 重開工作階段。
 * 進場（開工作階段）丟錯時不再當成沒有權限（G-06，取代原本一律 failedView：staff 空陣列被判成無權限、永不重試）。
 * 重試鈕、online、回到前景、退避計時器共用同一道門，同時只有一個進場；成功後全部停止。
 */
export function useScoring(cid: string, mtId: string, deps?: ScoringDeps): ScoringScreenView {
  const [view, setView] = useState<ScoringScreenView>(loadingView());

  useEffect(() => {
    const snap = deps;
    let stopped = false;
    let session: ScoringSession | null = null;
    let booting = false;
    /** 進場中（含等放鎖）按了重試：記一次，這次結束後若還沒成功就馬上再進場。自動來源不排隊。 */
    let retryQueued = false;
    let uid: string | null = snap?.uid ?? null;
    let lastError: ScoringLoadError | 'denied' | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let backend: ScoringBackend | null = snap?.backend ?? null;
    let storage: Promise<{ log?: ActionLog; sids?: SidStore }> | null = null;
    let unsub = () => {};
    let unauth = () => {};
    let unwatchOnline = () => {};
    let unwatchVisible = () => {};
    const isVisible = snap?.visible ?? browserVisible;
    const watchOnline = snap && 'watchOnline' in snap ? snap.watchOnline : browserWatchOnline;
    const watchVisible = snap && 'watchVisible' in snap ? snap.watchVisible : browserWatchVisible;

    const clearTimer = () => {
      if (retryTimer != null) clearTimeout(retryTimer);
      retryTimer = null;
    };
    const unwatch = () => {
      unwatchOnline();
      unwatchVisible();
      unwatchOnline = () => {};
      unwatchVisible = () => {};
    };
    const retry = () => {
      if (booting) {
        retryQueued = true;
        return;
      }
      void tryBoot();
    };
    const showError = (kind: ScoringLoadError) => {
      setView({ ...loadingView(), loading: false, loadError: kind, retry });
    };
    /** 只有網路類失敗、而且頁面看得到才排下一次；藏起來就停，回到前景再由 visibilitychange 觸發。 */
    const schedule = () => {
      clearTimer();
      if (stopped || session || lastError !== 'network' || !isVisible()) return;
      const wait = BOOT_RETRY_MS[Math.min(attempt, BOOT_RETRY_MS.length - 1)];
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void tryBoot();
      }, wait);
    };
    const autoRetry = () => {
      if (lastError !== 'network') return;
      if (isVisible()) void tryBoot();
      else clearTimer();
    };

    const boot = async (who: string): Promise<void> => {
      let created: ScoringSession | null = null;
      try {
        backend = backend ?? await defaultBackend(cid, mtId, who);
        if (stopped) return;
        storage = storage ?? resolveStorage(snap);
        const opened = await storage;
        if (stopped) return;
        const locks = snap && 'locks' in snap ? (snap.locks ?? null) : browserLocks();
        const channel = locks
          ? null
          : (snap && 'channel' in snap ? (snap.channel ?? null) : browserChannel(cid, mtId));
        created = createScoringSession({
          cid,
          mtId,
          uid: who,
          backend,
          log: opened.log,
          sids: opened.sids,
          now: snap?.now,
          randomBytes: snap?.randomBytes,
          online: snap?.online ?? browserOnline,
          watchOnline,
          visible: isVisible,
          watchVisible,
          locks,
          channel,
          wakeRequest: snap && 'wakeRequest' in snap ? (snap.wakeRequest ?? null) : browserWake(),
          tick: snap?.tick,
        });
        const current = created;
        session = current;
        unsub = current.subscribe((next) => {
          if (!stopped && session === current) setView(next);
        });
        await current.start();
        if (stopped) {
          current.stop();
          return;
        }
        lastError = null;
        clearTimer();
        unwatch();
        setView(current.getState());
      } catch (err) {
        // 失敗的工作階段整個收掉（放掉分頁鎖、取消訂閱），下次重新開。open 失敗時佇列還沒開始送。
        let released: Promise<void> = Promise.resolve();
        if (created) {
          unsub();
          unsub = () => {};
          released = created.stop();
          if (session === created) session = null;
        }
        if (stopped) return;
        const denied = isDeniedBootError(err);
        if (denied) {
          // 與修正前相同：空的 staff，記分頁算出沒有指派而顯示「沒有記分權限」，沒有重試。
          lastError = 'denied';
          clearTimer();
          setView({ ...loadingView(), loading: false });
        } else {
          lastError = isNetworkBootError(err) ? 'network' : 'error';
          showError(lastError);
        }
        // 瀏覽器在 callback 結束後才非同步放掉 Web Locks：等鎖真的放掉（最多 RELEASE_WAIT_MS）才結束這次進場，
        // 期間 booting 仍為 true，重試、online、前景、計時器都被擋，下一次進場不會因 ifAvailable 拿不到鎖而變 blocked（P2-1）。
        await waitAtMost(released, RELEASE_WAIT_MS);
        if (stopped || denied) return;
        schedule();
      }
    };

    /** 唯一的進場門：同時只有一個 boot，成功後不再進場。 */
    async function tryBoot(): Promise<void> {
      if (stopped || session || booting) return;
      if (!uid) {
        if (lastError) startAuth();
        return;
      }
      booting = true;
      retryQueued = false;
      clearTimer();
      try {
        await boot(uid);
      } finally {
        booting = false;
      }
      if (retryQueued && !session && !stopped) {
        retryQueued = false;
        void tryBoot();
      }
    }

    function startAuth(): void {
      unauth();
      unauth = () => {};
      void import('@/data/auth').then((mod) => {
        if (stopped) return;
        unauth = mod.onAuthChanged((user) => {
          if (!user?.uid) return;
          uid = user.uid;
          void tryBoot();
        });
      }).catch(() => {
        if (stopped) return;
        lastError = 'error';
        showError('error');
      });
    }

    unwatchOnline = watchOnline?.((next) => { if (next) autoRetry(); }) ?? (() => {});
    unwatchVisible = watchVisible?.(() => autoRetry()) ?? (() => {});
    if (uid) void tryBoot();
    else startAuth();

    return () => {
      stopped = true;
      clearTimer();
      unwatch();
      unauth();
      unsub();
      session?.stop();
    };
    // deps 故意不放進依賴：同一場只依第一次傳入的注入物。
  }, [cid, mtId]);

  return view;
}
