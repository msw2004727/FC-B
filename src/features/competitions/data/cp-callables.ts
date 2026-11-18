// 賽事第 2 步與第 3 步 Callable。三支：cpHost、cpEntry、cpParticipant。每個動作一支有型別的函式。
// 欄位照契約 §2、§6。多送的鍵伺服器會回 UNKNOWN_FIELD，所以這裡只組契約列出的鍵，略過 undefined。
// 錯誤從 details.reason 轉成 { reason, params }；沒有 reason 時 reason 為 UNKNOWN。
//
// mock：VITE_CALLABLE_MODE=mock 時走 registerCpMock，不連 Functions（與 src/data/callables.ts 相同判斷）。
// ASSUMPTION: 模擬器模式仍呼叫 getCpFirebase() 接上的本機 Functions，不沿用主站 callFn 的
// 「emulator 一律禁止」擋板。那道擋板是為了避免打到正式 Functions；這裡的實例在模擬器模式已接到本機。
// ASSUMPTION: 更新的四個時間在型別裡包成 schedule，送出時攤成四個欄位，不送 schedule 這個鍵。

import type { CompetitionCategory, DivisionInput, PaymentStatusWrite, ReportReason, Venue } from './types';
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
  /** 建賽精靈步驟 1 會送。不送時伺服器把缺值當 league。 */
  category?: CompetitionCategory;
  /** 公開聯絡文字。空白不送，伺服器寫 null。 */
  contactNote?: string;
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
    category: input.category,
    contactNote: input.contactNote,
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

// 後端 update 只收 name／hostDisplay／四個時間／venues／feeNote／liveLinks／divisions／category／contactNote。
// 主辦類型、俱樂部、運動、時區建立後不能改，多帶會被整筆拒絕（Flash 交叉審 P2）。
// category 是卡 A 新增的欄位；不送時不帶這個鍵。
// contactNote 送 null 或空字串，伺服器寫 null。不送這個鍵就不動原本的文字。
export interface CpHostUpdateInput {
  cid: string;
  name?: string;
  hostDisplay?: string;
  schedule?: CpScheduleInput;
  venues?: Venue[];
  feeNote?: string;
  liveLinks?: string[];
  divisions?: DivisionInput[];
  category?: CompetitionCategory;
  contactNote?: string | null;
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

export type CpRanking = 'h2hFirst' | 'goalDiffFirst';
export type CpForfeitSide = 'home' | 'away';

export interface CpScheduleDay {
  date: string;
  start: string;
  end: string;
}

/** generateSchedule。dryRun 只預覽，不寫。seed 相同則伺服器排出的賽程相同。 */
export interface CpGenerateScheduleInput {
  cid: string;
  dvId: string;
  legs: 1 | 2;
  ranking?: CpRanking;
  matchMinutes: number;
  bufferMinutes?: number;
  minRestMinutes?: number;
  days: CpScheduleDay[];
  venueIdx: number[];
  seed?: number;
  dryRun?: boolean;
}

/** dryRun 回預覽（場數、天數、未排數）。正式寫入的其他欄位由呼叫端另外看。 */
/** 與後端 match-host.ts generateSchedule 回傳一致（預覽與正式都回同一形狀，dryRun 標示是否寫入）。 */
export interface CpGenerateScheduleResult {
  dvId: string;
  /** 正式產生時帶回這個 seed，結果與預覽相同 */
  seed: number;
  matchCount: number;
  unplacedCount: number;
  /** 用到的日期（YYYY-MM-DD）。後端是字串陣列，不是天數。 */
  daysUsed: string[];
  perTeam: number;
  teamCount: number;
  dryRun: boolean;
}

export function cpHostGenerateSchedule(input: CpGenerateScheduleInput): Promise<CpGenerateScheduleResult> {
  return callAction('cpHost', payload('generateSchedule', {
    cid: input.cid,
    dvId: input.dvId,
    legs: input.legs,
    ranking: input.ranking,
    matchMinutes: input.matchMinutes,
    bufferMinutes: input.bufferMinutes,
    minRestMinutes: input.minRestMinutes,
    days: input.days,
    venueIdx: input.venueIdx,
    seed: input.seed,
    dryRun: input.dryRun,
  }));
}

export function cpHostClearSchedule(input: { cid: string; dvId: string }): Promise<unknown> {
  return callAction('cpHost', payload('clearSchedule', { cid: input.cid, dvId: input.dvId }));
}

/** kickoffAt 為 null 時伺服器把場次改成 postponed。force 只在真的要略過撞期時送 true。 */
export function cpHostRescheduleMatch(input: {
  cid: string;
  mtId: string;
  expectedRev: number;
  kickoffAt: number | null;
  venueIdx: number | null;
  force?: boolean;
}): Promise<unknown> {
  return callAction('cpHost', payload('rescheduleMatch', {
    cid: input.cid,
    mtId: input.mtId,
    expectedRev: input.expectedRev,
    kickoffAt: input.kickoffAt,
    venueIdx: input.venueIdx,
    force: input.force ? true : undefined,
  }));
}

/** 整天順延。fromDate／toDate 是台北 YYYY-MM-DD。原因只進稽核。 */
export function cpHostShiftMatchDay(input: {
  cid: string;
  fromDate: string;
  toDate: string;
  reason: string;
  force?: boolean;
}): Promise<unknown> {
  return callAction('cpHost', payload('shiftMatchDay', {
    cid: input.cid,
    fromDate: input.fromDate,
    toDate: input.toDate,
    reason: input.reason,
    force: input.force ? true : undefined,
  }));
}

/** 兩場對調開賽時間與場地。同一場不送，由畫面先擋。 */
export function cpHostSwapMatches(input: {
  cid: string;
  mtIdA: string;
  mtIdB: string;
  expectedRevA: number;
  expectedRevB: number;
  reason: string;
  force?: boolean;
}): Promise<unknown> {
  return callAction('cpHost', payload('swapMatches', {
    cid: input.cid,
    mtIdA: input.mtIdA,
    mtIdB: input.mtIdB,
    expectedRevA: input.expectedRevA,
    expectedRevB: input.expectedRevB,
    reason: input.reason,
    force: input.force ? true : undefined,
  }));
}

export interface CpPostNoticeResult {
  noticeId: string;
}

/** 主辦公告。純文字，伺服器上限 300 個碼位。系統公告不走這支。 */
export function cpHostPostNotice(input: { cid: string; text: string }): Promise<CpPostNoticeResult> {
  return callAction('cpHost', payload('postNotice', { cid: input.cid, text: input.text }));
}

/** 依 id 刪除。手動與系統都可以刪。 */
export function cpHostDeleteNotice(input: { cid: string; noticeId: string }): Promise<unknown> {
  return callAction('cpHost', payload('deleteNotice', { cid: input.cid, noticeId: input.noticeId }));
}

export function cpHostRecordResult(input: {
  cid: string;
  mtId: string;
  expectedRev: number;
  score: { home: number; away: number };
  confirm: boolean;
}): Promise<unknown> {
  return callAction('cpHost', payload('recordResult', { ...input }));
}

export function cpHostConfirmMatchResult(input: {
  cid: string;
  mtId: string;
  expectedRev: number;
}): Promise<unknown> {
  return callAction('cpHost', payload('confirmMatchResult', { ...input }));
}

export function cpHostSetWalkover(input: {
  cid: string;
  mtId: string;
  expectedRev: number;
  forfeitSide: CpForfeitSide;
  reason: string;
}): Promise<unknown> {
  return callAction('cpHost', payload('setWalkover', { ...input }));
}

export function cpHostResetMatch(input: {
  cid: string;
  mtId: string;
  expectedRev: number;
  reason: string;
}): Promise<unknown> {
  return callAction('cpHost', payload('resetMatch', { ...input }));
}

export function cpHostRecalcStandings(input: { cid: string; dvId: string }): Promise<unknown> {
  return callAction('cpHost', payload('recalcStandings', { cid: input.cid, dvId: input.dvId }));
}

/** 原因 2～100。可取消：scheduled、postponed、finished。 */
export function cpHostCancelMatch(input: {
  cid: string;
  mtId: string;
  expectedRev: number;
  reason: string;
}): Promise<unknown> {
  return callAction('cpHost', payload('cancelMatch', { ...input }));
}

/** 原因 2～100。不改場次。已有 endedAt 時伺服器拒絕。 */
export function cpHostEndCompetition(input: { cid: string; reason: string }): Promise<unknown> {
  return callAction('cpHost', payload('endCompetition', { cid: input.cid, reason: input.reason }));
}

/** 只有管理員。原因 2～100。 */
export function cpHostRestoreCompetition(input: { cid: string; reason: string }): Promise<unknown> {
  return callAction('cpHost', payload('restoreCompetition', { cid: input.cid, reason: input.reason }));
}

export type TieMethod = 'host' | 'drawLots';

/** 原因 1～200。order 必須剛好是目前某一群待裁定。 */
export function cpHostResolveTie(input: {
  cid: string;
  dvId: string;
  groupId?: string;
  order: string[];
  method: TieMethod;
  reason: string;
  expectedVersion: number;
}): Promise<unknown> {
  return callAction('cpHost', payload('resolveTie', { ...input }));
}

export function cpHostClearTieDecision(input: {
  cid: string;
  dvId: string;
  groupId?: string;
  reason: string;
  expectedVersion: number;
}): Promise<unknown> {
  return callAction('cpHost', payload('clearTieDecision', { ...input }));
}

/** 唯讀。teamIds 至少兩隊，而且積分必須相同。 */
export function cpHostExplainTie(input: {
  cid: string;
  dvId: string;
  groupId?: string;
  teamIds: string[];
}): Promise<unknown> {
  return callAction('cpHost', payload('explainTie', { ...input }));
}
