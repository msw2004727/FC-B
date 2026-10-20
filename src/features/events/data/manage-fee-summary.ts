// 活動管理卡片的「總管費用摘要」（應收／實收／短收），照 A `event-manage.js#renderMyActivities` 的 feeBox。
//
// A 的資料來自全站快取（ApiService.getRegistrationsByEvent／getAttendanceRecords），快取不完整時金額會少算；
// B 改為對每個需要顯示的活動直接讀該活動的報名與簽到子集合（R-REG-014 路徑），算式照 A。
// 只有總管（super_admin）且活動有記錄費用時才讀取與顯示。

import type { EventDoc, RegistrationDoc } from './types';
import { loadEventRegistrations } from './event-detail';
import { loadEventAttendance, type EventAttendanceEntry } from '@/features/checkin/data/attendance';

export interface ManageFeeSummary {
  expected: number;
  actual: number;
  short: number;
}

/** A `app.js#_getEventRecordedFeeAmount`：fee 為正數才算，取整數。 */
export function getEventRecordedFeeAmount(event: EventDoc | null | undefined): number {
  const fee = Number((event as Record<string, unknown> | null | undefined)?.['fee'] ?? 0);
  if (!Number.isFinite(fee) || fee <= 0) return 0;
  return Math.floor(fee);
}

/**
 * A feeBox 算式：
 * - 應收 = 費用 ×（正取報名數；讀不到報名時用卡片上顯示的正取人數）
 * - 實收 = 費用 × 簽退人數（同一人＋同行者只算一次；正取報名者，或未報名掃碼的本人）
 * - 短收 = 應收 − 實收
 * 簽到紀錄先排除 removed／cancelled（A `ApiService.getAttendanceRecords`）。
 */
export function computeManageFeeSummary(
  fee: number,
  registrations: readonly RegistrationDoc[],
  attendance: readonly Pick<EventAttendanceEntry, 'uid' | 'companionId' | 'type' | 'status'>[],
  confirmedDisplay: number,
): ManageFeeSummary | null {
  if (fee <= 0) return null;
  const confirmedRegs = registrations.filter((r) => r.status === 'confirmed' || r.status === 'registered');
  const confirmedCount = confirmedRegs.length > 0 ? confirmedRegs.length : confirmedDisplay;
  const confirmedKeys = new Set(confirmedRegs.map((r) => {
    const companionId = (r as RegistrationDoc & { companionId?: unknown }).companionId;
    return `${r.userId ?? ''}|${typeof companionId === 'string' ? companionId : ''}`;
  }));
  const active = attendance.filter((r) => r.status !== 'removed' && r.status !== 'cancelled');
  const unregUids = new Set(active.filter((r) => r.type === 'unreg').map((r) => r.uid));
  const seen = new Set<string>();
  let checkoutCount = 0;
  for (const r of active) {
    if (r.type !== 'checkout') continue;
    const key = `${r.uid}|${r.companionId ?? ''}`;
    if (seen.has(key)) continue;
    if (confirmedKeys.has(key) || (!r.companionId && unregUids.has(r.uid))) {
      seen.add(key);
      checkoutCount += 1;
    }
  }
  const expected = fee * confirmedCount;
  const actual = fee * checkoutCount;
  return { expected, actual, short: expected - actual };
}

export async function loadManageFeeSummary(
  event: EventDoc,
  eventDocId: string,
  confirmedDisplay: number,
): Promise<ManageFeeSummary | null> {
  const fee = getEventRecordedFeeAmount(event);
  if (fee <= 0 || !eventDocId) return null;
  const [registrations, attendance] = await Promise.all([
    loadEventRegistrations(eventDocId),
    loadEventAttendance(eventDocId),
  ]);
  return computeManageFeeSummary(fee, registrations, attendance, confirmedDisplay);
}
