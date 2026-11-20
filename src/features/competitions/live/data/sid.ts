// 本機 sid。只存在這支裝置，送出時絕不改用接手文件上的 sid。

import { SID_STORE } from './action-log';

export interface SidStore {
  get(cid: string, mtId: string, uid: string): Promise<string | null>;
  set(cid: string, mtId: string, uid: string, sid: string): Promise<void>;
}

export function sidKey(cid: string, mtId: string, uid: string): string {
  return `${cid}\t${mtId}\t${uid}`;
}

export function memorySidStore(): SidStore {
  const rows = new Map<string, string>();
  return {
    async get(cid, mtId, uid) {
      return rows.get(sidKey(cid, mtId, uid)) ?? null;
    },
    async set(cid, mtId, uid, sid) {
      rows.set(sidKey(cid, mtId, uid), sid);
    },
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 請求失敗'));
  });
}

export function idbSidStore(db: IDBDatabase): SidStore {
  return {
    async get(cid, mtId, uid) {
      const tx = db.transaction(SID_STORE, 'readonly');
      const row = await requestToPromise(tx.objectStore(SID_STORE).get(sidKey(cid, mtId, uid)));
      return row ? (row as { sid: string }).sid : null;
    },
    async set(cid, mtId, uid, sid) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SID_STORE, 'readwrite');
        tx.objectStore(SID_STORE).put({ id: sidKey(cid, mtId, uid), sid });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('sid 寫入失敗'));
        tx.onabort = () => reject(tx.error ?? new Error('sid 寫入中止'));
      });
    },
  };
}
