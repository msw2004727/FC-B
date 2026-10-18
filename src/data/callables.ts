// Cloud Functions Callable 型別化入口。
//
// - 名稱對應：透過 `CallableMap` 手動列出每個 `<PascalName>Request` / `<PascalName>Response`，
//   再以型別映射 `RequestOf<N>` / `ResponseOf<N>` 取得對應型別。
// - region：取自 `CALLABLES[name].region`。
// - `VITE_CALLABLE_MODE=mock` 時不連 Functions，改呼叫以 `registerMock(name, handler)`
//   註冊的假實作；未註冊者丟出 `Error('[callFn] 未註冊的 mock：' + name)`。
// - `startRecording()` / `stopRecording()`：mock 與正式模式皆記錄每次呼叫，
//   供測試與 golden payload 比對。
// - FunctionsError → CallableError 轉換：保留 code / message / details，不吞錯（R-CF-002 精神）。

import type { Functions } from 'firebase/functions';

import type {
  AdjustTeamReservationRequest,
  AdjustTeamReservationResponse,
  AdminManageUserRequest,
  AdminManageUserResponse,
  ApproveCourseEnrollmentRequest,
  ApproveCourseEnrollmentResponse,
  AutoPromoteTeamRoleRequest,
  AutoPromoteTeamRoleResponse,
  BackfillAutoExpRequest,
  BackfillAutoExpResponse,
  CalcNoShowCountsManualRequest,
  CalcNoShowCountsManualResponse,
  CancelCourseEnrollmentRequest,
  CancelCourseEnrollmentResponse,
  CancelRegistrationRequest,
  CancelRegistrationResponse,
  CommitIdentitySettingsRequest,
  CommitIdentitySettingsResponse,
  CommitSecondaryIdentityAvatarRequest,
  CommitSecondaryIdentityAvatarResponse,
  CreateCustomTokenRequest,
  CreateCustomTokenResponse,
  CreateEventFromCourseLessonRequest,
  CreateEventFromCourseLessonResponse,
  DeliverToInboxRequest,
  DeliverToInboxResponse,
  EditPrivateMessageRequest,
  EditPrivateMessageResponse,
  EnqueuePrivilegedLineNotificationRequest,
  EnqueuePrivilegedLineNotificationResponse,
  EnsureNotificationTemplatesRequest,
  EnsureNotificationTemplatesResponse,
  FetchUsageMetricsManualRequest,
  FetchUsageMetricsManualResponse,
  GetEduStudentAttendanceOverviewRequest,
  GetEduStudentAttendanceOverviewResponse,
  GetPmAuditConversationRequest,
  GetPmAuditConversationResponse,
  GetPmAuditLogsRequest,
  GetPmAuditLogsResponse,
  GetPrivateMessageSettingsRequest,
  GetPrivateMessageSettingsResponse,
  ListEduCourseEnrollmentSummariesRequest,
  ListEduCourseEnrollmentSummariesResponse,
  ListEduCourseEnrollmentsRequest,
  ListEduCourseEnrollmentsResponse,
  ListEduCoursePublicRosterRequest,
  ListEduCoursePublicRosterResponse,
  ListPmAuditThreadsRequest,
  ListPmAuditThreadsResponse,
  ManageCourseLinkedRegistrationStatusRequest,
  ManageCourseLinkedRegistrationStatusResponse,
  MarkPrivateConversationReadRequest,
  MarkPrivateConversationReadResponse,
  MigrateEduCourseAutoEnrollmentsRequest,
  MigrateEduCourseAutoEnrollmentsResponse,
  MigrateUidFieldsRequest,
  MigrateUidFieldsResponse,
  RecallPrivateMessageRequest,
  RecallPrivateMessageResponse,
  RecordUserLoginIpRequest,
  RecordUserLoginIpResponse,
  RefreshMyActivityRecordsRequest,
  RefreshMyActivityRecordsResponse,
  RegisterForEduCoursePlanRequest,
  RegisterForEduCoursePlanResponse,
  RegisterForEventRequest,
  RegisterForEventResponse,
  RepairActivityRecordsManualRequest,
  RepairActivityRecordsManualResponse,
  RepairCompanionAttendanceRecordsRequest,
  RepairCompanionAttendanceRecordsResponse,
  RunUidHealthCheckRequest,
  RunUidHealthCheckResponse,
  SaveEduCourseSelfAttendanceRequest,
  SaveEduCourseSelfAttendanceResponse,
  SaveEduCourseSelfLeaveRequest,
  SaveEduCourseSelfLeaveResponse,
  SaveEduSessionAttendanceChangesRequest,
  SaveEduSessionAttendanceChangesResponse,
  SaveRealtimeConfigRequest,
  SaveRealtimeConfigResponse,
  SearchPmAuditUsersRequest,
  SearchPmAuditUsersResponse,
  SendPrivateMessageRequest,
  SendPrivateMessageResponse,
  SyncGroupActionStatusRequest,
  SyncGroupActionStatusResponse,
  SyncUserRoleRequest,
  SyncUserRoleResponse,
  TranslateTextsRequest,
  TranslateTextsResponse,
  UpdateCourseLinkedEventRequest,
  UpdateCourseLinkedEventResponse,
  UpdateEduCourseSessionRequest,
  UpdateEduCourseSessionResponse,
  UpdatePrivateMessageSettingsRequest,
  UpdatePrivateMessageSettingsResponse,
  VerifyDataSyncPasswordRequest,
  VerifyDataSyncPasswordResponse,
  WriteAuditLogRequest,
  WriteAuditLogResponse,
} from './contract/callables';
import { CALLABLES, type CallableName } from './contract/callables';
import { getFirebase } from './firebase';

// ── 名稱 → request/response 型別映射 ─────────────────

export interface CallableMap {
  adjustTeamReservation: { req: AdjustTeamReservationRequest; res: AdjustTeamReservationResponse };
  adminManageUser: { req: AdminManageUserRequest; res: AdminManageUserResponse };
  approveCourseEnrollment: { req: ApproveCourseEnrollmentRequest; res: ApproveCourseEnrollmentResponse };
  autoPromoteTeamRole: { req: AutoPromoteTeamRoleRequest; res: AutoPromoteTeamRoleResponse };
  backfillAutoExp: { req: BackfillAutoExpRequest; res: BackfillAutoExpResponse };
  calcNoShowCountsManual: { req: CalcNoShowCountsManualRequest; res: CalcNoShowCountsManualResponse };
  cancelCourseEnrollment: { req: CancelCourseEnrollmentRequest; res: CancelCourseEnrollmentResponse };
  cancelRegistration: { req: CancelRegistrationRequest; res: CancelRegistrationResponse };
  commitIdentitySettings: { req: CommitIdentitySettingsRequest; res: CommitIdentitySettingsResponse };
  commitSecondaryIdentityAvatar: {
    req: CommitSecondaryIdentityAvatarRequest;
    res: CommitSecondaryIdentityAvatarResponse;
  };
  createCustomToken: { req: CreateCustomTokenRequest; res: CreateCustomTokenResponse };
  createEventFromCourseLesson: {
    req: CreateEventFromCourseLessonRequest;
    res: CreateEventFromCourseLessonResponse;
  };
  deliverToInbox: { req: DeliverToInboxRequest; res: DeliverToInboxResponse };
  editPrivateMessage: { req: EditPrivateMessageRequest; res: EditPrivateMessageResponse };
  enqueuePrivilegedLineNotification: {
    req: EnqueuePrivilegedLineNotificationRequest;
    res: EnqueuePrivilegedLineNotificationResponse;
  };
  ensureNotificationTemplates: {
    req: EnsureNotificationTemplatesRequest;
    res: EnsureNotificationTemplatesResponse;
  };
  fetchUsageMetricsManual: {
    req: FetchUsageMetricsManualRequest;
    res: FetchUsageMetricsManualResponse;
  };
  getEduStudentAttendanceOverview: {
    req: GetEduStudentAttendanceOverviewRequest;
    res: GetEduStudentAttendanceOverviewResponse;
  };
  getPmAuditConversation: { req: GetPmAuditConversationRequest; res: GetPmAuditConversationResponse };
  getPmAuditLogs: { req: GetPmAuditLogsRequest; res: GetPmAuditLogsResponse };
  getPrivateMessageSettings: {
    req: GetPrivateMessageSettingsRequest;
    res: GetPrivateMessageSettingsResponse;
  };
  listEduCourseEnrollmentSummaries: {
    req: ListEduCourseEnrollmentSummariesRequest;
    res: ListEduCourseEnrollmentSummariesResponse;
  };
  listEduCourseEnrollments: {
    req: ListEduCourseEnrollmentsRequest;
    res: ListEduCourseEnrollmentsResponse;
  };
  listEduCoursePublicRoster: {
    req: ListEduCoursePublicRosterRequest;
    res: ListEduCoursePublicRosterResponse;
  };
  listPmAuditThreads: { req: ListPmAuditThreadsRequest; res: ListPmAuditThreadsResponse };
  manageCourseLinkedRegistrationStatus: {
    req: ManageCourseLinkedRegistrationStatusRequest;
    res: ManageCourseLinkedRegistrationStatusResponse;
  };
  markPrivateConversationRead: {
    req: MarkPrivateConversationReadRequest;
    res: MarkPrivateConversationReadResponse;
  };
  migrateEduCourseAutoEnrollments: {
    req: MigrateEduCourseAutoEnrollmentsRequest;
    res: MigrateEduCourseAutoEnrollmentsResponse;
  };
  migrateUidFields: { req: MigrateUidFieldsRequest; res: MigrateUidFieldsResponse };
  recallPrivateMessage: { req: RecallPrivateMessageRequest; res: RecallPrivateMessageResponse };
  recordUserLoginIp: { req: RecordUserLoginIpRequest; res: RecordUserLoginIpResponse };
  refreshMyActivityRecords: {
    req: RefreshMyActivityRecordsRequest;
    res: RefreshMyActivityRecordsResponse;
  };
  registerForEduCoursePlan: {
    req: RegisterForEduCoursePlanRequest;
    res: RegisterForEduCoursePlanResponse;
  };
  registerForEvent: { req: RegisterForEventRequest; res: RegisterForEventResponse };
  repairActivityRecordsManual: {
    req: RepairActivityRecordsManualRequest;
    res: RepairActivityRecordsManualResponse;
  };
  repairCompanionAttendanceRecords: {
    req: RepairCompanionAttendanceRecordsRequest;
    res: RepairCompanionAttendanceRecordsResponse;
  };
  runUidHealthCheck: { req: RunUidHealthCheckRequest; res: RunUidHealthCheckResponse };
  saveEduCourseSelfAttendance: {
    req: SaveEduCourseSelfAttendanceRequest;
    res: SaveEduCourseSelfAttendanceResponse;
  };
  saveEduCourseSelfLeave: { req: SaveEduCourseSelfLeaveRequest; res: SaveEduCourseSelfLeaveResponse };
  saveEduSessionAttendanceChanges: {
    req: SaveEduSessionAttendanceChangesRequest;
    res: SaveEduSessionAttendanceChangesResponse;
  };
  saveRealtimeConfig: { req: SaveRealtimeConfigRequest; res: SaveRealtimeConfigResponse };
  searchPmAuditUsers: { req: SearchPmAuditUsersRequest; res: SearchPmAuditUsersResponse };
  sendPrivateMessage: { req: SendPrivateMessageRequest; res: SendPrivateMessageResponse };
  syncGroupActionStatus: { req: SyncGroupActionStatusRequest; res: SyncGroupActionStatusResponse };
  syncUserRole: { req: SyncUserRoleRequest; res: SyncUserRoleResponse };
  translateTexts: { req: TranslateTextsRequest; res: TranslateTextsResponse };
  updateCourseLinkedEvent: {
    req: UpdateCourseLinkedEventRequest;
    res: UpdateCourseLinkedEventResponse;
  };
  updateEduCourseSession: {
    req: UpdateEduCourseSessionRequest;
    res: UpdateEduCourseSessionResponse;
  };
  updatePrivateMessageSettings: {
    req: UpdatePrivateMessageSettingsRequest;
    res: UpdatePrivateMessageSettingsResponse;
  };
  verifyDataSyncPassword: {
    req: VerifyDataSyncPasswordRequest;
    res: VerifyDataSyncPasswordResponse;
  };
  writeAuditLog: { req: WriteAuditLogRequest; res: WriteAuditLogResponse };
}

export type RequestOf<N extends CallableName> = CallableMap[N]['req'];
export type ResponseOf<N extends CallableName> = CallableMap[N]['res'];

// ── CallableError ─────────────────────────────────────

export class CallableError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'CallableError';
    this.code = code;
    this.details = details;
  }
}

function toCallableError(err: unknown): CallableError {
  if (err instanceof CallableError) return err;
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown; details?: unknown };
    const code = typeof e.code === 'string' ? e.code : 'unknown';
    const message =
      typeof e.message === 'string' && e.message.length > 0 ? e.message : String(err);
    return new CallableError(code, message, e.details);
  }
  return new CallableError('unknown', String(err));
}

// ── Mock 註冊表 ───────────────────────────────────────

type AnyMockHandler = (req: unknown) => unknown | Promise<unknown>;
const mocks = new Map<string, AnyMockHandler>();

export type MockHandler<N extends CallableName> = (
  req: RequestOf<N>,
) => ResponseOf<N> | Promise<ResponseOf<N>>;

export function registerMock<N extends CallableName>(name: N, handler: MockHandler<N>): void {
  mocks.set(name, handler as unknown as AnyMockHandler);
}

export function clearMocks(): void {
  mocks.clear();
}

// ── Request recorder ─────────────────────────────────

export interface RecordedCall {
  name: CallableName;
  request: unknown;
  at: number;
}

let _recording = false;
let _buffer: RecordedCall[] = [];

export function startRecording(): void {
  _recording = true;
  _buffer = [];
}

export function stopRecording(): RecordedCall[] {
  _recording = false;
  const out = _buffer;
  _buffer = [];
  return out;
}

function recordCall(name: CallableName, request: unknown): void {
  if (!_recording) return;
  _buffer.push({ name, request, at: Date.now() });
}

// ── 主入口 ───────────────────────────────────────────

function isMockMode(): boolean {
  return import.meta.env.VITE_CALLABLE_MODE === 'mock';
}

const DEFAULT_FUNCTIONS_REGION = 'asia-east1';
const functionsByRegion = new Map<string, Functions>();

async function getFunctionsForRegion(region: string): Promise<Functions> {
  const cached = functionsByRegion.get(region);
  if (cached) return cached;

  const { getFunctions } = await import('firebase/functions');
  const functions = getFunctions(undefined, region);
  functionsByRegion.set(region, functions);
  return functions;
}

export async function callFn<N extends CallableName>(
  name: N,
  request: RequestOf<N>,
): Promise<ResponseOf<N>> {
  recordCall(name, request);

  if (isMockMode()) {
    const handler = mocks.get(name);
    if (!handler) {
      throw new Error('[callFn] 未註冊的 mock：' + name);
    }
    try {
      const response = await handler(request);
      return response as ResponseOf<N>;
    } catch (err) {
      throw toCallableError(err);
    }
  }

  const [{ httpsCallable }, ctx] = await Promise.all([
    import('firebase/functions'),
    getFirebase(),
  ]);

  const region = CALLABLES[name].region;
  const functions =
    region === DEFAULT_FUNCTIONS_REGION
      ? ctx.functions
      : await getFunctionsForRegion(region);

  const callable = httpsCallable<RequestOf<N>, ResponseOf<N>>(functions, name);

  try {
    const result = await callable(request);
    return result.data;
  } catch (err) {
    throw toCallableError(err);
  }
}
