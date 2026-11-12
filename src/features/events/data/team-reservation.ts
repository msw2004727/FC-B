/**
 * T-074a：團隊名額資料層。僅使用 viewer／活動的既有快照；沒有 Firestore 讀寫。
 * A oracle：event-detail-signup.js 567、1276、1475、1603、1703；firebase-crud.js 3187。
 */
import { callFn } from '@/data/callables';
import type { AdjustTeamReservationRequest } from '@/data/contract/callables';
import type { EventDoc } from './types';
import type { StaffTeamOption } from './team-staff';
import { canDetailTeamSignup } from './signup-context';
import { eventStartMs } from './terminal';
import { invalidateViewerRegistrations } from './viewer-registrations-cache';
import { normalizeTeamReservationSummaries, type NormalizedTeamReservationSummary } from './signup-restrictions';

export { getStaffTeams as getTeamReservationStaffTeams } from './team-staff';

export interface TeamReservationEvent extends EventDoc {
  current?: unknown;
  max?: unknown;
  teamReservationSummaries?: unknown;
  courseLinked?: unknown;
  courseLinkSource?: unknown;
}

export interface TeamReservationViewer {
  uid: string | null;
  teamIds: ReadonlySet<string>;
  /** 必須來自同一 UID 的 viewer；缺省／載入失敗一律無職員權限。 */
  staffTeams?: readonly StaffTeamOption[];
}

export interface TeamReservationSnapshot {
  event: TeamReservationEvent | null;
  viewer: TeamReservationViewer | null;
  /** 換活動、帳號、頁面或關閉／重開視窗時遞增；A → B → A 也不可重用。 */
  generation: number;
  /** 合併活動、報名、viewer／身分載入狀態。 */
  loading?: boolean;
  /** 收到 course-managed 結果後，本頁生命週期須保持 true。 */
  courseRejected?: boolean;
}

const FAILED = '團隊名額調整失敗，請稍後重試';
const BELOW_USED = '團隊名額不能低於已使用人數';
const OVER_CAPACITY = '團隊名額超過目前活動可用名額';
const PENDING = '團隊名額處理中，請稍候';

/** 與 A／既有 Functions 相同；單有 legacy 課程 ID 不視為課程管理。 */
export function isTeamReservationCourseManaged(event: TeamReservationEvent | null): boolean {
  return event?.courseLinked === true
    && typeof event.courseLinkSource === 'string'
    && event.courseLinkSource.trim().slice(0, 80) === 'eduCourseLesson';
}

/** 資料層狀態，T-074b 據此決定入口；Q-4 回 null，不附課程提示。 */
export function getTeamReservationAction(snapshot: TeamReservationSnapshot, now = Date.now()) {
  const { event, viewer } = snapshot;
  if (!event?.id || !viewer?.uid || snapshot.loading || snapshot.courseRejected
    || isTeamReservationCourseManaged(event) || !viewer.staffTeams?.length) return null;
  const start = eventStartMs(event);
  // 對應 B signup-state 的 isEnded、upcoming 與 canDetailTeamSignup；無管理員豁免。
  if (event.status === 'ended' || event.status === 'cancelled' || event.status === 'upcoming'
    || (start > 0 && start <= now) || !canDetailTeamSignup(event, viewer.teamIds)) return null;
  const summaries = normalizeTeamReservationSummaries(event);
  const active = viewer.staffTeams.find(team => summaries.some(summary => summary.teamId === team.id
    && (summary.reservedSlots > 0 || summary.usedSlots > 0)));
  return {
    label: active ? '調整名額' : '團隊報名',
    busyLabel: active ? '調整團隊名額中' : '建立團隊名額中',
    preferredTeamId: active?.id ?? '',
  };
}

function nonNegativeNumber(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

/** A _getTeamReservationModalState；不讀 localStorage，保持純函式。 */
export function getTeamReservationModalState(
  event: TeamReservationEvent | null,
  viewer: TeamReservationViewer | null,
  preferredTeamId = '',
) {
  if (!event || !viewer?.uid || !viewer.staffTeams?.length || isTeamReservationCourseManaged(event)) return null;
  const teams = viewer.staffTeams;
  const selectedTeam = teams.find(team => team.id === preferredTeamId) ?? teams[0]!;
  const summary = normalizeTeamReservationSummaries(event).find(item => item.teamId === selectedTeam.id) ?? {
    teamId: selectedTeam.id, teamName: selectedTeam.name, reservedSlots: 0, usedSlots: 0, remainingSlots: 0,
  };
  const used = summary.usedSlots;
  const remaining = summary.remainingSlots;
  const current = nonNegativeNumber(event.current);
  const max = nonNegativeNumber(event.max);
  const maxReserved = used + Math.max(0, max - Math.max(0, current - remaining));
  return { event, teams, selectedTeam, summary, used, remaining, maxReserved };
}

/** A _getTeamReservationSignupChoices：已用完但有 reserved／used 的隊伍仍保留為選項。 */
export function getTeamReservationSignupChoices(
  event: TeamReservationEvent | null,
  viewer: TeamReservationViewer | null,
): NormalizedTeamReservationSummary[] {
  if (!event || !viewer?.uid || isTeamReservationCourseManaged(event)) return [];
  const ids = new Set([...viewer.teamIds].map(id => String(id || '').trim()).filter(Boolean));
  return normalizeTeamReservationSummaries(event)
    .filter(item => ids.has(item.teamId) && (item.reservedSlots > 0 || item.usedSlots > 0));
}

/** 無選項回空 ID；一隊直接帶入；多隊只有合法預選才免選擇。 */
export function resolveTeamReservationSignupChoice(
  event: TeamReservationEvent | null,
  viewer: TeamReservationViewer | null,
  preferredTeamId = '',
) {
  const choices = getTeamReservationSignupChoices(event, viewer);
  const selected = choices.find(item => item.teamId === preferredTeamId.trim())
    ?? (choices.length === 1 ? choices[0] : undefined);
  return { teamId: selected?.teamId ?? '', choices, requiresSelection: !selected && choices.length > 1 };
}

type SlotStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Q-2：相同 A key／優先序，儲存不可用或值損壞時以已使用人數保底。 */
export function getTeamReservationInitialSlots(
  state: NonNullable<ReturnType<typeof getTeamReservationModalState>>,
  storage?: SlotStorage,
): number {
  if (state.summary.reservedSlots > 0) return state.summary.reservedSlots;
  try {
    const saved = Number((storage ?? globalThis.localStorage).getItem('teamReservationSlots:' + state.selectedTeam.id));
    if (Number.isFinite(saved) && saved > 0) return saved;
  } catch { /* localStorage 可能被禁用；不影響名額功能。 */ }
  return state.used;
}

function rememberSlots(teamId: string, slots: number, storage?: SlotStorage): void {
  try { (storage ?? globalThis.localStorage).setItem('teamReservationSlots:' + teamId, String(slots)); }
  catch { /* 輸入便利失敗不可阻擋 Callable。 */ }
}

function errorCode(error: unknown): string {
  const e = error && typeof error === 'object' ? error as { details?: unknown; code?: unknown; message?: unknown } : null;
  const details = e?.details && typeof e.details === 'object' ? e.details as { code?: unknown } : null;
  // Firebase 常將業務碼放在 message，外層 code 是 functions/failed-precondition。
  for (const value of [details?.code, e?.message, e?.code, error]) {
    if (typeof value !== 'string') continue;
    const code = value.trim().replace(/^functions\//i, '').toUpperCase().replace(/-/g, '_');
    if (['RESERVED_BELOW_USED', 'RESERVED_OVER_CAPACITY', 'COURSE_LINKED_EVENT_MANAGED_BY_COURSE'].includes(code)) return code;
  }
  return '';
}

/** 僅兩個簡報指定業務錯誤提供細節；其餘固定中文，不回傳原始錯誤。 */
export function teamReservationErrorMessage(error: unknown): string {
  const code = errorCode(error);
  return code === 'RESERVED_BELOW_USED' ? BELOW_USED : code === 'RESERVED_OVER_CAPACITY' ? OVER_CAPACITY : FAILED;
}

export interface TeamReservationEventPatch {
  current: number;
  realCurrent: number;
  waitlist: number;
  status: string;
  participants: unknown[];
  waitlistNames: unknown[];
  participantsWithUid: unknown[];
  waitlistWithUid: unknown[];
  teamReservationSummaries: unknown[];
}

/** 只接受 occupancy 欄位，不讓伺服器額外欄位覆蓋活動 ID／其他設定。 */
function eventPatch(value: unknown): TeamReservationEventPatch | null {
  if (!value || typeof value !== 'object') return null;
  const e = value as Record<string, unknown>;
  if (typeof e.current !== 'number' || !Number.isFinite(e.current) || e.current < 0
    || typeof e.realCurrent !== 'number' || !Number.isFinite(e.realCurrent) || e.realCurrent < 0
    || typeof e.waitlist !== 'number' || !Number.isFinite(e.waitlist) || e.waitlist < 0
    || typeof e.status !== 'string' || !e.status
    || !Array.isArray(e.participants) || !Array.isArray(e.waitlistNames)
    || !Array.isArray(e.participantsWithUid) || !Array.isArray(e.waitlistWithUid)
    || !Array.isArray(e.teamReservationSummaries)) return null;
  return {
    current: e.current, realCurrent: e.realCurrent, waitlist: e.waitlist, status: e.status,
    participants: e.participants, waitlistNames: e.waitlistNames,
    participantsWithUid: e.participantsWithUid, waitlistWithUid: e.waitlistWithUid,
    teamReservationSummaries: e.teamReservationSummaries,
  };
}

export interface TeamReservationPromotion {
  /** 至少一個報名 ID 非空；不可改用 userId／userName 配對報名。 */
  id: string;
  docId: string;
  userId: string;
  userName: string;
  teamSeatSource: 'reserved' | 'overflow' | null;
}

/** 僅投影已驗證欄位；髒資料不影響已成功的名額調整，也不提示原始資料。 */
function validatedPromotions(value: unknown): TeamReservationPromotion[] {
  if (!Array.isArray(value)) return [];
  const promoted: TeamReservationPromotion[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if ([item.id, item.docId, item.userId, item.userName]
      .some(field => field != null && typeof field !== 'string')) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const docId = typeof item.docId === 'string' ? item.docId.trim() : '';
    if (!id && !docId) continue;
    if (item.teamSeatSource != null && item.teamSeatSource !== 'reserved' && item.teamSeatSource !== 'overflow') continue;
    promoted.push({
      id, docId,
      userId: typeof item.userId === 'string' ? item.userId : '',
      userName: typeof item.userName === 'string' ? item.userName : '',
      teamSeatSource: item.teamSeatSource ?? null,
    });
  }
  return promoted;
}

export type TeamReservationResult =
  | { status: 'success'; deduplicated: false; message: string; eventPatch: TeamReservationEventPatch; promoted: TeamReservationPromotion[] }
  | { status: 'success'; deduplicated: true; message: string }
  | { status: 'error' | 'busy'; message: string }
  | { status: 'ignored' | 'course-managed'; message: '' };

/**
 * 每個詳情頁建立一個 controller；getSnapshot 只讀目前記憶體快照，不得查 Firestore。
 * T-074b 在回傳後仍須核對自身頁面世代，套用 eventPatch 並依 promoted 的 docId／id
 * 同步 registrations 的 confirmed 狀態及非空 teamSeatSource，並從 eventPatch 的唯一本人投影
 * 補齊俱樂部歸屬；卸載時讓快照回 null。
 */
export function createTeamReservationController(
  getSnapshot: () => TeamReservationSnapshot | null,
  options: { storage?: SlotStorage; now?: () => number; randomSuffix?: () => string } = {},
) {
  const pending = new Set<string>();
  const courseRejected = new Set<string>();
  const now = options.now ?? Date.now;
  return {
    isPending: (eventId: string, teamId: string): boolean => pending.has(JSON.stringify([eventId, teamId])),
    async submit(teamId: string, value: string | number): Promise<TeamReservationResult> {
      let key: string | undefined;
      let isCurrent = () => true;
      let targetEventId = '';
      try {
        const snapshot = getSnapshot();
        const event = snapshot?.event;
        const uid = snapshot?.viewer?.uid;
        if (!snapshot || !event?.id || !uid) return { status: 'error', message: FAILED };
        targetEventId = event.id;
        const generation = snapshot.generation;
        isCurrent = () => {
          const latest = getSnapshot();
          return latest?.generation === generation && latest.event?.id === targetEventId && latest.viewer?.uid === uid;
        };
        if (snapshot.courseRejected || courseRejected.has(event.id) || isTeamReservationCourseManaged(event)) {
          return { status: 'course-managed', message: '' };
        }
        if (!getTeamReservationAction(snapshot, now())) return { status: 'error', message: FAILED };
        const state = getTeamReservationModalState(event, snapshot.viewer, teamId);
        if (!state || state.selectedTeam.id !== teamId) return { status: 'error', message: FAILED };
        const busyKey = JSON.stringify([event.id, teamId]);
        if (pending.has(busyKey)) return { status: 'busy', message: PENDING };
        const numeric = Number(value || 0);
        if (!Number.isFinite(numeric)) return { status: 'error', message: FAILED };
        // 與 A 相同：非負整數化後預檢，後端仍是最終名額裁判。
        const reservedSlots = Math.max(0, Math.trunc(numeric || 0));
        if (reservedSlots < state.used) return { status: 'error', message: BELOW_USED };
        if (reservedSlots > state.maxReserved) return { status: 'error', message: OVER_CAPACITY };
        const payload: AdjustTeamReservationRequest = {
          eventId: event.id, teamId, reservedSlots,
          // 後端只保留前 100 字：時間與亂數須先於可能很長的身分／活動／俱樂部 ID。
          requestId: ('team_res_' + now() + '_' + (options.randomSuffix?.() ?? Math.random().toString(36).slice(2, 5))
            + '_' + uid + '_' + event.id + '_' + teamId).slice(0, 100),
        };
        key = busyKey;
        pending.add(key);
        rememberSlots(teamId, reservedSlots, options.storage);
        const response = await callFn('adjustTeamReservation', payload);
        if (!isCurrent()) return { status: 'ignored', message: '' };
        if (response?.deduplicated === true) return { status: 'success', deduplicated: true, message: PENDING };
        const patch = response?.success === true ? eventPatch(response.event) : null;
        if (!patch) return { status: 'error', message: FAILED };
        return {
          status: 'success', deduplicated: false, eventPatch: patch, promoted: validatedPromotions(response.promoted),
          message: reservedSlots > 0 ? '已更新團隊名額' : '已取消團隊名額',
        };
      } catch (error) {
        if (!isCurrent()) return { status: 'ignored', message: '' };
        if (errorCode(error) === 'COURSE_LINKED_EVENT_MANAGED_BY_COURSE') {
          courseRejected.add(targetEventId);
          return { status: 'course-managed', message: '' };
        }
        return { status: 'error', message: teamReservationErrorMessage(error) };
      } finally {
        if (key) pending.delete(key);
        // key 有值＝已送出 adjustTeamReservation；寫入呼叫一結束就失效（成功、失敗、逾時都算）：伺服器可能已寫入。
        if (key) invalidateViewerRegistrations();
      }
    },
  };
}
