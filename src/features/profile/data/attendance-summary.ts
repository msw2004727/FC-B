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
  /** 放鴿子／出席率 v2（站長 11-06）：伺服器寫入 `countedSince` 才有；沒有時畫面退回舊算法。 */
  v2?: {
    since: string;
    participatedCount: number;
    countedCount: number;
    countedCompletedCount: number;
    /** 計入場次中的放鴿子次數（名單 🕊 用；個人頁不顯示）。 */
    countedNoShowCount: number;
  } | null;
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
    v2: typeof data?.['countedSince'] === 'string' && data['countedSince']
      ? {
        since: data['countedSince'] as string,
        participatedCount: toSafeCount(data?.['participatedCount']),
        countedCount: toSafeCount(data?.['countedCount']),
        countedCompletedCount: toSafeCount(data?.['countedCompletedCount']),
        countedNoShowCount: toSafeCount(data?.['countedNoShowCount']),
      }
      : null,
  };
}

/** 個人頁三格與計量條的顯示值（球員卡、他人名片、分享 PNG 共用）。 */
export interface AttendanceDisplay {
  participatedText: string;
  completedText: string;
  /** 出席率：計入 0 場「--」、未滿 3 場「完成/計入」、其餘百分比。 */
  rateText: string;
  /** 計量條 0～1；沒有可算的場次為 0。 */
  ratio: number;
  /** v2 計入場數；舊資料（伺服器尚未寫 v2）為 null，不顯示「計 N 場」。 */
  countedCount: number | null;
}

/** 計入不滿這個場數只顯示「完成/計入」，不顯示百分比（站長 11-06）。 */
export const ATTEND_RATE_MIN_COUNTED = 3;

export function deriveAttendanceDisplay(summary: UserAttendanceSummary | null): AttendanceDisplay | null {
  if (!summary) return null;
  const v2 = summary.v2;
  if (!v2) {
    const rate = Math.min(100, Math.max(0, Math.round(summary.attendRate)));
    return {
      participatedText: String(summary.expectedCount),
      completedText: String(summary.completedCount),
      rateText: `${rate}%`,
      ratio: rate / 100,
      countedCount: null,
    };
  }
  const counted = v2.countedCount;
  const completed = Math.min(v2.countedCompletedCount, counted);
  let rateText = '--';
  if (counted > 0) {
    rateText = counted < ATTEND_RATE_MIN_COUNTED
      ? `${completed}/${counted}`
      : `${Math.round((completed / counted) * 100)}%`;
  }
  return {
    participatedText: String(v2.participatedCount),
    completedText: String(completed),
    rateText,
    ratio: counted > 0 ? completed / counted : 0,
    countedCount: counted,
  };
}

interface DirectSnapLike {
  exists: () => boolean;
  data: () => unknown;
}

// 進行中的請求（同一 UID 同時多處呼叫只讀一次）；完成即移除，不是快取——
// 之後再呼叫（按重新整理、換頁回來）一律重新讀，避免顯示過期的 userAttendanceStats。
const inflight = new Map<string, Promise<UserAttendanceSummary | null>>();

export interface LoadUserAttendanceSummaryOptions {
  /**
   * 寫入之後重讀（例如 `refreshMyActivityRecords` 剛重算完）：不得沿用寫入前就已發出的進行中請求，
   * 一律新發一次；之後的一般呼叫會改共用這次較新的請求。
   */
  fresh?: boolean;
}

/**
 * 讀取 `userAttendanceStats/{uid}` 單一文件（只做一次 `getDoc`，不用 `onSnapshot`）。
 * 文件不存在時照 A 回傳全 0；讀取失敗回傳 `null`（UI 顯示 `--`）。
 */
export function loadUserAttendanceSummary(
  uid: string,
  options: LoadUserAttendanceSummaryOptions = {},
): Promise<UserAttendanceSummary | null> {
  const targetUid = String(uid || '').trim();
  if (!targetUid || targetUid.includes('/')) return Promise.resolve(null);

  if (!options.fresh) {
    const pending = inflight.get(targetUid);
    if (pending) return pending;
  }
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
