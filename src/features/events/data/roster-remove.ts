/**
 * 活動詳情出席表「踢人」（移除報名者）資料層。
 *
 * 對照舊版 A `js/modules/event/event-manage-lifecycle.js#_removeParticipant`（第 357～627 行）：
 * - B 只走 CF 路徑：呼叫 `callFn('cancelRegistration', { eventId, registrationIds: [regDocId], reason: 'manager_remove', requestId })`。
 * - 15 秒逾時（訊息「移除操作逾時，請重新整理後再試」）。
 * - 呼叫前依目標報名狀態檢查 `canRemoveConfirmedParticipant`／`canRemoveWaitlistedParticipant`（R-IAM-004）。
 * - 嚴禁直接寫入 `registrations` 或 `events` 文件（R-REG-001～003）。
 * - 成功後寫操作日誌 `writeOpLog`（type: `participant_removed`，標題「移除參加者」，內容「從「{活動}」移除 {名字}」）。
 */

import { callFn, CallableError } from '@/data/callables';
import type { CancelRegistrationResponse } from '@/data/contract/callables';
import { writeOpLog } from '@/data/op-log';
import type { RosterRegistrationInput } from './attendance-roster-model';
import {
  canRemoveConfirmedParticipant,
  canRemoveWaitlistedParticipant,
  type OperateContext,
  type OperateEvent,
} from './operate-permissions';

export const REMOVE_PARTICIPANT_TIMEOUT_MS = 15_000;
export const REMOVE_PARTICIPANT_TIMEOUT_MESSAGE = '移除操作逾時，請重新整理後再試';

const CF_ERROR_MAP: Readonly<Record<string, string>> = {
  ALREADY_CANCELLED: '已取消此報名',
  REG_NOT_FOUND: '找不到報名紀錄',
  EVENT_NOT_FOUND: '活動不存在',
  PERMISSION_DENIED: '無權限執行此操作',
};

export interface ManagerRemoveTargetInput {
  /** 被移除者 uid（本人用 userId，同行者用 companionId，對照 A `_removeParticipant` 的 `uid` 參數）。 */
  uid: string;
  /** 被移除者顯示名稱（用於操作紀錄與 toast）。 */
  name: string;
  /** 是否為同行者列。 */
  isCompanion?: boolean;
  /** 指定報名紀錄 ID（課程學員列或明確指定時傳入）。 */
  registrationId?: string | null;
  /** 若呼叫端已持有單筆目標報名可直接傳入。 */
  registration?: RosterRegistrationInput | null;
}

export interface ManagerRemoveRegistrationInput {
  /** public eventId（R-ID-009）。 */
  eventId: string;
  /** 活動資料（含 title 與權限判定欄位）。 */
  event: (OperateEvent & { id?: unknown; title?: unknown }) | null | undefined;
  /** 目標參加者或報名紀錄資訊。 */
  registration: ManagerRemoveTargetInput;
  /** 活動目前所有報名紀錄（用於照 A 篩選 targetRegsForPermission 與目標 reg）。 */
  registrations?: readonly RosterRegistrationInput[];
  /** 操作者 uid（用於 writeOpLog 的 actorUid）。 */
  operatorUid: string | null;
  /** 操作者名稱（用於 writeOpLog 的 operator；未提供時預設 '管理員'）。 */
  operatorName?: string;
  /** 權限判定 context。 */
  context: OperateContext;
  /** 測試注入時間戳（預設 Date.now()）。 */
  now?: number;
  /** 測試注入逾時秒數（預設 15000ms）。 */
  timeoutMs?: number;
}

export type ManagerRemoveRegistrationResult =
  | {
      ok: true;
      toastMessage: string;
      regDocId: string;
      response: CancelRegistrationResponse;
    }
  | {
      ok: false;
      reason: 'event_missing' | 'permission_denied' | 'not_found' | 'callable_failed';
      toastMessage: string;
    };

function str(val: unknown): string {
  return typeof val === 'string'
    ? val.trim()
    : val != null && typeof val === 'number'
      ? String(val)
      : '';
}

function docIdOf(reg: RosterRegistrationInput): string {
  return str(reg._docId) || str(reg.id);
}

function isActiveReg(reg: RosterRegistrationInput): boolean {
  const status = str(reg.status);
  return status !== 'cancelled' && status !== 'removed';
}

/**
 * 對照 A `_getEventRegistrationErrorCode`：從 CallableError / Firebase Functions error 取出大寫錯誤碼。
 */
export function extractRemoveErrorCode(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const e = err as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  if (e.details && typeof e.details === 'object') {
    const det = e.details as { code?: unknown };
    if (typeof det.code === 'string' && det.code.trim()) {
      return det.code.trim();
    }
  }
  if (typeof e.details === 'string' && e.details.trim()) {
    return e.details.trim();
  }
  const msg = typeof e.message === 'string' ? e.message.trim() : '';
  for (const code of Object.keys(CF_ERROR_MAP)) {
    if (msg.includes(code)) return code;
  }
  if (err instanceof CallableError && typeof e.code === 'string') {
    const normalized = e.code.replace(/^functions\//, '').toUpperCase().replace(/-/g, '_');
    if (normalized in CF_ERROR_MAP) return normalized;
  }
  return msg;
}

/**
 * 對照 A `_removeParticipant` catch 分支的錯誤訊息格式化。
 */
export function formatRemoveParticipantErrorToast(err: unknown): string {
  const errCode = extractRemoveErrorCode(err);
  const mapped = CF_ERROR_MAP[errCode];
  if (mapped) {
    return `移除失敗：${mapped}`;
  }
  const rawMessage =
    err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message
      : '';
  // A 逾時 Promise 直接 reject Error('移除操作逾時，請重新整理後再試')，測試與對照保留該訊息或網路逾時訊息。
  if (rawMessage === REMOVE_PARTICIPANT_TIMEOUT_MESSAGE) {
    return `移除失敗：${REMOVE_PARTICIPANT_TIMEOUT_MESSAGE}`;
  }
  const isNetworkOrTimeout = /timeout|network|fetch|ECONNREFUSED|逾時/i.test(rawMessage);
  if (isNetworkOrTimeout) {
    return '移除失敗：連線逾時，請檢查網路後重新整理再試';
  }
  return `移除失敗：${rawMessage}`;
}

/**
 * 篩出該參加者於此活動的有效報名（對照 A `targetRegsForPermission` 與 `reg` 搜尋）。
 */
function findTargetRegistrations(
  allRegs: readonly RosterRegistrationInput[],
  target: ManagerRemoveTargetInput,
): RosterRegistrationInput[] {
  const exactRegistrationId = str(target.registrationId);
  const uid = str(target.uid);
  const isCompanion = Boolean(target.isCompanion);

  const source =
    allRegs.length > 0
      ? allRegs
      : target.registration
        ? [target.registration]
        : [];

  return source
    .filter((r) => {
      if (exactRegistrationId) {
        return docIdOf(r) === exactRegistrationId;
      }
      if (isCompanion) {
        return str(r.companionId) === uid;
      }
      const rUserId = str(r.userId) || str(r.uid) || str(r.ownerUid);
      return rUserId === uid && str(r.participantType) !== 'companion';
    })
    .filter(isActiveReg);
}

/**
 * 執行管理員踢人（正取或候補）。
 *
 * 對照 A `_removeParticipant`：
 * 1. 檢查權限（正取需 `canRemoveConfirmedParticipant`、候補需 `canRemoveWaitlistedParticipant`）。
 * 2. 尋找有效報名紀錄，無則回傳「找不到對應的報名紀錄」。
 * 3. 呼叫 `callFn('cancelRegistration', { eventId, registrationIds: [regDocId], reason: 'manager_remove', requestId })`，含 15s 逾時。
 * 4. 成功後寫入 `writeOpLog('participant_removed', '移除參加者', '從「{title}」移除 {name}', eventId)`。
 */
export async function managerRemoveRegistration(
  input: ManagerRemoveRegistrationInput,
): Promise<ManagerRemoveRegistrationResult> {
  const { eventId, event, registration, registrations = [], operatorUid, context } = input;
  if (!event) {
    return {
      ok: false,
      reason: 'event_missing',
      toastMessage: '',
    };
  }

  const targetRegsForPermission = findTargetRegistrations(registrations, registration);
  const touchesConfirmed = targetRegsForPermission.some((r) => {
    const st = str(r.status);
    return st === 'confirmed' || st === 'registered';
  });
  const touchesWaitlisted = targetRegsForPermission.some(
    (r) => str(r.status) === 'waitlisted',
  );

  // ASSUMPTION: 若報名清單尚未匹配到任何紀錄但呼叫端嘗試踢人，預設仍先檢查現場或正取權限；
  // 若匹配到紀錄則嚴格照 A 分別檢查 touchesConfirmed 與 touchesWaitlisted。
  if (touchesConfirmed && !canRemoveConfirmedParticipant(context, event)) {
    return {
      ok: false,
      reason: 'permission_denied',
      toastMessage: '權限不足',
    };
  }
  if (touchesWaitlisted && !canRemoveWaitlistedParticipant(context, event)) {
    return {
      ok: false,
      reason: 'permission_denied',
      toastMessage: '權限不足',
    };
  }
  if (
    !touchesConfirmed
    && !touchesWaitlisted
    && !canRemoveConfirmedParticipant(context, event)
    && !canRemoveWaitlistedParticipant(context, event)
  ) {
    return {
      ok: false,
      reason: 'permission_denied',
      toastMessage: '權限不足',
    };
  }

  const reg = targetRegsForPermission[0];
  const regDocId = reg ? docIdOf(reg) : '';
  if (!reg || !regDocId) {
    return {
      ok: false,
      reason: 'not_found',
      toastMessage: '找不到對應的報名紀錄',
    };
  }

  const uid = str(registration.uid);
  const timestamp = input.now ?? Date.now();
  const requestId = `remove_${uid}_${eventId}_${timestamp}`;
  const timeoutMs = input.timeoutMs ?? REMOVE_PARTICIPANT_TIMEOUT_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(REMOVE_PARTICIPANT_TIMEOUT_MESSAGE));
    }, timeoutMs);
  });

  let response: CancelRegistrationResponse;
  try {
    response = await Promise.race([
      callFn('cancelRegistration', {
        eventId,
        registrationIds: [regDocId],
        reason: 'manager_remove',
        requestId,
      }),
      timeoutPromise,
    ]);
  } catch (err) {
    return {
      ok: false,
      reason: 'callable_failed',
      toastMessage: formatRemoveParticipantErrorToast(err),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  const eventTitle = str(event.title);
  const targetName = str(registration.name);
  await writeOpLog({
    type: 'participant_removed',
    typeName: '移除參加者',
    content: `從「${eventTitle}」移除 ${targetName}`,
    eventId,
    actorUid: operatorUid,
    operator: str(input.operatorName) || '管理員',
  });

  return {
    ok: true,
    regDocId,
    response,
    toastMessage: `已將 ${targetName} 從報名名單中移除`,
  };
}
