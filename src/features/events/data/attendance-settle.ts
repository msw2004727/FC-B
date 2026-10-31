// 活動正取名單結算：套用簽到狀態，再以最多 5 人同時發放完成活動經驗值。
// 對照 A：event-manage-confirm.js#_confirmAllAttendance、auto-exp/index.js#_grantAutoExp。
// 刻意偏離 A：requestId 使用決定性鍵而非 Date.now()；逐人查 expLogs，避免 A 已發過者重複領取。
// 不移植 _reconcileNoShowExp、不處理未報名單；不直接寫 attendanceRecords 或 expLogs。
// ASSUMPTION: companionName 空而以 userName 補名時，roster key 會與伺服器 `${userId}_${companionName}` 不同，伺服器會略過該列＝不動。
//
// 步驟 0 查證（PM，2026-10-22，FC main 3a30e9256）：
// (a) 不在 desired 裡的人：planAttendanceConfirm 以 `if (!(pUidKey in desiredStateByUid)) continue;` 略過，伺服器完全不動（不會軟刪除）。
// (b) 正式環境含 expTargets：commit 564e54c58（2026-10-19，回傳 expTargets）是 2026-10-20 部署 commit 2f2935fd0 的祖先。仍把缺 expTargets 視為空陣列。
// (c) 金額鍵名：A `_getAutoExpRules` 讀 `siteConfig/autoExpRules` 文件、以規則 key 取值，完成活動為 `complete_activity`（Number(...)，未設定為 0）。
// (d) expLogs.time 是伺服器時區的 'MM/DD HH:mm'、沒有年份，無法比時間；時間窗改用 createdAt（serverTimestamp，A 的 adjustUserExp 也走 adjustExp callable，所以都有 createdAt）。
// (e) 雙邊時間窗含開始前 24h 至結束後 72h，上界排除下一場同名活動紀錄；取不到結束時間則用開始 + 24h。同名活動在開始前 24h 內也辦、一天兩場同名仍刻意不處理，寧可漏發。

import { callFn, CallableError } from '@/data/callables';
import type {
  ConfirmEventAttendanceDesiredState,
  ConfirmEventAttendanceResponse,
} from '@/data/contract/callables';
import { getFirebase } from '@/data/firebase';
import { writeOpLog } from '@/data/op-log';
import {
  normalizeAttendanceSelection,
  type AttendanceSelection,
} from './attendance-edit';
import type { ConfirmedRosterPerson } from './attendance-roster-model';
import { parseEventStartDate } from './event-lifecycle';

export const CONFIRM_ATTENDANCE_TIMEOUT_MS = 30_000;
export const ADJUST_EXP_TIMEOUT_MS = 15_000;
export const COMPLETE_ACTIVITY_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const COMPLETE_ACTIVITY_DEDUPE_AFTER_END_MS = 72 * 60 * 60 * 1000;
export const COMPLETE_ACTIVITY_END_FALLBACK_MS = 24 * 60 * 60 * 1000;
export const AUTO_EXP_MAX_ABS = 100;
export const CONFIRM_ATTENDANCE_TIMEOUT_MESSAGE = '結算逾時，請重新整理後再試';
export const ADJUST_EXP_TIMEOUT_MESSAGE = '發放經驗值逾時';

export interface SettleAttendanceInput {
  event: { id: string; title?: unknown; date?: unknown };
  people: readonly ConfirmedRosterPerson[];
  getSelection: (
    person: ConfirmedRosterPerson,
  ) => Partial<AttendanceSelection> | null | undefined;
  /** 寫操作紀錄用：目前登入者 uid（Rules 要求是自己）。 */
  operatorUid: string | null;
  /** 寫操作紀錄用：顯示名稱 → 角色名 → '系統'，由呼叫端組好。 */
  operatorName: string;
  /** 測試注入。 */
  confirmTimeoutMs?: number;
  adjustTimeoutMs?: number;
}

export type SettleAttendanceResult =
  | {
      ok: true;
      added: number;
      removed: number;
      /** 伺服器回傳的 expTargets（缺就 []），只保留去重後的非空字串。 */
      targets: string[];
      granted: string[];
      /** expLogs：時間窗內有同 uid、同 reason 的紀錄；requestId：伺服器 deduplicated。 */
      skippedAlready: Array<{ uid: string; source: 'expLogs' | 'requestId' }>;
      /** 金額無效時整批不發，此時 granted 與 failed 皆空。 */
      skippedZeroAmount: boolean;
      amountSkipReason?: 'zero' | 'unreadable' | 'out_of_range';
      failed: Array<{ uid: string; error: string }>;
    }
  | { ok: false; stage: 'confirm'; error: string; code?: string };

function str(val: unknown): string {
  return typeof val === 'string'
    ? val.trim()
    : val != null && typeof val === 'number'
      ? String(val)
      : '';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    if (typeof err.message === 'string') return err.message;
  }
  return str(err) || String(err);
}

/** title 原樣使用，不 trim；對照 A `_grantAutoExp`。 */
export function buildCompleteActivityReason(title: string): string {
  return '自動：完成活動' + (title ? `（${title}）` : '');
}

export function buildCompleteActivityRequestId(uid: string, eventId: string): string {
  return `autoexp_${uid}_complete_activity_${eventId}`;
}

/** 以活動起訖建立雙邊時間窗；取不到結束時間時用開始 + 24h。 */
export function resolveCompleteActivityDedupeWindow(
  date: unknown,
): { sinceMs: number; untilMs: number } | null {
  const start = parseEventStartDate(date);
  // 年份超出 Date 範圍時 parseEventStartDate 會回 Invalid Date，比照無法解析。
  if (start === null || Number.isNaN(start.getTime())) return null;

  let endMs = start.getTime() + COMPLETE_ACTIVITY_END_FALLBACK_MS;
  const endPart = typeof date === 'string' ? date.split(' ')[1]?.split('~')[1] : undefined;
  const match = endPart?.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (
      Number.isInteger(hh) && hh >= 0 && hh <= 23 &&
      Number.isInteger(mm) && mm >= 0 && mm <= 59
    ) {
      const y = start.getFullYear();
      const m = start.getMonth();
      const d = start.getDate();
      let end = new Date(y, m, d, hh, mm);
      if (end.getTime() <= start.getTime()) {
        end = new Date(y, m, d + 1, hh, mm);
      }
      endMs = end.getTime();
    }
  }

  return {
    sinceMs: start.getTime() - COMPLETE_ACTIVITY_DEDUPE_WINDOW_MS,
    untilMs: endMs + COMPLETE_ACTIVITY_DEDUPE_AFTER_END_MS,
  };
}

/** 組 desired；省略的列在伺服器完全不動。 */
export function buildAttendanceDesired(
  people: readonly ConfirmedRosterPerson[],
  getSelection: (
    person: ConfirmedRosterPerson,
  ) => Partial<AttendanceSelection> | null | undefined,
): Record<string, ConfirmEventAttendanceDesiredState> {
  const desired = new Map<string, ConfirmEventAttendanceDesiredState>();

  for (const person of people) {
    if (
      person.isTeamHeader ||
      person.isTeamPlaceholder ||
      person.isTeamGeneralSeparator ||
      person.proxyOnly ||
      person.isProxyOnly ||
      person.attendanceAmbiguous === true ||
      (person.courseLinkedRegistration && person.regDocId)
    ) {
      continue;
    }

    const key = person.uid.trim();
    if (!key || desired.has(key)) continue;

    const { checkin, checkout, note } = normalizeAttendanceSelection(getSelection(person));
    desired.set(key, { checkin, checkout, note });
  }

  // fromEntries 保留一般物件格式，也能安全保留 __proto__ 等字面 key。
  return Object.fromEntries(desired);
}

/** 讀取 A 使用的完成活動金額；在送出 requestId 前擋掉無效金額。 */
export async function loadCompleteActivityExpAmount(): Promise<
  { ok: true; amount: number } | { ok: false; reason: 'zero' | 'unreadable' | 'out_of_range' }
> {
  try {
    const [{ doc, getDoc }, { db }] = await Promise.all([
      import('firebase/firestore'),
      getFirebase(),
    ]);
    const snap = await getDoc(doc(db, 'siteConfig', 'autoExpRules'));
    if (!snap.exists()) return { ok: false, reason: 'zero' };

    const value: unknown = snap.data().complete_activity;
    if (value === undefined) return { ok: false, reason: 'zero' };

    const amount = Number(value);
    if (!Number.isFinite(amount)) return { ok: false, reason: 'unreadable' };
    if (amount === 0) return { ok: false, reason: 'zero' };
    if (Math.abs(amount) > AUTO_EXP_MAX_ABS) {
      return { ok: false, reason: 'out_of_range' };
    }
    return { ok: true, amount };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[attendance-settle] loadCompleteActivityExpAmount failed', err);
    return { ok: false, reason: 'unreadable' };
  }
}

/** 無法解析的 createdAt 不算命中；不使用沒有年份的 time。 */
function createdAtMillis(value: unknown): number | null {
  try {
    let millis: unknown;
    if (
      value &&
      typeof value === 'object' &&
      'toMillis' in value &&
      typeof value.toMillis === 'function'
    ) {
      millis = value.toMillis();
    } else if (typeof value === 'number') {
      millis = value;
    } else if (value instanceof Date) {
      millis = value.getTime();
    } else {
      return null;
    }
    return typeof millis === 'number' && Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
}

async function loadExpLogFirestore() {
  const [{ collection, query, where, getDocs }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  return { collection, query, where, getDocs, db };
}

type ExpLogFirestore = Awaited<ReturnType<typeof loadExpLogFirestore>>;

async function hasPriorCompleteActivityGrantWith(
  uid: string,
  reason: string,
  sinceMs: number | null,
  untilMs: number | null,
  fs: ExpLogFirestore,
): Promise<boolean> {
  const snap = await fs.getDocs(
    fs.query(
      fs.collection(fs.db, 'expLogs'),
      fs.where('uid', '==', uid),
      fs.where('reason', '==', reason.trim().slice(0, 200)),
    ),
  );

  if (sinceMs === null) return snap.docs.length > 0;
  return snap.docs.some((entry) => {
    const millis = createdAtMillis(entry.data().createdAt);
    return millis !== null && millis >= sinceMs && (untilMs === null || millis <= untilMs);
  });
}

/** 只查 uid、reason 等值條件，前端判斷雙邊時間窗（兩端含）；上界 null 僅看下界，下界 null 任一筆即命中；查詢錯誤往外拋。 */
export async function hasPriorCompleteActivityGrant(
  uid: string,
  reason: string,
  sinceMs: number | null,
  untilMs: number | null = null,
): Promise<boolean> {
  return hasPriorCompleteActivityGrantWith(
    uid,
    reason,
    sinceMs,
    untilMs,
    await loadExpLogFirestore(),
  );
}

/** 逾時只停止等待，不能取消已送出的 Callable；呼叫端不得自動重試。 */
async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const EXP_GRANT_CONCURRENCY = 5;

type CompleteActivityGrantOutcome =
  | { kind: 'granted'; uid: string }
  | { kind: 'skipped'; uid: string; source: 'expLogs' | 'requestId' }
  | { kind: 'failed'; uid: string; error: string };

/** 發放進行中攔截關閉分頁。瀏覽器只顯示內建提示，完成或失敗後由呼叫端移除。 */
function attachCompleteActivityUnloadWarning(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const warn = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', warn);
  return () => {
    window.removeEventListener('beforeunload', warn);
  };
}

/** 單人仍先查 expLogs 再 adjustExp；查失敗或發放失敗的收集方式與原本相同。 */
async function grantOneCompleteActivityExp(
  uid: string,
  eventId: string,
  reason: string,
  amount: number,
  dedupeWindow: { sinceMs: number; untilMs: number } | null,
  adjustTimeoutMs: number,
  fs: ExpLogFirestore,
): Promise<CompleteActivityGrantOutcome> {
  try {
    if (await hasPriorCompleteActivityGrantWith(
      uid,
      reason,
      dedupeWindow?.sinceMs ?? null,
      dedupeWindow?.untilMs ?? null,
      fs,
    )) {
      return { kind: 'skipped', uid, source: 'expLogs' };
    }
  } catch {
    // 查不到去重證據就不發；重複發放的代價高於漏發。
    return { kind: 'failed', uid, error: 'dedupe_query_failed' };
  }

  try {
    const response = await withTimeout(
      () => callFn('adjustExp', {
        mode: 'auto',
        targets: [uid],
        amount,
        reason,
        operatorLabel: '系統',
        requestId: buildCompleteActivityRequestId(uid, eventId),
      }),
      adjustTimeoutMs,
      ADJUST_EXP_TIMEOUT_MESSAGE,
    );

    const first = response.results?.[0];
    if (response.deduplicated === true) {
      return { kind: 'skipped', uid, source: 'requestId' };
    }
    if (first?.success === false) {
      return { kind: 'failed', uid, error: first.error || 'adjust_failed' };
    }
    if (response.success === true && first?.success === true) {
      // 伺服器對每位 target 回一筆 results；沒有成功結果就不算已發。
      return { kind: 'granted', uid };
    }
    return { kind: 'failed', uid, error: 'unexpected_response' };
  } catch (err) {
    // requestId 一送出就可能已消耗；含逾時在內都不重試。
    return { kind: 'failed', uid, error: errorMessage(err) };
  }
}

export async function settleAttendance(
  input: SettleAttendanceInput,
): Promise<SettleAttendanceResult> {
  const { event, operatorUid, operatorName } = input;
  let desired: Record<string, ConfirmEventAttendanceDesiredState>;
  let res: ConfirmEventAttendanceResponse;

  try {
    desired = buildAttendanceDesired(input.people, input.getSelection);
    res = await withTimeout(
      () => callFn('confirmEventAttendance', { eventId: event.id, desired }),
      input.confirmTimeoutMs ?? CONFIRM_ATTENDANCE_TIMEOUT_MS,
      CONFIRM_ATTENDANCE_TIMEOUT_MESSAGE,
    );
    // ASSUMPTION: success 非 true 視為結算失敗，不寫操作紀錄或發放經驗值。
    if (res.success !== true) throw new Error('unexpected_response');
  } catch (err) {
    return {
      ok: false,
      stage: 'confirm',
      error: errorMessage(err),
      ...(err instanceof CallableError ? { code: err.code } : {}),
    };
  }

  const title = typeof event.title === 'string' ? event.title : '';
  const { added, removed } = res;

  void writeOpLog({
    type: 'manual_attendance',
    typeName: '編輯簽到',
    content: `活動 ${title} 已套用編輯簽到（共 ${Object.keys(desired).length} 人，${added + removed} 筆操作）`,
    actorUid: operatorUid,
    operator: operatorName,
  }).catch(() => {
    // writeOpLog 原本會吞錯；額外保護，避免日誌失敗中斷已完成結算的後續發放。
  });

  const targets = Array.isArray(res.expTargets)
    ? [...new Set(
        res.expTargets
          .filter((uid): uid is string => typeof uid === 'string')
          .map((uid) => str(uid))
          .filter((uid) => uid.length > 0),
      )]
    : [];

  const result: Extract<SettleAttendanceResult, { ok: true }> = {
    ok: true,
    added,
    removed,
    targets,
    granted: [],
    skippedAlready: [],
    skippedZeroAmount: false,
    failed: [],
  };

  if (targets.length === 0) return result;

  const amountResult = await loadCompleteActivityExpAmount();
  if (!amountResult.ok) {
    result.skippedZeroAmount = true;
    result.amountSkipReason = amountResult.reason;
    return result;
  }

  const reason = buildCompleteActivityReason(title);
  const dedupeWindow = resolveCompleteActivityDedupeWindow(event.date);
  const adjustTimeoutMs = input.adjustTimeoutMs ?? ADJUST_EXP_TIMEOUT_MS;
  const outcomes: Array<CompleteActivityGrantOutcome | undefined> = new Array(targets.length);
  let nextIndex = 0;
  const releaseUnloadWarning = attachCompleteActivityUnloadWarning();

  try {
    // 池啟動前解析一次，工人共用同一組 firestore 與 db，避免同時動態載入。
    const fs = await loadExpLogFirestore();
    // 固定最多 5 條工人：做完一人才取下一個 index，不是一次展開全部 targets。
    const workerCount = Math.min(EXP_GRANT_CONCURRENCY, targets.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < targets.length) {
        const index = nextIndex;
        nextIndex += 1;
        const uid = targets[index];
        if (!uid) continue;
        outcomes[index] = await grantOneCompleteActivityExp(
          uid,
          event.id,
          reason,
          amountResult.amount,
          dedupeWindow,
          adjustTimeoutMs,
          fs,
        );
      }
    }));
  } finally {
    releaseUnloadWarning();
  }

  for (const outcome of outcomes) {
    if (!outcome) continue;
    if (outcome.kind === 'granted') {
      result.granted.push(outcome.uid);
    } else if (outcome.kind === 'skipped') {
      result.skippedAlready.push({ uid: outcome.uid, source: outcome.source });
    } else {
      result.failed.push({ uid: outcome.uid, error: outcome.error });
    }
  }

  return result;
}
