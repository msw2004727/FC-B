// 本機動作日誌。先寫日誌再送出。IndexedDB 不能用時由工作階段改走 MemoryActionLog。

import type { LogEntry, LogPatch } from './types';

export const SCORING_DB = 'fcb-live-scoring';
export const SCORING_DB_VERSION = 1;
const ACTION_STORE = 'actions';
const META_STORE = 'meta';
export const SID_STORE = 'sids';
const MATCH_INDEX = 'match';
export const ACTION_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ActionLog {
  probe(): Promise<boolean>;
  put(entry: LogEntry): Promise<void>;
  get(op: string): Promise<LogEntry | null>;
  list(cid: string, mtId: string): Promise<LogEntry[]>;
  /** 所有場次。韌性日誌切換前用來找出本場與其他場，再逐場 list。 */
  listAll?(): Promise<LogEntry[]>;
  patch(op: string, patch: LogPatch): Promise<LogEntry | null>;
  remove(op: string): Promise<void>;
  removeMatch(cid: string, mtId: string): Promise<void>;
  purgeOlderThan(nowMs: number, maxAgeMs?: number): Promise<void>;
}

export function compareEntries(a: LogEntry, b: LogEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return (a.group?.index ?? 0) - (b.group?.index ?? 0);
}

function cloneEntry(entry: LogEntry): LogEntry {
  return {
    ...entry,
    intent: { ...entry.intent },
    ...(entry.group ? { group: { ...entry.group } } : {}),
  };
}

function applyPatch(entry: LogEntry, patch: LogPatch): LogEntry {
  // 已作廢的項目不再改狀態。重置先落地、原寫入隨後成功時，不能被標回 applied。
  if (entry.state === 'discarded' && patch.state !== undefined && patch.state !== 'discarded') {
    return entry;
  }
  const { seq, rejectReason, group, ...rest } = patch;
  const next: LogEntry = { ...entry, ...rest, intent: patch.intent ?? entry.intent };
  if (seq === null) delete next.seq;
  else if (typeof seq === 'number') next.seq = seq;
  if (rejectReason === null) delete next.rejectReason;
  else if (rejectReason) next.rejectReason = rejectReason;
  if (group === null) delete next.group;
  else if (group) next.group = group;
  return next;
}

export class MemoryActionLog implements ActionLog {
  private readonly rows = new Map<string, LogEntry>();

  async probe(): Promise<boolean> {
    const key = '__probe__';
    const nonce = `m-${Date.now()}-${this.rows.size}`;
    this.rows.set(key, probeEntry(nonce));
    const back = this.rows.get(key);
    this.rows.delete(key);
    return back?.op === key && back.sid === nonce;
  }

  async put(entry: LogEntry): Promise<void> {
    this.rows.set(entry.op, cloneEntry(entry));
  }

  async get(op: string): Promise<LogEntry | null> {
    const row = this.rows.get(op);
    return row ? cloneEntry(row) : null;
  }

  async list(cid: string, mtId: string): Promise<LogEntry[]> {
    const out: LogEntry[] = [];
    for (const row of this.rows.values()) {
      if (row.op === '__probe__') continue;
      if (row.cid === cid && row.mtId === mtId) out.push(cloneEntry(row));
    }
    out.sort(compareEntries);
    return out;
  }

  async patch(op: string, patch: LogPatch): Promise<LogEntry | null> {
    const row = this.rows.get(op);
    if (!row) return null;
    const next = applyPatch(row, patch);
    this.rows.set(op, next);
    return cloneEntry(next);
  }

  async remove(op: string): Promise<void> {
    this.rows.delete(op);
  }

  async removeMatch(cid: string, mtId: string): Promise<void> {
    for (const row of [...this.rows.values()]) {
      if (row.cid === cid && row.mtId === mtId) this.rows.delete(row.op);
    }
  }

  async listAll(): Promise<LogEntry[]> {
    const out: LogEntry[] = [];
    for (const row of this.rows.values()) {
      if (row.op === '__probe__') continue;
      out.push(cloneEntry(row));
    }
    out.sort(compareEntries);
    return out;
  }

  async purgeOlderThan(nowMs: number, maxAgeMs = ACTION_LOG_MAX_AGE_MS): Promise<void> {
    const cut = nowMs - maxAgeMs;
    for (const row of [...this.rows.values()]) {
      if (row.op === '__probe__') continue;
      if (row.createdAt < cut) this.rows.delete(row.op);
    }
  }
}

function probeEntry(nonce: string): LogEntry {
  return {
    op: '__probe__',
    cid: '_',
    mtId: '_',
    uid: '_',
    sid: nonce,
    kind: 'clock',
    intent: {
      kind: 'clock',
      matchSecond: 0,
      clockAction: 'correct',
      clock: { running: false, period: 'pre', pausedSec: 0, startedAt: null },
    },
    state: 'discarded',
    createdAt: 0,
    attempts: 0,
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 請求失敗'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 交易失敗'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 交易中止'));
  });
}

export function openScoringDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(SCORING_DB, SCORING_DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(ACTION_STORE)) {
        const store = db.createObjectStore(ACTION_STORE, { keyPath: 'op' });
        store.createIndex(MATCH_INDEX, ['cid', 'mtId']);
      }
      if (!db.objectStoreNames.contains(SID_STORE)) {
        db.createObjectStore(SID_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('IndexedDB 開不起來'));
  });
}

export class IndexedDbActionLog implements ActionLog {
  private db: IDBDatabase | null = null;

  constructor(private readonly opener: () => Promise<IDBDatabase>) {}

  private async database(): Promise<IDBDatabase> {
    if (!this.db) this.db = await this.opener();
    return this.db;
  }

  async probe(): Promise<boolean> {
    try {
      const db = await this.database();
      const nonce = `p-${Date.now()}`;
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put({ id: 'probe', nonce });
      await txDone(tx);
      const read = db.transaction(META_STORE, 'readonly');
      const back = await requestToPromise(read.objectStore(META_STORE).get('probe'));
      await txDone(read);
      return !!back && (back as { nonce?: string }).nonce === nonce;
    } catch {
      this.db = null;
      return false;
    }
  }

  async put(entry: LogEntry): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(ACTION_STORE, 'readwrite');
    tx.objectStore(ACTION_STORE).put(cloneEntry(entry));
    await txDone(tx);
  }

  async get(op: string): Promise<LogEntry | null> {
    const db = await this.database();
    const tx = db.transaction(ACTION_STORE, 'readonly');
    const row = await requestToPromise(tx.objectStore(ACTION_STORE).get(op));
    await txDone(tx);
    return row ? cloneEntry(row as LogEntry) : null;
  }

  async list(cid: string, mtId: string): Promise<LogEntry[]> {
    const db = await this.database();
    const tx = db.transaction(ACTION_STORE, 'readonly');
    const rows = await requestToPromise(
      tx.objectStore(ACTION_STORE).index(MATCH_INDEX).getAll(IDBKeyRange.only([cid, mtId])),
    );
    await txDone(tx);
    return (rows as LogEntry[]).map(cloneEntry).sort(compareEntries);
  }

  async patch(op: string, patch: LogPatch): Promise<LogEntry | null> {
    const db = await this.database();
    const tx = db.transaction(ACTION_STORE, 'readwrite');
    const store = tx.objectStore(ACTION_STORE);
    // get 與 put 留在同一個 success 回呼，避免交易中途讓出後被覆寫。
    const next = await new Promise<LogEntry | null>((resolve, reject) => {
      const request = store.get(op);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 請求失敗'));
      request.onsuccess = () => {
        const row = request.result as LogEntry | undefined;
        if (!row) {
          resolve(null);
          return;
        }
        const updated = applyPatch(row, patch);
        if (updated !== row) store.put(cloneEntry(updated));
        resolve(cloneEntry(updated));
      };
    });
    await txDone(tx);
    return next;
  }

  async remove(op: string): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(ACTION_STORE, 'readwrite');
    tx.objectStore(ACTION_STORE).delete(op);
    await txDone(tx);
  }

  async removeMatch(cid: string, mtId: string): Promise<void> {
    const rows = await this.list(cid, mtId);
    if (rows.length === 0) return;
    const db = await this.database();
    const tx = db.transaction(ACTION_STORE, 'readwrite');
    const store = tx.objectStore(ACTION_STORE);
    for (const row of rows) store.delete(row.op);
    await txDone(tx);
  }

  async listAll(): Promise<LogEntry[]> {
    const db = await this.database();
    const tx = db.transaction(ACTION_STORE, 'readonly');
    const rows = await requestToPromise(tx.objectStore(ACTION_STORE).getAll());
    await txDone(tx);
    return (rows as LogEntry[])
      .filter((row) => row.op !== '__probe__')
      .map(cloneEntry)
      .sort(compareEntries);
  }

  async purgeOlderThan(nowMs: number, maxAgeMs = ACTION_LOG_MAX_AGE_MS): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(ACTION_STORE, 'readwrite');
    const store = tx.objectStore(ACTION_STORE);
    const cut = nowMs - maxAgeMs;
    // 刪除必須留在 cursor 的 success 回呼裡。await 之後交易已經 inactive。
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const row = cursor.value as LogEntry;
      if (row.createdAt < cut) cursor.delete();
      cursor.continue();
    };
    await txDone(tx);
  }
}

/**
 * IndexedDB 任何操作拋錯就改走記憶體日誌。
 * 切換前先以內層 list 讀出本場與其他場；讀不到才用已見集合。
 * 內層不拋錯時行為與內層相同。
 */
export class ResilientActionLog implements ActionLog {
  private memory: MemoryActionLog | null = null;
  private readonly seen = new Map<string, LogEntry>();
  private switched = false;

  constructor(
    private readonly inner: ActionLog,
    private readonly onUnavailable: () => void,
  ) {}

  private remember(entry: LogEntry | null): void {
    if (!entry || entry.op === '__probe__') return;
    this.seen.set(entry.op, cloneEntry(entry));
  }

  private forgetOp(op: string): void {
    this.seen.delete(op);
  }

  private forgetMatch(cid: string, mtId: string): void {
    for (const row of this.seen.values()) {
      if (row.cid === cid && row.mtId === mtId) this.seen.delete(row.op);
    }
  }

  private forgetOlderThan(cut: number): void {
    for (const row of this.seen.values()) {
      if (row.createdAt < cut) this.seen.delete(row.op);
    }
  }

  /** 先找出場次，再逐場 list。任一步讀不到就回 null，呼叫端改用已見集合。 */
  private async dumpInner(): Promise<LogEntry[] | null> {
    const pairs = new Map<string, { cid: string; mtId: string }>();
    const add = (cid: string, mtId: string) => {
      if (!cid || cid === '_') return;
      pairs.set(`${cid}\0${mtId}`, { cid, mtId });
    };
    for (const row of this.seen.values()) add(row.cid, row.mtId);
    if (typeof this.inner.listAll === 'function') {
      try {
        for (const row of await this.inner.listAll()) add(row.cid, row.mtId);
      } catch {
        // 全量索引失敗時仍用已見場次。
      }
    }
    if (pairs.size === 0) return null;
    try {
      const all: LogEntry[] = [];
      for (const pair of pairs.values()) {
        all.push(...await this.inner.list(pair.cid, pair.mtId));
      }
      return all;
    } catch {
      return null;
    }
  }

  private async failOver(): Promise<MemoryActionLog> {
    if (this.memory) return this.memory;
    const memory = new MemoryActionLog();
    const dumped = await this.dumpInner();
    const source = dumped ?? [...this.seen.values()];
    for (const row of source) {
      if (row.op === '__probe__') continue;
      await memory.put(row);
    }
    this.memory = memory;
    this.seen.clear();
    for (const row of source) this.remember(row);
    if (!this.switched) {
      this.switched = true;
      this.onUnavailable();
    }
    return memory;
  }

  async probe(): Promise<boolean> {
    if (this.memory) return this.memory.probe();
    try {
      return await this.inner.probe();
    } catch {
      const memory = await this.failOver();
      return memory.probe();
    }
  }

  async put(entry: LogEntry): Promise<void> {
    if (this.memory) {
      await this.memory.put(entry);
      this.remember(entry);
      return;
    }
    try {
      await this.inner.put(entry);
      this.remember(entry);
    } catch {
      const memory = await this.failOver();
      await memory.put(entry);
      this.remember(entry);
    }
  }

  async get(op: string): Promise<LogEntry | null> {
    if (this.memory) return this.memory.get(op);
    try {
      const row = await this.inner.get(op);
      this.remember(row);
      return row;
    } catch {
      const memory = await this.failOver();
      return memory.get(op);
    }
  }

  async list(cid: string, mtId: string): Promise<LogEntry[]> {
    if (this.memory) return this.memory.list(cid, mtId);
    try {
      const rows = await this.inner.list(cid, mtId);
      for (const row of rows) this.remember(row);
      return rows;
    } catch {
      const memory = await this.failOver();
      return memory.list(cid, mtId);
    }
  }

  async patch(op: string, patch: LogPatch): Promise<LogEntry | null> {
    if (this.memory) {
      const next = await this.memory.patch(op, patch);
      this.remember(next);
      return next;
    }
    try {
      const next = await this.inner.patch(op, patch);
      this.remember(next);
      return next;
    } catch {
      const memory = await this.failOver();
      const next = await memory.patch(op, patch);
      this.remember(next);
      return next;
    }
  }

  async remove(op: string): Promise<void> {
    if (this.memory) {
      await this.memory.remove(op);
      this.forgetOp(op);
      return;
    }
    try {
      await this.inner.remove(op);
      this.forgetOp(op);
    } catch {
      const memory = await this.failOver();
      await memory.remove(op);
      this.forgetOp(op);
    }
  }

  async removeMatch(cid: string, mtId: string): Promise<void> {
    if (this.memory) {
      await this.memory.removeMatch(cid, mtId);
      this.forgetMatch(cid, mtId);
      return;
    }
    try {
      await this.inner.removeMatch(cid, mtId);
      this.forgetMatch(cid, mtId);
    } catch {
      const memory = await this.failOver();
      await memory.removeMatch(cid, mtId);
      this.forgetMatch(cid, mtId);
    }
  }

  async purgeOlderThan(nowMs: number, maxAgeMs?: number): Promise<void> {
    const cut = nowMs - (maxAgeMs ?? ACTION_LOG_MAX_AGE_MS);
    if (this.memory) {
      await this.memory.purgeOlderThan(nowMs, maxAgeMs);
      this.forgetOlderThan(cut);
      return;
    }
    try {
      await this.inner.purgeOlderThan(nowMs, maxAgeMs);
      this.forgetOlderThan(cut);
    } catch {
      const memory = await this.failOver();
      await memory.purgeOlderThan(nowMs, maxAgeMs);
      this.forgetOlderThan(cut);
    }
  }
}
