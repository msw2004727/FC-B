import type { TeamDoc } from './types';

/**
 * 俱樂部詳情的記憶體快取（顧問 §3.233 ④）：上次從伺服器讀到的俱樂部文件，回訪先顯示頁首與資訊，背景照常重讀。
 * 只放記憶體、不寫 localStorage／IndexedDB；以「帳號＋俱樂部」區隔，帳號不同就不用。整頁重載即清空。
 * 成員名單不在這裡（成員含他人資料，照舊等伺服器俱樂部文件回來才讀）。
 */
const cache = new Map<string, TeamDoc>();

function keyOf(uid: string | null, teamId: string): string {
  return `${uid ?? ''}|${teamId}`;
}

export function readTeamDetailCache(uid: string | null, teamId: string): TeamDoc | null {
  // 詳情需登入；沒有帳號時不讀不寫，避免所有未登入工作階段共用一格（MiMo P3-1）。
  if (!uid) return null;
  const hit = cache.get(keyOf(uid, teamId));
  return hit ? { ...hit } : null;
}

export function writeTeamDetailCache(uid: string | null, teamId: string, team: TeamDoc | null): void {
  if (!uid) return;
  if (team) cache.set(keyOf(uid, teamId), team);
  else cache.delete(keyOf(uid, teamId));
}

export function resetTeamDetailCacheForTest(): void {
  cache.clear();
}
