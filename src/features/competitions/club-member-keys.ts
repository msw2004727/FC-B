// 俱樂部成員比對雙鍵（顧問 §3.846）：與後端 functions-cp main-profile.ts mainTeamKeysOf／readMainTeamKeys 同一規則。
// 舊俱樂部的 teams 文件 id 與文件內 id 欄位（自訂 id）可能不同：報隊 entry.teamId 存文件 id，users.teamIds 存自訂 id（R-ID-004）。
// 鍵＝文件 id，加上「id 欄位是合法隊伍 id 且不等於文件 id」時的自訂 id；成員清單含任一把就算成員。
// 換算順序：成員清單已含文件 id 或清單是空的就不換算；先找 viewer 已載入的俱樂部文件，找不到才補讀一次 teams/{teamId}。
// 畫面只決定看不看得到登錄入口，伺服器 joinRoster 另行守門。
// ASSUMPTION: teams 的 id 欄位只有 canManageAnyTeam 或 Admin SDK 改得了（主站 Rules），換算結果留到登出、換帳號或 viewer:refresh。

import { useEffect, useState } from 'preact/hooks';
import { on } from '@/core/events';
import { peekViewerTeamScan } from '@/features/profile/data/viewer-team-scan';

/** 與後端 TEAM_ID_RE 相同。 */
const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 文件 id 一定在；id 欄位缺漏、不是字串、形狀錯或等於文件 id 時只有一把。 */
export function clubMemberKeysOf(docId: string, idField: unknown): string[] {
  if (typeof idField === 'string' && idField !== docId && TEAM_ID_RE.test(idField)) return [docId, idField];
  return [docId];
}

/** 成員清單含任一把鍵就算成員。teamId 形狀錯一律不算。 */
export function isClubMemberByKeys(memberClubIds: readonly string[], teamId: string, keys: readonly string[]): boolean {
  if (!TEAM_ID_RE.test(teamId)) return false;
  return keys.some((key) => memberClubIds.includes(key));
}

const keyCache = new Map<string, string[]>();
const keyInflight = new Map<string, Promise<string[]>>();

function clearClubKeys(): void {
  keyCache.clear();
  keyInflight.clear();
}

/** 測試用。 */
export function resetClubMemberKeysForTest(): void {
  clearClubKeys();
}

on('auth:changed', () => clearClubKeys());
on('viewer:refresh', () => clearClubKeys());

async function readTeamIdField(teamId: string): Promise<unknown> {
  const [{ getFirebase }, fs] = await Promise.all([
    import('@/data/firebase'),
    import('firebase/firestore'),
  ]);
  const { db } = await getFirebase();
  const snap = await fs.getDoc(fs.doc(db, 'teams', teamId));
  return snap.exists() ? snap.data()?.id : undefined;
}

/**
 * 正式頁的換算（CpInjectedEnv.clubKeys）。讀取失敗只回文件 id 一把、不寫快取，下次重讀。
 * reader 只給測試換掉 Firestore。
 */
export async function loadClubMemberKeys(
  uid: string | null,
  teamId: string,
  reader: (teamId: string) => Promise<unknown> = readTeamIdField,
): Promise<string[]> {
  if (!TEAM_ID_RE.test(teamId)) return [];
  const scanned = uid ? peekViewerTeamScan(uid)?.docs.find((doc) => doc.docId === teamId) : undefined;
  if (scanned) return clubMemberKeysOf(teamId, scanned.data.id);
  const hit = keyCache.get(teamId);
  if (hit) return [...hit];
  let request = keyInflight.get(teamId);
  if (!request) {
    const started = reader(teamId).then((idField) => clubMemberKeysOf(teamId, idField));
    request = started;
    keyInflight.set(teamId, started);
    void started.then(
      (keys) => {
        if (keyInflight.get(teamId) !== started) return;
        keyInflight.delete(teamId);
        keyCache.set(teamId, keys);
      },
      () => {
        if (keyInflight.get(teamId) === started) keyInflight.delete(teamId);
      },
    );
  }
  return request.then((keys) => [...keys], () => [teamId]);
}

export type ClubKeysPort = (uid: string | null, teamId: string) => Promise<readonly string[]>;

/**
 * 頁面用：回傳這支報隊的成員鍵與是否還在換算。
 * 不需換算（成員清單已含文件 id、清單是空的、沒注入 clubKeys）時同步回 [teamId]，不讀網路。
 */
export function useClubMemberKeys(
  actor: { uid: string | null; memberClubIds: readonly string[] },
  teamId: string,
  port: ClubKeysPort | undefined,
): { keys: readonly string[]; pending: boolean } {
  const needLookup = !!port && !!teamId && actor.memberClubIds.length > 0 && !actor.memberClubIds.includes(teamId);
  const [loaded, setLoaded] = useState<{ uid: string | null; teamId: string; keys: readonly string[] } | null>(null);

  useEffect(() => {
    if (!needLookup || !port) return undefined;
    let alive = true;
    const uid = actor.uid;
    void port(uid, teamId).then(
      (keys) => { if (alive) setLoaded({ uid, teamId, keys }); },
      () => { if (alive) setLoaded({ uid, teamId, keys: [teamId] }); },
    );
    return () => {
      alive = false;
    };
  }, [needLookup, port, actor.uid, teamId]);

  if (!teamId) return { keys: [], pending: false };
  if (!needLookup) return { keys: [teamId], pending: false };
  if (loaded && loaded.uid === actor.uid && loaded.teamId === teamId) return { keys: loaded.keys, pending: false };
  return { keys: [teamId], pending: true };
}
