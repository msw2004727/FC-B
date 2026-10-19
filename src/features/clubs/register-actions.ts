// 俱樂部：`team_join_request` 的收件匣可操作訊息登錄。
//
// 對應 A `js/modules/message/message-actions-team.js#handleTeamJoinAction` 的權限檢查片段：
//   - 權限碼（`team.review_join` / `team.manage.entry`）：A 只在 `hasPermission` 存在時檢查；
//   - uid 幹部判定：`captainUid`、`leaderUids`（陣列優先，否則 `leaderUid`）、`coachUids`；
//   - `admin`/`super_admin` 直接放行；
//   - `actionStatus !== 'pending'` 一律不可操作。
//
// R-ID-002：A 以名稱比對的分支不移植；本檔僅以 uid 判定。
//
// `actions` 為 approve／reject，分別呼叫 `membership.ts` 的 `approveTeamJoin`／`rejectTeamJoin`，
// team 於動作時才以 `teams-repo.ts#loadTeam(message.meta.teamId)` 取得（避免與 A 的 live 讀取語意分叉）。

import {
  registerMessageAction,
  type InboxMessageLike,
  type MessageActionHandler,
  type MessageActionViewer,
} from '@/core/action-registry';
import { approveTeamJoin, rejectTeamJoin } from '@/features/clubs/data/membership';
import { loadTeam } from '@/features/clubs/data/teams-repo';
import type { TeamDoc } from '@/features/clubs/data/types';

function resolveMetaTeamId(message: InboxMessageLike): string {
  return String(message?.meta?.teamId ?? '').trim();
}

function resolveApplicantUid(message: InboxMessageLike): string {
  return String(message?.meta?.applicantUid ?? '').trim();
}

/**
 * 取得 `team`，並補上 `id`（approveTeamJoin/rejectTeamJoin 需要 `team.id`）。
 * teamId 來源以 `message.meta.teamId` 為準（與 `requestTeamJoin` 寫入的 meta.teamId 同值）。
 */
async function loadTeamForMessage(message: InboxMessageLike): Promise<TeamDoc> {
  const metaTeamId = resolveMetaTeamId(message);
  if (!metaTeamId) {
    throw new Error('team_join_request: message.meta.teamId is required');
  }
  const team = await loadTeam(metaTeamId);
  if (!team) {
    throw new Error(`team_join_request: team not found: ${metaTeamId}`);
  }
  return { ...team, id: String(team.id || metaTeamId) };
}

/** 依 `TeamDoc` 判定幹部（uid-based；R-ID-002：不比對姓名）。 */
function isTeamStaff(team: TeamDoc, uid: string): boolean {
  if (!uid) return false;
  if (String(team.captainUid ?? '').trim() === uid) return true;

  const leaderUids = Array.isArray(team.leaderUids)
    ? team.leaderUids.map((v) => String(v ?? '').trim())
    : (team.leaderUid ? [String(team.leaderUid).trim()] : []);
  if (leaderUids.includes(uid)) return true;

  const coachUids = Array.isArray(team.coachUids)
    ? team.coachUids.map((v) => String(v ?? '').trim())
    : [];
  return coachUids.includes(uid);
}

const handler: MessageActionHandler = {
  async canAct(
    viewer: MessageActionViewer,
    message: InboxMessageLike,
  ): Promise<boolean> {
    const uid = String(viewer?.uid ?? '').trim();
    if (!uid) return false;

    // A：actionStatus 非 pending 就不給操作（已處理的訊息）。
    if (String(message?.actionStatus ?? '').trim() !== 'pending') return false;

    // A：若呼叫端提供 hasPermission，且兩個權限碼都沒授予，直接擋。
    if (
      viewer.hasPermission
      && !viewer.hasPermission('team.review_join')
      && !viewer.hasPermission('team.manage.entry')
    ) {
      return false;
    }

    let team: TeamDoc;
    try {
      team = await loadTeamForMessage(message);
    } catch {
      // 找不到隊或 meta 不完整時不顯示操作（也避免 run 一定失敗）。
      return false;
    }

    if (isTeamStaff(team, uid)) return true;

    const role = String(viewer.role ?? '').trim();
    return role === 'admin' || role === 'super_admin';
  },

  actions: [
    {
      key: 'approve',
      labelKey: 'inbox.action.approve',
      async run(message, viewer): Promise<void> {
        const team = await loadTeamForMessage(message);
        const applicantUid = resolveApplicantUid(message);
        if (!applicantUid) {
          throw new Error('team_join_request: message.meta.applicantUid is required');
        }
        await approveTeamJoin({
          team,
          applicantUid,
          message,
          reviewer: {
            uid: String(viewer.uid ?? ''),
            displayName: viewer.displayName,
          },
        });
      },
    },
    {
      key: 'reject',
      labelKey: 'inbox.action.reject',
      async run(message, viewer): Promise<void> {
        const team = await loadTeamForMessage(message);
        const applicantUid = resolveApplicantUid(message);
        if (!applicantUid) {
          throw new Error('team_join_request: message.meta.applicantUid is required');
        }
        await rejectTeamJoin({
          team,
          applicantUid,
          message,
          reviewer: {
            uid: String(viewer.uid ?? ''),
            displayName: viewer.displayName,
          },
        });
      },
    },
  ],
};

registerMessageAction('team_join_request', handler);
