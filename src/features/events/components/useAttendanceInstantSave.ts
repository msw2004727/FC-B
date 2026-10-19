/**
 * 出席表「管理名單」編輯模式的即時存檔 Hook。
 *
 * 對照舊版 A（`js/modules/event/event-manage-instant-save.js`）：
 * - `_onAttendanceCheckboxChange`：checkbox 變更後寫入（並處理勾選簽退連帶勾簽到、取消簽到連帶取消簽退）。
 * - `_bindInstantSaveHandler`：備註輸入 1000ms debounce。
 * - `_writeInstantAttendance`：同一人寫入中（in-flight）若再次變更則排隊（queued），寫完自動再寫一次。
 * - 失敗時還原該列至實際狀態，並透過回呼提示 `{name} 儲存失敗，已還原`。
 * - 成功時觸發該列短暫閃綠（`att-row-saved`，600ms）。
 * - `_flushInstantSaves`：立即執行所有 debounce 中的計時器並等待所有 in-flight 寫入完成。
 *
 * 寫入成功後的畫面更新策略（決策第 3 點）：
 * 採用「重新呼叫 `loadEventAttendance(eventDocId)` 並以本地樂觀草稿（drafts）橋接讀取延遲」：
 * 理由：`writeBatch` 新增的文件 ID 與伺服器時間戳由 Firestore 產生，直接重讀 `loadEventAttendance`
 * 能確保 `_docId` 與之後軟刪除所需的 canonical 文件身分完全一致，避免手工拼湊快取結構與真實子集合偏離（L-31）。
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  buildAttendanceBaseRecord,
  collectAttendanceOps,
  formatAttendanceDateTime,
  getAttendancePersonKey,
  normalizeAttendanceSelection,
  writeAttendanceOps,
  type AttendanceSelection,
} from '../data/attendance-edit';
import {
  attendanceStateFor,
  buildConfirmedRoster,
  type ConfirmedRosterPerson,
  type RosterAttendanceRecordInput,
  type RosterEventInput,
  type RosterRegistrationInput,
} from '../data/attendance-roster-model';

/** A `_onAttendanceCheckboxChange`：勾選後 300ms 才寫（同一人連續變更合併成一次）。 */
export const CHECKBOX_DEBOUNCE_MS = 300;
/** A `_bindInstantSaveHandler`：備註停止輸入 1000ms 後再走勾選同一條路（再 300ms）。 */
export const NOTE_DEBOUNCE_MS = 1000;
export const ROW_SAVED_FLASH_MS = 600;
export const ROW_FAILED_FLASH_MS = 1200;

export interface UseAttendanceInstantSaveOptions {
  event: RosterEventInput | null | undefined;
  eventDocId: string;
  publicEventId: string;
  operatorUid: string | null;
  registrations: readonly RosterRegistrationInput[];
  attendanceRecords: readonly RosterAttendanceRecordInput[];
  onReloadAttendance: () => Promise<readonly RosterAttendanceRecordInput[]>;
  onSaveFailed: (personName: string) => void;
  onCompanionMissing?: () => void;
}

export interface UseAttendanceInstantSaveResult {
  /** 各列目前的勾選與備註顯示值（優先取使用者剛操作的樂觀值，無則取 attendanceRecords）。 */
  getRowSelection: (person: ConfirmedRosterPerson) => AttendanceSelection;
  /** 正在寫入中的 attendanceKey 集合（用於列內 checkbox disabled）。 */
  inFlightKeys: Readonly<Record<string, boolean>>;
  /** 剛儲存成功閃綠的 attendanceKey 集合（600ms）。 */
  savedFlashKeys: Readonly<Record<string, boolean>>;
  /** 剛儲存失敗閃紅的 attendanceKey 集合（1200ms）。 */
  failedFlashKeys: Readonly<Record<string, boolean>>;
  /** 勾選簽到／簽退（自動套用連帶勾選規則並立即觸發寫入）。 */
  onToggleCheckbox: (
    person: ConfirmedRosterPerson,
    field: 'checkin' | 'checkout',
    checked: boolean,
  ) => void;
  /** 備註輸入變更（最長 20 字，1000ms debounce 後寫入）。 */
  onChangeNote: (person: ConfirmedRosterPerson, noteValue: string) => void;
  /** Flush 所有 debounce 中的備註／勾選並等待所有寫入中請求完成。 */
  flushInstantSaves: () => Promise<void>;
  /** 清除所有計時器與暫存狀態（關閉編輯模式時呼叫）。 */
  resetInstantSave: () => void;
}

export function useAttendanceInstantSave({
  event,
  eventDocId,
  publicEventId,
  operatorUid,
  registrations,
  attendanceRecords,
  onReloadAttendance,
  onSaveFailed,
  onCompanionMissing,
}: UseAttendanceInstantSaveOptions): UseAttendanceInstantSaveResult {
  const [draftByKey, setDraftByKey] = useState<Record<string, AttendanceSelection>>({});
  const [inFlightKeys, setInFlightKeys] = useState<Record<string, boolean>>({});
  const [savedFlashKeys, setSavedFlashKeys] = useState<Record<string, boolean>>({});
  const [failedFlashKeys, setFailedFlashKeys] = useState<Record<string, boolean>>({});

  const aliveRef = useRef(true);
  const draftMapRef = useRef<Record<string, AttendanceSelection>>({});
  const inFlightMapRef = useRef<Record<string, Promise<void>>>({});
  const queuedMapRef = useRef<Record<string, boolean>>({});
  const noteTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const flashTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const idCounterRef = useRef<{ v: number }>({ v: Date.now() });

  const latestRef = useRef({
    event,
    eventDocId,
    publicEventId,
    operatorUid,
    registrations,
    attendanceRecords,
    onReloadAttendance,
    onSaveFailed,
    onCompanionMissing,
  });
  latestRef.current = {
    event,
    eventDocId,
    publicEventId,
    operatorUid,
    registrations,
    attendanceRecords,
    onReloadAttendance,
    onSaveFailed,
    onCompanionMissing,
  };

  const peopleByKeyRef = useRef<Map<string, ConfirmedRosterPerson>>(new Map());
  const roster = buildConfirmedRoster(event, registrations);
  const nextPeopleMap = new Map<string, ConfirmedRosterPerson>();
  for (const p of roster.people) {
    if (
      p.isTeamHeader
      || p.isTeamGeneralSeparator
      || p.isTeamPlaceholder
      || p.proxyOnly
      || p.isProxyOnly
      || p.attendanceAmbiguous
    ) {
      continue;
    }
    const key = getAttendancePersonKey(p);
    if (key) nextPeopleMap.set(key, p);
  }
  peopleByKeyRef.current = nextPeopleMap;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      for (const timer of Object.values(noteTimersRef.current)) clearTimeout(timer);
      for (const timer of Object.values(saveTimersRef.current)) clearTimeout(timer);
      for (const timer of Object.values(flashTimersRef.current)) clearTimeout(timer);
      noteTimersRef.current = {};
      saveTimersRef.current = {};
      flashTimersRef.current = {};
    };
  }, []);

  const computeActualSelection = useCallback(
    (
      person: ConfirmedRosterPerson,
      records: readonly RosterAttendanceRecordInput[],
    ): AttendanceSelection => {
      const state = attendanceStateFor(person, records);
      return normalizeAttendanceSelection({
        checkin: state.hasCheckin,
        checkout: state.hasCheckout,
        note: state.noteText,
      });
    },
    [],
  );

  const getRowSelection = useCallback(
    (person: ConfirmedRosterPerson): AttendanceSelection => {
      const key = getAttendancePersonKey(person);
      const draft = key ? draftMapRef.current[key] ?? draftByKey[key] : undefined;
      if (draft) return draft;
      return computeActualSelection(person, latestRef.current.attendanceRecords);
    },
    [computeActualSelection, draftByKey],
  );

  const setDraftForKey = useCallback((key: string, next: AttendanceSelection | null): void => {
    if (next === null) {
      delete draftMapRef.current[key];
      if (aliveRef.current) {
        setDraftByKey((prev) => {
          if (!(key in prev)) return prev;
          const copy = { ...prev };
          delete copy[key];
          return copy;
        });
      }
      return;
    }
    draftMapRef.current[key] = next;
    if (aliveRef.current) {
      setDraftByKey((prev) => ({ ...prev, [key]: next }));
    }
  }, []);

  const triggerRowFlash = useCallback((key: string, kind: 'saved' | 'failed'): void => {
    if (!aliveRef.current) return;
    const timerKey = `${kind}:${key}`;
    if (flashTimersRef.current[timerKey]) {
      clearTimeout(flashTimersRef.current[timerKey]);
    }
    if (kind === 'saved') {
      setSavedFlashKeys((prev) => ({ ...prev, [key]: true }));
      flashTimersRef.current[timerKey] = setTimeout(() => {
        delete flashTimersRef.current[timerKey];
        if (aliveRef.current) {
          setSavedFlashKeys((prev) => {
            if (!prev[key]) return prev;
            const copy = { ...prev };
            delete copy[key];
            return copy;
          });
        }
      }, ROW_SAVED_FLASH_MS);
    } else {
      setFailedFlashKeys((prev) => ({ ...prev, [key]: true }));
      flashTimersRef.current[timerKey] = setTimeout(() => {
        delete flashTimersRef.current[timerKey];
        if (aliveRef.current) {
          setFailedFlashKeys((prev) => {
            if (!prev[key]) return prev;
            const copy = { ...prev };
            delete copy[key];
            return copy;
          });
        }
      }, ROW_FAILED_FLASH_MS);
    }
  }, []);

  const writeForKey = useCallback(
    async (attendanceKey: string): Promise<void> => {
      if (!attendanceKey) return;
      if (attendanceKey in inFlightMapRef.current) {
        queuedMapRef.current[attendanceKey] = true;
        return;
      }

      const person = peopleByKeyRef.current.get(attendanceKey);
      if (!person) return;

      const {
        eventDocId: curDocId,
        publicEventId: curEventId,
        operatorUid: curOperatorUid,
        registrations: curRegs,
        attendanceRecords: curRecords,
      } = latestRef.current;

      const wantedRaw =
        draftMapRef.current[attendanceKey] ?? computeActualSelection(person, curRecords);
      const wanted = normalizeAttendanceSelection({
        checkin: wantedRaw.checkin,
        checkout: wantedRaw.checkout,
        note: wantedRaw.note.trim().slice(0, 20),
      });

      const resolved = buildAttendanceBaseRecord(curEventId, person, curRegs);
      if (!resolved.ok) {
        // 還原至實際狀態並提示
        setDraftForKey(attendanceKey, null);
        latestRef.current.onCompanionMissing?.();
        return;
      }

      const timeStr = formatAttendanceDateTime(new Date());
      const ops = collectAttendanceOps(
        person,
        wanted,
        curRecords,
        curEventId,
        timeStr,
        resolved.record,
        idCounterRef.current,
      );

      if (ops.blocked || (ops.adds.length === 0 && ops.removes.length === 0)) {
        return;
      }

      if (!curOperatorUid || !curDocId) {
        setDraftForKey(attendanceKey, null);
        triggerRowFlash(attendanceKey, 'failed');
        latestRef.current.onSaveFailed(person.name || person.displayName || '');
        return;
      }

      if (aliveRef.current) {
        setInFlightKeys((prev) => ({ ...prev, [attendanceKey]: true }));
      }

      const runPromise = (async () => {
        try {
          await writeAttendanceOps(curDocId, ops, curOperatorUid);
          // 即時存檔不發任何經驗值（決策第 4 點：經驗值集中在伺服器結算時發）。
          try {
            const refreshed = await latestRef.current.onReloadAttendance();
            latestRef.current.attendanceRecords = refreshed;
            if (
              !queuedMapRef.current[attendanceKey]
              && !noteTimersRef.current[attendanceKey]
              && !saveTimersRef.current[attendanceKey]
            ) {
              setDraftForKey(attendanceKey, null);
            }
          } catch {
            // 重讀失敗時保留樂觀顯示值，不視為寫入失敗。
          }
          triggerRowFlash(attendanceKey, 'saved');
        } catch {
          // 寫入失敗：清除樂觀草稿（還原該列 checkbox／備註至實際狀態）並 toast（L-08、L-09）
          setDraftForKey(attendanceKey, null);
          triggerRowFlash(attendanceKey, 'failed');
          latestRef.current.onSaveFailed(person.name || person.displayName || '');
        } finally {
          delete inFlightMapRef.current[attendanceKey];
          if (aliveRef.current) {
            setInFlightKeys((prev) => {
              if (!prev[attendanceKey]) return prev;
              const copy = { ...prev };
              delete copy[attendanceKey];
              return copy;
            });
          }
          if (queuedMapRef.current[attendanceKey]) {
            delete queuedMapRef.current[attendanceKey];
            if (aliveRef.current) {
              void writeForKey(attendanceKey);
            }
          }
        }
      })();

      inFlightMapRef.current[attendanceKey] = runPromise;
      await runPromise;
    },
    [computeActualSelection, setDraftForKey, triggerRowFlash],
  );

  /** A `_onAttendanceCheckboxChange`：清掉同一人的計時器，300ms 後寫入。 */
  const scheduleSave = useCallback(
    (key: string): void => {
      if (saveTimersRef.current[key]) clearTimeout(saveTimersRef.current[key]);
      saveTimersRef.current[key] = setTimeout(() => {
        delete saveTimersRef.current[key];
        void writeForKey(key);
      }, CHECKBOX_DEBOUNCE_MS);
    },
    [writeForKey],
  );

  const onToggleCheckbox = useCallback(
    (person: ConfirmedRosterPerson, field: 'checkin' | 'checkout', checked: boolean): void => {
      const key = getAttendancePersonKey(person);
      if (!key) return;
      const current = getRowSelection(person);
      let nextCheckin = current.checkin;
      let nextCheckout = current.checkout;

      // 對照 A `_bindAttendanceCheckboxLink`：
      // 勾選簽退連帶勾簽到；取消簽到連帶取消簽退。
      if (field === 'checkout') {
        nextCheckout = checked;
        if (checked) nextCheckin = true;
      } else {
        nextCheckin = checked;
        if (!checked && nextCheckout) {
          nextCheckout = false;
        }
      }

      const nextSelection = normalizeAttendanceSelection({
        checkin: nextCheckin,
        checkout: nextCheckout,
        note: current.note,
      });
      setDraftForKey(key, nextSelection);
      scheduleSave(key);
    },
    [getRowSelection, setDraftForKey, scheduleSave],
  );

  const onChangeNote = useCallback(
    (person: ConfirmedRosterPerson, noteValue: string): void => {
      const key = getAttendancePersonKey(person);
      if (!key) return;
      const clipped = noteValue.slice(0, 20);
      const current = getRowSelection(person);
      setDraftForKey(key, {
        checkin: current.checkin,
        checkout: current.checkout,
        note: clipped,
      });

      if (noteTimersRef.current[key]) {
        clearTimeout(noteTimersRef.current[key]);
      }
      noteTimersRef.current[key] = setTimeout(() => {
        delete noteTimersRef.current[key];
        // A：備註計時到後呼叫 `_onAttendanceCheckboxChange`（再延遲 300ms）。
        scheduleSave(key);
      }, NOTE_DEBOUNCE_MS);
    },
    [getRowSelection, setDraftForKey, scheduleSave],
  );

  const flushInstantSaves = useCallback(async (): Promise<void> => {
    const pendingKeys = new Set([
      ...Object.keys(noteTimersRef.current),
      ...Object.keys(saveTimersRef.current),
    ]);
    const pendingWrites: Promise<void>[] = [];
    for (const key of pendingKeys) {
      clearTimeout(noteTimersRef.current[key]);
      clearTimeout(saveTimersRef.current[key]);
      delete noteTimersRef.current[key];
      delete saveTimersRef.current[key];
      pendingWrites.push(writeForKey(key));
    }
    if (pendingWrites.length > 0) {
      await Promise.allSettled(pendingWrites);
    }
    // 等待所有 in-flight（及排隊觸發的下一輪）寫入完成
    let safety = 0;
    while (Object.keys(inFlightMapRef.current).length > 0 && safety < 20) {
      safety += 1;
      await Promise.allSettled(Object.values(inFlightMapRef.current));
    }
  }, [writeForKey]);

  const resetInstantSave = useCallback((): void => {
    for (const timer of Object.values(noteTimersRef.current)) clearTimeout(timer);
    for (const timer of Object.values(saveTimersRef.current)) clearTimeout(timer);
    noteTimersRef.current = {};
    saveTimersRef.current = {};
    queuedMapRef.current = {};
    draftMapRef.current = {};
    if (aliveRef.current) {
      setDraftByKey({});
    }
  }, []);

  return {
    getRowSelection,
    inFlightKeys,
    savedFlashKeys,
    failedFlashKeys,
    onToggleCheckbox,
    onChangeNote,
    flushInstantSaves,
    resetInstantSave,
  };
}
