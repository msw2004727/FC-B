/**
 * users 文件的「同一人」鍵。
 *
 * 舊格式帳號遷移後舊文件不刪：同一人可能有舊文件（文件 ID ≠ uid，常缺 `uid` 欄位）與正本（文件 ID == uid）。
 * 鍵依序取 `uid` → `lineUserId` → 文件 ID（同 A `_mapUserDoc` 與後端 `getUserIdentityKey`，R-ID-002 不用名稱）。
 * 文件 ID 等於鍵的那份是正本；兩份並存時以正本為準。
 */
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
