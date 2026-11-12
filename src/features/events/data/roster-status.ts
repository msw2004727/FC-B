import { callFn } from '@/data/callables';
import type {
  ForceDemoteToWaitlistAppliedResponse,
  ForceDemoteToWaitlistResponse,
  ForcePromoteWaitlistAppliedResponse,
  ForcePromoteWaitlistResponse,
} from '@/data/contract/callables';
import { writeOpLog } from '@/data/op-log';
import { runInBackground } from './background-work';
import { invalidateViewerRegistrations } from './viewer-registrations-cache';
import type { RosterRegistrationInput } from './attendance-roster-model';
import type { OperateContext } from './operate-permissions';
import {
  canAdjustRosterStatus, isRosterStatusCourseEvent, isRosterStatusCourseTarget, rosterStatusTargets,
  type RosterStatusAction, type RosterStatusEvent,
} from './roster-status-policy';
import { ROSTER_STATUS_ERROR_KEYS, rosterStatusErrorCode } from './roster-status-errors';

export const ROSTER_STATUS_TIMEOUT_MS = 35_000;
export interface RosterStatusSnapshot {
  event: RosterStatusEvent;
  registrations: readonly RosterRegistrationInput[];
  context: OperateContext;
  operatorName: string;
}
export interface RosterStatusInput {
  action: RosterStatusAction;
  eventId: string;
  target: { userId: string; name: string; isCompanion?: boolean };
  getLatest: () => RosterStatusSnapshot;
  reload: () => Promise<RosterStatusSnapshot>;
  refreshPermissions: () => void;
  flush: () => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Callable 已成功時，在日誌與重讀之前套用伺服器投影與目標報名的新狀態。 */
  adopt?: (next: RosterStatusSnapshot) => void;
  /** 背景重讀失敗時的既有「名單資料同步中」提示。 */
  onSyncing?: (message: string) => void;
}
export interface RosterStatusResult {
  message: string;
  tone: 'success' | 'error' | 'info' | 'warning';
  /** 成功後的背景重讀；呼叫端先出 toast，等它結束才解鎖。不會 reject。 */
  settled?: Promise<void>;
}
/** 名單狀態調整；兼容尚未提供 randomUUID 的 WebView。 */
export function newRosterStatusRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function projectRosterStatusResult(
  snapshot: RosterStatusSnapshot,
  action: RosterStatusAction,
  userId: string,
  response: ForceDemoteToWaitlistAppliedResponse | ForcePromoteWaitlistAppliedResponse,
): RosterStatusSnapshot {
  const from = action === 'demote' ? 'confirmed' : 'waitlisted';
  const to = action === 'demote' ? 'waitlisted' : 'confirmed';
  return {
    ...snapshot,
    event: { ...snapshot.event, ...response.event },
    registrations: snapshot.registrations.map((reg) => (
      reg.userId === userId && reg.status === from ? { ...reg, status: to } : reg
    )),
  };
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ROSTER_STATUS_TIMEOUT_MS);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
/** 名單狀態調整；確認後與每次呼叫前都從目前快照重驗。 */
export async function adjustRosterStatus(input: RosterStatusInput): Promise<RosterStatusResult> {
  const { action, target } = input;
  const demote = action === 'demote';
  const initial = input.getLatest();
  const actorUid = initial.context.uid;
  const msg = (key: string, params?: Record<string, string | number>) =>
    input.t('events.roster.' + key, params);
  const result = (key: string, tone: RosterStatusResult['tone'] = 'error'): RosterStatusResult =>
    ({ message: msg(key, { name: target.name }), tone });
  const guard = (): RosterStatusResult | null => {
    const latest = input.getLatest();
    if (!actorUid || latest.context.uid !== actorUid) return result('loginRequired');
    if (isRosterStatusCourseEvent(latest.event)
      || isRosterStatusCourseTarget(action, latest.registrations, target.userId)) return result('useLegacyForCourse');
    if (demote && Number(latest.event.max || 0) <= 0) return result('noWaitlistCap');
    if (!canAdjustRosterStatus(action, latest.context, latest.event)) return result('noPermission');
    if (demote && target.isCompanion) return result('companionDemoteAlone');
    if (!target.userId || !rosterStatusTargets(action, latest.registrations, target.userId).length) {
      return result(demote ? 'confirmedNotFound' : 'waitlistNotFound');
    }
    return null;
  };
  const reloadSafely = async (): Promise<RosterStatusSnapshot | null> => {
    try { return await input.reload(); } catch { return null; }
  };
  const reconcile = async (): Promise<RosterStatusResult> => {
    const fresh = await reloadSafely();
    if (!fresh) return result('rosterSyncing');
    const owned = fresh.registrations.filter(reg => reg.userId === target.userId);
    const from = demote ? 'confirmed' : 'waitlisted';
    const to = demote ? 'waitlisted' : 'confirmed';
    if (!owned.some(reg => reg.status === from) && owned.some(reg => reg.status === to)) {
      return result(demote ? 'alreadyWaitlisted' : 'alreadyConfirmed', 'info');
    }
    return result(owned.some(reg => ['confirmed', 'waitlisted'].includes(String(reg.status)))
      ? 'statusFailed' : 'regMissing');
  };
  const handleError = async (error: unknown): Promise<RosterStatusResult> => {
    // 送出失敗（含 TIMEOUT）也失效：伺服器可能已寫入。成功路徑在送出後失效。
    invalidateViewerRegistrations();
    const code = rosterStatusErrorCode(error);
    if (code === 'REGISTRATION_NOT_CONFIRMED' || code === 'REGISTRATION_NOT_WAITLISTED') {
      return reconcile();
    }
    if (code === 'PERMISSION_DENIED') input.refreshPermissions();
    if (code === 'INVALID_ARGUMENT') console.error('[名單狀態調整] INVALID_ARGUMENT');
    if (code && code !== 'TIMEOUT' && code !== 'UNKNOWN' && !ROSTER_STATUS_ERROR_KEYS[code]) console.warn(code);
    // 例外結果均重讀；不自動重送，也不顯示原始錯誤。
    await reloadSafely();
    return result(code === 'TIMEOUT' ? 'statusTimeout' : ROSTER_STATUS_ERROR_KEYS[code] || 'statusFailed');
  };
  const send = (allowOverCapacity = false) => {
    const payload = { eventId: input.eventId, userId: target.userId, requestId: newRosterStatusRequestId() };
    return withTimeout<ForceDemoteToWaitlistResponse | ForcePromoteWaitlistResponse>(demote
      ? callFn('forceDemoteToWaitlist', payload)
      : callFn('forcePromoteWaitlist', { ...payload, ...(allowOverCapacity ? { allowOverCapacity: true } : {}) }));
  };
  try {
    const blocked = guard();
    if (blocked) return blocked;
    if (demote) {
      const count = rosterStatusTargets(action, initial.registrations, target.userId)
        .filter(reg => reg.participantType === 'companion').length;
      if (!await input.confirm(msg(count ? 'demoteConfirmWithCompanions' : 'demoteConfirm',
        { name: target.name, count }))) return { message: '', tone: 'info' };
    }
    const afterConfirm = guard();
    if (afterConfirm) return afterConfirm;
    await input.flush();
    const afterFlush = guard();
    if (afterFlush) return afterFlush;
    let sentSnapshot = input.getLatest();
    let response: ForceDemoteToWaitlistResponse | ForcePromoteWaitlistResponse;
    try {
      response = await send();
    } catch (error) {
      if (demote || rosterStatusErrorCode(error) !== 'CAPACITY_EXCEEDED') return await handleError(error);
      // 拿新名單算確認數字；重讀失敗仍允許使用無數字確認，伺服器為最終裁判。
      const fresh = await reloadSafely();
      let latest = input.getLatest();
      const afterReload = guard();
      if (afterReload) return afterReload;
      if (!canAdjustRosterStatus('demote', latest.context, latest.event)) {
        input.refreshPermissions();
        return result('noPermission');
      }
      const after = fresh ? fresh.registrations.filter(reg => reg.status === 'confirmed').length
        + rosterStatusTargets(action, fresh.registrations, target.userId).length : 0;
      const max = Number(latest.event.max || 0);
      const confirmed = await input.confirm(msg(fresh && max > 0 && after > max
        ? 'overCapacityConfirm' : 'overCapacityConfirmNoCount', { after, max }));
      if (!confirmed) return { message: '', tone: 'info' };
      const afterSecondConfirm = guard();
      if (afterSecondConfirm) return afterSecondConfirm;
      latest = input.getLatest();
      if (!canAdjustRosterStatus('demote', latest.context, latest.event)) return result('noPermission');
      sentSnapshot = latest;
      try { response = await send(true); } catch (secondError) { return await handleError(secondError); }
    }
    invalidateViewerRegistrations();
    if ('deduplicated' in response) return await reconcile();
    const targets = rosterStatusTargets(action, sentSnapshot.registrations, target.userId);
    const names = targets.map(reg => reg.participantType === 'companion'
      ? reg.companionName || reg.userName : reg.userName).filter(Boolean).map(String);
    const title = String(sentSnapshot.event.title || '');
    const message = msg(demote ? 'demoteDone' : 'promoteDone', { name: target.name })
      + msg('doneWithCount', { current: response.current, max: Number(sentSnapshot.event.max || 0) })
      + ('overCapacity' in response && response.overCapacity ? '\n' + msg('overCapacityNote') : '');
    // 按鈕加速①：伺服器已確認後先套投影，toast 不等日誌與整份重讀。重讀回來由 reload 照舊覆蓋。
    // 投影以「目前」快照為底（不用送出時的舊快照，避免蓋回期間別的重讀結果）；套用出錯不影響已提交的結果。
    try {
      input.adopt?.(projectRosterStatusResult(input.getLatest(), action, target.userId, response));
    } catch (error) { console.warn('[名單狀態調整] 投影套用失敗', error); }
    const syncing = msg('rosterSyncing');
    // writeOpLog 自己吞錯；與重讀並行，縮短呼叫端持鎖時間。
    runInBackground(() => writeOpLog({
      type: demote ? 'force_demote' : 'force_promote',
      typeName: demote ? '下放候補' : '手動正取',
      content: demote ? `活動「${title}」將 ${target.name} 下放至候補`
        : `活動「${title}」將 ${names.join('、')} 從候補升為正取`,
      eventId: input.eventId, actorUid, operator: sentSnapshot.operatorName || '管理員',
    }), '[名單狀態調整] 日誌寫入失敗');
    // 重讀完成前呼叫端仍持鎖（Opus／Gemini 審查：提早解鎖會讓重讀清掉剛勾的簽到、蓋回下一次操作）。
    const settled = (async () => {
      const fresh = await reloadSafely();
      if (fresh) return;
      try { input.onSyncing?.(syncing); } catch (error) { console.warn('[名單狀態調整] 同步提示失敗', error); }
    })();
    return { message, tone: 'success', settled };
  } catch (error) {
    return await handleError(error);
  }
}
