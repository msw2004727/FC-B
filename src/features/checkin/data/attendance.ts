/**
 * QR 簽到資料層：資料契約 ②a 直寫（A22 掃碼簽到／簽退、A23 家庭代簽、A24 取消出席）。
 *
 * - 寫入路徑 `events/{eventDocId}/attendanceRecords`（R-REG-014）。
 * - `uid` 為被簽到者（R-ID-003、R-STAT-002）；A 不記錄操作者，B 也不寫。
 * - `eventId` 欄位存 public id（R-ID-009），與 A 一致。
 * - 不移植任何 R-STAT-000 鎖定的統計邏輯（出席率等僅屬 UI 呈現，不在本層）。
 */

import type { Firestore } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { attendanceRecords as attendanceRecordsPath } from '@/data/paths';
import { assertAllowedFields } from '@/data/write-guard';
import { assertInternalTestEventDocWritable } from '@/data/internal-test';

// ── 型別 ──────────────────────────────────────────

export type AttendanceType = 'checkin' | 'checkout' | 'unreg';

/**
 * A `addAttendanceRecord`／`removeAttendanceRecord` 實際寫入的欄位。
 * 禁止出現操作者欄位（operatorUid / actorUid 等）——uid 一律為被簽到者（R-STAT-002）。
 */
export interface AttendanceWritePayload {
  id: string;
  /** public eventId（R-ID-009）。 */
  eventId: string;
  /** 被簽到者 uid（R-ID-003）。 */
  uid: string;
  userName: string;
  type: AttendanceType;
  /** `_formatDateTime(now)` 字串。 */
  time: string;
  /** A23 家庭代簽專用。 */
  participantType?: 'self' | 'companion';
  companionId?: string | null;
  companionName?: string | null;
  status?: 'active' | 'removed';
  createdAt?: unknown;
  removedAt?: unknown;
  removedByUid?: string;
}

/**
 * A 會寫入的欄位集合。
 * 注意：
 *  - 不含任何「操作者」欄位；`uid` 是被簽到者（R-STAT-002）。
 *  - `createdAt` / `removedAt` 由 serverTimestamp() 提供（A 版行為）。
 */
export const ATTENDANCE_FIELD_ALLOWLIST = [
  'id',
  'eventId',
  'uid',
  'userName',
  'type',
  'time',
  'participantType',
  'companionId',
  'companionName',
  'status',
  'createdAt',
  'removedAt',
  'removedByUid',
] as const;

// ── 純函式：id / time 預設實作 ────────────────────

/** 對照 A：`'att_' + Date.now() + '_' + Math.random().toString(36).slice(2,5)`。 */
function defaultIdFactory(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
}

/**
 * 對照 A `App._formatDateTime`：需為字串可排序（`_renderScanResults` 以 localeCompare 排序）。
 * 預設 `YYYY/MM/DD HH:mm`，呼叫端如需與 A 完全一致的格式請注入。
 */
function defaultFormatTime(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── 純函式：buildAttendanceRecord ─────────────────

export interface BuildAttendanceRecordCompanion {
  companionId: string | null;
  companionName: string | null;
}

export interface BuildAttendanceRecordInput {
  /** public id（R-ID-009）。 */
  eventId: string;
  /** 被簽到者 uid（R-ID-003）。 */
  uid: string;
  userName: string;
  type: AttendanceType;
  now: Date;
  /**
   * 家庭代簽專用（A23）。未傳 = 非家庭路徑，不寫 participantType / companionId / companionName。
   * 傳入時即使 companionId 為 null 也會寫入這三個欄位（A 版就是這樣）。
   */
  companion?: BuildAttendanceRecordCompanion;
  /** 測試注入；預設 A 的 `att_<ms>_<rand>`。 */
  idFactory?: () => string;
  /** 測試注入；預設 `YYYY/MM/DD HH:mm`。 */
  formatTime?: (d: Date) => string;
}

/**
 * 照 A 組出寫入物件（不含 status / createdAt；那兩個由 recordAttendance 補）。
 *
 * A 來源對照：
 *  - 非家庭路徑（`_processAttendance`）：`{ id, eventId, uid, userName, type, time }`。
 *  - 家庭路徑（`_confirmFamilyCheckin`）：追加之
 *    `participantType: cId ? 'companion' : 'self'`、
 *    `companionId: cId || null`、
 *    `companionName: cId ? displayName : null`。
 */
export function buildAttendanceRecord(input: BuildAttendanceRecordInput): AttendanceWritePayload {
  const id = (input.idFactory ?? defaultIdFactory)();
  const time = (input.formatTime ?? defaultFormatTime)(input.now);

  const record: AttendanceWritePayload = {
    id,
    eventId: input.eventId,
    uid: input.uid,
    userName: input.userName,
    type: input.type,
    time,
  };

  if (input.companion !== undefined) {
    const cId = input.companion.companionId;
    record.participantType = cId ? 'companion' : 'self';
    record.companionId = cId ?? null;
    record.companionName = cId ? (input.companion.companionName ?? null) : null;
  }

  return record;
}

// ── 純函式：decideScanAction ─────────────────────

export type ScanMode = 'checkin' | 'checkout';

/** 對照 A `getRegistrations` 回傳的欄位子集（A 有讀到的）。 */
export interface ScanRegistration {
  userId?: string;
  uid?: string;
  userName?: string;
  status?: string;
  companionId?: string | null;
  companionName?: string | null;
}

/** 對照 A `getAttendanceRecords` 回傳的欄位子集。 */
export interface ScanAttendance {
  uid?: string;
  type?: string;
  companionId?: string | null;
  status?: string;
}

export type DecideScanActionReasonKey =
  | 'checkin.success'
  | 'checkin.already'
  | 'checkout.success'
  | 'checkout.already'
  | 'checkout.auto_full'
  | 'unregistered.checkin.success'
  | 'unregistered.checkin.already'
  | 'unregistered.checkout.success'
  | 'unregistered.checkout.already'
  | 'unregistered.auto_full';

export interface DecideScanActionInput {
  /** public id（R-ID-009）。 */
  eventId: string;
  /** 被簽到者 uid（R-ID-003）。 */
  uid: string;
  userName: string;
  mode: ScanMode;
  /** 需要 `participants` 欄位；A：`participants.includes(userName)` 也算已報名。 */
  event: { participants?: unknown };
  /** 全活動的 registrations（A `getRegistrationsByEvent`）。 */
  registrations: readonly ScanRegistration[];
  /** 該活動所有 attendanceRecords（A `getAttendanceRecords`）。 */
  attendance: readonly ScanAttendance[];
  /** 用於 time / id 生成。 */
  now: Date;
  idFactory?: () => string;
  formatTime?: (d: Date) => string;
}

/**
 * 回傳本次掃碼應寫入的記錄與結果訊息 key。
 *
 * - `action` 表示簽到／簽退動作的結果（reject 表示本次不寫入簽到或簽退）。
 * - `records` 為完整要寫入的清單；未報名時可能含一筆 `unreg`（A 的行為），
 *   即使 `action === 'reject'` 也可能要寫 `unreg`。
 * - 已排除 `status === 'removed'` 的記錄（避免取消後無法重新簽到）。
 *
 * A 的來源：`_processAttendance`（未報名／已報名、checkin／checkout、已簽到／已簽退分支）。
 * 家庭代簽請先以 `shouldUseFamilyFlow` 分流並走 `buildFamilyCheckinRecords`。
 */
export function decideScanAction(input: DecideScanActionInput): {
  action: 'checkin' | 'checkout' | 'reject';
  resultClass: 'success' | 'warning';
  reasonKey: DecideScanActionReasonKey;
  records: readonly AttendanceWritePayload[];
} {
  const { eventId, uid, userName, mode, event, registrations, attendance, now } = input;

  const userRegsForCheck = registrations.filter(
    (r) => (r.userId === uid || r.userName === userName) && r.status === 'confirmed',
  );
  const isRegistered = userRegsForCheck.length > 0
    || (Array.isArray(event.participants)
      && event.participants.some((v) => typeof v === 'string' && v === userName));

  const active = (r: ScanAttendance): boolean => (r.status ?? 'active') !== 'removed';
  const userCheckin = attendance.some((r) => active(r) && r.uid === uid && r.type === 'checkin');
  const userCheckout = attendance.some((r) => active(r) && r.uid === uid && r.type === 'checkout');
  const hasUnreg = attendance.some((r) => active(r) && r.uid === uid && r.type === 'unreg');

  const make = (type: AttendanceType): AttendanceWritePayload => buildAttendanceRecord({
    eventId,
    uid,
    userName,
    type,
    now,
    idFactory: input.idFactory,
    formatTime: input.formatTime,
  });

  // ── 未報名分支：A 先寫 unreg（若尚無），再處理簽到／簽退 ──
  if (!isRegistered) {
    const prelude: AttendanceWritePayload[] = hasUnreg ? [] : [make('unreg')];
    if (mode === 'checkin') {
      if (userCheckin) {
        return {
          action: 'reject',
          resultClass: 'warning',
          reasonKey: 'unregistered.checkin.already',
          records: prelude,
        };
      }
      return {
        action: 'checkin',
        resultClass: 'warning',
        reasonKey: 'unregistered.checkin.success',
        records: [...prelude, make('checkin')],
      };
    }
    // mode === 'checkout'
    if (userCheckout) {
      return {
        action: 'reject',
        resultClass: 'warning',
        reasonKey: 'unregistered.checkout.already',
        records: prelude,
      };
    }
    if (!userCheckin) {
      return {
        action: 'checkout',
        resultClass: 'warning',
        reasonKey: 'unregistered.auto_full',
        records: [...prelude, make('checkin'), make('checkout')],
      };
    }
    return {
      action: 'checkout',
      resultClass: 'warning',
      reasonKey: 'unregistered.checkout.success',
      records: [...prelude, make('checkout')],
    };
  }

  // ── 已報名分支 ──
  if (mode === 'checkin') {
    if (userCheckin) {
      return {
        action: 'reject',
        resultClass: 'warning',
        reasonKey: 'checkin.already',
        records: [],
      };
    }
    return {
      action: 'checkin',
      resultClass: 'success',
      reasonKey: 'checkin.success',
      records: [make('checkin')],
    };
  }
  // mode === 'checkout'
  if (userCheckout) {
    return {
      action: 'reject',
      resultClass: 'warning',
      reasonKey: 'checkout.already',
      records: [],
    };
  }
  if (!userCheckin) {
    return {
      action: 'checkout',
      resultClass: 'success',
      reasonKey: 'checkout.auto_full',
      records: [make('checkin'), make('checkout')],
    };
  }
  return {
    action: 'checkout',
    resultClass: 'success',
    reasonKey: 'checkout.success',
    records: [make('checkout')],
  };
}

/**
 * 對照 A `_processAttendance` 的家庭分流：
 *   `userRegs.length > 1 || (userRegs.length === 1 && userRegs[0].companionId)`
 * 其中 `userRegs` 為該 uid 的 confirmed registrations。
 */
export function shouldUseFamilyFlow(
  registrations: readonly ScanRegistration[],
  uid: string,
): boolean {
  const userRegs = registrations.filter((r) => r.userId === uid && r.status === 'confirmed');
  if (userRegs.length > 1) return true;
  const only = userRegs.length === 1 ? userRegs[0] : undefined;
  return !!only?.companionId;
}

// ── 純函式：buildFamilyCheckinRecords ────────────

export interface FamilyMemberSelection {
  companionId: string | null;
  companionName: string | null;
  /** 顯示名稱（供 companionName 為空時 fallback，照 A dataset.name）。 */
  displayName?: string;
}

export interface BuildFamilyCheckinRecordsInput {
  eventId: string;
  uid: string;
  userName: string;
  mode: ScanMode;
  members: readonly FamilyMemberSelection[];
  attendance: readonly ScanAttendance[];
  now: Date;
  idFactory?: () => string;
  formatTime?: (d: Date) => string;
}

/**
 * 對照 A `_confirmFamilyCheckin`：每位成員一筆，checkout 若尚未 checkin 則自動補簽到。
 * A 已在 UI 端把已簽到／已簽退的項目 disabled；本函式再保險跳過。
 * `userName` / `companionName` 為快照欄位（A 的寫入方式）。
 */
export function buildFamilyCheckinRecords(
  input: BuildFamilyCheckinRecordsInput,
): AttendanceWritePayload[] {
  const { eventId, uid, userName, mode, members, attendance, now } = input;

  const active = (r: ScanAttendance): boolean => (r.status ?? 'active') !== 'removed';
  const has = (cId: string | null, type: 'checkin' | 'checkout'): boolean =>
    attendance.some(
      (r) => active(r)
        && r.uid === uid
        && r.type === type
        && (r.companionId ?? null) === cId,
    );

  const out: AttendanceWritePayload[] = [];

  for (const m of members) {
    const cId = m.companionId ?? null;
    const cName = cId ? (m.companionName ?? m.displayName ?? null) : null;

    const build = (type: AttendanceType): AttendanceWritePayload => buildAttendanceRecord({
      eventId,
      uid,
      userName,
      type,
      now,
      idFactory: input.idFactory,
      formatTime: input.formatTime,
      companion: { companionId: cId, companionName: cName },
    });

    if (mode === 'checkin') {
      if (has(cId, 'checkin')) continue;
      out.push(build('checkin'));
      continue;
    }

    if (has(cId, 'checkout')) continue;
    if (!has(cId, 'checkin')) {
      out.push(build('checkin'));
    }
    out.push(build('checkout'));
  }

  return out;
}

// ── Firestore 寫入（Firebase 12 modular）────────

function assertAttendancePayload(action: string, payload: Record<string, unknown>): void {
  assertAllowedFields(action, payload, ATTENDANCE_FIELD_ALLOWLIST);
}

async function resolveDb(): Promise<Firestore> {
  const fb = await getFirebase();
  return fb.db as unknown as Firestore;
}

/**
 * A `addAttendanceRecord`：
 *   `set({ ...record, status: 'active', createdAt: serverTimestamp() })`
 * 寫入 `events/{eventDocId}/attendanceRecords/{autoId}`（R-REG-014）。
 * 回傳新文件的 doc.id。
 */
export async function recordAttendance(
  eventDocId: string,
  record: AttendanceWritePayload,
): Promise<string> {
  if (!eventDocId) throw new Error('[checkin] recordAttendance 需要 eventDocId（R-REG-014）');
  if (!record.eventId) throw new Error('[checkin] recordAttendance 需要 eventId（public id，R-ID-009）');
  await assertInternalTestEventDocWritable(eventDocId);

  const [{ doc: fsDoc, collection, setDoc, serverTimestamp }, db] = await Promise.all([
    import('firebase/firestore'),
    resolveDb(),
  ]);

  const payload: Record<string, unknown> = {
    ...record,
    status: record.status ?? 'active',
    createdAt: serverTimestamp(),
  };
  assertAttendancePayload('recordAttendance', payload);

  const collRef = collection(db, attendanceRecordsPath(eventDocId));
  const docRef = fsDoc(collRef);
  await setDoc(docRef, payload);
  return docRef.id;
}

/**
 * A `removeAttendanceRecord`：軟刪除
 *   `update({ status: 'removed', removedAt: serverTimestamp(), removedByUid })`
 * `removedByUid` 為 A24 標記的操作者；與簽到記錄的 `uid` 無關（R-STAT-002）。
 */
export async function removeAttendance(
  eventDocId: string,
  recordDocId: string,
  operatorUid: string,
): Promise<void> {
  if (!eventDocId) throw new Error('[checkin] removeAttendance 需要 eventDocId（R-REG-014）');
  if (!recordDocId) throw new Error('[checkin] removeAttendance 需要 recordDocId');
  if (!operatorUid) throw new Error('[checkin] removeAttendance 需要 operatorUid（removedByUid，A24）');
  await assertInternalTestEventDocWritable(eventDocId);

  const [{ doc: fsDoc, updateDoc, serverTimestamp }, db] = await Promise.all([
    import('firebase/firestore'),
    resolveDb(),
  ]);

  const updates: Record<string, unknown> = {
    status: 'removed',
    removedAt: serverTimestamp(),
    removedByUid: operatorUid,
  };
  assertAttendancePayload('removeAttendance', updates);

  const docRef = fsDoc(db, attendanceRecordsPath(eventDocId), recordDocId);
  await updateDoc(docRef, updates);
}

// ── Firestore 讀取 ───────────────────────────────

export interface EventAttendanceEntry {
  _docId: string;
  uid: string;
  userName: string;
  companionId: string | null;
  companionName: string | null;
  /** 對照 A `_renderScanResults` 的 `companionName || userName`。 */
  displayName: string;
  type: string;
  time: string;
  status: string;
  /** 保留原始 data，供 UI 需要更多欄位時使用；不構成寫入契約。 */
  data: Record<string, unknown>;
}

/**
 * 對照 A `_renderScanResults` 的整理方式：
 *   `[...records].sort((a, b) => (b.time || '').localeCompare(a.time || ''))`
 * 不在此過濾 removed：A 呈現時也會顯示；是否顯示交給 UI（僅供呈現，不作統計）。
 */
export async function loadEventAttendance(eventDocId: string): Promise<EventAttendanceEntry[]> {
  if (!eventDocId) throw new Error('[checkin] loadEventAttendance 需要 eventDocId（R-REG-014）');

  const [{ collection, getDocs }, db] = await Promise.all([
    import('firebase/firestore'),
    resolveDb(),
  ]);

  const collRef = collection(db, attendanceRecordsPath(eventDocId));
  const snap = await getDocs(collRef);

  const entries: EventAttendanceEntry[] = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as Record<string, unknown>;
    const uid = typeof data.uid === 'string' ? data.uid : '';
    const userName = typeof data.userName === 'string' ? data.userName : '';
    const companionId = typeof data.companionId === 'string' ? data.companionId : null;
    const companionName = typeof data.companionName === 'string' ? data.companionName : null;
    const type = typeof data.type === 'string' ? data.type : '';
    const time = typeof data.time === 'string' ? data.time : '';
    const status = typeof data.status === 'string' ? data.status : 'active';
    const displayName = companionName || userName;
    entries.push({
      _docId: docSnap.id,
      uid,
      userName,
      companionId,
      companionName,
      displayName,
      type,
      time,
      status,
      data,
    });
  }

  entries.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  return entries;
}
