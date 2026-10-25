import type { Firestore } from 'firebase/firestore';
import { doc, getDoc } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';

export const USER_ATTENDANCE_STATS_COLLECTION = 'userAttendanceStats' as const;

export interface UserAttendanceSummary {
  uid: string;
  exists: boolean;
  sourceVersion: number;
  expectedCount: number;
  attendedCount: number;
  completedCount: number;
  attendRate: number;
  updatedAt: unknown;
}

function toSafeCount(value: unknown): number {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.trunc(num));
}

/**
 * 對應 A `firebase-service.js#_normalizeUserAttendanceSummary`。
 */
export function normalizeUserAttendanceSummary(
  uid: string,
  data: Record<string, unknown> | null | undefined,
  exists = true,
): UserAttendanceSummary {
  const expectedCount = toSafeCount(data?.['expectedCount']);
  const attendedCount = toSafeCount(data?.['attendedCount']);
  const completedCount = toSafeCount(data?.['completedCount']);
  return {
    uid,
    exists,
    sourceVersion: toSafeCount(data?.['sourceVersion']),
    expectedCount,
    attendedCount,
    completedCount,
    attendRate: expectedCount > 0 ? Math.round((attendedCount / expectedCount) * 100) : 0,
    updatedAt: data?.['updatedAt'] ?? null,
  };
}

interface DirectSnapLike {
  exists: () => boolean;
  data: () => unknown;
}

// 進行中的請求（同一 UID 同時多處呼叫只讀一次）；完成即移除，不是快取——
// 之後再呼叫（按重新整理、換頁回來）一律重新讀，避免顯示過期的 userAttendanceStats。
const inflight = new Map<string, Promise<UserAttendanceSummary | null>>();

/**
 * 讀取 `userAttendanceStats/{uid}` 單一文件（只做一次 `getDoc`，不用 `onSnapshot`）。
 * 文件不存在時照 A 回傳全 0；讀取失敗回傳 `null`（UI 顯示 `--`）。
 */
export function loadUserAttendanceSummary(
  uid: string,
): Promise<UserAttendanceSummary | null> {
  const targetUid = String(uid || '').trim();
  if (!targetUid || targetUid.includes('/')) return Promise.resolve(null);

  const pending = inflight.get(targetUid);
  if (pending) return pending;
  const request = fetchUserAttendanceSummary(targetUid).finally(() => {
    if (inflight.get(targetUid) === request) inflight.delete(targetUid);
  });
  inflight.set(targetUid, request);
  return request;
}

async function fetchUserAttendanceSummary(
  targetUid: string,
): Promise<UserAttendanceSummary | null> {
  try {
    const { db } = await getFirebase();
    const firestore = db as unknown as Firestore;
    const snap = (await getDoc(
      doc(firestore, USER_ATTENDANCE_STATS_COLLECTION, targetUid),
    )) as unknown as DirectSnapLike;
    // A：文件不存在也正規化成 0 筆（exists=false），畫面顯示 0／0／0%。
    if (!snap.exists()) return normalizeUserAttendanceSummary(targetUid, {}, false);
    const raw = (snap.data() as Record<string, unknown> | undefined) ?? {};
    return normalizeUserAttendanceSummary(targetUid, raw, true);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[attendance-summary] load failed', err);
    return null;
  }
}
