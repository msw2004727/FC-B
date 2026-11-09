/**
 * 成員管理寫入編排。
 * 對應 A team-detail.js:1436-1540 changeTeamMemberRoleLevel、
 * :1328-1339 _sendTeamRoleLevelChangeNotice、:1685-1768 editTeamMemberNote；
 * 重算重試對應 api-service.js:2758-2775 promoteUserByUid。
 *
 * 與 A 差異：升降職務不改變人數，因此不寫 `members` 也不呼叫 `recountTeamMembers`；
 * 剔除一般隊員只走 Callable `removeTeamMember`（伺服器交易內剔除並重算人數）；
 * 角色重算、通知與稽核均為 best-effort；
 * 備註補上 120 字硬上限，且不寫無對應 AuditAction 的備註 opLog。
 */
import { callFn } from '@/data/callables';
import { deliverInboxMessage } from '@/data/inbox-delivery';

import {
  canChangeMemberRole,
  canEditMemberMatchData,
  canEditMemberNote,
  canKickMember,
  canManageMembers,
  getMemberRoleChangeTargetForUser,
  getTeamLeaderUidList,
} from '../../club-policy';
import type { MemberRoleTarget } from '../../club-policy';
import type { TeamUserLike } from '../../data/team-list-model';
import {
  MEMBER_MATCH_LIMITS,
  saveTeamMemberMatchData,
  saveTeamMemberNote,
  saveTeamRoleChange,
} from '../../data/teams-write';
import type { ClubViewer, TeamDoc } from '../../data/types';

export type RoleChangeResult =
  | { ok: true; target: MemberRoleTarget }
  | { ok: false; reason: 'forbidden' | 'no-target' };

export interface ChangeMemberRoleInput {
  team: TeamDoc;
  viewer: ClubViewer;
  targetUid: string;
  /** 呼叫當下的使用者文件快照；預檢與交易 guard 共用。 */
  targetUser: TeamUserLike | null | undefined;
  /** 顯示名稱空白時使用 UID；僅用於名稱快取，不用於權限判斷。 */
  displayName: string;
  direction: 'promote' | 'demote';
}

export type NoteResult =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'invalid' };

export interface SaveMemberNoteInput {
  team: TeamDoc;
  viewer: ClubViewer;
  memberKey: string;
  /** 空字串代表清除備註。 */
  notes: string;
  existingRecord?: Record<string, unknown> | null;
  now?: Date;
}

export function getRoleChangeLabels(target: MemberRoleTarget): {
  actionText: '晉升' | '降級';
  roleName: '教練' | '領隊' | '成員';
} {
  const roleNames = {
    coach: '教練',
    leader: '領隊',
    member: '成員',
  } as const;
  return {
    actionText: target.direction === 'promote' ? '晉升' : '降級',
    roleName: roleNames[target.key],
  };
}

export function getTeamRoleOfMember(
  team: TeamDoc,
  uid: string,
): 'captain' | 'leader' | 'coach' | 'member' {
  const normalizedUid = uid.trim();
  if (!normalizedUid) return 'member';
  if (String(team.captainUid ?? '').trim() === normalizedUid) return 'captain';

  const containsUid = (values: unknown): boolean =>
    Array.isArray(values)
    && values.some((value: unknown) => String(value ?? '').trim() === normalizedUid);

  if (getTeamLeaderUidList(team).includes(normalizedUid)) return 'leader';
  if (containsUid(team.coachUids)) return 'coach';
  return 'member';
}

function isRetryableRoleError(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false;
  const code = error.code;
  if (typeof code !== 'string') return false;
  return ['internal', 'unavailable', 'deadline-exceeded']
    .includes(code.replace(/^functions\//, ''));
}

export async function recalculateRole(targetUid: string, teamId: string) {
  try {
    return await callFn('autoPromoteTeamRole', { targetUid, teamId });
  } catch (error: unknown) {
    if (!isRetryableRoleError(error)) throw error;
    // A 最多兩次；第二次的錯誤由外層 best-effort 處理，不繼續重試。
    return await callFn('autoPromoteTeamRole', { targetUid, teamId });
  }
}

export async function bestEffort(label: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // 不將成員資料或遠端錯誤本文寫入 console。
    // eslint-disable-next-line no-console
    console.warn(`[member-management-actions] ${label} failed`);
  }
}

export async function changeMemberRole(
  input: ChangeMemberRoleInput,
): Promise<RoleChangeResult> {
  const { team, viewer, direction } = input;
  const targetUid = input.targetUid.trim();
  const target = getMemberRoleChangeTargetForUser(
    viewer, team, input.targetUser, direction,
  );
  if (!target) {
    return {
      ok: false,
      reason: canChangeMemberRole(viewer, team) ? 'no-target' : 'forbidden',
    };
  }
  const targetUserUid = String(
    input.targetUser?.uid ?? input.targetUser?._docId ?? '',
  ).trim();
  if (targetUserUid !== targetUid) return { ok: false, reason: 'no-target' };

  const displayName = input.displayName.trim() || targetUid;
  let statusFrom = getTeamRoleOfMember(team, targetUid);

  // 升降職務不改變人數，因此不寫 members，也不需重算人數。
  // 主要寫入失敗直接往外拋，所有後續副作用都不啟動。
  const updates = await saveTeamRoleChange(
    team,
    targetUid,
    target.key,
    displayName,
    (fresh) => {
      // fresh 是交易讀到的最新 team；targetUser 沿用呼叫當下的使用者文件快照。
      if (getMemberRoleChangeTargetForUser(
        viewer, fresh, input.targetUser, direction,
      )?.key !== target.key) {
        return false;
      }
      // 交易可能重試；成功回傳時保留最後一次 guard 所讀到的變更前角色。
      statusFrom = getTeamRoleOfMember(fresh, targetUid);
      return true;
    },
  );
  if (!updates) return { ok: false, reason: 'no-target' };

  const teamId = String(team.id ?? team._docId ?? '');
  const teamName = team.name || '俱樂部';

  const { roleName } = getRoleChangeLabels(target);
  const title = '俱樂部層級調整';
  const body = `您在「${teamName}」的俱樂部層級已調整為${roleName}。`;

  await Promise.allSettled([
    bestEffort('autoPromoteTeamRole', () => recalculateRole(targetUid, teamId)),
    bestEffort('deliverInboxMessage', () => deliverInboxMessage({
      title,
      body,
      category: 'system',
      categoryName: '系統',
      targetUid,
      senderName: '系統',
      senderUid: viewer.uid,
    })),
    // 與站內信獨立；站內信失敗不阻止 LINE 排程。
    bestEffort('enqueuePrivilegedLineNotification', () =>
      callFn('enqueuePrivilegedLineNotification', {
        uid: targetUid,
        title,
        body,
        category: 'system',
        source: `team_role_assignment:${target.key}`,
      })),
    // A 的 team_member_level_promote/demote opLog 對應 B AuditAction.role_change。
    bestEffort('writeAuditLog', () => callFn('writeAuditLog', {
      action: 'role_change',
      targetType: 'team',
      targetId: teamId,
      targetLabel: teamName,
      result: 'success',
      source: 'web',
      meta: { teamId, statusFrom, statusTo: target.key },
    })),
  ]);

  return { ok: true, target };
}

export async function saveMemberActivityNote(
  input: SaveMemberNoteInput,
): Promise<NoteResult> {
  const { team, viewer, notes, existingRecord, now } = input;
  if (!canEditMemberNote(viewer, team)) return { ok: false, reason: 'forbidden' };

  const memberKey = input.memberKey.trim();
  if (!memberKey || typeof notes !== 'string' || notes.trim().length > 120) {
    return { ok: false, reason: 'invalid' };
  }

  await saveTeamMemberNote(team, 'activity', memberKey, {
    notes: notes.trim(),
    updatedAt: (now ?? new Date()).toISOString(),
  }, existingRecord ?? null);

  // B AuditAction 沒有備註更新項目；不冒用其他 action，也不移植 A opLog。
  return { ok: true };
}

export type KickMemberResult =
  | { ok: true; alreadyRemoved: boolean }
  | { ok: false; reason: 'forbidden' | 'not-regular' };

/**
 * 剔除一般隊員（K4）。對應 A `removeTeamMember`（team-detail.js），改走 Callable `removeTeamMember`：
 * 伺服器在交易內重驗幹部身分、改被剔者隊籍、寫 operationLogs，並重算人數。
 * 球經／領隊／教練不可直接剔除（站長 11-02：先降職再剔除）；按鈕與本函式共用 `canKickMember`。
 * Callable 錯誤往外拋，由呼叫端以 `getKickErrorMessage` 轉成提示。
 */
export async function kickTeamMember(input: {
  team: TeamDoc;
  viewer: ClubViewer;
  targetUid: string;
}): Promise<KickMemberResult> {
  const { team, viewer } = input;
  const targetUid = input.targetUid.trim();
  if (!canKickMember(viewer, team, targetUid)) {
    return { ok: false, reason: canManageMembers(viewer, team) ? 'not-regular' : 'forbidden' };
  }
  const teamId = String(team.id ?? team._docId ?? '').trim();
  const res = await callFn('removeTeamMember', { teamId, memberUid: targetUid });
  return { ok: true, alreadyRemoved: res?.alreadyRemoved === true };
}

/** removeTeamMember 錯誤碼 → A 文案（team-detail.js `removeTeamMember`）。 */
export function getKickErrorMessage(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';
  if (message.includes('TARGET_IS_STAFF')) return '僅可移除一般成員';
  if (message.includes('MEMBER_NOT_FOUND')) return '成員資料不存在或已不在俱樂部中';
  // 伺服器拒絕文件 id 與 id 欄位不一致的舊格式俱樂部（與刪除俱樂部同一 resolver）；重試無效，不叫人重試
  if (message.includes('TEAM_ID_MISMATCH')) return '此俱樂部資料格式較舊，請聯繫管理員處理';
  if (message.includes('TEAM_MANAGE_DENIED') || message.includes('COACH_PLUS_REQUIRED')) {
    return '您沒有移除成員的權限';
  }
  return '移除失敗，請稍後再試';
}

export interface SaveMemberMatchInput {
  team: TeamDoc;
  viewer: ClubViewer;
  memberKey: string;
  jerseyNumber: string;
  position: string;
  notes: string;
  /** 只用於操作日誌內容。 */
  memberName: string;
  now?: Date;
}

/**
 * 背號／位置編輯（K6）。對應 A `editTeamMemberMatchData`：守衛 `_canManageTeamMembers`，
 * 寫 `teams.memberMatchData.{memberKey}`，並照 A 寫一筆 `team_member_match_data_update` 操作日誌（best-effort）。
 */
export async function saveMemberMatchData(input: SaveMemberMatchInput): Promise<NoteResult> {
  const { team, viewer } = input;
  if (!canEditMemberMatchData(viewer, team)) return { ok: false, reason: 'forbidden' };
  const memberKey = input.memberKey.trim();
  const jerseyNumber = String(input.jerseyNumber ?? '').trim();
  const position = String(input.position ?? '').trim();
  const notes = String(input.notes ?? '').trim();
  if (
    !memberKey
    || jerseyNumber.length > MEMBER_MATCH_LIMITS.jerseyNumber
    || position.length > MEMBER_MATCH_LIMITS.position
    || notes.length > MEMBER_MATCH_LIMITS.notes
  ) {
    return { ok: false, reason: 'invalid' };
  }

  await saveTeamMemberMatchData(team, memberKey, {
    jerseyNumber,
    position,
    notes,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });

  const teamName = team.name || String(team.id ?? '');
  await bestEffort('writeOpLog', async () => {
    const { writeOpLog } = await import('@/data/op-log');
    await writeOpLog({
      type: 'team_member_match_data_update',
      typeName: '編輯成員賽事數據',
      content: `更新「${input.memberName.trim() || memberKey}」在「${teamName}」的賽事數據`,
      actorUid: viewer.uid,
      // 實際傳入的是 useViewer()（含 displayName）；ClubViewer 最小介面沒有此欄，缺值照 A 用「系統」。
      operator: String((viewer as { displayName?: unknown }).displayName ?? '').trim() || '系統',
    });
  });
  return { ok: true };
}
