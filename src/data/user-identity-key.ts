/**
 * users 文件的「同一人」鍵。
 *
 * 舊格式帳號遷移後舊文件不刪：同一人可能有舊文件（文件 ID ≠ uid，常缺 `uid` 欄位）與正本（文件 ID == uid）。
 * 鍵依序取 `uid` → `lineUserId` → 文件 ID（同 A `_mapUserDoc` 與後端 `getUserIdentityKey`，R-ID-002 不用名稱）。
 * 文件 ID 等於鍵的那份是正本；兩份並存時以正本為準。
 */
import type { CollectionReference } from 'firebase/firestore';

import type { FirestoreSdk } from './firestore-sdk';

function nonEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function userIdentityKey(docId: string, data: unknown): string {
  const d = (data ?? {}) as { uid?: unknown; lineUserId?: unknown };
  return nonEmpty(d.uid) || nonEmpty(d.lineUserId) || nonEmpty(docId);
}

/** 文件 ID 就是此人的鍵（正本）。 */
export function isCanonicalUserDoc(docId: string, key: string): boolean {
  return docId === key;
}

/** `where(documentId(), 'in', …)` 一次最多 30 個值。 */
const DOC_ID_IN_CHUNK = 30;

/**
 * Firestore 合法文件 ID：不含 `/`、不是 `.`／`..`、不是 `__…__`、不超過 1500 bytes。
 * 不合法的鍵不可能有正本，也不能放進 `documentId in`（整批查詢會拋錯）。
 */
function isQueryableDocId(key: string): boolean {
  return (
    key.length > 0
    && !key.includes('/')
    && key !== '.'
    && key !== '..'
    && !/^__.*__$/.test(key)
    && new TextEncoder().encode(key).length <= 1500
  );
}

/**
 * 回傳 keys 中「正本 users/{key} 存在」的鍵。每批 30 個，讀取＝實際存在的筆數（每批至少 1）。
 * 不合法文件 ID 的鍵直接視為沒有正本（不查）。
 */
export async function findCanonicalUserIds(
  fs: Pick<FirestoreSdk, 'getDocs' | 'query' | 'where' | 'documentId' | 'limit'>,
  users: CollectionReference,
  keys: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const queryable = keys.filter(isQueryableDocId);
  for (let i = 0; i < queryable.length; i += DOC_ID_IN_CHUNK) {
    const chunk = queryable.slice(i, i + DOC_ID_IN_CHUNK);
    const snap = await fs.getDocs(fs.query(users, fs.where(fs.documentId(), 'in', chunk), fs.limit(chunk.length)));
    snap.forEach((d) => {
      found.add(d.id);
    });
  }
  return found;
}
