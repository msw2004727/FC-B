/**
 * 臨時取消時限（FC 契約 late-cancel-contract-2026-11-23 §1、§2、§3、§8）。
 * 判定（記點）只在 Functions `cancelRegistration` 交易內；這裡只做顯示用的同一套判斷，不寫 Firestore。
 * 與團隊預留 `normalizeReleaseHours`（缺值＝0）是兩支函式、兩個常數，不可合併或互相呼叫：差別只有缺值，這裡缺值＝2。
 * 不得被入口檔引用（只給建立表單、詳情頁、取消流程、名單、用戶管理這些延後載入的畫面）。
 */
import { eventStartMs } from './terminal';

/** 允許值；0＝不設定（站長 11-23 定）。 */
export const LATE_CANCEL_HOURS = [0, 2, 3, 6, 12, 24, 48] as const;
export type LateCancelHours = typeof LATE_CANCEL_HOURS[number];
/** 新活動預設，且已建立的活動缺欄位也當 2（不回填正式資料）。 */
export const DEFAULT_LATE_CANCEL_HOURS = 2;
/**
 * 起算點（與 Functions 同值）：活動開始時間早於此不記點，彈窗也不寫標記後果。
 * 暫定值：上線時由 PM／顧問依「前端上線日＋至少 1 天」確認，前後端同步改。
 */
export const LATE_CANCEL_SINCE = Date.parse('2026-11-25T00:00:00+08:00');

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** 90 天內第 3 次變紅標（站長 11-23 定）。 */
const RED_WINDOW_MS = 90 * DAY_MS;
const RED_THRESHOLD = 3;

/** `undefined`（沒有鍵或值為 undefined）→ 2；允許值照用；其餘（含 null、字串、NaN、不在清單）→ 0。 */
export function normalizeLateCancelHours(
  event: { lateCancelHours?: unknown } | null | undefined,
): LateCancelHours {
  const v = event?.lateCancelHours;
  if (v === undefined) return DEFAULT_LATE_CANCEL_HOURS;
  return typeof v === 'number' && (LATE_CANCEL_HOURS as readonly number[]).includes(v)
    ? v as LateCancelHours
    : 0;
}

export interface LateCancelEvent {
  lateCancelHours?: unknown;
  courseLinkId?: unknown;
  status?: unknown;
  date?: unknown;
  startAt?: unknown;
  startTime?: unknown;
}

/** §3 活動層條件：判定值 > 0、不是課程連結活動、活動沒有被取消。 */
export function isLateCancelEnabled(event: LateCancelEvent | null | undefined): boolean {
  if (!event) return false;
  if (normalizeLateCancelHours(event) <= 0) return false;
  // 與後端 sanitizeStr 一致：去頭尾空白後非空才算課程連結活動。
  if (typeof event.courseLinkId === 'string' && event.courseLinkId.trim() !== '') return false;
  return event.status !== 'cancelled';
}

/** 表單下拉選項文字（與活動頁小字同一句）。 */
export function lateCancelOptionLabel(hours: number): string {
  return hours > 0 ? `開始前 ${hours} 小時內取消算臨時取消` : '不設定';
}

/**
 * 活動頁報名按鈕下方小字（§3 文案甲）：活動層條件成立且活動尚未開始才回字串。
 * 非 provisional（只用伺服器讀回的活動文件）由呼叫端擋。
 */
export function lateCancelHint(event: LateCancelEvent | null | undefined, nowMs: number): string | null {
  if (!event || !isLateCancelEnabled(event)) return null;
  const start = eventStartMs(event);
  if (!(start > nowMs)) return null;
  return lateCancelOptionLabel(normalizeLateCancelHours(event));
}

/** 現在取消是否落在時限內（§4 第 2、3 條）：活動開始時間 ≥ 起算點且 0 < 開始 − 現在 ≤ 時限。 */
export function isWithinLateCancelWindow(event: LateCancelEvent | null | undefined, nowMs: number): boolean {
  if (!event || !isLateCancelEnabled(event)) return false;
  const start = eventStartMs(event);
  if (!(start > 0) || start < LATE_CANCEL_SINCE) return false;
  const remaining = start - nowMs;
  return remaining > 0 && remaining <= normalizeLateCancelHours(event) * HOUR_MS;
}

/** Timestamp／{seconds}／毫秒數字 → 毫秒；其餘 null。 */
export function lateCancelTimeMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value || typeof value !== 'object') return null;
  const record = value as { toMillis?: unknown; seconds?: unknown };
  if (typeof record.toMillis === 'function') {
    const ms = Number((record.toMillis as () => unknown)());
    return Number.isFinite(ms) ? ms : null;
  }
  return typeof record.seconds === 'number' && Number.isFinite(record.seconds) ? record.seconds * 1000 : null;
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 照 FC functions/index.js isCourseLinkedRegistrationData：課程報名不記點（§4 第 4 條）。 */
export function isCourseLinkedRegistration(reg: Record<string, unknown>): boolean {
  const source = trimmed(reg.source) || trimmed(reg.courseLinkSource);
  const state = trimmed(reg.courseLinkState);
  return source === 'eduCourseLesson'
    || state === 'created_by_course'
    || state === 'priority_overlay'
    || reg.coursePriority === true
    || trimmed(reg.courseLinkId) !== ''
    || trimmed(reg.courseStudentId) !== '';
}

/** 被取消的那筆報名是否可能記點（§4 第 1、4、5 條；顯示用）：正取、非課程連結、不是時限內才遞補上來。 */
export function isLateCancelRegistration(
  reg: { status?: unknown; promotedAt?: unknown },
  event: LateCancelEvent,
): boolean {
  if (reg.status !== 'confirmed') return false;
  if (isCourseLinkedRegistration(reg as Record<string, unknown>)) return false;
  const promoted = lateCancelTimeMs(reg.promotedAt);
  if (promoted === null) return true;
  return promoted < eventStartMs(event) - normalizeLateCancelHours(event) * HOUR_MS;
}

/** users 的臨取欄位（§5，只由 Functions 寫；前端只讀）。 */
export interface LateCancelUserInfo {
  level: 'black' | 'red' | null;
  untilMs: number | null;
  releaseAt: number;
  recentMs: readonly number[];
  total: number;
}

export type LateCancelTag = 'black' | 'red';

/** 只有黑標且還沒到解除時間的人，才需要讀出席場數（§8）。 */
export function needsLateCancelAttendance(info: LateCancelUserInfo | null | undefined, nowMs: number): boolean {
  return info?.level === 'black' && info.untilMs !== null && info.untilMs > nowMs;
}

/** §8 標籤狀態：紅 → 紅；黑且未過期且出席數 < 解除場數 → 黑；其他（含出席數未知）不畫。 */
export function lateCancelTagState(
  info: LateCancelUserInfo | null | undefined,
  attendedCount: number | null | undefined,
  nowMs: number,
): LateCancelTag | null {
  if (info?.level === 'red') return 'red';
  if (!needsLateCancelAttendance(info, nowMs)) return null;
  if (typeof attendedCount !== 'number' || !Number.isFinite(attendedCount)) return null;
  return attendedCount < (info?.releaseAt ?? 0) ? 'black' : null;
}

/** 90 天內的紀錄筆數（含本次）；已是紅標回 null（再取消仍是紅標）。 */
export function lateCancelCountIfMarked(info: LateCancelUserInfo | null | undefined, nowMs: number): number | null {
  if (info?.level === 'red') return null;
  const recent = (info?.recentMs ?? []).filter(ms => ms > nowMs - RED_WINDOW_MS);
  return recent.length + 1;
}

/** 這次記點後會不會變紅標（§5：90 天內第 3 次）。 */
export function lateCancelWouldTurnRed(info: LateCancelUserInfo | null | undefined, nowMs: number): boolean {
  const count = lateCancelCountIfMarked(info, nowMs);
  return count !== null && count >= RED_THRESHOLD;
}

/** 取消彈窗的候補資訊（候補順位用頁面已有名單，零額外讀）。 */
export function lateCancelWaitlistLine(waitlistCount: number, cancelledConfirmed: number, verb = '會讓給'): string {
  const n = Math.min(Math.max(0, Math.floor(waitlistCount)), Math.max(0, Math.floor(cancelledConfirmed)));
  if (n <= 0) return '目前無人候補，名額將空出';
  return `名額${verb}候補第 ${Array.from({ length: n }, (_, i) => i + 1).join('、')} 位`;
}

/** 取消成功且伺服器回 `lateCancelMarked` 時接在原本成功提示後面（toast 一次）。 */
export function withLateCancelMarked(message: string, marked: unknown): string {
  return marked === true ? `${message}，已記一次臨時取消` : message;
}

export interface LateCancelConfirmContent {
  /** 紅色粗體警示列；時限外沒有。 */
  warn?: string;
  message: string;
  /** 次要說明（可含 \n 換行）。 */
  sub: string;
  cancelText: string;
  okText: string;
}

export interface LateCancelConfirmInput {
  event: LateCancelEvent;
  nowMs: number;
  /** 這次要取消、且可能記點的報名筆數（isLateCancelRegistration）。 */
  eligibleCount: number;
  /** 這次要取消的正取筆數（算候補順位）。 */
  confirmedCount: number;
  waitlistCount: number;
  /** undefined＝讀不到操作者資料：只寫中性後果，不寫恢復條件（避免紅標的人看到「7 天後恢復」）。 */
  user: LateCancelUserInfo | null | undefined;
}

/**
 * 本人取消報名的確認框內容（預覽 ②③④）；活動層條件不成立回 null（呼叫端沿用原本確認框）。
 * 起算點前的活動、只取消候補或不可能記點的報名：只多一句候補資訊（②），不寫標記後果。
 */
export function buildLateCancelConfirm(input: LateCancelConfirmInput): LateCancelConfirmContent | null {
  const { event, nowMs, user } = input;
  if (!isLateCancelEnabled(event)) return null;
  const waitLine = lateCancelWaitlistLine(input.waitlistCount, input.confirmedCount);
  if (input.eligibleCount <= 0 || !isWithinLateCancelWindow(event, nowMs)) {
    return { message: '確定要取消報名？', sub: waitLine, cancelText: '返回', okText: '確定取消' };
  }
  if (user === undefined) {
    return {
      warn: `距開始不到 ${normalizeLateCancelHours(event)} 小時`,
      message: '現在取消會記一次臨時取消',
      sub: `同一場只記一次\n${waitLine}`,
      cancelText: '保留名額',
      okText: '仍要取消',
    };
  }
  const count = lateCancelCountIfMarked(user, nowMs);
  if (count !== null && count >= RED_THRESHOLD) {
    return {
      warn: `這是你 90 天內第 ${count} 次臨時取消`,
      message: '取消後標籤會變紅',
      sub: '紅標要管理員解除',
      cancelText: '保留名額',
      okText: '仍要取消',
    };
  }
  return {
    warn: `距開始不到 ${normalizeLateCancelHours(event)} 小時`,
    message: '現在取消會記一次臨時取消',
    sub: `${user?.level === 'red' ? '紅標要管理員解除' : '名字標籤 7 天或出席 3 場後恢復'}\n同一場只記一次\n${waitLine}`,
    cancelText: '保留名額',
    okText: '仍要取消',
  };
}

/**
 * 同行者取消彈窗的時限內提示（預覽 ⑤-3）；不在時限內或勾選裡沒有可能記點的報名回 null。
 * selfChecked：勾選含本人那筆。
 */
export function buildCompanionLateCancelNote(
  input: LateCancelConfirmInput & { selfChecked: boolean },
): { warn: string; message: string; sub: string } | null {
  const { event, nowMs, user } = input;
  if (input.eligibleCount <= 0 || !isWithinLateCancelWindow(event, nowMs)) return null;
  const count = user === undefined ? null : lateCancelCountIfMarked(user, nowMs);
  const turnsRed = count !== null && count >= RED_THRESHOLD;
  return {
    warn: turnsRed ? `這是你 90 天內第 ${count} 次臨時取消` : `距開始不到 ${normalizeLateCancelHours(event)} 小時`,
    message: !input.selfChecked
      ? '同行者取消也會記你一次臨時取消'
      : turnsRed ? '取消後標籤會變紅' : '現在取消會記一次臨時取消',
    // 預覽 ⑤-3 用「名額讓給」（一行放得下），本人確認框用「名額會讓給」。
    sub: `同一場只記一次・${lateCancelWaitlistLine(input.waitlistCount, input.confirmedCount, '讓給')}`,
  };
}
