/**
 * 活動詳情出席表「管理名單」編輯模式 — 純函式與 Firestore 批次寫入。
 *
 * 對照舊版 A：
 * - `_normalizeAttendanceSelection`（`event-manage-attendance.js` 第 14～22 行）
 * - `_isCompanionPseudoUid` / `_getAttendancePersonKey`（`event-manage-attendance.js` 第 49～65 行）
 * - `_findCompanionRegistrationForAttendance` / `_buildAttendanceBaseRecord`（`event-manage-attendance.js` 第 369～447 行）
 * - `_collectAttendanceOps`（`event-manage-confirm.js` 第 47～98 行）
 * - `batchWriteAttendance`（`firebase-crud.js` 第 975～1046 行）
 *
 * 嚴格遵守：
 * - 子集合路徑一律 `events/{eventDocId}/attendanceRecords`（R-REG-014）。
 * - `eventId` 欄位存 public id（R-ID-009）。
 * - 身分只認 UID（R-ID-002）；A 用名字比對的分支刻意不移植。
 * - 不寫入 A 快取用的內部欄位 `_path`、`_parentPath`、`_sourceKind`、`_sourceCollection`、`_docId`（L-31、L-32）。
 * - 即時存檔不發任何經驗值（PM 決定經驗值集中在伺服器結算時發；`collectAttendanceOps` 仍回傳 `grantExp` 對照 A，但本批不使用）。
 * - 不移植 `_confirmAllAttendance`（R-STAT-000 上鎖）。
 */

import type { Firestore } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { attendanceRecords as attendanceRecordsPath } from '@/data/paths';
import { assertAllowedFields } from '@/data/write-guard';
import {
  getLatestAttendanceRecord,
  matchAttendanceRecord,
  type ConfirmedRosterPerson,
  type RosterAttendanceRecordInput,
  type RosterRegistrationInput,
} from './attendance-roster-model';

// ── 型別定義 ──────────────────────────────────────

export interface AttendanceSelection {
  checkin: boolean;
  checkout: boolean;
  note: string;
}

export interface AttendancePersonInput {
  uid: string;
  name?: string;
  displayName?: string;
  ownerUid?: string;
  userId?: string;
  isCompanion?: boolean;
  regDocId?: string | null;
  courseStudentId?: string;
  courseLinkedRegistration?: boolean;
  isTeamPlaceholder?: boolean;
  isTeamHeader?: boolean;
  isTeamGeneralSeparator?: boolean;
}

export interface AttendanceBaseRecord {
  /** public eventId（R-ID-009）。 */
  eventId: string;
  /** 被簽到者／主報名者 uid（R-ID-003、R-STAT-002）。 */
  uid: string;
  userName: string;
  participantType: 'self' | 'companion';
  companionId: string | null;
  companionName: string | null;
}

export type BuildAttendanceBaseRecordResult =
  | {
      ok: true;
      record: AttendanceBaseRecord;
    }
  | {
      ok: false;
      reason: 'companion_registration_missing' | 'invalid_self_uid';
      personUid: string;
      personName: string;
    };

export type ManualAttendanceRecordType = 'checkin' | 'checkout' | 'note';

export interface AttendanceAddRecord extends AttendanceBaseRecord {
  id: string;
  type: ManualAttendanceRecordType;
  time: string;
  note?: string;
}

export interface AttendanceIdCounter {
  v: number;
}

export interface CollectAttendanceOpsResult {
  adds: AttendanceAddRecord[];
  removes: RosterAttendanceRecordInput[];
  /**
   * 對照 A `_collectAttendanceOps`：新增簽退且勾選簽到且有 uid 時為 true。
   * 注意：本批即時存檔**不使用**此欄位發放經驗值（經驗值集中在伺服器結算時發）。
   */
  grantExp: boolean;
  blocked?: boolean;
  reason?: 'companion_pseudo_uid_as_attendance_uid';
}

/**
 * 允許寫入 `events/{eventDocId}/attendanceRecords` 的欄位白名單（L-32）。
 * 嚴禁包含 `_docId`、`_path`、`_parentPath`、`_sourceKind`、`_sourceCollection` 等 A 快取內部欄位。
 */
export const ATTENDANCE_EDIT_ADD_ALLOWLIST = [
  'id',
  'eventId',
  'uid',
  'userName',
  'participantType',
  'companionId',
  'companionName',
  'type',
  'time',
  'note',
  'status',
  'createdAt',
] as const;

export const ATTENDANCE_EDIT_REMOVE_ALLOWLIST = [
  'status',
  'removedAt',
  'removedByUid',
] as const;

// ── 輔助純函式 ────────────────────────────────────

function str(val: unknown): string {
  return typeof val === 'string' ? val.trim() : val != null && typeof val === 'number' ? String(val) : '';
}

/** 對照 A `_isCompanionPseudoUid`（第 49～51 行）。 */
export function isCompanionPseudoUid(value: unknown): boolean {
  return str(value).startsWith('comp_');
}

/** 對照 A `_getAttendancePersonKey`（第 61～65 行）。 */
export function getAttendancePersonKey(person: {
  uid?: unknown;
  regDocId?: unknown;
  courseLinkedRegistration?: unknown;
} | null | undefined): string {
  const regDocId = str(person?.regDocId);
  if (person?.courseLinkedRegistration && regDocId) return `course-${regDocId}`;
  return str(person?.uid);
}

/** 對照 A `App._formatDateTime`：`YYYY/MM/DD HH:mm`。 */
export function formatAttendanceDateTime(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 對照 A `_normalizeAttendanceSelection`（第 14～22 行）：
 * 勾選簽退時強制連帶勾選簽到；備註若非字串則轉為空字串。
 */
export function normalizeAttendanceSelection(
  state: Partial<AttendanceSelection> | null | undefined,
): AttendanceSelection {
  const normalized: AttendanceSelection = {
    checkin: Boolean(state?.checkin),
    checkout: Boolean(state?.checkout),
    note: typeof state?.note === 'string' ? state.note : '',
  };
  if (normalized.checkout) normalized.checkin = true;
  return normalized;
}

function isActiveAttendanceRegistration(reg: RosterRegistrationInput): boolean {
  const status = str(reg.status);
  // 對照 A `_isActiveAttendanceRegistration`：排除已取消／移除的報名，預設正取與有效報名。
  return status !== 'cancelled' && status !== 'removed' && status !== 'waitlisted';
}

/**
 * 對照 A `_findCompanionRegistrationForAttendance`（第 369～395 行）。
 *
 * R-ID-002 刻意不移植：
 * - A 在最後有 `nameMatches = scopedRegs.filter(r => ... === safeName)` 的純名字比對 fallback；
 *   B 只認 `companionId === safeUid` 或主帳號 UID 衍生的複合鍵 `${regOwnerUid}_${regName} === safeUid`（含 ownerUid 驗證），
 *   不做純名字反查。
 */
export function findCompanionRegistrationForAttendance(
  _eventId: string,
  person: AttendancePersonInput | null | undefined,
  regs: readonly RosterRegistrationInput[] = [],
): RosterRegistrationInput | null {
  const safeUid = str(person?.uid);
  const ownerUid = str(person?.ownerUid) || str(person?.userId);
  if (!safeUid) return null;

  const companionRegs = regs.filter(
    (r) =>
      Boolean(r)
      && isActiveAttendanceRegistration(r)
      && (str(r.participantType) === 'companion' || Boolean(str(r.companionId))),
  );

  const byId = companionRegs.find((r) => str(r.companionId) === safeUid);
  if (byId) return byId;

  const scopedRegs = ownerUid
    ? companionRegs.filter((r) => str(r.userId) === ownerUid)
    : companionRegs;

  const byDerivedUid = scopedRegs.find((r) => {
    const regOwnerUid = str(r.userId);
    const regName = str(r.companionName) || str(r.userName);
    return Boolean(regOwnerUid && regName && `${regOwnerUid}_${regName}` === safeUid);
  });
  if (byDerivedUid) return byDerivedUid;

  // R-ID-002 刻意不移植：不以純名字（companionName === safeName）匹配同行者報名。
  return null;
}

/**
 * 對照 A `_buildAttendanceBaseRecord`（第 397～447 行）。
 */
export function buildAttendanceBaseRecord(
  eventId: string,
  person: AttendancePersonInput | null | undefined,
  regs: readonly RosterRegistrationInput[] = [],
): BuildAttendanceBaseRecordResult {
  const safeUid = str(person?.uid);
  const safeName = str(person?.name) || str(person?.displayName);
  const mustBeCompanion = Boolean(person?.isCompanion) || isCompanionPseudoUid(safeUid);

  if (mustBeCompanion) {
    const cReg = findCompanionRegistrationForAttendance(eventId, person, regs);
    // A：只認報名的 userId（R-ID-003）。
    const ownerUid = cReg ? str(cReg.userId) : '';
    if (!cReg || !ownerUid || isCompanionPseudoUid(ownerUid)) {
      return {
        ok: false,
        reason: 'companion_registration_missing',
        personUid: safeUid,
        personName: safeName,
      };
    }
    const companionId = str(cReg.companionId) || safeUid;
    return {
      ok: true,
      record: {
        eventId,
        uid: ownerUid,
        userName: str(cReg.userName),
        participantType: 'companion',
        companionId,
        companionName: str(cReg.companionName) || safeName,
      },
    };
  }

  if (!safeUid || isCompanionPseudoUid(safeUid)) {
    return {
      ok: false,
      reason: 'invalid_self_uid',
      personUid: safeUid,
      personName: safeName,
    };
  }

  return {
    ok: true,
    record: {
      eventId,
      uid: safeUid,
      userName: safeName,
      participantType: 'self',
      companionId: null,
      companionName: null,
    },
  };
}

function defaultRandom4(): string {
  // A：Math.random().toString(36).slice(2, 6)（不補位）。
  return Math.random().toString(36).slice(2, 6);
}

/**
 * 對照 A `_collectAttendanceOps`（`event-manage-confirm.js` 第 47～98 行）。
 *
 * - 新增簽到／簽退 id：`'att_' + idCounter.v++ + '_' + 4 碼亂數`
 * - 新增備註 id：`'att_note_' + idCounter.v++`
 * - `grantExp` 照 A 計算並回傳，但本批即時存檔**不使用**（經驗值集中在伺服器結算時發）。
 */
export function collectAttendanceOps(
  person: AttendancePersonInput,
  wantedInput: AttendanceSelection,
  currentRecords: readonly RosterAttendanceRecordInput[],
  eventId: string,
  timeStr: string,
  baseRecord: AttendanceBaseRecord,
  idCounter: AttendanceIdCounter,
  random4: () => string = defaultRandom4,
): CollectAttendanceOpsResult {
  const adds: AttendanceAddRecord[] = [];
  const removes: RosterAttendanceRecordInput[] = [];
  let grantExp = false;

  const wanted = normalizeAttendanceSelection(wantedInput);
  const matchTarget: ConfirmedRosterPerson = {
    uid: str(person.uid),
    ownerUid: str(person.ownerUid) || str(person.userId) || baseRecord.uid,
    name: str(person.name) || str(person.displayName),
    displayName: str(person.displayName) || str(person.name),
    isCompanion: Boolean(person.isCompanion),
    hasSelfReg: !person.isCompanion,
    proxyOnly: false,
    displayBadges: [],
    teamKey: null,
    regDocId: person.regDocId ?? null,
    teamReservationTeamId: null,
    teamReservationTeamName: null,
    teamSeatSource: null,
    isTeamPlaceholder: person.isTeamPlaceholder,
    isTeamHeader: person.isTeamHeader,
    isTeamGeneralSeparator: person.isTeamGeneralSeparator,
  };

  const activeRecords = currentRecords.filter((r) => {
    const status = str(r.status ?? r.data?.status) || 'active';
    return status !== 'removed';
  });

  const hasCheckin = activeRecords.some(
    (r) => str(r.type) === 'checkin' && matchAttendanceRecord(r, matchTarget),
  );
  const hasCheckout = activeRecords.some(
    (r) => str(r.type) === 'checkout' && matchAttendanceRecord(r, matchTarget),
  );
  const existingNote = getLatestAttendanceRecord(activeRecords, matchTarget, 'note');
  const existingNoteText = str(existingNote?.note ?? existingNote?.data?.note);

  if (
    wanted.checkin === hasCheckin
    && wanted.checkout === hasCheckout
    && wanted.note === existingNoteText
  ) {
    return { adds, removes, grantExp };
  }

  if (isCompanionPseudoUid(baseRecord?.uid)) {
    return {
      adds,
      removes,
      grantExp,
      blocked: true,
      reason: 'companion_pseudo_uid_as_attendance_uid',
    };
  }

  // 取消簽退
  if (!wanted.checkout && hasCheckout) {
    const rec = getLatestAttendanceRecord(activeRecords, matchTarget, 'checkout');
    if (rec) removes.push(rec);
  }
  // 取消簽到（連帶取消簽退）
  if (!wanted.checkin && hasCheckin) {
    const recOut = getLatestAttendanceRecord(activeRecords, matchTarget, 'checkout');
    const recOutId = str(recOut?.id ?? recOut?._docId);
    if (recOut && !removes.some((r) => str(r.id ?? r._docId) === recOutId)) {
      removes.push(recOut);
    }
    const recIn = getLatestAttendanceRecord(activeRecords, matchTarget, 'checkin');
    if (recIn) removes.push(recIn);
  }
  // 新增簽到
  if (wanted.checkin && !hasCheckin) {
    adds.push({
      ...baseRecord,
      id: `att_${idCounter.v++}_${random4()}`,
      type: 'checkin',
      time: timeStr,
    });
  }
  // 新增簽退
  if (wanted.checkout && !hasCheckout) {
    adds.push({
      ...baseRecord,
      id: `att_${idCounter.v++}_${random4()}`,
      type: 'checkout',
      time: timeStr,
    });
    if (wanted.checkin && baseRecord.uid) {
      grantExp = true;
    }
  }
  // 備註變更
  if (wanted.note !== existingNoteText) {
    adds.push({
      ...baseRecord,
      id: `att_note_${idCounter.v++}`,
      type: 'note',
      time: timeStr,
      note: wanted.note,
    });
  }

  return { adds, removes, grantExp };
}

// ── Firestore 批次寫入 ────────────────────────────

async function resolveDb(): Promise<Firestore> {
  const fb = await getFirebase();
  return fb.db as unknown as Firestore;
}

export interface WriteAttendanceOpsResult {
  addedDocIds: string[];
  removedDocIds: string[];
}

/**
 * 對照 A `batchWriteAttendance`（`firebase-crud.js` 第 975～1046 行）：
 * - 新增與軟刪除使用同一個 `writeBatch` 原子提交。
 * - 子集合路徑一律 `events/{eventDocId}/attendanceRecords`（R-REG-014）。
 * - 新增文件：`status: 'active'`、`createdAt: serverTimestamp()`，不寫 `_docId` / `_path` 等快取欄位。
 * - 軟刪除文件：`status: 'removed'`、`removedAt: serverTimestamp()`、`removedByUid: operatorUid`。
 */
export async function writeAttendanceOps(
  eventDocId: string,
  ops: Pick<CollectAttendanceOpsResult, 'adds' | 'removes'>,
  operatorUid: string,
): Promise<WriteAttendanceOpsResult> {
  if (!eventDocId) {
    throw new Error('[attendance-edit] writeAttendanceOps 需要 eventDocId（R-REG-014）');
  }
  if (!operatorUid) {
    throw new Error('[attendance-edit] writeAttendanceOps 需要 operatorUid（removedByUid）');
  }
  if (ops.adds.length === 0 && ops.removes.length === 0) {
    return { addedDocIds: [], removedDocIds: [] };
  }


  const [{ collection, doc: fsDoc, serverTimestamp, writeBatch }, db] = await Promise.all([
    import('firebase/firestore'),
    resolveDb(),
  ]);

  const batch = writeBatch(db);
  const collPath = attendanceRecordsPath(eventDocId);
  const collRef = collection(db, collPath);
  const addedDocIds: string[] = [];

  for (const addRec of ops.adds) {
    if (!addRec.eventId) {
      throw new Error('[attendance-edit] 新增紀錄缺少 eventId（public id，R-ID-009）');
    }
    const payload: Record<string, unknown> = {
      id: addRec.id,
      eventId: addRec.eventId,
      uid: addRec.uid,
      userName: addRec.userName,
      participantType: addRec.participantType,
      companionId: addRec.companionId,
      companionName: addRec.companionName,
      type: addRec.type,
      time: addRec.time,
      status: 'active',
      createdAt: serverTimestamp(),
    };
    if (addRec.type === 'note' || addRec.note !== undefined) {
      payload.note = addRec.note ?? '';
    }
    assertAllowedFields('writeAttendanceOps.add', payload, ATTENDANCE_EDIT_ADD_ALLOWLIST);

    const docRef = fsDoc(collRef);
    addedDocIds.push(docRef.id);
    batch.set(docRef, payload);
  }

  const removedDocIdsSet = new Set<string>();
  const removeUpdates: Record<string, unknown> = {
    status: 'removed',
    removedAt: serverTimestamp(),
    removedByUid: operatorUid,
  };
  assertAllowedFields('writeAttendanceOps.remove', removeUpdates, ATTENDANCE_EDIT_REMOVE_ALLOWLIST);

  for (const remRec of ops.removes) {
    const docId = str(remRec._docId);
    if (!docId || removedDocIdsSet.has(docId)) continue;
    removedDocIdsSet.add(docId);
    const docRef = fsDoc(db, collPath, docId);
    batch.update(docRef, removeUpdates);
  }

  await batch.commit();

  return {
    addedDocIds,
    removedDocIds: Array.from(removedDocIdsSet),
  };
}
