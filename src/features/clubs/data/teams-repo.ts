/**
 * 俱樂部 Firestore 讀取層（純讀取）。
 *
 * 契約：
 * - 本檔不寫入任何文件、不呼叫 Callable、不做 UI。
 * - `firebase/firestore` 一律以動態 `import()` 載入（與 `@/features/events/data/event-detail.ts` 慣例一致）。
 * - `loadTeamMembers` 需要登入；任一 Firestore 查詢失敗一律往外拋，
 *   不得靜默回空陣列掩蓋權限/網路錯誤。
 */

import { getFirebase } from '@/data/firebase';
import { teams as teamsCollection, users as usersCollection } from '@/data/paths';
import { getTeamStaffIdentity } from './team-detail-model';
import type { TeamDoc, TeamMember } from './types';

let cachedTeams: TeamDoc[] | null = null;

/** 清除 `loadTeams()` 的 session 記憶體快取。 */
export function invalidateTeams(): void {
  cachedTeams = null;
}

/**
 * 讀取 `teams` 全集合。
 *
 * A 也是全量快取；teams 公開可讀（無需登入）。
 * 同一 session 內記憶化；跨頁共用同一陣列參照。
 */
export async function loadTeams(): Promise<TeamDoc[]> {
  if (cachedTeams) return cachedTeams;

  const [{ collection, getDocs }, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
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
 * 讀取 `teams/{teamId}`。
 *
 * @returns `null` 表示文件不存在。
 */
export async function loadTeam(teamId: string): Promise<TeamDoc | null> {
  if (!teamId) return null;

  const [{ doc, getDoc }, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);

  const snap = await getDoc(doc(ctx.db, teamsCollection, teamId));
  if (!snap.exists()) return null;

  const data = snap.data() as TeamDoc;
  return { ...data, _docId: snap.id };
}

/**
 * 讀取 `users` 中屬於該隊伍的成員。
 *
 * 流程：
 *   1. 需要登入（users 只有登入者可讀）；未登入回 null。
 *   2. 併查 `users where teamIds array-contains teamId`（現行）與
 *      `users where teamId == teamId`（legacy）。
 *   3. 以 `getDoc(users/{uid})` 補齊幹部 UID（可能不在上兩查詢結果內）。
 *   4. 以 uid 去重。
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

  const addSnapshot = (snapshot: {
    id: string;
    data: () => unknown;
  }): void => {
    const data = (snapshot.data() ?? {}) as Record<string, unknown>;
    const uid = String((data.uid ?? snapshot.id) ?? '').trim();
    if (!uid) return;
    if (byUid.has(uid)) return;
    byUid.set(uid, { ...(data as TeamMember), uid, _docId: snapshot.id });
  };

  byTeamIds.forEach(addSnapshot);
  byLegacyTeamId.forEach(addSnapshot);

  const staff = getTeamStaffIdentity(team);
  const staffUids = new Set<string>();
  for (const uid of staff.captainUids) staffUids.add(uid);
  for (const uid of staff.leaderUids) staffUids.add(uid);
  for (const uid of staff.coachUids) staffUids.add(uid);

  for (const uid of staffUids) {
    if (byUid.has(uid)) continue;
    const snap = await getDoc(doc(ctx.db, usersCollection, uid));
    if (!snap.exists()) {
      // ASSUMPTION: 幹部 UID 沒有對應 user doc 時仍輸出 stub，
      // 讓呼叫端可顯示佔位列；`buildTeamRoster` 亦會處理 `user = null`。
      byUid.set(uid, { uid, _docId: uid });
      continue;
    }
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    byUid.set(uid, {
      ...(data as TeamMember),
      uid,
      _docId: snap.id,
    });
  }

  return [...byUid.values()];
}
