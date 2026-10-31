/**
 * QR 簽到：可簽到活動清單（A22）。
 *
 * 權限一律以 `canOperateEventSite` 判斷（R-IAM-010），不自行縮窄。
 * 分類／排序照 A `_categorizeScanEvents`：today asc / past desc / future asc。
 * 狀態篩選照 A `renderScanPage`：只收 open / full / ended。
 * `value` 與 `eventId` 為 public id（R-ID-009，等同 A `_scanSelectedEventId`），
 * 另附 `docId`（R-REG-014 寫入路徑 `/events/{docId}/attendanceRecords`）。
 */

import {
  canOperateEventSite,
  type OperateContext,
} from '@/features/events/data/operate-permissions';
import { parseEventStartMs } from '@/core/event-time';
import { taipeiStartOfDay } from '@/core/taipei-time';
import type { EventDoc } from '@/features/events/data/types';

/** 對應 A 的 `TYPE_CONFIG[e.type].label`；由外部注入避免耦合 UI 設定。 */
export interface ScanEventTypeConfig {
  readonly [type: string]: { readonly label: string } | undefined;
}

/** 照 A `js/config.js#TYPE_CONFIG` 的 label。 */
export const SCAN_EVENT_TYPE_CONFIG: ScanEventTypeConfig = {
  friendly: { label: '友誼' },
  camp: { label: '教學' },
  play: { label: 'PLAY' },
  watch: { label: '觀賽' },
  course: { label: '課程' },
  external: { label: '外部' },
};

export interface ScanEventEntry {
  /** `<option>` 的 value；A 的 `_scanSelectedEventId` 即 public id（R-ID-009）。 */
  value: string;
  /** attendanceRecords 文件的 `eventId` 欄位（public id，R-ID-009）。 */
  eventId: string;
  /** Firestore document id；寫入路徑用（R-REG-014）。 */
  docId: string;
  title: string;
  date: string;
  type?: string;
  /** A `_getScanEventTypeLabel` 輸出，含結尾空白；無 type 時為 ''。 */
  typeLabel: string;
  /** 原始 event doc（供 UI 取更多欄位；不複製寫入契約）。 */
  event: EventDoc;
}

export interface ScanEventBuckets {
  /** 今天（A：eventDay ∈ [todayStart, tomorrowStart)）。 */
  today: ScanEventEntry[];
  /** 過去（A：eventDay < todayStart）。 */
  past: ScanEventEntry[];
  /** 未來（A：其他）。 */
  future: ScanEventEntry[];
}

export interface LoadScanEventsInput {
  events: readonly EventDoc[];
  context: OperateContext;
  typeConfig?: ScanEventTypeConfig;
  /** 測試注入，用於決定 today/past/future；預設 new Date()。 */
  now?: Date;
  /** 預設解析「YYYY/MM/DD」。 */
  parseEventDate?: (date: string | undefined) => Date | null;
}

const SCAN_STATUSES: ReadonlySet<string> = new Set(['open', 'full', 'ended']);

/** 從 date 字串（如「2026/05/09 15:00~17:00」）解析日期部分，避免依賴 Date 對原字串的寬鬆解析。 */
function defaultParseEventDate(date: string | undefined): Date | null {
  if (!date) return null;
  const day = date.split(' ')[0] ?? '';
  // Q-12：只收斜線日期；保留此消費端只看日期、不依活動時間分桶的語意。
  if (day.split('/').length !== 3 || day.includes('T')) return null;
  const ms = parseEventStartMs(day);
  // Date 只保留注入點簽名，禁止以本地 getter 讀回。
  return ms === null ? null : new Date(taipeiStartOfDay(ms));
}

function eventStatus(event: EventDoc): string {
  const value = (event as EventDoc & { status?: unknown }).status;
  return typeof value === 'string' ? value : '';
}

function resolveIds(event: EventDoc): { eventId: string; docId: string } | null {
  const publicId = typeof event.id === 'string' && event.id.trim() ? event.id.trim() : '';
  const docId = typeof event._docId === 'string' && event._docId.trim()
    ? event._docId.trim()
    : typeof event.docId === 'string' && event.docId.trim()
      ? event.docId.trim()
      : '';
  // R-ID-009：eventId 欄位存 public id；需能解析出 docId 才能寫入子集合（R-REG-014）。
  const eventId = publicId || docId;
  if (!eventId || !docId) return null;
  return { eventId, docId };
}

/** 就是既有 `toEntry`，改為匯出供帶入模式使用。 */
export function toScanEventEntry(
  event: EventDoc,
  typeConfig?: ScanEventTypeConfig,
): ScanEventEntry | null {
  const ids = resolveIds(event);
  if (!ids) return null;
  const type = event.type;
  const typeLabel = type && typeConfig?.[type] ? `[${typeConfig[type]!.label}] ` : '';
  return {
    value: ids.eventId,
    eventId: ids.eventId,
    docId: ids.docId,
    title: event.title ?? '',
    date: event.date ?? '',
    type,
    typeLabel,
    event,
  };
}

/**
 * 回傳操作者可簽到的活動，並依 A `_categorizeScanEvents` 分桶排序。
 * 只有 `canOperateEventSite(context, event) === true` 的活動才會出現在清單。
 */
export function loadScanEvents(input: LoadScanEventsInput): ScanEventBuckets {
  const now = input.now ?? new Date();
  const parse = input.parseEventDate ?? defaultParseEventDate;
  const { context, events, typeConfig } = input;

  const buckets: ScanEventBuckets = { today: [], past: [], future: [] };

  const todayStart = taipeiStartOfDay(now.getTime());
  const tomorrowStart = todayStart + 86_400_000;

  for (const event of events) {
    const status = eventStatus(event);
    if (!SCAN_STATUSES.has(status)) continue;
    if (!canOperateEventSite(context, event)) continue;
    const entry = toScanEventEntry(event, typeConfig);
    if (!entry) continue;

    const parsed = parse(event.date);
    if (!parsed) {
      buckets.past.push(entry);
      continue;
    }
    const eventDay = taipeiStartOfDay(parsed.getTime());
    if (eventDay >= todayStart && eventDay < tomorrowStart) {
      buckets.today.push(entry);
    } else if (eventDay < todayStart) {
      buckets.past.push(entry);
    } else {
      buckets.future.push(entry);
    }
  }

  const cmpAsc = (a: ScanEventEntry, b: ScanEventEntry): number => a.date.localeCompare(b.date);
  const cmpDesc = (a: ScanEventEntry, b: ScanEventEntry): number => b.date.localeCompare(a.date);
  buckets.today.sort(cmpAsc);
  buckets.past.sort(cmpDesc);
  buckets.future.sort(cmpAsc);

  return buckets;
}

/**
 * 對照 A `_populateScanSelect` 的 filter 取用方式：UI 依 `this._scanDateFilter` 選桶。
 * 提供小工具避免散落 `buckets[filter] || []` 的隱含型別。
 */
export function pickScanBucket(
  buckets: ScanEventBuckets,
  filter: 'today' | 'past' | 'future',
): ScanEventEntry[] {
  return buckets[filter];
}
