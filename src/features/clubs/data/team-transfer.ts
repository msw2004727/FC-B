/**
 * T-090h：自建俱樂部轉移經理（Callable `transferUserTeam`，FC functions/team-transfer.js）。
 *
 * - 只給自建俱樂部擁有者使用；入口顯示判斷沿用 club-policy `canOwnerDeleteUserTeam`，最終授權在伺服器。
 * - 候選人取自詳情頁成員名單（buildTeamRoster 的成員列），排除本人、沒有使用者資料的幹部佔位列，
 *   以及 users.teamIds 不含本俱樂部的人（伺服器同一判斷，不符回 NEW_OWNER_NOT_MEMBER）。
 * - requestId 由呼叫端在開確認視窗時產生，同一目標重送沿用；伺服器以 _regDedupe 去重。
 */

import type { TransferUserTeamResponse } from '@/data/contract/callables';

import { extractCallableReason } from './user-team-errors';
import { patchCachedTeamWith } from './teams-repo';
import type { TeamDoc, TeamRosterRow } from './types';

/** 伺服器 REQUEST_ID_RE。 */
export const TRANSFER_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface TransferCandidate {
  uid: string;
  /** 空字串＝名單上沒有可顯示的名字，由畫面補通用文案。 */
  name: string;
}

/**
 * 成員名單 → 可選的新經理（排除本人；幹部佔位列沒有使用者資料，伺服器會回 NEW_OWNER_NOT_FOUND，不列）。
 * 審查 P3-2：只收 user.teamIds 含該俱樂部文件 ID 的人，與伺服器會籍判斷一致（只有舊式 teamId 欄位的人送出必被拒）；
 * 用已載入的名單資料，不增加讀取。
 */
export function getTransferCandidates(
  roster: readonly TeamRosterRow[],
  viewerUid: string | null | undefined,
  teamDocId: string,
): TransferCandidate[] {
  const self = typeof viewerUid === 'string' ? viewerUid : '';
  const seen = new Set<string>();
  const out: TransferCandidate[] = [];
  if (!teamDocId) return out;
  for (const row of roster) {
    const uid = String(row.uid ?? '');
    if (!uid || uid === self || !row.isMember || !row.user || seen.has(uid)) continue;
    const teamIds = row.user.teamIds;
    if (!Array.isArray(teamIds) || !teamIds.includes(teamDocId)) continue;
    seen.add(uid);
    out.push({ uid, name: row.name });
  }
  return out;
}

/** 比照 createUserTeamRequestId；符合 /^[A-Za-z0-9_-]{8,64}$/。 */
export function createTransferRequestId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `utt_${Date.now().toString(36)}_${random}`.slice(0, 64);
}

/** 伺服器直接讀 teams/{teamId}，送文件 ID（自建俱樂部文件 ID 即公開 ID）。 */
export function resolveTransferTeamId(team: Pick<TeamDoc, 'id' | '_docId'>): string {
  return String(team._docId ?? '').trim() || String(team.id ?? '').trim();
}

export interface TransferUserTeamInput {
  teamId: string;
  newOwnerUid: string;
  requestId: string;
  /** 舊經理（呼叫者）UID；成功後從列表快取的領隊／教練名單移除。 */
  callerUid?: string | null;
  /** 成功後就地更新列表快取的經理名字；空字串不改名字。 */
  newOwnerName?: string;
}

type StaffFields = Pick<
  TeamDoc,
  'leaderUids' | 'leaders' | 'leaderNames' | 'leaderUid' | 'leader' | 'coachUids' | 'coaches' | 'coachNames'
>;

/**
 * 後端 functions/team-transfer.js#buildStaffRemoval 的前端版（審查 P3-1）：依 uid 移除領隊／教練，
 * 名字陣列依索引與 uid 陣列對位移除；只回有變動的欄位。用於成功後就地更新列表快取。
 */
export function buildStaffRemoval(team: StaffFields, uid: string): Partial<StaffFields> {
  const updates: Partial<StaffFields> = {};
  const removeUid = (list: unknown): string[] =>
    (Array.isArray(list) ? list : []).filter((value) => value !== uid);
  const removePaired = (names: unknown, uids: unknown): string[] =>
    (Array.isArray(names) ? names : [])
      .filter((_, index) => !(Array.isArray(uids) && uids[index] === uid));

  const leaderUids = Array.isArray(team.leaderUids) ? team.leaderUids : [];
  if (leaderUids.includes(uid) || team.leaderUid === uid) {
    const nextLeaderUids = removeUid(leaderUids);
    const leaderNames = Array.isArray(team.leaders) ? team.leaders : (team.leader ? [team.leader] : []);
    const nextLeaderNames = removePaired(leaderNames, leaderUids);
    updates.leaderUids = nextLeaderUids;
    updates.leaders = nextLeaderNames;
    updates.leaderNames = Array.isArray(team.leaderNames)
      ? removePaired(team.leaderNames, leaderUids) : nextLeaderNames;
    if (team.leaderUid === uid || !nextLeaderUids.includes(String(team.leaderUid ?? ''))) {
      // 後端寫 null；快取型別不收 null，以 undefined 表示無領隊。
      updates.leaderUid = nextLeaderUids[0];
    }
    if (!team.leader || !nextLeaderNames.includes(team.leader)) updates.leader = nextLeaderNames[0] ?? '';
  }
  const coachUids = Array.isArray(team.coachUids) ? team.coachUids : [];
  if (coachUids.includes(uid)) {
    const nextCoachNames = removePaired(team.coaches, coachUids);
    updates.coachUids = removeUid(coachUids);
    updates.coaches = nextCoachNames;
    updates.coachNames = Array.isArray(team.coachNames) ? removePaired(team.coachNames, coachUids) : nextCoachNames;
  }
  return updates;
}

/** 與後端 teamUpdate 同形：先移除舊經理、再從結果移除新經理，三個擁有者欄位與經理名字改為新經理。 */
export function buildTransferCachePatch(
  cached: TeamDoc,
  callerUid: string,
  newOwnerUid: string,
  newOwnerName: string,
): Partial<TeamDoc> {
  const removeOld = callerUid ? buildStaffRemoval(cached, callerUid) : {};
  const afterOld = { ...cached, ...removeOld };
  return {
    ...removeOld,
    ...buildStaffRemoval(afterOld, newOwnerUid),
    captainUid: newOwnerUid,
    creatorUid: newOwnerUid,
    ownerUid: newOwnerUid,
    ...(newOwnerName ? { captain: newOwnerName, captainName: newOwnerName } : {}),
  };
}

export async function transferUserTeamViaCallable(
  input: TransferUserTeamInput,
): Promise<TransferUserTeamResponse> {
  const { teamId, newOwnerUid, requestId } = input;
  if (!teamId || !newOwnerUid || !TRANSFER_REQUEST_ID.test(requestId)) {
    throw new Error('TRANSFER_USER_TEAM_INVALID_INPUT');
  }
  const { callFn } = await import('@/data/callables');
  const res = await callFn('transferUserTeam', { requestId, teamId, newOwnerUid });
  const name = String(input.newOwnerName ?? '').trim();
  const callerUid = typeof input.callerUid === 'string' ? input.callerUid : '';
  patchCachedTeamWith(teamId, (cached) => buildTransferCachePatch(cached, callerUid, newOwnerUid, name));
  return res;
}

/** 伺服器原因碼（functions/team-transfer.js 的 fail(...) 與 catch 區）→ i18n key。 */
const TEAM_TRANSFER_KEYS: Readonly<Record<string, string>> = {
  AUTH_REQUIRED: 'clubs.transfer.error.authRequired',
  INVALID_CALLER_UID: 'clubs.transfer.error.accountInvalid',
  USER_IDENTITY_MISMATCH: 'clubs.transfer.error.accountInvalid',
  TRANSFER_USER_TEAM_INVALID_INPUT: 'clubs.transfer.error.invalid',
  TRANSFER_USER_TEAM_UNKNOWN_FIELD: 'clubs.transfer.error.invalid',
  TRANSFER_USER_TEAM_INVALID_REQUEST_ID: 'clubs.transfer.error.invalid',
  TRANSFER_TO_SELF: 'clubs.transfer.error.toSelf',
  TRANSFER_REQUEST_ID_CONFLICT: 'clubs.transfer.error.conflict',
  TEAM_NOT_FOUND: 'clubs.transfer.error.teamNotFound',
  TEAM_NOT_USER_CREATED: 'clubs.transfer.error.notUserCreated',
  TEAM_TRANSFER_DENIED: 'clubs.transfer.error.denied',
  NEW_OWNER_NOT_FOUND: 'clubs.transfer.error.newOwnerNotFound',
  NEW_OWNER_IDENTITY_MISMATCH: 'clubs.transfer.error.newOwnerInvalid',
  NEW_OWNER_NOT_MEMBER: 'clubs.transfer.error.notMember',
  NEW_OWNER_TEAM_LIMIT: 'clubs.transfer.error.newOwnerLimit',
  TRANSFER_USER_TEAM_RETRY: 'clubs.transfer.error.retry',
  TRANSFER_USER_TEAM_FAILED: 'clubs.transfer.error.failed',
};

export const TEAM_TRANSFER_FALLBACK_KEY = 'clubs.transfer.error.failed';

/** transferUserTeam 錯誤 → i18n key；未知錯誤回通用文案，不露原始訊息。 */
export function teamTransferErrorKey(error: unknown): string {
  return TEAM_TRANSFER_KEYS[extractCallableReason(error)] ?? TEAM_TRANSFER_FALLBACK_KEY;
}
