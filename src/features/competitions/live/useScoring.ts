// useScoring：訂閱記分工作階段。預設依賴只在 effect 裡接上，測試可整包注入。

import { useEffect, useState } from 'preact/hooks';
import { LIVE_COPY } from './copy';
import { IndexedDbActionLog, openScoringDatabase, type ActionLog } from './data/action-log';
import { createFirestoreBackend, type ScoringBackend } from './data/live-repo';
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

function failedView(): ScoringView {
  return {
    ...loadingView(),
    loading: false,
    storage: 'unavailable',
    storageHint: LIVE_COPY.offlineUnstored,
  };
}

/** 記分資料層。deps 只在這場 cid／mtId 生效時讀一次，避免每輪 render 重開工作階段。 */
export function useScoring(cid: string, mtId: string, deps?: ScoringDeps): ScoringView {
  const [view, setView] = useState<ScoringView>(loadingView());

  useEffect(() => {
    const snap = deps;
    let stopped = false;
    let session: ScoringSession | null = null;
    let unsub = () => {};
    let unauth = () => {};

    const boot = async (uid: string) => {
      if (stopped || session) return;
      try {
        const backend = snap?.backend ?? await defaultBackend(cid, mtId, uid);
        if (stopped) return;
        const storage = await resolveStorage(snap);
        if (stopped) return;
        const locks = snap && 'locks' in snap ? (snap.locks ?? null) : browserLocks();
        const channel = locks
          ? null
          : (snap && 'channel' in snap ? (snap.channel ?? null) : browserChannel(cid, mtId));
        const created = createScoringSession({
          cid,
          mtId,
          uid,
          backend,
          log: storage.log,
          sids: storage.sids,
          now: snap?.now,
          randomBytes: snap?.randomBytes,
          online: snap?.online ?? browserOnline,
          watchOnline: snap && 'watchOnline' in snap ? snap.watchOnline : browserWatchOnline,
          visible: snap?.visible ?? browserVisible,
          watchVisible: snap && 'watchVisible' in snap ? snap.watchVisible : browserWatchVisible,
          locks,
          channel,
          wakeRequest: snap && 'wakeRequest' in snap ? (snap.wakeRequest ?? null) : browserWake(),
          tick: snap?.tick,
        });
        session = created;
        unsub = created.subscribe((next) => {
          if (!stopped) setView(next);
        });
        await created.start();
        if (stopped) {
          created.stop();
          return;
        }
        setView(created.getState());
      } catch {
        if (!stopped) setView(failedView());
      }
    };

    if (snap?.uid) {
      void boot(snap.uid);
    } else {
      void import('@/data/auth').then((mod) => {
        if (stopped) return;
        unauth = mod.onAuthChanged((user) => {
          if (user?.uid) void boot(user.uid);
        });
      }).catch(() => {
        if (!stopped) setView(failedView());
      });
    }

    return () => {
      stopped = true;
      unauth();
      unsub();
      session?.stop();
    };
    // deps 故意不放進依賴：同一場只依第一次傳入的注入物。
  }, [cid, mtId]);

  return view;
}
