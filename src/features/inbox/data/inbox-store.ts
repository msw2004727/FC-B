// 收件匣共用訂閱（照 A `FirebaseService._startMessagesListener` + `App._startPmThreadListener`）。
//
// A 登入後就常駐兩個監聽：`users/{uid}/inbox`（createdAt 倒序 200 筆）與 `users/{uid}/pmThreads`，
// 鈴鐺紅點與收件匣頁都讀同一份快取。B 照做：App 層（InboxStoreHost）登入後呼叫 `startInboxStore(uid)`，
// 登出或換帳號時 `stopInboxStore()`；InboxPage 只讀這份狀態，不再自己訂閱。
// 第二身份與主身份共用同一個 Auth uid 的收件匣（照 A，不分開）。

// 自我保護（不依賴呼叫端）：
//  - 訂 `auth:changed`：登出或換成別的帳號時自己退訂（App 主機或頁面備援任一方漏退訂都不會殘留）。
//  - 啟動前比對最後確認的登入帳號，不用過時的 uid 重啟。
//  - 監聽出錯後，分頁回到前景時自動重訂出錯的那條（照 A `_setupVisibilityRefresh` → `_resumeListeners`）。

import { useEffect, useState } from 'preact/hooks';

import { on } from '@/core/events';
import { getLastKnownAuthUid } from '@/data/auth';

import { countUnread, isUnread, subscribeInbox, type InboxMessage } from './inbox-repo';
import { pmUnreadTotal, subscribeThreads, type PmThread } from './pm-repo';
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
let stopAuthWatch: (() => void) | null = null;
let stopVisibilityWatch: (() => void) | null = null;

// ── 樂觀已讀（照 A `readMessage` 先改快取再 `updateNotifBadge`；私訊照 A
//    `_optimisticallyMarkPmConversationRead`／`_reconcilePmOptimisticReadThreads`）──
// 監聽收到的原始資料另存；畫面與鈴鐺看的是「原始資料＋尚未確認的已讀標記」。
// 標記只把該則設成已讀／該對話未讀設 0（不做減法），伺服器快照確認已讀後就移除，不會重複扣。
// 寫入失敗＝移除標記，畫面回到伺服器原始資料（還原）；成功後最多保留 10 秒等快照，逾時也回到伺服器資料。

/** 照 A `_reconcilePmOptimisticReadThreads` 的 10 秒逾時。 */
export const OPTIMISTIC_READ_HOLD_MS = 10_000;

interface PendingRead {
  token: number;
  /** 寫入已成功；只有成功後伺服器快照顯示已讀才移除（寫入途中先到的舊快照不算）。 */
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

let rawMessages: InboxMessage[] = [];
let rawThreads: PmThread[] = [];
const pendingInboxRead = new Map<string, PendingRead>();
const pendingPmRead = new Map<string, PendingRead>();
let optimisticToken = 0;

/** 照 A `_pmConversationKey`：優先 conversationId，其次 id、_docId。 */
function threadKey(thread: PmThread | null | undefined): string {
  return String(thread?.conversationId || thread?.id || thread?._docId || '').trim();
}

function clearPending(map: Map<string, PendingRead>): void {
  for (const entry of map.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  map.clear();
}

function deletePending(map: Map<string, PendingRead>, key: string): void {
  const entry = map.get(key);
  if (entry?.timer) clearTimeout(entry.timer);
  map.delete(key);
}

function viewMessages(uid: string | null): InboxMessage[] {
  if (pendingInboxRead.size === 0 || !uid) return rawMessages;
  return rawMessages.map((m) =>
    pendingInboxRead.has(m.id) && isUnread(m, uid) ? { ...m, read: true, unread: false } : m,
  );
}

function viewThreads(): PmThread[] {
  if (pendingPmRead.size === 0) return rawThreads;
  return rawThreads.map((t) =>
    pendingPmRead.has(threadKey(t)) && Number(t.unreadCount ?? 0) > 0 ? { ...t, unreadCount: 0 } : t,
  );
}

/** 寫入成功後伺服器快照已顯示已讀就移除標記；該則已不在也移除。 */
function reconcileInboxPending(uid: string): void {
  for (const [key, entry] of Array.from(pendingInboxRead.entries())) {
    const msg = rawMessages.find((m) => m.id === key);
    if (!msg || (entry.settled && !isUnread(msg, uid))) deletePending(pendingInboxRead, key);
  }
}

function reconcilePmPending(): void {
  for (const [key, entry] of Array.from(pendingPmRead.entries())) {
    const thread = rawThreads.find((t) => threadKey(t) === key);
    if (!thread || (entry.settled && !(Number(thread.unreadCount ?? 0) > 0))) {
      deletePending(pendingPmRead, key);
    }
  }
}

function refreshView(): void {
  if (!state.uid) return;
  commit({ ...state, messages: viewMessages(state.uid), threads: viewThreads() });
}

function settlePending(
  map: Map<string, PendingRead>,
  keys: string[],
  token: number,
  ok: boolean,
): void {
  let changed = false;
  for (const key of keys) {
    const entry = map.get(key);
    if (!entry || entry.token !== token) continue;
    if (!ok) {
      deletePending(map, key);
      changed = true;
      continue;
    }
    entry.settled = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      const current = map.get(key);
      if (!current || current.token !== token) return;
      map.delete(key);
      refreshView();
    }, OPTIMISTIC_READ_HOLD_MS);
    changed = true;
  }
  if (!changed) return;
  // 寫入途中伺服器快照已先顯示已讀時，成功當下就移除，之後的新未讀不會被這個標記蓋住。
  if (ok && state.uid) {
    reconcileInboxPending(state.uid);
    reconcilePmPending();
  }
  refreshView();
}

function beginPending(map: Map<string, PendingRead>, keys: string[]): (ok: boolean) => void {
  const token = ++optimisticToken;
  for (const key of keys) {
    deletePending(map, key);
    map.set(key, { token, settled: false, timer: null });
  }
  refreshView();
  let settled = false;
  return (ok: boolean) => {
    if (settled) return;
    settled = true;
    settlePending(map, keys, token, ok);
  };
}

const NOOP_SETTLE = (): void => {};

/**
 * 收件匣訊息樂觀已讀：立即把這幾則當已讀（鈴鐺立刻扣），回傳結算函式。
 * 寫入成功呼叫 `settle(true)`、失敗呼叫 `settle(false)`（還原成伺服器資料）；只認第一次呼叫。
 * uid 不是目前共用訂閱的帳號時不做事。
 */
export function beginOptimisticInboxRead(uid: string, messageIds: string[]): (ok: boolean) => void {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid || state.uid !== safeUid) return NOOP_SETTLE;
  const keys = (Array.isArray(messageIds) ? messageIds : [])
    .map((id) => String(id ?? '').trim())
    .filter((id) => id && rawMessages.some((m) => m.id === id && isUnread(m, safeUid)));
  if (keys.length === 0) return NOOP_SETTLE;
  return beginPending(pendingInboxRead, keys);
}

/**
 * 私訊對話樂觀已讀：立即把該對話未讀設 0（鈴鐺立刻扣），回傳結算函式（語意同上）。
 * 同一對話再次呼叫會換成新的標記，舊的結算函式失效。
 */
export function beginOptimisticPmRead(uid: string, conversationId: string): (ok: boolean) => void {
  const safeUid = String(uid ?? '').trim();
  const key = String(conversationId ?? '').trim();
  if (!safeUid || !key || state.uid !== safeUid) return NOOP_SETTLE;
  return beginPending(pendingPmRead, [key]);
}

function retryErroredStreams(): void {
  if (!state.uid) return;
  if (state.messagesStatus === 'error') retryInboxMessages();
  if (state.threadsStatus === 'error') retryInboxThreads();
}

function bindWatchers(): void {
  if (!stopAuthWatch) {
    stopAuthWatch = on('auth:changed', ({ uid }) => {
      if (state.uid !== null && uid !== state.uid) stopInboxStore();
    });
  }
  if (!stopVisibilityWatch && typeof document !== 'undefined') {
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') retryErroredStreams();
    };
    document.addEventListener('visibilitychange', onVisibility);
    stopVisibilityWatch = () => document.removeEventListener('visibilitychange', onVisibility);
  }
}

function unbindWatchers(): void {
  stopAuthWatch?.();
  stopAuthWatch = null;
  stopVisibilityWatch?.();
  stopVisibilityWatch = null;
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
        rawMessages = messages;
        reconcileInboxPending(uid);
        commit({ ...state, messages: viewMessages(uid), messagesStatus: 'ready' });
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
        rawThreads = threads;
        reconcilePmPending();
        commit({ ...state, threads: viewThreads(), threadsStatus: 'ready' });
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
 * 已確認的登入帳號（`getLastKnownAuthUid`）和 uid 不同時不啟動（畫面還停在舊帳號的過渡期）；尚未確認時照常啟動。
 */
export function startInboxStore(uid: string): void {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) {
    stopInboxStore();
    return;
  }
  if (state.uid === safeUid) return;
  const authUid = getLastKnownAuthUid();
  if (authUid !== undefined && authUid !== safeUid) return;
  stopInboxStore();
  bindWatchers();
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
  unbindWatchers();
  clearPending(pendingInboxRead);
  clearPending(pendingPmRead);
  rawMessages = [];
  rawThreads = [];
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
