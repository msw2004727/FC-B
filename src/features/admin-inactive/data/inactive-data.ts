/**
 * 「無效資料查詢」讀取層（W1C-I）。只讀、不寫。
 *
 * A 版從快取讀（俱樂部、活動是已載入的那一批，用戶狀態是整個 users 集合的即時監聽）；
 * 新站改成條件查詢＋分頁＋`getCountFromServer` 聚合計數，不讀整個 users／events 集合、不用 collectionGroup。
 *
 * 讀取上限（每頁籤進頁，寫成測試斷言）：
 * - 俱樂部：count 1 ＋ 名單 ≤ 20 ＝ ≤ 21
 * - 活動：count 1 ＋ 名單 ≤ 20 ＝ ≤ 21
 * - 用戶狀態：count 4 ＋ 兩段名單各 ≤ 10 ＝ ≤ 24
 * 「載入更多」每次 ≤ 20（用戶名單每段 ≤ 10）。count 的計費是每 1,000 筆符合的索引項 1 次讀取（集合很大時會多於 1）。
 *
 * 索引：俱樂部、用戶只用單欄位條件（自動索引）；活動用既有複合索引 events (status ASC, createdAt DESC)。
 */
import {
  Timestamp,
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import type { Query, QueryConstraint, QueryDocumentSnapshot } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';

import {
  loginBoundaries,
  mapInactiveEvent,
  mapInactiveTeam,
  mapStatusUser,
  type InactiveEvent,
  type InactiveTeam,
  type StatusUser,
} from './inactive-model';

export const INACTIVE_PAGE_SIZE = 20;
export const USER_LIST_PAGE_SIZE = 10;
export const INACTIVE_EVENT_STATUSES = ['ended', 'cancelled'] as const;

export type Cursor = QueryDocumentSnapshot | null;

export interface Page<T> {
  items: T[];
  cursor: Cursor;
  done: boolean;
}

type Raw = Record<string, unknown>;

async function countOf(q: Query): Promise<number> {
  const value = (await getCountFromServer(q)).data().count;
  return Number.isFinite(value) ? value : 0;
}

async function fetchPage<T>(
  base: Query,
  constraints: readonly QueryConstraint[],
  cursor: Cursor,
  size: number,
  map: (id: string, data: Raw | undefined) => T,
): Promise<Page<T>> {
  const parts = cursor ? [...constraints, startAfter(cursor), limit(size)] : [...constraints, limit(size)];
  const snap = await getDocs(query(base, ...parts));
  const items = snap.docs.map((d) => map(d.id, d.data() as Raw | undefined));
  const last = snap.docs[snap.docs.length - 1];
  return { items, cursor: last ?? cursor, done: snap.docs.length < size };
}

// ─── 俱樂部 ───

async function teamsBase(): Promise<Query> {
  const { db } = await getFirebase();
  return query(collection(db, 'teams'), where('active', '==', false));
}

export async function fetchInactiveTeamsPage(cursor: Cursor): Promise<Page<InactiveTeam>> {
  return fetchPage(await teamsBase(), [], cursor, INACTIVE_PAGE_SIZE, mapInactiveTeam);
}

export async function loadInactiveTeams(): Promise<{ total: number; page: Page<InactiveTeam> }> {
  const base = await teamsBase();
  const [total, page] = await Promise.all([countOf(base), fetchInactiveTeamsPage(null)]);
  return { total, page };
}

// ─── 活動 ───

async function eventsBase(): Promise<Query> {
  const { db } = await getFirebase();
  return query(collection(db, 'events'), where('status', 'in', [...INACTIVE_EVENT_STATUSES]));
}

export async function fetchInactiveEventsPage(cursor: Cursor): Promise<Page<InactiveEvent>> {
  return fetchPage(await eventsBase(), [orderBy('createdAt', 'desc')], cursor, INACTIVE_PAGE_SIZE, mapInactiveEvent);
}

export async function loadInactiveEvents(): Promise<{ total: number; page: Page<InactiveEvent> }> {
  const base = await eventsBase();
  const [total, page] = await Promise.all([countOf(base), fetchInactiveEventsPage(null)]);
  return { total, page };
}

// ─── 用戶狀態 ───

export type UserSegment = 'over90' | 'mid';

export interface UserLoginStats {
  active: number;
  mid: number;
  /** 超過 90 天＝總數 − 活躍 − 30~90 天（含從未登入、最後登入不是時間戳的舊資料，同 A 視為 9999 天）。 */
  over90: number;
}

export interface UserStatusLoad {
  stats: UserLoginStats;
  /** 名單查得到的人數（標題人數與「載入更多」用）。超過 90 天只算最後登入是時間戳的人，可能少於 stats.over90。 */
  listTotals: Record<UserSegment, number>;
  over90: Page<StatusUser>;
  mid: Page<StatusUser>;
}

function segmentConstraints(segment: UserSegment, nowMs: number): QueryConstraint[] {
  const { activeAfterMs, over90AtOrBeforeMs } = loginBoundaries(nowMs);
  const activeAfter = Timestamp.fromMillis(activeAfterMs);
  const over90At = Timestamp.fromMillis(over90AtOrBeforeMs);
  // A 依天數由多到少排（最久沒登入的在前）＝最後登入時間由舊到新。
  return segment === 'over90'
    ? [where('lastLogin', '<=', over90At), orderBy('lastLogin', 'asc')]
    : [where('lastLogin', '>', over90At), where('lastLogin', '<=', activeAfter), orderBy('lastLogin', 'asc')];
}

export async function fetchUserSegmentPage(segment: UserSegment, cursor: Cursor, nowMs: number): Promise<Page<StatusUser>> {
  const { db } = await getFirebase();
  return fetchPage(
    collection(db, 'users'),
    segmentConstraints(segment, nowMs),
    cursor,
    USER_LIST_PAGE_SIZE,
    (id, data) => mapStatusUser(id, data, nowMs),
  );
}

export async function loadUserStatus(nowMs: number): Promise<UserStatusLoad> {
  const { db } = await getFirebase();
  const users = collection(db, 'users');
  const { activeAfterMs, over90AtOrBeforeMs } = loginBoundaries(nowMs);
  const activeAfter = Timestamp.fromMillis(activeAfterMs);
  const over90At = Timestamp.fromMillis(over90AtOrBeforeMs);
  const [total, active, mid, over90Listed, over90, midPage] = await Promise.all([
    countOf(users),
    countOf(query(users, where('lastLogin', '>', activeAfter))),
    countOf(query(users, where('lastLogin', '>', over90At), where('lastLogin', '<=', activeAfter))),
    countOf(query(users, where('lastLogin', '<=', over90At))),
    fetchUserSegmentPage('over90', null, nowMs),
    fetchUserSegmentPage('mid', null, nowMs),
  ]);
  return {
    stats: { active, mid, over90: Math.max(0, total - active - mid) },
    listTotals: { over90: over90Listed, mid },
    over90,
    mid: midPage,
  };
}
