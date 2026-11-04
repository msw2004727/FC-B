/**
 * T-090h：自建俱樂部轉移經理（Callable `transferUserTeam`，FC functions/team-transfer.js）。
 *
 * - 只給自建俱樂部擁有者使用；入口顯示判斷沿用 club-policy `canOwnerDeleteUserTeam`，最終授權在伺服器。
 * - 候選人取自詳情頁成員名單（buildTeamRoster 的成員列），排除本人與沒有使用者資料的幹部佔位列；
 *   伺服器另以 users.teamIds 檢查會籍（不符回 NEW_OWNER_NOT_MEMBER）。
 * - requestId 由呼叫端在開確認視窗時產生，同一目標重送沿用；伺服器以 _regDedupe 去重。
 */

import type { TransferUserTeamResponse } from '@/data/contract/callables';

import { extractCallableReason } from './user-team-errors';
import { patchCachedTeam } from './teams-repo';
import type { TeamDoc, TeamRosterRow } from './types';

/** 伺服器 REQUEST_ID_RE。 */
export const TRANSFER_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface TransferCandidate {
  uid: string;
  /** 空字串＝名單上沒有可顯示的名字，由畫面補通用文案。 */
  name: string;
}

/** 成員名單 → 可選的新經理（排除本人；幹部佔位列沒有使用者資料，伺服器會回 NEW_OWNER_NOT_FOUND，不列）。 */
export function getTransferCandidates(
  roster: readonly TeamRosterRow[],
  viewerUid: string | null | undefined,
): TransferCandidate[] {
  const self = typeof viewerUid === 'string' ? viewerUid : '';
  const seen = new Set<string>();
  const out: TransferCandidate[] = [];
  for (const row of roster) {
    const uid = String(row.uid ?? '');
    if (!uid || uid === self || !row.isMember || !row.user || seen.has(uid)) continue;
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
  /** 成功後就地更新列表快取的經理名字；空字串不改名字。 */
  newOwnerName?: string;
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
  patchCachedTeam(teamId, {
    captainUid: newOwnerUid,
    creatorUid: newOwnerUid,
    ownerUid: newOwnerUid,
    ...(name ? { captain: name, captainName: name } : {}),
  });
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
