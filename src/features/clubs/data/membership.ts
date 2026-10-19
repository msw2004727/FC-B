/**
 * 俱樂部成員資格寫入（FC-B p46 teams）。
 *
 * 決策（已定案，不改）：
 * - 核准、退出 → 前端直寫 `users/{uid}`；payload 形狀必須通過 Rules 的
 *   `isTeamFieldShrinkOrClear` / `isSafeTeamMembershipUpdateByStaff` /
 *   `isSafeGrantedTeamReviewJoinUpdate`；`updatedAt` 用 `serverTimestamp()`。
 * - 不寫 `teams.members`（伺服器 Callable `recountTeamMembers` 維護），
 *   不寫 `teams.coachUids`（Rules 的 `isTeamStaffFieldsOnly` 不含 coachUids）。
 * - 角色重算只走 `autoPromoteTeamRole` Callable。
 * - 申請加入走 `deliverToInbox` + `enqueuePrivilegedLineNotification` + `writeAuditLog`。
 * - 同 groupId 其他幹部訊息同步走 `syncGroupActionStatus`。
 * - 名稱比對分支不移植（R-ID-002），只以 uid 判定。
 * - best-effort 副作用（audit log／推播／broadcast／syncGroupActionStatus）失敗只 warn，
 *   不得讓主結果失敗；主要寫入（users/updateDoc、deliverToInbox-of-request）失敗往外拋。
 *
 * ASSUMPTION: buildLeaveMembershipUpdate 只拿到 selfDoc，無法作 `ApiService.getTeam(id)` 名稱補齊；
 * 這裡以 selfDoc.teamNames 為優先，缺名時用 teamId 補位，與 A 於 `handleLeaveTeam` 中的
 * `teamObj ? teamObj.name : id` 精神一致（A 會重新查 team 名稱）。若不回寫團隊名稱在 Rules
 * 上不影響（`isTeamFieldShrinkOrClear` 只檢查字串型別與 teamName == teamNames[0]）。
 */

import type { Firestore } from 'firebase/firestore';

import { callFn } from '@/data/callables';
import { assertInternalTestWritable } from '@/data/internal-test';
import type {
  EnqueuePrivilegedLineNotificationRequest,
  WriteAuditLogRequest,
} from '@/data/contract/callables';
import { deliverInboxMessage as deliverInbox, type InboxDeliveryExtra } from '@/data/inbox-delivery';
import { getFirebase } from '@/data/firebase';
import { users } from '@/data/paths';

import type { TeamDoc, TeamMember } from './types';

/* ── 型別 ─────────────────────────────────────────── */

export interface MembershipNormalized {
  ids: string[];
  names: string[];
}

export interface ApproveMembershipUpdate {
  changed: boolean;
  update: {
    teamId: string | null;
    teamName: string | null;
    teamIds: string[];
    teamNames: string[];
  };
}

export interface LeaveMembershipUpdate {
  teamId: string | null;
  teamName: string | null;
  teamIds: string[];
  teamNames: string[];
}

export interface InboxMessageForReview {
  id: string;
  meta?: {
    teamId?: string;
    teamName?: string;
    applicantUid?: string;
    applicantName?: string;
    groupId?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface RequestTeamJoinInput {
  team: TeamDoc;
  applicant: TeamMember;
}

export interface ApproveTeamJoinInput {
  team: TeamDoc;
  applicantUid: string;
  message: InboxMessageForReview;
  reviewer: TeamMember;
}

export interface RejectTeamJoinInput {
  team: TeamDoc;
  applicantUid: string;
  message: InboxMessageForReview;
  reviewer: TeamMember;
}

export interface LeaveTeamInput {
  team: TeamDoc;
  self: TeamMember;
}

export interface LeaveTeamResult {
  stillStaff: boolean;
}

/* ── 純函式 ───────────────────────────────────────── */

/**
 * 對應 A `handleTeamJoinAction` 內的 `normalizeMembership`。
 * 優先讀 `teamIds`/`teamNames`，再 push `teamId`/`teamName`；以 id 去重。
 * 缺名時回傳空字串（保留 A 的原始輸出；補位由呼叫端處理）。
 */
export function normalizeMembership(
  userDoc: Record<string, unknown> | null | undefined,
): MembershipNormalized {
  const ids: string[] = [];
  const names: string[] = [];
  const seen = new Set<string>();
  const pushMember = (id: unknown, name: unknown): void => {
    const tid = String(id ?? '').trim();
    if (!tid || seen.has(tid)) return;
    seen.add(tid);
    ids.push(tid);
    names.push(String(name ?? '').trim());
  };

  const teamIds = (userDoc as { teamIds?: unknown } | null | undefined)?.teamIds;
  const teamNames = (userDoc as { teamNames?: unknown } | null | undefined)?.teamNames;
  if (Array.isArray(teamIds)) {
    teamIds.forEach((id, idx) => {
      const name = Array.isArray(teamNames) ? (teamNames[idx] as unknown) : '';
      pushMember(id, name);
    });
  }
  pushMember(
    (userDoc as { teamId?: unknown } | null | undefined)?.teamId,
    (userDoc as { teamName?: unknown } | null | undefined)?.teamName,
  );
  return { ids, names };
}

/**
 * 對應 A `handleTeamJoinAction` 的 approve 分支：
 *  1. 以 live doc 為基礎，
 *  2. 若 applicant 已在 targetTeamId 內 → changed=false，
 *  3. 否則 append 到尾端；新隊名稱缺時用 teamId 補位，
 *  4. teamId/teamName 永遠 == teamIds[0]/teamNames[0]。
 */
export function buildApproveMembershipUpdate(
  applicantLiveDoc: Record<string, unknown> | null | undefined,
  teamId: string,
  teamName: string,
): ApproveMembershipUpdate {
  const targetTeamId = String(teamId ?? '').trim();
  const targetTeamName = String(teamName ?? '').trim();

  const membership = normalizeMembership(applicantLiveDoc);
  const alreadyIn = membership.ids.includes(targetTeamId);

  const update: ApproveMembershipUpdate['update'] = {
    teamId: membership.ids[0] ?? null,
    teamName: membership.names[0] ?? '',
    teamIds: [...membership.ids],
    teamNames: [...membership.names],
  };

  if (!targetTeamId || alreadyIn) {
    return { changed: false, update };
  }

  // ASSUMPTION: A 於 approve 分支只補新隊名稱（不變動既有隊名），
  // 如此才能通過前端 Rules 的 isTeamMembershipPrefixUnchanged 檢查。
  const nextIds = [...membership.ids, targetTeamId];
  const nextNames = [...membership.names, targetTeamName || targetTeamId];
  return {
    changed: true,
    update: {
      teamId: nextIds[0] ?? null,
      teamName: nextNames[0] ?? '',
      teamIds: nextIds,
      teamNames: nextNames,
    },
  };
}

/**
 * 對應 A `handleLeaveTeam` 的 `userTeamUpdates`。
 * 剩餘隊伍 → 取下一隊為第一順位；全部退出 → 清空（必須符合 Rules 的 clear 分支）。
 *
 * ASSUMPTION: 純函式無法做 `ApiService.getTeam(id)` 名稱查詢；
 * 以 selfDoc.teamNames 為主、缺名時用 id 補位（A 則以當下 team 名稱補齊）。
 */
export function buildLeaveMembershipUpdate(
  selfDoc: Record<string, unknown> | null | undefined,
  teamId: string,
): LeaveMembershipUpdate {
  const targetId = String(teamId ?? '').trim();
  const membership = normalizeMembership(selfDoc);
  const remaining: Array<{ id: string; name: string }> = [];
  for (let i = 0; i < membership.ids.length; i += 1) {
    const id = membership.ids[i]!;
    if (id === targetId) continue;
    const rawName = membership.names[i] ?? '';
    remaining.push({ id, name: rawName || id });
  }
  if (remaining.length === 0) {
    return { teamId: null, teamName: null, teamIds: [], teamNames: [] };
  }
  return {
    teamId: remaining[0]!.id,
    teamName: remaining[0]!.name,
    teamIds: remaining.map((r) => r.id),
    teamNames: remaining.map((r) => r.name),
  };
}

/* ── 內部 helper ──────────────────────────────────── */

const SYSTEM_SENDER = '系統';
const SYSTEM_CATEGORY = 'system';
const SYSTEM_CATEGORY_NAME = '系統';

function trimUid(value: unknown): string {
  return String(value ?? '').trim();
}

function trimName(value: unknown): string {
  return String(value ?? '').trim();
}

function getApplicantName(applicant: TeamMember): string {
  return (
    trimName(applicant.displayName)
    || trimName(applicant.name)
    || trimName(applicant.nickname)
    || trimName(applicant._docId)
    || '未知'
  );
}

function getReviewerName(reviewer: TeamMember): string {
  return (
    trimName(reviewer.displayName)
    || trimName(reviewer.name)
    || trimName(reviewer.uid)
    || '審核人'
  );
}

/**
 * 收集 staff UID（captainUid、leaderUids、coachUids）。
 * 名稱比對一律不移植（R-ID-002）。
 */
function collectStaffUids(team: TeamDoc | null | undefined): string[] {
  if (!team) return [];
  const set = new Set<string>();

  const captain = trimUid(team.captainUid);
  if (captain) set.add(captain);

  const leaders = Array.isArray(team.leaderUids)
    ? team.leaderUids
    : (team.leaderUid ? [team.leaderUid] : []);
  for (const raw of leaders) {
    const uid = trimUid(raw);
    if (uid) set.add(uid);
  }

  if (Array.isArray(team.coachUids)) {
    for (const raw of team.coachUids) {
      const uid = trimUid(raw);
      if (uid) set.add(uid);
    }
  }

  return [...set];
}

function isStillTeamStaff(team: TeamDoc | null | undefined, uid: string): boolean {
  if (!team || !uid) return false;
  if (trimUid(team.captainUid) === uid) return true;
  const leaders = Array.isArray(team.leaderUids)
    ? team.leaderUids
    : (team.leaderUid ? [team.leaderUid] : []);
  if (leaders.map((l) => trimUid(l)).includes(uid)) return true;
  if (Array.isArray(team.coachUids) && team.coachUids.map((c) => trimUid(c)).includes(uid)) {
    return true;
  }
  return false;
}

interface BuildInboxMessageInput {
  title: string;
  body: string;
  senderName: string;
  actionType?: string | null;
  actionStatus?: string | null;
  meta?: Record<string, unknown> | null;
}

async function getDb(): Promise<Firestore> {
  const { db } = await getFirebase();
  return db as unknown as Firestore;
}

/** best-effort：失敗時 warn（帶函式名與 teamId），不往外拋。 */
async function runBestEffort(
  fn: () => Promise<unknown>,
  label: string,
  teamId: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[membership] ${label} failed`, { teamId, error: err });
  }
}

/**
 * 照 A `_deliverMessageWithLinePush(title, body, 'system', '系統', targetUid, senderName, extra)`；
 * 訊息物件由共用的 inbox-delivery 產生（欄位與 A `_deliverMessageToInbox` 相同）。
 * fromUid 由伺服器強制為呼叫者，這裡不傳。
 */
async function deliverInboxMessage(
  targetUid: string,
  input: BuildInboxMessageInput,
): Promise<Record<string, unknown>> {
  const extra: InboxDeliveryExtra = {};
  if (input.actionType != null) extra.actionType = input.actionType;
  if (input.actionStatus != null) extra.actionStatus = input.actionStatus;
  if (input.meta != null) extra.meta = input.meta;
  return deliverInbox({
    title: input.title,
    body: input.body,
    category: SYSTEM_CATEGORY,
    categoryName: SYSTEM_CATEGORY_NAME,
    targetUid,
    senderName: input.senderName,
    senderUid: null,
    extra,
  });
}

/** A41：只走 enqueuePrivilegedLineNotification；dedupeKey 沿用站內信的 dedupeKey（照 A `_deliverMessageWithLinePush`）。 */
async function enqueuePrivilegedLine(input: {
  uid: string;
  title: string;
  body: string;
  source: string;
  dedupeKey?: unknown;
}): Promise<unknown> {
  const request: EnqueuePrivilegedLineNotificationRequest = {
    uid: input.uid,
    title: input.title,
    body: input.body,
    category: SYSTEM_CATEGORY,
    source: input.source,
  };
  if (typeof input.dedupeKey === 'string' && input.dedupeKey) request.dedupeKey = input.dedupeKey;
  await assertInternalTestWritable({ kind: 'line', affectedUids: [input.uid] });
  return callFn('enqueuePrivilegedLineNotification', request);
}

async function writeAudit(payload: Omit<WriteAuditLogRequest, 'source'>): Promise<unknown> {
  return callFn('writeAuditLog', { ...payload, source: 'web' });
}

async function broadcastToOtherStaff(
  team: TeamDoc,
  teamId: string,
  reviewerUid: string,
  body: string,
  lineSource: 'approve' | 'reject',
  labelPrefix: string,
): Promise<void> {
  const others = collectStaffUids(team).filter((uid) => uid && uid !== reviewerUid);
  for (const staffUid of others) {
    await runBestEffort(
      () =>
        deliverInboxMessage(staffUid, {
          title: '入隊申請審核通知',
          body,
          senderName: SYSTEM_SENDER,
        }),
      `${labelPrefix}.deliverBroadcast`,
      teamId,
    );
    await runBestEffort(
      () =>
        enqueuePrivilegedLine({
          uid: staffUid,
          title: '入隊申請審核通知',
          body,
          source: `team_join_review:broadcast:${lineSource}`,
        }),
      `${labelPrefix}.enqueueLineBroadcast`,
      teamId,
    );
  }
}

/* ── 非同步：申請加入 ─────────────────────────────── */

export async function requestTeamJoin({
  team,
  applicant,
}: RequestTeamJoinInput): Promise<{ groupId: string } | void> {
  const teamId = trimUid(team?.id);
  const teamName = trimName(team?.name);
  const applicantUid = trimUid(applicant?.uid ?? applicant?._docId);
  const applicantName = getApplicantName(applicant ?? {});

  if (!teamId) {
    throw new Error('[membership] requestTeamJoin: team.id is required');
  }
  if (!applicantUid) {
    throw new Error('[membership] requestTeamJoin: applicant.uid is required');
  }

  const staffUids = collectStaffUids(team);
  if (staffUids.length === 0) {
    throw new Error('[membership] requestTeamJoin: no staff to review');
  }
  await assertInternalTestWritable({
    kind: 'team',
    affectedUids: [applicantUid, ...staffUids],
  });

  const groupId = `tjr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const body = `${applicantName} 申請加入「${teamName}」俱樂部，請審核此申請。`;
  const meta = { teamId, teamName, applicantUid, applicantName, groupId };

  // 逐位幹部投遞；單一失敗只 warn；全部失敗視為主結果失敗。
  let successCount = 0;
  const envelope = staffUids.map((staffUid) => ({ staffUid }));
  for (const { staffUid } of envelope) {
    let delivered: Record<string, unknown> | null = null;
    try {
      delivered = await deliverInboxMessage(staffUid, {
        title: '俱樂部加入申請',
        body,
        senderName: applicantName,
        actionType: 'team_join_request',
        actionStatus: 'pending',
        meta,
      });
      successCount += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      // R-SAFE-012：log 不印收件人 UID。
      console.warn('[membership] requestTeamJoin.deliverToInbox failed', {
        teamId,
        error: err,
      });
    }
    await runBestEffort(
      () =>
        enqueuePrivilegedLine({
          uid: staffUid,
          title: '俱樂部加入申請',
          body,
          source: 'team_join_request',
          dedupeKey: delivered?.['dedupeKey'],
        }),
      'requestTeamJoin.enqueuePrivilegedLineNotification',
      teamId,
    );
  }

  if (successCount === 0) {
    throw new Error('[membership] requestTeamJoin: all staff deliveries failed');
  }

  await runBestEffort(
    () =>
      writeAudit({
        action: 'team_join_request',
        targetType: 'team',
        targetId: teamId,
        targetLabel: teamName,
        result: 'success',
        meta: { teamId },
      }),
    'requestTeamJoin.writeAuditLog',
    teamId,
  );

  return { groupId };
}

/* ── 非同步：核准 ─────────────────────────────────── */

export async function approveTeamJoin({
  team,
  applicantUid,
  message,
  reviewer,
}: ApproveTeamJoinInput): Promise<{ changed: boolean }> {
  const teamId = trimUid(team?.id);
  const metaTeamName = trimName(message?.meta?.teamName);
  const teamName = metaTeamName || trimName(team?.name);
  const reviewerUid = trimUid(reviewer?.uid);
  const reviewerName = getReviewerName(reviewer ?? {});
  const applicantName = trimName(message?.meta?.applicantName) || '未知';
  const groupId = trimName(message?.meta?.groupId);
  const targetApplicantUid = trimUid(applicantUid);

  if (!teamId) throw new Error('[membership] approveTeamJoin: team.id is required');
  if (!targetApplicantUid) {
    throw new Error('[membership] approveTeamJoin: applicantUid is required');
  }
  await assertInternalTestWritable({
    kind: 'team',
    affectedUids: [targetApplicantUid, reviewerUid, ...collectStaffUids(team)],
  });

  // 1. 讀 applicant live 文件
  const db = await getDb();
  const { doc, getDoc, updateDoc, serverTimestamp } = await import('firebase/firestore');
  const liveSnap = await getDoc(doc(db, users, targetApplicantUid));
  const liveData = (liveSnap.exists() ? liveSnap.data() : null) as Record<string, unknown> | null;
  if (!liveData) {
    throw new Error(`[membership] approveTeamJoin: applicant ${targetApplicantUid} not found`);
  }

  // 2. build
  const result = buildApproveMembershipUpdate(liveData, teamId, teamName);

  // 3. 若 changed，寫 users（主要寫入，失敗往外拋）
  if (result.changed) {
    await updateDoc(doc(db, users, targetApplicantUid), {
      ...result.update,
      updatedAt: serverTimestamp(),
    });

    // A 核准不重算角色（新成員沒有幹部職位）；角色重算只在退出時走 autoPromoteTeamRole。

    // TODO(recountTeamMembers): teams.members 由伺服器 Callable 維護，本版不呼叫。

    // 5. 通知 applicant
    const finalTeamName = result.update.teamName || teamName || result.update.teamId || '';
    const notifyBody = `恭喜！您已成功加入「${finalTeamName}」俱樂部，審核人：${reviewerName}。`;
    await runBestEffort(
      () =>
        deliverInboxMessage(targetApplicantUid, {
          title: '俱樂部申請通過',
          body: notifyBody,
          senderName: SYSTEM_SENDER,
        }),
      'approveTeamJoin.deliverApplicant',
      teamId,
    );
    await runBestEffort(
      () =>
        enqueuePrivilegedLine({
          uid: targetApplicantUid,
          title: '俱樂部申請通過',
          body: notifyBody,
          source: 'team_join_review:approve',
        }),
      'approveTeamJoin.enqueueLineToApplicant',
      teamId,
    );

    // 6. audit log
    await runBestEffort(
      () =>
        writeAudit({
          action: 'team_join_approve',
          targetType: 'team',
          targetId: teamId,
          targetLabel: finalTeamName,
          result: 'success',
          meta: { teamId, statusTo: 'approved' },
        }),
      'approveTeamJoin.writeAuditLog',
      teamId,
    );
  }

  // 審核者自己的那則訊息不直寫：inbox Rules 只允許本人改 read／readAt（A 的 updateMessage 對非 admin 會被拒），
  // syncGroupActionStatus 以 collectionGroup 更新同 groupId 所有 pending 訊息（含審核者自己的）。
  // 8. syncGroupActionStatus（best-effort）
  if (groupId) {
    await runBestEffort(
      () =>
        callFn('syncGroupActionStatus', {
          groupId,
          newStatus: 'approved',
          reviewerName,
        }),
      'approveTeamJoin.syncGroupActionStatus',
      teamId,
    );

    // 9. broadcast 給其他幹部
    await broadcastToOtherStaff(
      team,
      teamId,
      reviewerUid,
      `「${reviewerName}」已同意「${applicantName}」加入「${teamName}」的申請。`,
      'approve',
      'approveTeamJoin',
    );
  }

  return { changed: result.changed };
}

/* ── 非同步：拒絕 ─────────────────────────────────── */

export async function rejectTeamJoin({
  team,
  applicantUid,
  message,
  reviewer,
}: RejectTeamJoinInput): Promise<void> {
  const teamId = trimUid(team?.id);
  const metaTeamName = trimName(message?.meta?.teamName);
  const teamName = metaTeamName || trimName(team?.name);
  const reviewerUid = trimUid(reviewer?.uid);
  const reviewerName = getReviewerName(reviewer ?? {});
  const applicantName = trimName(message?.meta?.applicantName) || '未知';
  const groupId = trimName(message?.meta?.groupId);
  const targetApplicantUid = trimUid(applicantUid);

  if (!teamId) throw new Error('[membership] rejectTeamJoin: team.id is required');
  if (!targetApplicantUid) {
    throw new Error('[membership] rejectTeamJoin: applicantUid is required');
  }
  // 拒絕沒有其他持久化寫入，審核狀態只能經 syncGroupActionStatus 落地；沒有 groupId 的舊訊息無法更新，直接拒絕操作。
  if (!groupId) {
    throw new Error('[membership] rejectTeamJoin: message.meta.groupId is required');
  }
  await assertInternalTestWritable({
    kind: 'team',
    affectedUids: [targetApplicantUid, reviewerUid, ...collectStaffUids(team)],
  });

  // 1. 主要寫入：先把同 groupId 的申請訊息改為 rejected，失敗往外拋（避免已通知申請人但訊息仍是 pending）。
  await callFn('syncGroupActionStatus', {
    groupId,
    newStatus: 'rejected',
    reviewerName,
  });

  // 2. 通知 applicant（best-effort，文案照 A）
  const body = `很抱歉，您申請加入「${teamName}」俱樂部未獲通過。如有疑問，請聯繫俱樂部職員。`;
  await runBestEffort(
    () =>
      deliverInboxMessage(targetApplicantUid, {
        title: '俱樂部申請結果',
        body,
        senderName: SYSTEM_SENDER,
      }),
    'rejectTeamJoin.deliverApplicant',
    teamId,
  );
  await runBestEffort(
    () =>
      enqueuePrivilegedLine({
        uid: targetApplicantUid,
        title: '俱樂部申請結果',
        body,
        source: 'team_join_review:reject',
      }),
    'rejectTeamJoin.enqueueLineToApplicant',
    teamId,
  );

  // 3. audit log（best-effort）
  await runBestEffort(
    () =>
      writeAudit({
        action: 'team_join_reject',
        targetType: 'team',
        targetId: teamId,
        targetLabel: teamName,
        result: 'success',
        meta: { teamId, statusTo: 'rejected' },
      }),
    'rejectTeamJoin.writeAuditLog',
    teamId,
  );

  // 4. 通知其他幹部（best-effort）
  await broadcastToOtherStaff(
    team,
    teamId,
    reviewerUid,
    `「${reviewerName}」已拒絕「${applicantName}」加入「${teamName}」的申請。`,
    'reject',
    'rejectTeamJoin',
  );
}

/* ── 非同步：退出 ─────────────────────────────────── */

export async function leaveTeam({
  team,
  self,
}: LeaveTeamInput): Promise<LeaveTeamResult> {
  const teamId = trimUid(team?.id);
  const uid = trimUid(self?.uid ?? self?._docId);
  if (!teamId) throw new Error('[membership] leaveTeam: team.id is required');
  if (!uid) throw new Error('[membership] leaveTeam: self.uid is required');
  await assertInternalTestWritable({
    kind: 'team',
    affectedUids: [uid, ...collectStaffUids(team)],
  });

  // 讀 live self doc（Rules 以 server 端 oldData 為基準；避免 stale self 造成 rules 拒絕）
  const db = await getDb();
  const { doc, getDoc, updateDoc, serverTimestamp } = await import('firebase/firestore');
  const selfSnap = await getDoc(doc(db, users, uid));
  const liveData = (selfSnap.exists() ? selfSnap.data() : (self as Record<string, unknown>))
    || {};

  // build
  const update = buildLeaveMembershipUpdate(liveData, teamId);

  // 主要寫入：users/{uid}
  await updateDoc(doc(db, users, uid), {
    ...update,
    updatedAt: serverTimestamp(),
  });

  // stillStaff：僅由 team 端 staff 陣列判定（B 不寫 teams.coachUids）
  const stillStaff = isStillTeamStaff(team, uid);

  // 角色重算走 Callable（best-effort）
  await runBestEffort(
    () => callFn('autoPromoteTeamRole', { targetUid: uid, teamId }),
    'leaveTeam.autoPromoteTeamRole',
    teamId,
  );

  // TODO(recountTeamMembers): teams.members 由伺服器 Callable 維護，本版不呼叫。

  return { stillStaff };
}
