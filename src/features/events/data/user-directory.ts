import { getCurrentUser } from '@/data/auth';
import { callFn } from '@/data/callables';

export interface DirectoryUser {
  uid: string;
  name: string;
  displayName: string;
  pictureUrl: string;
  role: string;
}

export interface DirectoryVerification {
  ok: boolean;
  users: DirectoryUser[];
  missingUids: string[];
  reason: string;
}

let ownerUid = '';
let generation = 0;
let loaded = false;
let cache: DirectoryUser[] = [];
/** 照 A `_userDirectoryLoadPromise`＋`_userDirectoryLoadUid`：同一登入者的進行中請求共用。 */
let pending: { uid: string; promise: Promise<boolean> } | null = null;

/** 照 A getAuthUser；切換帳號即隔離目錄。 */
async function currentOwner(): Promise<string> {
  const uid = String((await getCurrentUser())?.uid || '').trim();
  if (uid !== ownerUid) {
    ownerUid = uid;
    generation += 1;
    loaded = false;
    cache = [];
    pending = null;
  }
  return uid;
}

/** 照 A _normalizeUserDirectory。 */
function normalize(entries: readonly unknown[]): DirectoryUser[] {
  const seen = new Set<string>();
  const users: DirectoryUser[] = [];
  for (const entry of entries) {
    const source = entry && typeof entry === 'object'
      ? entry as Record<string, unknown>
      : {};
    const uid = String(source.uid || '').trim();
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    const name = String(source.name || source.displayName || '').trim();
    const displayName = String(source.displayName || source.name || '').trim();
    users.push({
      uid,
      name: name || displayName || '未知',
      displayName,
      pictureUrl: typeof source.pictureUrl === 'string' ? source.pictureUrl.trim() : '',
      role: String(source.role || 'user').trim() || 'user',
    });
  }
  return users;
}

export function getUserDirectory(): readonly DirectoryUser[] {
  // 換帳號時下一次 load／verify 會清空快取（currentOwner）；這裡只讀。
  return cache;
}

/** 照 A ensureUserDirectoryReady；同一登入者併發呼叫共用同一個進行中請求。 */
export async function loadUserDirectory(options: { force?: boolean } = {}): Promise<boolean> {
  const uid = await currentOwner();
  if (!uid) return false;
  if (pending && pending.uid === uid) return pending.promise;
  if (!options.force && loaded) return true;
  const requestGeneration = generation;

  const request = (async (): Promise<boolean> => {
    try {
      const response = await callFn('listUserDirectory', {});
      if ((await currentOwner()) !== uid || generation !== requestGeneration) return false;
      if (!Array.isArray(response?.users)) return false;
      cache = normalize(response.users);
      loaded = true;
      return true;
    } catch {
      return false;
    }
  })();

  const entry = { uid, promise: request };
  pending = entry;
  const clear = (): void => {
    if (pending === entry) pending = null;
  };
  request.then(clear, clear);
  return request;
}

/** 照 A verifyUserDirectorySelection；缺少者也從既有快取移除。 */
export async function verifyUserDirectorySelection(
  uids: string[],
): Promise<DirectoryVerification> {
  const requested = [...new Set(uids.map(uid => String(uid || '').trim()).filter(Boolean))];
  const fail = (reason: string): DirectoryVerification => ({
    ok: false,
    users: [],
    missingUids: [...requested],
    reason,
  });
  if (requested.length === 0) {
    return { ok: true, users: [], missingUids: [], reason: '' };
  }

  // ASSUMPTION: B 由 callFn 負責初始化；沒有 A 的 _initialized gate。
  const uid = await currentOwner();
  if (!uid) return fail('unauthenticated');
  const requestGeneration = generation;

  try {
    const response = await callFn('listUserDirectory', { verifyUids: requested });
    if ((await currentOwner()) !== uid || generation !== requestGeneration) return fail('stale-auth');
    const rawUsers: unknown = response?.users;
    if (!Array.isArray(rawUsers)) return fail('invalid-response');

    const requestedSet = new Set(requested);
    const responseUids = rawUsers.map((entry: unknown) => {
      const source = entry && typeof entry === 'object'
        ? entry as Record<string, unknown>
        : {};
      return String(source.uid || '').trim();
    });
    if (
      responseUids.some(value => !value || !requestedSet.has(value))
      || new Set(responseUids).size !== responseUids.length
    ) {
      return fail('invalid-response');
    }

    const users = normalize(rawUsers);
    if (users.length !== rawUsers.length) return fail('invalid-response');
    const returnedSet = new Set(users.map(user => user.uid));
    cache = [...cache.filter(user => !requestedSet.has(user.uid)), ...users];
    const missingUids = requested.filter(value => !returnedSet.has(value));
    return {
      ok: missingUids.length === 0,
      users,
      missingUids,
      reason: missingUids.length === 0 ? '' : 'missing-users',
    };
  } catch {
    return fail('unavailable');
  }
}

/** 照 A _eventDelegateMatchesDirectoryQuery／_searchDelegates。 */
export function searchUserDirectory(
  users: readonly DirectoryUser[],
  query: string,
  excludeUids: readonly string[],
): DirectoryUser[] {
  const normalizedQuery = query.trim().toLowerCase();
  const excluded = new Set(excludeUids);
  return users.filter(user =>
    !excluded.has(user.uid)
    && [user.displayName, user.name, user.uid]
      .some(value => value.toLowerCase().includes(normalizedQuery)),
  ).slice(0, 5);
}
