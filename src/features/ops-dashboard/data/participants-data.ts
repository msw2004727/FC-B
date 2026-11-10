/**
 * 活動參與查詢（C1 骨架，C3c 接每日索引）。只讀 `opsParticipantDays/{YYYYMMDD}`，不讀任何 attendanceRecords。
 * 權限錯誤丟出，畫面顯示讀取失敗；文件不存在（空結果或 not-found）是「該日沒有活動」，兩者不混用。
 * 區間裡沒有文件的日子略過，不當成錯誤。`checkedInUids` 是 UID，畫面只顯示 users 的姓名。
 *
 * 指標字典 §2.6：
 * - Q1 符合活動：區間內（≤ 365 天、迄日 ≤ asOf）每日索引的活動，標題含關鍵字（不分大小寫）；符合 > 50 場拒絕。
 * - Q2 參與人數：Q1 各場 `checkedInUids` 聯集人數；Q3 參與次數：各場 `checkedInUids` 長度加總。
 * - 讀取：索引以 `documentId()` 範圍查一次（≤ 365 份）＋當頁名稱 ≤ 50 份（`documentId() in` 每批 30）＝ ≤ 415。
 * - 日期一律台北（`taipei-time`），不用 `new Date(字串)`。
 */
import { collection, documentId, getDocs, limit, orderBy, query, where } from 'firebase/firestore';

import { addTaipeiDays, formatTaipei, parseTaipei } from '@/core/taipei-time';
import { getFirebase } from '@/data/firebase';

export const MAX_RANGE_DAYS = 365;
export const MAX_MATCHED_EVENTS = 50;
export const PARTICIPANT_PAGE_SIZE = 50;
export const NAME_BATCH_SIZE = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ParticipantQuery {
  keyword: string;
  /** `YYYY-MM-DD`（台北）。 */
  from: string;
  to: string;
}

export type QueryErrorKey = 'err.keyword' | 'err.dates' | 'err.order' | 'err.range' | 'err.future';

export interface ParticipantRow {
  uid: string;
  count: number;
  /** 最近一次參與的日期鍵 `YYYYMMDD`（排序用）。 */
  lastDay: string;
}

export type ParticipantOutcome =
  | { kind: 'noData' }
  | { kind: 'tooMany'; matched: number }
  | { kind: 'ok'; matchedEvents: number; participations: number; rows: ParticipantRow[] };

/** 索引只到 asOf（昨天，台北）；日期選擇器上限也用這天。 */
export function participantsAsOf(nowMs: number): string {
  return formatTaipei(addTaipeiDays(nowMs, -1), 'YYYY-MM-DD');
}

/** 預設區間：asOf 當月 1 日～asOf（照 A 預設「本月 1 日～今天」，迄日改 asOf）。 */
export function defaultQueryRange(nowMs: number): { from: string; to: string } {
  const to = participantsAsOf(nowMs);
  return { from: `${to.slice(0, 8)}01`, to };
}

export function normalizeKeyword(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function dateMs(value: string): number | null {
  return DATE_RE.test(value) ? parseTaipei(value) : null;
}

export function validateQuery(q: ParticipantQuery, asOf: string): QueryErrorKey | null {
  if (!normalizeKeyword(q.keyword)) return 'err.keyword';
  const fromMs = dateMs(q.from);
  const toMs = dateMs(q.to);
  if (fromMs === null || toMs === null) return 'err.dates';
  if (fromMs > toMs) return 'err.order';
  const asOfMs = dateMs(asOf);
  if (asOfMs !== null && toMs > asOfMs) return 'err.future';
  if (Math.round((toMs - fromMs) / DAY_MS) + 1 > MAX_RANGE_DAYS) return 'err.range';
  return null;
}

const dayId = (ymd: string): string => ymd.replace(/-/g, '');

interface IndexEvent {
  docId: string;
  title: string;
  uids: string[];
}

function readEvents(data: Record<string, unknown> | undefined): IndexEvent[] {
  const list = data?.['events'];
  if (!Array.isArray(list)) return [];
  const out: IndexEvent[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const docId = typeof item['docId'] === 'string' ? item['docId'] : '';
    const uids = Array.isArray(item['checkedInUids'])
      ? item['checkedInUids'].filter((u): u is string => typeof u === 'string' && u.length > 0)
      : [];
    out.push({ docId, title: typeof item['title'] === 'string' ? item['title'] : '', uids: [...new Set(uids)] });
  }
  return out;
}

/** 純函式：把每日索引彙總成 Q1～Q3 與名單（測試直接用）。 */
export function summarizeParticipants(
  days: readonly { id: string; data: Record<string, unknown> | undefined }[],
  keyword: string,
): ParticipantOutcome {
  if (days.length === 0) return { kind: 'noData' };
  const kw = normalizeKeyword(keyword);
  const seen = new Set<string>();
  const matched: { day: string; uids: string[] }[] = [];
  for (const day of days) {
    for (const ev of readEvents(day.data)) {
      if (!ev.title.toLowerCase().includes(kw)) continue;
      const key = ev.docId || `${day.id}#${matched.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matched.push({ day: day.id, uids: ev.uids });
    }
  }
  if (matched.length > MAX_MATCHED_EVENTS) return { kind: 'tooMany', matched: matched.length };
  const byUid = new Map<string, ParticipantRow>();
  let participations = 0;
  for (const m of matched) {
    participations += m.uids.length;
    for (const uid of m.uids) {
      const row = byUid.get(uid) ?? { uid, count: 0, lastDay: '' };
      row.count += 1;
      if (m.day > row.lastDay) row.lastDay = m.day;
      byUid.set(uid, row);
    }
  }
  const rows = [...byUid.values()].sort(
    (a, b) => b.count - a.count || (a.lastDay < b.lastDay ? 1 : a.lastDay > b.lastDay ? -1 : 0) || (a.uid < b.uid ? -1 : 1),
  );
  return { kind: 'ok', matchedEvents: matched.length, participations, rows };
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) return false;
  const code = String((err as { code: unknown }).code);
  return code === 'not-found' || code.endsWith('/not-found');
}

/**
 * 讀區間內的每日索引並彙總。呼叫前先 `validateQuery`。
 * 一次 `documentId()` 範圍查詢（缺的日子不會成文件，不算錯誤）。
 * 權限錯誤直接丟出；`not-found` 與 0 筆都是「該日沒有活動」。
 */
export async function queryParticipants(q: ParticipantQuery): Promise<ParticipantOutcome> {
  const { db } = await getFirebase();
  const ref = query(
    collection(db, 'opsParticipantDays'),
    where(documentId(), '>=', dayId(q.from)),
    where(documentId(), '<=', dayId(q.to)),
    orderBy(documentId()),
    limit(MAX_RANGE_DAYS + 1),
  );
  try {
    const snap = await getDocs(ref);
    return summarizeParticipants(
      snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> | undefined })),
      q.keyword,
    );
  } catch (err: unknown) {
    if (isNotFound(err)) return { kind: 'noData' };
    throw err;
  }
}

/** 讀當頁名稱（`users/{uid}`，每批 30）。查不到的 UID 不放進結果，由畫面顯示「未知」。 */
export async function fetchUserNames(uids: readonly string[]): Promise<Record<string, string>> {
  const { db } = await getFirebase();
  const out: Record<string, string> = {};
  const unique = [...new Set(uids)].slice(0, PARTICIPANT_PAGE_SIZE);
  for (let i = 0; i < unique.length; i += NAME_BATCH_SIZE) {
    const batch = unique.slice(i, i + NAME_BATCH_SIZE);
    const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', batch)));
    for (const d of snap.docs) {
      const data = (d.data() ?? {}) as Record<string, unknown>;
      const name = [data['displayName'], data['name']].find((v): v is string => typeof v === 'string' && v.trim() !== '');
      if (name) out[d.id] = name.trim();
    }
  }
  return out;
}

/** 分享網址（相對路徑）：只含關鍵字與日期，不含任何個資。 */
export function participantsPath(q: ParticipantQuery): string {
  const params = new URLSearchParams({ q: q.keyword.trim(), from: q.from, to: q.to });
  return `/admin/ops/participants?${params.toString()}`;
}
