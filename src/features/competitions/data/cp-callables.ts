// 賽事第 2 步 Callable。三支：cpHost、cpEntry、cpParticipant。每個動作一支有型別的函式。
// 欄位照契約 §2、§6。多送的鍵伺服器會回 UNKNOWN_FIELD，所以這裡只組契約列出的鍵，略過 undefined。
// 錯誤從 details.reason 轉成 { reason, params }；沒有 reason 時 reason 為 UNKNOWN。
//
// mock：VITE_CALLABLE_MODE=mock 時走 registerCpMock，不連 Functions（與 src/data/callables.ts 相同判斷）。
// ASSUMPTION: 模擬器模式仍呼叫 getCpFirebase() 接上的本機 Functions，不沿用主站 callFn 的
// 「emulator 一律禁止」擋板。那道擋板是為了避免打到正式 Functions；這裡的實例在模擬器模式已接到本機。
// ASSUMPTION: 更新的四個時間在型別裡包成 schedule，送出時攤成四個欄位，不送 schedule 這個鍵。

import type { DivisionInput, PaymentStatusWrite, ReportReason, Venue } from './types';
import { getCpFirebase } from './cp-firebase';

export type CpCallableName = 'cpHost' | 'cpEntry' | 'cpParticipant';

export interface CpCallErrorShape {
  reason: string;
  params: Record<string, unknown>;
}

export class CpCallError extends Error implements CpCallErrorShape {
  readonly reason: string;
  readonly params: Record<string, unknown>;

  constructor(reason: string, params: Record<string, unknown>) {
    super(reason);
    this.name = 'CpCallError';
    this.reason = reason;
    this.params = params;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readDetails(err: unknown): Record<string, unknown> | null {
  if (!isRecord(err)) return null;
  const direct = err.details;
  if (isRecord(direct)) return direct;
  const custom = err.customData;
  if (isRecord(custom) && isRecord(custom.details)) return custom.details;
  return null;
}

/** 從 Callable 錯誤取出 { reason, params }。未知錯誤 reason 為 UNKNOWN、params 為空。 */
export function toCpCallError(err: unknown): CpCallError {
  if (err instanceof CpCallError) return err;
  const details = readDetails(err);
  const reason = typeof details?.reason === 'string' ? details.reason.trim() : '';
  if (!reason) return new CpCallError('UNKNOWN', {});
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (key !== 'reason') params[key] = value;
  }
  return new CpCallError(reason, params);
}

export type CpMockHandler = (data: Record<string, unknown>) => unknown | Promise<unknown>;

const mocks = new Map<string, CpMockHandler>();

export function registerCpMock(name: CpCallableName, action: string, handler: CpMockHandler): void {
  mocks.set(`${name}:${action}`, handler);
}

export function clearCpMocks(): void {
  mocks.clear();
}

function isMockMode(): boolean {
  return import.meta.env.VITE_CALLABLE_MODE === 'mock';
}

function payload(action: string, fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { action };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

async function mockTransport(name: CpCallableName, data: Record<string, unknown>): Promise<unknown> {
  const action = typeof data.action === 'string' ? data.action : '';
  const handler = mocks.get(`${name}:${action}`);
  if (!handler) throw new Error(`[cp] 未註冊的 mock：${name}.${action}`);
  return handler(data);
}

async function liveTransport(name: CpCallableName, data: Record<string, unknown>): Promise<unknown> {
  const [{ httpsCallable }, ctx] = await Promise.all([
    import('firebase/functions'),
    getCpFirebase(),
  ]);
  const callable = httpsCallable(ctx.functions, name);
  const result = await callable(data);
  return result.data;
}

async function callAction<T>(name: CpCallableName, data: Record<string, unknown>): Promise<T> {
  const transport = isMockMode() ? mockTransport : liveTransport;
  try {
    return await transport(name, data) as T;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[cp] 未註冊的 mock')) throw err;
    throw toCpCallError(err);
  }
}

export interface CpScheduleInput {
  regOpenAt: number;
  regCloseAt: number;
  firstMatchAt: number;
  lastMatchAt: number;
}

interface CpHostCommon {
  name: string;
  sport: 'football';
  timezone: 'Asia/Taipei';
  regOpenAt: number;
  regCloseAt: number;
  firstMatchAt: number;
  lastMatchAt: number;
  venues: Venue[];
  liveLinks: string[];
  divisions: DivisionInput[];
}

export type CpHostCreateInput = CpHostCommon & (
  | { hostType: 'personal' }
  | { hostType: 'club'; hostTeamId: string; feeNote?: string }
);

export interface CpHostCreateResult {
  cid: string;
  dvIds: string[];
}

/** cpHost create。個人主辦不送 hostTeamId／feeNote／hostDisplay；俱樂部不送 hostDisplay。 */
export function cpHostCreate(input: CpHostCreateInput): Promise<CpHostCreateResult> {
  const common = {
    name: input.name,
    sport: input.sport,
    timezone: input.timezone,
    regOpenAt: input.regOpenAt,
    regCloseAt: input.regCloseAt,
    firstMatchAt: input.firstMatchAt,
    lastMatchAt: input.lastMatchAt,
    venues: input.venues,
    liveLinks: input.liveLinks,
    divisions: input.divisions,
  };
  if (input.hostType === 'club') {
    return callAction('cpHost', payload('create', {
      ...common,
      hostType: 'club',
      hostTeamId: input.hostTeamId,
      feeNote: input.feeNote,
    }));
  }
  return callAction('cpHost', payload('create', {
    ...common,
    hostType: 'personal',
  }));
}

// 後端 update 只收 name／hostDisplay／四個時間／venues／feeNote／liveLinks／divisions；
// 主辦類型、俱樂部、運動、時區建立後不能改，多帶會被整筆拒絕（Flash 交叉審 P2）。
export interface CpHostUpdateInput {
  cid: string;
  name?: string;
  hostDisplay?: string;
  schedule?: CpScheduleInput;
  venues?: Venue[];
  feeNote?: string;
  liveLinks?: string[];
  divisions?: DivisionInput[];
}

export interface CpCidResult {
  cid: string;
}

export function cpHostUpdate(input: CpHostUpdateInput): Promise<CpCidResult> {
  const { schedule, ...rest } = input;
  return callAction('cpHost', payload('update', {
    ...rest,
    regOpenAt: schedule?.regOpenAt,
    regCloseAt: schedule?.regCloseAt,
    firstMatchAt: schedule?.firstMatchAt,
    lastMatchAt: schedule?.lastMatchAt,
  }));
}

export interface CpPublishResult {
  cid: string;
  status: 'published';
}

export function cpHostPublish(input: { cid: string }): Promise<CpPublishResult> {
  return callAction('cpHost', payload('publish', { cid: input.cid }));
}

export type CpHostSetStatusInput = { cid: string; status: 'published' } | {
  cid: string;
  status: 'postponed' | 'cancelled';
  reason: string;
};

export interface CpStatusResult {
  cid: string;
  status: 'published' | 'postponed' | 'cancelled';
}

export function cpHostSetStatus(input: CpHostSetStatusInput): Promise<CpStatusResult> {
  return callAction('cpHost', payload('setStatus', {
    cid: input.cid,
    status: input.status,
    reason: 'reason' in input ? input.reason : undefined,
  }));
}

export interface CpDeleteResult {
  cid: string;
  deleted: true;
}

export function cpHostDelete(input: { cid: string }): Promise<CpDeleteResult> {
  return callAction('cpHost', payload('delete', { cid: input.cid }));
}

export interface CpRegisterEntryInput {
  cid: string;
  dvId: string;
  teamId: string;
  teamName?: string;
  contactName?: string;
  contactPhone?: string;
}

export function cpEntryRegister(input: CpRegisterEntryInput): Promise<unknown> {
  return callAction('cpEntry', payload('registerEntry', { ...input }));
}

export type CpReviewEntryInput = {
  cid: string;
  enId: string;
  decision: 'approve';
} | {
  cid: string;
  enId: string;
  decision: 'reject';
  reason: string;
};

export function cpEntryReview(input: CpReviewEntryInput): Promise<unknown> {
  return callAction('cpEntry', payload('reviewEntry', {
    cid: input.cid,
    enId: input.enId,
    decision: input.decision,
    reason: 'reason' in input ? input.reason : undefined,
  }));
}

export function cpEntryWithdraw(input: { cid: string; enId: string }): Promise<unknown> {
  return callAction('cpEntry', payload('withdrawEntry', { ...input }));
}

export interface CpJoinRosterInput {
  cid: string;
  enId: string;
  number: number;
  position?: 'GK' | 'DF' | 'MF' | 'FW' | 'custom';
  positionText?: string;
  nickname?: string;
  realName?: string;
  guardianConsent?: boolean;
  privacyAck: true;
}

export function cpEntryJoinRoster(input: CpJoinRosterInput): Promise<unknown> {
  return callAction('cpEntry', payload('joinRoster', { ...input }));
}

export interface CpAddRosterByRepInput extends CpJoinRosterInput {
  realName: string;
  birthday: string;
}

export function cpEntryAddRosterByRep(input: CpAddRosterByRepInput): Promise<unknown> {
  return callAction('cpEntry', payload('addRosterByRep', { ...input }));
}

export function cpEntryLeaveRoster(input: { cid: string; plId: string }): Promise<unknown> {
  return callAction('cpEntry', payload('leaveRoster', { ...input }));
}

export function cpEntryConfirmRoster(input: { cid: string; enId: string }): Promise<unknown> {
  return callAction('cpEntry', payload('confirmRoster', { ...input }));
}

export function cpEntryLockRosters(input: { cid: string }): Promise<unknown> {
  return callAction('cpEntry', payload('lockRosters', { ...input }));
}

export function cpEntryUnlockRosters(input: { cid: string; reason: string }): Promise<unknown> {
  return callAction('cpEntry', payload('unlockRosters', { ...input }));
}

/** 主辦標示已繳費。線上支付本身不實作，只留這支接點。 */
export function cpEntrySetPaymentStatus(input: {
  cid: string;
  enId: string;
  paymentStatus: PaymentStatusWrite;
}): Promise<unknown> {
  return callAction('cpEntry', payload('setPaymentStatus', { ...input }));
}

export type CpReportInput = {
  cid: string;
  reason: Exclude<ReportReason, 'other'>;
  detail?: string;
} | {
  cid: string;
  reason: 'other';
  detail: string;
};

export function cpParticipantReport(input: CpReportInput): Promise<unknown> {
  return callAction('cpParticipant', payload('reportCompetition', { ...input }));
}
