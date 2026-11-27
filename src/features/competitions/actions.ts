// 畫面用的寫入接點。正式頁用 liveCpActions；測試與 harness 換上假的，不連 Functions。

import {
  cpEntryAddRosterByRep,
  cpEntryConfirmRoster,
  cpEntryJoinRoster,
  cpEntryLeaveRoster,
  cpEntryLockRosters,
  cpEntryRegister,
  cpEntryReview,
  cpEntrySetPaymentStatus,
  cpEntryUnlockRosters,
  cpEntryUpdateRosterNickname,
  cpEntrySyncRosterName,
  cpHostClearSchedule,
  cpHostConfirmMatchResult,
  cpHostCreate,
  cpHostGenerateSchedule,
  cpHostDelete,
  cpHostSetStatus,
  cpEntryWithdraw,
  cpHostDeleteNotice,
  cpHostPostNotice,
  cpHostPublish,
  cpHostRecordResult,
  cpHostRescheduleMatch,
  cpHostShiftMatchDay,
  cpHostSwapMatches,
  cpHostCancelMatch,
  cpHostClearTieDecision,
  cpHostEndCompetition,
  cpHostAssignStaff,
  cpHostExplainTie,
  cpHostRemoveStaff,
  cpHostResetMatch,
  cpHostResolveTie,
  cpHostRestoreCompetition,
  cpHostSetWalkover,
  cpHostUpdate,
  cpParticipantReport,
  cpHostCreateInvite,
  cpHostRevokeInvite,
  cpParticipantAcceptInvite,
  cpParticipantRequestMyDataRemoval,
  cpHostModerate,
  cpHostReviewReport,
  type CpAcceptInviteResult,
  type CpCreateInviteResult,
  type CpDataRemovalResult,
  type CpDeleteResult,
  type CpHostSetStatusInput,
  type CpModerateInput,
  type CpReviewStatus,
  type CpAddRosterByRepInput,
  type CpUpdateRosterNicknameResult,
  type StaffScoreRole,
  type CpForfeitSide,
  type CpGenerateScheduleInput,
  type CpGenerateScheduleResult,
  type CpHostCreateInput,
  type CpHostCreateResult,
  type CpHostUpdateInput,
  type CpJoinRosterInput,
  type CpPublishResult,
  type CpRegisterEntryInput,
  type CpReportInput,
  type CpReviewEntryInput,
  type TieMethod,
} from './data/cp-callables';
import { CpCallError } from './data/cp-callables';
import type { PaymentStatusWrite } from './data/types';

export interface CpActions {
  create(input: CpHostCreateInput): Promise<CpHostCreateResult>;
  /** 編輯已建立的賽事。分類可以改，只送有改的鍵。 */
  update(input: CpHostUpdateInput): Promise<{ cid: string }>;
  publish(input: { cid: string }): Promise<CpPublishResult>;
  registerEntry(input: CpRegisterEntryInput): Promise<unknown>;
  review(input: CpReviewEntryInput): Promise<unknown>;
  joinRoster(input: CpJoinRosterInput): Promise<unknown>;
  addRosterByRep(input: CpAddRosterByRepInput): Promise<unknown>;
  leaveRoster(input: { cid: string; plId: string }): Promise<unknown>;
  updateRosterNickname(input: { cid: string; plId: string; nickname: string | null }): Promise<CpUpdateRosterNicknameResult>;
  syncRosterName(input: { cid: string; plId: string }): Promise<{ cid: string; plId: string; changed: boolean }>;
  confirmRoster(input: { cid: string; enId: string }): Promise<unknown>;
  lockRosters(input: { cid: string }): Promise<unknown>;
  unlockRosters(input: { cid: string; reason: string }): Promise<unknown>;
  setPaymentStatus(input: { cid: string; enId: string; paymentStatus: PaymentStatusWrite }): Promise<unknown>;
  report(input: CpReportInput): Promise<unknown>;
  generateSchedule(input: CpGenerateScheduleInput): Promise<CpGenerateScheduleResult>;
  clearSchedule(input: { cid: string; dvId: string }): Promise<unknown>;
  rescheduleMatch(input: {
    cid: string;
    mtId: string;
    expectedRev: number;
    kickoffAt: number | null;
    venueIdx: number | null;
    force?: boolean;
  }): Promise<unknown>;
  shiftMatchDay(input: {
    cid: string;
    fromDate: string;
    toDate: string;
    reason: string;
    force?: boolean;
  }): Promise<unknown>;
  swapMatches(input: {
    cid: string;
    mtIdA: string;
    mtIdB: string;
    expectedRevA: number;
    expectedRevB: number;
    reason: string;
    force?: boolean;
  }): Promise<unknown>;
  postNotice(input: { cid: string; text: string }): Promise<{ noticeId: string }>;
  deleteNotice(input: { cid: string; noticeId: string }): Promise<unknown>;
  recordResult(input: {
    cid: string;
    mtId: string;
    expectedRev: number;
    score: { home: number; away: number };
    confirm: boolean;
  }): Promise<unknown>;
  confirmMatchResult(input: { cid: string; mtId: string; expectedRev: number }): Promise<unknown>;
  setWalkover(input: {
    cid: string;
    mtId: string;
    expectedRev: number;
    forfeitSide: CpForfeitSide;
    reason: string;
  }): Promise<unknown>;
  resetMatch(input: { cid: string; mtId: string; expectedRev: number; reason: string }): Promise<unknown>;
  cancelMatch(input: { cid: string; mtId: string; expectedRev: number; reason: string }): Promise<unknown>;
  endCompetition(input: { cid: string; reason: string }): Promise<unknown>;
  restoreCompetition(input: { cid: string; reason: string }): Promise<unknown>;
  resolveTie(input: {
    cid: string;
    dvId: string;
    groupId?: string;
    order: string[];
    method: TieMethod;
    reason: string;
    expectedVersion: number;
  }): Promise<unknown>;
  clearTieDecision(input: {
    cid: string;
    dvId: string;
    groupId?: string;
    reason: string;
    expectedVersion: number;
  }): Promise<unknown>;
  explainTie(input: { cid: string; dvId: string; groupId?: string; teamIds: string[] }): Promise<unknown>;
  assignStaff(input: {
    cid: string;
    uid: string;
    roles: readonly StaffScoreRole[];
    matchIds: readonly string[];
    expiresAt?: number;
  }): Promise<unknown>;
  removeStaff(input: { cid: string; uid: string; roles?: readonly string[] }): Promise<unknown>;
  // 以下五支是第 4 步 K11／K12。必填（PM 11-20：cp-open-b 合併後 screen-fixtures 的 idleActions 已補上，取代原本選填＋missingAction）。
  createInvite(input: {
    cid: string;
    roles: readonly StaffScoreRole[];
    matchIds: readonly string[];
    expiresAt?: number;
  }): Promise<CpCreateInviteResult>;
  revokeInvite(input: { cid: string; ivId: string }): Promise<unknown>;
  acceptInvite(input: { cid: string; ivId: string; code: string }): Promise<CpAcceptInviteResult>;
  moderate(input: CpModerateInput): Promise<unknown>;
  reviewReport(input: { cid: string; reportId: string; status: CpReviewStatus }): Promise<unknown>;
  /** 刪除整場賽事（cpHost delete）。刪到一半失敗時再呼叫一次即續刪。 */
  deleteCompetition(input: { cid: string }): Promise<CpDeleteResult>;
  /** 賽事延期、取消、延期後恢復（cpHost setStatus）。 */
  setCompetitionStatus(input: CpHostSetStatusInput): Promise<unknown>;
  /** 代表撤回報名（cpEntry withdrawEntry），連同這隊名單一併移除。 */
  withdrawEntry(input: { cid: string; enId: string }): Promise<unknown>;
  /** 本人移除自己的賽事資料（cpParticipant requestMyDataRemoval，設計 §4.11）。 */
  requestMyDataRemoval(): Promise<CpDataRemovalResult>;
}

export const liveCpActions: CpActions = {
  create: cpHostCreate,
  update: cpHostUpdate,
  publish: cpHostPublish,
  registerEntry: cpEntryRegister,
  review: cpEntryReview,
  joinRoster: cpEntryJoinRoster,
  addRosterByRep: cpEntryAddRosterByRep,
  leaveRoster: cpEntryLeaveRoster,
  updateRosterNickname: cpEntryUpdateRosterNickname,
  syncRosterName: cpEntrySyncRosterName,
  confirmRoster: cpEntryConfirmRoster,
  lockRosters: cpEntryLockRosters,
  unlockRosters: cpEntryUnlockRosters,
  setPaymentStatus: cpEntrySetPaymentStatus,
  report: cpParticipantReport,
  generateSchedule: cpHostGenerateSchedule,
  clearSchedule: cpHostClearSchedule,
  rescheduleMatch: cpHostRescheduleMatch,
  shiftMatchDay: cpHostShiftMatchDay,
  swapMatches: cpHostSwapMatches,
  postNotice: cpHostPostNotice,
  deleteNotice: cpHostDeleteNotice,
  recordResult: cpHostRecordResult,
  confirmMatchResult: cpHostConfirmMatchResult,
  setWalkover: cpHostSetWalkover,
  resetMatch: cpHostResetMatch,
  cancelMatch: cpHostCancelMatch,
  endCompetition: cpHostEndCompetition,
  restoreCompetition: cpHostRestoreCompetition,
  resolveTie: cpHostResolveTie,
  clearTieDecision: cpHostClearTieDecision,
  explainTie: cpHostExplainTie,
  assignStaff: cpHostAssignStaff,
  removeStaff: cpHostRemoveStaff,
  createInvite: cpHostCreateInvite,
  revokeInvite: cpHostRevokeInvite,
  acceptInvite: cpParticipantAcceptInvite,
  moderate: cpHostModerate,
  reviewReport: cpHostReviewReport,
  deleteCompetition: cpHostDelete,
  setCompetitionStatus: cpHostSetStatus,
  withdrawEntry: cpEntryWithdraw,
  requestMyDataRemoval: cpParticipantRequestMyDataRemoval,
};
