// 本機動作日誌。先寫日誌再送出。IndexedDB 不能用時由工作階段改走 MemoryActionLog。

import type { LogEntry, LogPatch } from './types';

export const SCORING_DB = 'fcb-live-scoring';
export const SCORING_DB_VERSION = 1;
const ACTION_STORE = 'actions';
const META_STORE = 'meta';
export const SID_STORE = 'sids';
const MATCH_INDEX = 'match';
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export interface ActionLog {
  probe(): Promise<boolean>;
  put(entry: LogEntry): Promise<void>;
  get(op: string): Promise<LogEntry | null>;
  list(cid: string, mtId: string): Promise<LogEntry[]>;
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

  async purgeOlderThan(nowMs: number, maxAgeMs = SEVEN_DAYS): Promise<void> {
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
    const current = await this.get(op);
    if (!current) return null;
    const next = applyPatch(current, patch);
    await this.put(next);
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

  async purgeOlderThan(nowMs: number, maxAgeMs = SEVEN_DAYS): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(ACTION_STORE, 'readwrite');
    const store = tx.objectStore(ACTION_STORE);
    const rows = await requestToPromise(store.getAll());
    const cut = nowMs - maxAgeMs;
    for (const row of rows as LogEntry[]) {
      if (row.createdAt < cut) store.delete(row.op);
    }
    await txDone(tx);
  }
}
