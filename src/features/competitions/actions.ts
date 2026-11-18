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
  cpHostCreate,
  cpHostPublish,
  cpParticipantReport,
  type CpAddRosterByRepInput,
  type CpHostCreateInput,
  type CpHostCreateResult,
  type CpJoinRosterInput,
  type CpPublishResult,
  type CpRegisterEntryInput,
  type CpReportInput,
  type CpReviewEntryInput,
} from './data/cp-callables';
import type { PaymentStatusWrite } from './data/types';

export interface CpActions {
  create(input: CpHostCreateInput): Promise<CpHostCreateResult>;
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
}

export const liveCpActions: CpActions = {
  create: cpHostCreate,
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
};
