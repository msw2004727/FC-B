/**
 * 俱樂部 Firestore 讀取層（純讀取）。
 *
 * 契約：
 * - 本檔不寫入任何文件、不呼叫 Callable、不做 UI。
 * - `firebase/firestore` 一律以動態 `import()` 載入（與 `@/features/events/data/event-detail.ts` 慣例一致）。
 * - `loadTeamMembers` 需要登入；任一 Firestore 查詢失敗一律往外拋，
 *   不得靜默回空陣列掩蓋權限/網路錯誤。
 */

import { getFirebase, getFirebaseCore } from '@/data/firebase';
import { teams as teamsCollection, users as usersCollection } from '@/data/paths';
import { isCanonicalUserDoc, userIdentityKey } from '@/data/user-identity-key';
import { getTeamStaffIdentity } from './team-detail-model';
import type { TeamDoc, TeamMember } from './types';

let cachedTeams: TeamDoc[] | null = null;

/** 清除 `loadTeams()` 的 session 記憶體快取。 */
export function invalidateTeams(): void {
  cachedTeams = null;
}

function isSameTeam(team: TeamDoc, teamKey: string): boolean {
  return String(team._docId ?? '').trim() === teamKey || String(team.id ?? '').trim() === teamKey;
}

/** 寫入成功後就地更新快取中的單一俱樂部，不重讀整集合（快取不存在時不動）。 */
export function patchCachedTeam(teamKey: string, patch: Partial<TeamDoc>): void {
  const key = teamKey.trim();
  if (!cachedTeams || !key) return;
  cachedTeams = cachedTeams.map((team) => (isSameTeam(team, key) ? { ...team, ...patch } : team));
}

/** 同 patchCachedTeam，但 patch 依快取中的現值計算（巢狀欄位單點更新後用）。 */
export function patchCachedTeamWith(
  teamKey: string,
  buildPatch: (cached: TeamDoc) => Partial<TeamDoc>,
): void {
  const key = teamKey.trim();
  if (!cachedTeams || !key) return;
  cachedTeams = cachedTeams.map((team) => (isSameTeam(team, key) ? { ...team, ...buildPatch(team) } : team));
}

/** 刪除成功後從快取移除該俱樂部，不重讀整集合。 */
export function removeCachedTeam(teamKey: string): void {
  const key = teamKey.trim();
  if (!cachedTeams || !key) return;
  cachedTeams = cachedTeams.filter((team) => !isSameTeam(team, key));
}

/**
 * 讀取 `teams` 全集合。
 *
 * A 也是全量快取；teams 公開可讀（Rules `allow read: if true`），只用 db。
 * 走 getFirebaseCore()：沒有登入旗標的訪客不等 auth／functions。
 * 有登入旗標時，核心初始化仍等第一次 auth 狀態，本函式不拆該閘。
 * 同一 session 內記憶化；跨頁共用同一陣列參照。
 */
export async function loadTeams(): Promise<TeamDoc[]> {
  if (cachedTeams) return cachedTeams;

  const [{ collection, getDocs }, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebaseCore(),
  ]);

  const snap = await getDocs(collection(ctx.db, teamsCollection));
  const out: TeamDoc[] = [];
  snap.forEach((child) => {
    const data = child.data() as TeamDoc;
    out.push({ ...data, _docId: child.id });
  });

  cachedTeams = out;
  return out;
}

/**
 * 以路由上的俱樂部 ID 讀取。R-ID-004 新建俱樂部的文件 ID 等於 `id`，先讀 `teams/{teamId}`；
 * 找不到時照活動 `resolveEventDocId` 的做法以 `where('id','==',teamId)` 補查，涵蓋 public id 與文件 ID 不同的舊資料。
 *
 * 公開讀取，與 `loadTeams` 同一條核心路徑（不需 auth／functions）。
 *
 * @returns `null` 表示兩種方式都找不到。
 */
export async function loadTeam(teamId: string): Promise<TeamDoc | null> {
  if (!teamId) return null;

  const [{ doc, getDoc, collection, query, where, limit, getDocs }, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebaseCore(),
  ]);

  const snap = await getDoc(doc(ctx.db, teamsCollection, teamId));
  if (snap.exists()) {
    const data = snap.data() as TeamDoc;
    return { ...data, _docId: snap.id };
  }

  const byId = await getDocs(query(collection(ctx.db, teamsCollection), where('id', '==', teamId), limit(1)));
  const found = byId.docs[0];
  if (!found) return null;
  return { ...(found.data() as TeamDoc), _docId: found.id };
}

/**
 * 讀取 `users` 中屬於該隊伍的成員。
 *
 * 流程：
 *   1. 需要登入（users 只有登入者可讀）；未登入回 null。
 *   2. 併查 `users where teamIds array-contains teamId`（現行）與
 *      `users where teamId == teamId`（legacy）。
 *   3. 以 `getDoc(users/{uid})` 補齊幹部 UID（可能不在上兩查詢結果內）。
 *      缺席的幹部同時讀，不循序等。讀取筆數不變。
 *   4. 以同一人鍵（uid → lineUserId → 文件 ID）去重，舊文件與正本並存時取正本。
 *      順序仍是查詢結果，再依隊長、領隊、教練補上。
 *      已知未處理：只剩舊文件帶此隊（正本已退隊）的人仍會列出，與後端人數重算一致（健檢 N-01）。
 *
 * `users` 的 Rules 是 `allow read: if isAuth()`，所以這支維持 `getFirebase()`，
 * 等 auth 註冊後再查。公開的俱樂部文件不走這支。
 *
 * 錯誤契約：任一 Firestore 查詢失敗一律往外拋（不吞）。
 */
export async function loadTeamMembers(team: TeamDoc): Promise<TeamMember[] | null> {
  const teamId = team?.id
    ? String(team.id).trim()
    : team?._docId
      ? String(team._docId).trim()
      : '';
  if (!teamId) return [];

  const [{ getCurrentUser }, firestoreMod, ctx] = await Promise.all([
    import('@/data/auth'),
    import('firebase/firestore'),
    getFirebase(),
  ]);

  const current = await getCurrentUser();
  if (!current?.uid) return null;

  const { collection, query, where, getDocs, doc, getDoc } = firestoreMod;
  const usersRef = collection(ctx.db, usersCollection);

  const [byTeamIds, byLegacyTeamId] = await Promise.all([
    getDocs(query(usersRef, where('teamIds', 'array-contains', teamId))),
    getDocs(query(usersRef, where('teamId', '==', teamId))),
  ]);

  const byUid = new Map<string, TeamMember>();

  // 同一人（uid → lineUserId → 文件 ID）只留一列；舊文件與正本並存時用正本的資料（位置不變）。
  const addSnapshot = (snapshot: {
    id: string;
    data: () => unknown;
  }): void => {
    const data = (snapshot.data() ?? {}) as Record<string, unknown>;
    const uid = userIdentityKey(snapshot.id, data);
    if (!uid) return;
    const existing = byUid.get(uid);
    if (existing && (isCanonicalUserDoc(existing._docId ?? '', uid) || !isCanonicalUserDoc(snapshot.id, uid))) return;
    byUid.set(uid, { ...(data as TeamMember), uid, _docId: snapshot.id });
  };

  byTeamIds.forEach(addSnapshot);
  byLegacyTeamId.forEach(addSnapshot);

  const staff = getTeamStaffIdentity(team);
  const staffUids = new Set<string>();
  for (const uid of staff.captainUids) staffUids.add(uid);
  for (const uid of staff.leaderUids) staffUids.add(uid);
  for (const uid of staff.coachUids) staffUids.add(uid);

  // 幹部只由舊文件列出時也補讀正本：正本存在就以正本為準，不存在保留舊文件那列。
  const missingStaffUids = [...staffUids].filter((uid) => {
    const existing = byUid.get(uid);
    return !existing || !isCanonicalUserDoc(existing._docId ?? '', uid);
  });
  if (missingStaffUids.length > 0) {
    const snaps = await Promise.all(
      missingStaffUids.map((uid) => getDoc(doc(ctx.db, usersCollection, uid))),
    );
    missingStaffUids.forEach((uid, index) => {
      const snap = snaps[index];
      if (!snap) {
        throw new Error('[loadTeamMembers] staff read missing');
      }
      if (!snap.exists()) {
        if (byUid.has(uid)) return;
        // ASSUMPTION: 幹部 UID 沒有對應 user doc 時仍輸出 stub，
        // 讓呼叫端可顯示佔位列；`buildTeamRoster` 亦會處理 `user = null`。
        byUid.set(uid, { uid, _docId: uid });
        return;
      }
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      byUid.set(uid, {
        ...(data as TeamMember),
        uid,
        _docId: snap.id,
      });
    });
  }

  return [...byUid.values()];
}
