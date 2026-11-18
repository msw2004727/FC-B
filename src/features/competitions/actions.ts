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
  cpHostClearSchedule,
  cpHostConfirmMatchResult,
  cpHostCreate,
  cpHostGenerateSchedule,
  cpHostPublish,
  cpHostRecordResult,
  cpHostRescheduleMatch,
  cpHostCancelMatch,
  cpHostClearTieDecision,
  cpHostEndCompetition,
  cpHostExplainTie,
  cpHostResetMatch,
  cpHostResolveTie,
  cpHostRestoreCompetition,
  cpHostSetWalkover,
  cpHostUpdate,
  cpParticipantReport,
  type CpAddRosterByRepInput,
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
  }): Promise<unknown>;
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
  confirmRoster: cpEntryConfirmRoster,
  lockRosters: cpEntryLockRosters,
  unlockRosters: cpEntryUnlockRosters,
  setPaymentStatus: cpEntrySetPaymentStatus,
  report: cpParticipantReport,
  generateSchedule: cpHostGenerateSchedule,
  clearSchedule: cpHostClearSchedule,
  rescheduleMatch: cpHostRescheduleMatch,
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
};
