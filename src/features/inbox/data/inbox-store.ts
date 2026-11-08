// 收件匣共用訂閱（照 A `FirebaseService._startMessagesListener` + `App._startPmThreadListener`）。
//
// A 登入後就常駐兩個監聽：`users/{uid}/inbox`（createdAt 倒序 200 筆）與 `users/{uid}/pmThreads`，
// 鈴鐺紅點與收件匣頁都讀同一份快取。B 照做：App 層（InboxStoreHost）登入後呼叫 `startInboxStore(uid)`，
// 登出或換帳號時 `stopInboxStore()`；InboxPage 只讀這份狀態，不再自己訂閱。
// 第二身份與主身份共用同一個 Auth uid 的收件匣（照 A，不分開）。

import { useEffect, useState } from 'preact/hooks';

import { countUnread, subscribeInbox, type InboxMessage } from './inbox-repo';
import { subscribeThreads, type PmThread } from './pm-repo';
import { setInboxBadgeCounts } from './inbox-badge';

export type InboxStreamStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface InboxStoreState {
  /** 目前訂閱的 uid；未啟動為 null。 */
  uid: string | null;
  messages: InboxMessage[];
  messagesStatus: InboxStreamStatus;
  threads: PmThread[];
  threadsStatus: InboxStreamStatus;
}

type Listener = (state: InboxStoreState) => void;

const IDLE_STATE: InboxStoreState = {
  uid: null,
  messages: [],
  messagesStatus: 'idle',
  threads: [],
  threadsStatus: 'idle',
};

let state: InboxStoreState = IDLE_STATE;
const listeners = new Set<Listener>();
let inboxUnsub: (() => void) | null = null;
let threadsUnsub: (() => void) | null = null;
/** 每條訂閱各自的世代號；退訂或重訂後舊回呼一律丟棄。 */
let inboxGen = 0;
let threadsGen = 0;

function pmUnreadTotal(threads: PmThread[]): number {
  // 照 A `_pmUnreadTotal`：Σ max(0, unreadCount)
  return threads.reduce((sum, t) => {
    const c = Number(t.unreadCount ?? 0);
    return sum + (Number.isFinite(c) && c > 0 ? c : 0);
  }, 0);
}

function commit(next: InboxStoreState): void {
  state = next;
  setInboxBadgeCounts({
    inboxUnread: next.uid ? countUnread(next.messages, next.uid) : 0,
    pmUnread: next.uid ? pmUnreadTotal(next.threads) : 0,
  });
  const snapshot = Array.from(listeners);
  for (const listener of snapshot) {
    try {
      listener(state);
    } catch (err) {
      console.error('[inbox-store] listener failed', err);
    }
  }
}

function safeUnsub(fn: (() => void) | null): void {
  if (!fn) return;
  try {
    fn();
  } catch {
    // 退訂例外不影響呼叫端
  }
}

function openInbox(uid: string): void {
  safeUnsub(inboxUnsub);
  inboxUnsub = null;
  const gen = ++inboxGen;
  const isCurrent = (): boolean => gen === inboxGen && state.uid === uid;
  try {
    inboxUnsub = subscribeInbox(
      uid,
      (messages) => {
        if (!isCurrent()) return;
        commit({ ...state, messages, messagesStatus: 'ready' });
      },
      (err) => {
        if (!isCurrent()) return;
        console.warn('[inbox-store] inbox listener error', err);
        commit({ ...state, messagesStatus: 'error' });
      },
    );
  } catch (err) {
    console.warn('[inbox-store] inbox listener error', err);
    commit({ ...state, messagesStatus: 'error' });
  }
}

function openThreads(uid: string): void {
  safeUnsub(threadsUnsub);
  threadsUnsub = null;
  const gen = ++threadsGen;
  const isCurrent = (): boolean => gen === threadsGen && state.uid === uid;
  try {
    threadsUnsub = subscribeThreads(
      uid,
      (threads) => {
        if (!isCurrent()) return;
        commit({ ...state, threads, threadsStatus: 'ready' });
      },
      (err) => {
        if (!isCurrent()) return;
        console.warn('[inbox-store] pmThreads listener error', err);
        commit({ ...state, threadsStatus: 'error' });
      },
    );
  } catch (err) {
    console.warn('[inbox-store] pmThreads listener error', err);
    commit({ ...state, threadsStatus: 'error' });
  }
}

/**
 * 登入後啟動共用訂閱；同一 uid 重複呼叫不重訂（全站只建一次）。
 * 換 uid 時先退訂舊的、清空狀態再訂新的。
 */
export function startInboxStore(uid: string): void {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) {
    stopInboxStore();
    return;
  }
  if (state.uid === safeUid) return;
  stopInboxStore();
  commit({
    uid: safeUid,
    messages: [],
    messagesStatus: 'loading',
    threads: [],
    threadsStatus: 'loading',
  });
  openInbox(safeUid);
  openThreads(safeUid);
}

/**
 * 只在尚未啟動時啟動（InboxPage 備援：App 層 lazy 主機尚未載入時仍能顯示）。
 * 已由其他 uid 啟動時不搶，避免換帳號過渡期互相覆蓋。
 */
export function ensureInboxStore(uid: string): void {
  if (state.uid !== null) return;
  startInboxStore(uid);
}

/** 登出／換帳號：退訂兩條監聽、清空資料與紅點。 */
export function stopInboxStore(): void {
  inboxGen += 1;
  threadsGen += 1;
  safeUnsub(inboxUnsub);
  safeUnsub(threadsUnsub);
  inboxUnsub = null;
  threadsUnsub = null;
  if (state === IDLE_STATE) return;
  commit(IDLE_STATE);
}

/** 收件匣載入失敗後重試（只重訂收件匣）。 */
export function retryInboxMessages(): void {
  const uid = state.uid;
  if (!uid) return;
  commit({ ...state, messagesStatus: 'loading' });
  openInbox(uid);
}

/** 私訊對話列表載入失敗後重試。 */
export function retryInboxThreads(): void {
  const uid = state.uid;
  if (!uid) return;
  commit({ ...state, threadsStatus: 'loading' });
  openThreads(uid);
}

export function getInboxStoreState(): InboxStoreState {
  return state;
}

export function subscribeInboxStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Preact hook；照 L-04：effect 訂閱後補讀一次目前值。 */
export function useInboxStore(): InboxStoreState {
  const [snapshot, setSnapshot] = useState<InboxStoreState>(state);
  useEffect(() => {
    setSnapshot(state);
    return subscribeInboxStore(setSnapshot);
  }, []);
  return snapshot;
}
