/**
 * 活動管理「區間統計」的純函式模型（2026-11-23 站長核可預覽，計畫書 docs/specs/lite-convergence/
 * manage-events-diagnosis-range-stats-2026-11-23.md §2）。不讀資料、不寫資料。
 *
 * 身分鍵（R-ID-002／003、R-STAT-002／003）：
 *  - 報名用 `userId`（legacy 退回 `uid`／`ownerUid`，與名單 `regOwnerUid` 相同）；不以名字比對。
 *  - 簽到紀錄用 `uid`；同行者另以 `companionId` 區分。
 *  - 每場活動的報名與簽到都從該場 `events/{_docId}/...` 子集合讀，天然限定在同一場，不靠 `eventId` 欄位 join。
 */
import { taipeiParts } from '@/core/taipei-time';
import { effectiveEventStatus } from './my-activities-model';
import type { EventDoc } from './types';

export type RangePeriod = 'week' | 'month' | 'year' | 'custom';

export interface DateRangeKeys {
  /** 含：`YYYY/MM/DD` */
  startKey: string;
  /** 不含：`YYYY/MM/DD` */
  endKey: string;
  /** 區間天數 */
  days: number;
}

export const RANGE_STATUS_KEYS = ['upcoming', 'open', 'full', 'ended', 'cancelled'] as const;
export type RangeStatusKey = (typeof RANGE_STATUS_KEYS)[number];

/** 超過這個天數，讀名單前先讓使用者確認（計畫書 §3：超過 3 個月先確認）。 */
export const RANGE_CONFIRM_DAYS = 92;

const DAY_MS = 86_400_000;

function keyOfUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

function keysFromUtc(startMs: number, endMs: number): DateRangeKeys {
  return { startKey: keyOfUtc(startMs), endKey: keyOfUtc(endMs), days: Math.round((endMs - startMs) / DAY_MS) };
}

/**
 * 週（週一～週日）、月、年；`offset` 為相對於 `nowMs` 所在週期的位移（-1＝上一週期）。
 * 一律以台北日期計算。
 */
export function periodRange(period: Exclude<RangePeriod, 'custom'>, nowMs: number, offset = 0): DateRangeKeys {
  const p = taipeiParts(nowMs);
  if (period === 'week') {
    const back = (p.weekday + 6) % 7;
    const start = Date.UTC(p.year, p.month - 1, p.day - back + offset * 7);
    return keysFromUtc(start, start + 7 * DAY_MS);
  }
  if (period === 'month') {
    return keysFromUtc(Date.UTC(p.year, p.month - 1 + offset, 1), Date.UTC(p.year, p.month + offset, 1));
  }
  return keysFromUtc(Date.UTC(p.year + offset, 0, 1), Date.UTC(p.year + offset + 1, 0, 1));
}

/** 手動起訖（`YYYY-MM-DD`，兩端都含）。不合法或起大於訖回 null。 */
export function customRange(from: string, to: string): DateRangeKeys | null {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const a = re.exec(from);
  const b = re.exec(to);
  if (!a || !b) return null;
  const start = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const end = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) + DAY_MS;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return keysFromUtc(start, end);
}

/** 活動 `date` 的日期部分（`YYYY/MM/DD`）；格式不符回空字串。 */
export function eventDateKey(event: Pick<EventDoc, 'date'>): string {
  const raw = typeof event.date === 'string' ? event.date.trim() : '';
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(raw);
  if (!m) return '';
  return `${m[1]}/${m[2]!.padStart(2, '0')}/${m[3]!.padStart(2, '0')}`;
}

export function isEventInRange(event: Pick<EventDoc, 'date'>, range: DateRangeKeys): boolean {
  const key = eventDateKey(event);
  return key !== '' && key >= range.startKey && key < range.endKey;
}

// ---- 人數統計 ----

export interface RangeRegistration {
  eventId?: unknown;
  promotedAt?: unknown;
  userId?: unknown;
  uid?: unknown;
  ownerUid?: unknown;
  status?: unknown;
  participantType?: unknown;
  companionId?: unknown;
}

export interface RangeAttendance {
  eventId?: unknown;
  uid?: unknown;
  type?: unknown;
  status?: unknown;
  companionId?: unknown;
}

export interface EventRoster {
  event: EventDoc;
  registrations: readonly RangeRegistration[];
  attendance: readonly RangeAttendance[];
}

export type StatMetric = 'registered' | 'confirmed' | 'waitlisted' | 'checkedPair' | 'noShow' | 'cancelled';
export const STAT_METRICS: readonly StatMetric[] = [
  'registered', 'confirmed', 'waitlisted', 'checkedPair', 'noShow', 'cancelled',
];

export interface MetricCount {
  /** 人次（重複）：同一人參加 N 場算 N。 */
  times: number;
  /** 人數（不重複）：同一人參加 N 場算 1。 */
  people: number;
}

export interface RangeStats {
  metrics: Record<StatMetric, MetricCount>;
  /** 正取中「沒有完成簽到簽退、也不算放鴿子」的人次／人數（未開始、只簽到等），給圓餅圖用。 */
  confirmedOther: MetricCount;
  eventCountByStatus: Record<RangeStatusKey, number>;
  eventCount: number;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function regOwner(reg: RangeRegistration): string {
  return str(reg.userId) || str(reg.uid) || str(reg.ownerUid);
}

function isCompanion(reg: RangeRegistration): boolean {
  return str(reg.participantType) === 'companion' || str(reg.companionId) !== '';
}

/**
 * 一筆報名代表的人。同行者以「主報名人 UID＋companionId」為鍵；缺 companionId 的舊同行者
 * 無法可靠辨識（不以名字比對，R-ID-002），每筆各自算一人（`fallback` 由呼叫端給唯一值）。
 */
function personKey(reg: RangeRegistration, fallback: string): string {
  const owner = regOwner(reg);
  if (isCompanion(reg)) {
    const cid = str(reg.companionId);
    return cid && owner ? `${owner}#c:${cid}` : `#reg:${fallback}`;
  }
  return owner;
}

function isActiveRecord(r: RangeAttendance): boolean {
  const s = str(r.status);
  return s !== 'removed' && s !== 'cancelled';
}

function regStatus(reg: RangeRegistration): 'confirmed' | 'waitlisted' | 'cancelled' | 'other' {
  const s = str(reg.status);
  if (s === 'confirmed' || s === 'registered') return 'confirmed';
  if (s === 'waitlisted') return 'waitlisted';
  if (s === 'cancelled') return 'cancelled';
  return 'other';
}

// ---- 放鴿子 v2（與個人頁、管理名單顯示的 userAttendanceStats.countedNoShowCount 同一口徑）----
// 正本：FC `functions/noshow-v2-core.js`（isCountedEvent、computeEventCountedCheckoutFlag、isLatePromotion、
// computeUserCountedStats）與 `functions/ops-rollup-core.js` summarizeHeldEvent。
// （2026-11-23 顧問 §3.603 條件①：取代原本照每小時批次 calcNoShowCountsBatch 的舊算法——舊算法沒有起算日，
//  會把起算日前已結束的場次也算進放鴿子，與使用者看到的數字不同。）

/** 起算點（台北日期），同 FC `functions/noshow-v2-core.js` NOSHOW_V2_SINCE = "2026-11-07"。 */
export const NOSHOW_V2_SINCE_KEY = '2026/11/07';

/** 紀錄的 eventId 要等於活動 public id 或文件 ID（v2 recordMatchesEvent）；空的不算。 */
function belongsToEvent(record: { eventId?: unknown }, event: EventDoc): boolean {
  const eventId = str(record.eventId);
  if (!eventId) return false;
  return eventId === str(event.id) || eventId === str(event._docId);
}

function isCompanionRecord(record: { companionId?: unknown; participantType?: unknown }): boolean {
  return str(record.companionId) !== '' || str(record.participantType) === 'companion';
}

/**
 * v2 旗標 hasCountedCheckout：該場有「有效簽退」——非同行者、狀態有效、屬於本場，
 * 且簽退者是本場正取非同行者報名者、不是主辦（creatorUid）或委託人（delegateUids）。
 * 正式由觸發器寫在 eventAttendanceFlags（前端讀不到），這裡用同一份名單資料重算。
 */
export function eventHasCountedCheckout(roster: EventRoster): boolean {
  const { event } = roster;
  const hosts = new Set<string>();
  if (str(event.creatorUid)) hosts.add(str(event.creatorUid));
  const delegates = (event as EventDoc & { delegateUids?: unknown }).delegateUids;
  if (Array.isArray(delegates)) delegates.forEach((uid) => { if (str(uid)) hosts.add(str(uid)); });
  const confirmed = new Set<string>();
  for (const reg of roster.registrations) {
    if (isCompanionRecord(reg) || str(reg.status) !== 'confirmed') continue;
    const uid = str(reg.userId);
    if (uid && !hosts.has(uid)) confirmed.add(uid);
  }
  if (confirmed.size === 0) return false;
  return roster.attendance.some((r) => str(r.type) === 'checkout' && isActiveRecord(r)
    && !isCompanionRecord(r) && belongsToEvent(r, event) && confirmed.has(str(r.uid)));
}

/** v2 計入場次：活動文件狀態已結束、開始日 ≥ 起算點、該場有有效簽退。 */
export function isNoShowCountedEvent(roster: EventRoster, sinceKey: string = NOSHOW_V2_SINCE_KEY): boolean {
  if (roster.event.status !== 'ended') return false;
  const key = eventDateKey(roster.event);
  if (key === '' || key < sinceKey) return false;
  return eventHasCountedCheckout(roster);
}

function toMillis(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const v = value as { toMillis?: () => number; seconds?: unknown; _seconds?: unknown; nanoseconds?: unknown; _nanoseconds?: unknown };
  if (typeof v.toMillis === 'function') {
    try { return v.toMillis(); } catch { return null; }
  }
  const seconds = v.seconds ?? v._seconds;
  if (typeof seconds === 'number') {
    const nanos = Number(v.nanoseconds ?? v._nanoseconds ?? 0) || 0;
    return seconds * 1000 + Math.floor(nanos / 1e6);
  }
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/** v2 eventStartMillis：台北開始時間；沒寫時間視為當天 00:00。 */
function eventStartMs(event: EventDoc): number | null {
  const raw = typeof event.date === 'string' ? event.date.trim() : '';
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?=$|\s)/.exec(raw);
  if (!m) return null;
  const t = /^(\d{1,2}):(\d{2})/.exec(raw.slice(m[0].length).trim());
  let h = 0;
  let min = 0;
  if (t && Number(t[1]) <= 23 && Number(t[2]) <= 59) {
    h = Number(t[1]);
    min = Number(t[2]);
  }
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h - 8, min);
}

/** v2 isLatePromotion：候補在活動開始後才遞補，該場不計入本人。 */
function isLatePromotion(reg: RangeRegistration, event: EventDoc): boolean {
  const promoted = toMillis(reg.promotedAt);
  if (promoted == null) return false;
  const start = eventStartMs(event);
  return start != null && promoted > start;
}

export function computeRangeStats(rosters: readonly EventRoster[], nowMs: number = Date.now()): RangeStats {
  const pairSets: Record<StatMetric | 'confirmedOther', Set<string>> = {
    registered: new Set(), confirmed: new Set(), waitlisted: new Set(),
    checkedPair: new Set(), noShow: new Set(), cancelled: new Set(), confirmedOther: new Set(),
  };
  const peopleSets: Record<StatMetric | 'confirmedOther', Set<string>> = {
    registered: new Set(), confirmed: new Set(), waitlisted: new Set(),
    checkedPair: new Set(), noShow: new Set(), cancelled: new Set(), confirmedOther: new Set(),
  };
  const eventCountByStatus: Record<RangeStatusKey, number> = {
    upcoming: 0, open: 0, full: 0, ended: 0, cancelled: 0,
  };

  rosters.forEach((roster, eventIndex) => {
    const st = effectiveEventStatus(roster.event, nowMs) as RangeStatusKey;
    if (st in eventCountByStatus) eventCountByStatus[st] += 1;

    const eventKey = String(roster.event._docId ?? roster.event.id ?? `#e${eventIndex}`);
    const add = (metric: StatMetric | 'confirmedOther', person: string): void => {
      pairSets[metric].add(`${eventKey}::${person}`);
      peopleSets[metric].add(person);
    };

    const active = roster.attendance.filter(isActiveRecord);
    const checkinSelf = new Set<string>();
    const checkoutSelf = new Set<string>();
    const checkinComp = new Set<string>();
    const checkoutComp = new Set<string>();
    for (const r of active) {
      const uid = str(r.uid);
      if (!uid) continue;
      const type = str(r.type);
      const cid = str(r.companionId);
      if (cid) {
        if (type === 'checkin') checkinComp.add(`${uid}#c:${cid}`);
        if (type === 'checkout') checkoutComp.add(`${uid}#c:${cid}`);
      } else {
        if (type === 'checkin') checkinSelf.add(uid);
        if (type === 'checkout') checkoutSelf.add(uid);
      }
    }
    const noShowCounted = isNoShowCountedEvent(roster);
    // v2 放鴿子只看屬於本場、有效、非同行者的本人紀錄：簽到、簽退都沒有才算。
    const attendedV2 = new Set<string>();
    for (const r of active) {
      const type = str(r.type);
      if ((type === 'checkin' || type === 'checkout') && !isCompanionRecord(r) && belongsToEvent(r, roster.event)) {
        attendedV2.add(str(r.uid));
      }
    }

    roster.registrations.forEach((reg, regIndex) => {
      const person = personKey(reg, `${eventKey}:${regIndex}`);
      if (!person) return;
      const status = regStatus(reg);
      if (status === 'cancelled') {
        add('cancelled', person);
        return;
      }
      if (status === 'other') return;
      add('registered', person);
      if (status === 'waitlisted') {
        add('waitlisted', person);
        return;
      }
      add('confirmed', person);
      const companion = isCompanion(reg);
      const paired = companion
        ? checkinComp.has(person) && checkoutComp.has(person)
        : checkinSelf.has(person) && checkoutSelf.has(person);
      if (paired) {
        add('checkedPair', person);
        return;
      }
      if (!companion && noShowCounted && str(reg.status) === 'confirmed' && !isLatePromotion(reg, roster.event)
        && !attendedV2.has(person)) {
        add('noShow', person);
        return;
      }
      add('confirmedOther', person);
    });
  });

  const count = (k: StatMetric | 'confirmedOther'): MetricCount => ({
    times: pairSets[k].size,
    people: peopleSets[k].size,
  });
  return {
    metrics: {
      registered: count('registered'),
      confirmed: count('confirmed'),
      waitlisted: count('waitlisted'),
      checkedPair: count('checkedPair'),
      noShow: count('noShow'),
      cancelled: count('cancelled'),
    },
    confirmedOther: count('confirmedOther'),
    eventCountByStatus,
    eventCount: rosters.length,
  };
}

// ---- 圓餅圖 ----

export interface PieSlice {
  key: string;
  label: string;
  value: number;
  /** 0～100，一位小數 */
  percent: number;
}

/** 百分比以四捨五入到一位小數；合計為 0 時全部 0。 */
export function toPieSlices(parts: readonly { key: string; label: string; value: number }[]): PieSlice[] {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  return parts.map((p) => ({
    ...p,
    value: Math.max(0, p.value),
    percent: total > 0 ? Math.round((Math.max(0, p.value) / total) * 1000) / 10 : 0,
  }));
}
