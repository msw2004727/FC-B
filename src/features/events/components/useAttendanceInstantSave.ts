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
 * 寫入成功後：用 `writeAttendanceOps` 回傳的文件 ID 局部更新本地出席清單，該列鎖只到 `batch.commit()`。
 * 整批重讀改為背景排程，不擋住該列。重讀失敗保留本地清單與樂觀草稿，不當成寫入失敗；
 * 失敗後下一次頁面傳入的新清單要採用。開始或結束編輯且沒有寫入中項目時，也把本地清單對回頁面資料。
 * 離頁：`visibilitychange`（hidden）、`pagehide`、卸載與切換活動都會 flush 防抖中的寫入，不丟計時器。
 * 有待送或寫入中的變更時註冊 `beforeunload`，清空後解除；卸載之後不再掛回。
 * 排隊中的變更把當下草稿凍進寫入情境。只有活動切換才用凍結勾選；同一活動重送讀當下草稿，失敗還原後不再送出。
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  applyAttendanceWriteResult,
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

interface PendingAttendanceWriteContext {
  gen: number;
  eventDocId: string;
  publicEventId: string;
  operatorUid: string | null;
  registrations: readonly RosterRegistrationInput[];
  records: readonly RosterAttendanceRecordInput[];
  person: ConfirmedRosterPerson | null;
  selection: AttendanceSelection | null;
}

/**
 * hidden、pagehide、卸載與 scopeKey 改變時 flush。
 * beforeunload 只在元件這次 effect 仍有效、且 `pending === true` 時註冊。
 * 卸載或切換 scope 的 cleanup 先標成無效並拆掉監聽，之後寫入結束的同步不得再掛回。
 */
export function useAttendanceLeaveGuard(
  scopeKey: string,
  flushRef: { readonly current: () => void },
): (pending: boolean) => void {
  const boundRef = useRef(false);
  const mountedRef = useRef(false);
  const handlerRef = useRef<((event: BeforeUnloadEvent) => void) | null>(null);
  if (handlerRef.current === null) {
    handlerRef.current = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
  }

  const syncBeforeUnload = useCallback((pending: boolean): void => {
    if (!mountedRef.current) return;
    const handler = handlerRef.current;
    if (!handler) return;
    if (pending && !boundRef.current) {
      window.addEventListener('beforeunload', handler);
      boundRef.current = true;
    } else if (!pending && boundRef.current) {
      window.removeEventListener('beforeunload', handler);
      boundRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flushRef.current();
    };
    const onPageHide = (): void => {
      flushRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      const handler = handlerRef.current;
      if (handler && boundRef.current) {
        window.removeEventListener('beforeunload', handler);
        boundRef.current = false;
      }
      flushRef.current();
    };
  }, [scopeKey, flushRef]);

  return syncBeforeUnload;
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
  const recordsRef = useRef<readonly RosterAttendanceRecordInput[]>(attendanceRecords);
  const seenPropsRecordsRef = useRef<readonly RosterAttendanceRecordInput[]>(attendanceRecords);
  const recordsEventRef = useRef(eventDocId);
  const localEpochRef = useRef(0);
  const serverEpochRef = useRef(0);
  const adoptNextPropsRef = useRef(false);
  const eventGenRef = useRef(0);
  const pendingCtxRef = useRef<Record<string, PendingAttendanceWriteContext>>({});
  const queuedCtxRef = useRef<Record<string, PendingAttendanceWriteContext>>({});
  const flushRef = useRef<() => void>(() => {});
  const syncLeaveGuardRef = useRef<(pending: boolean) => void>(() => {});
  const syncPendingRef = useRef<() => void>(() => {});
  const scheduleReloadRef = useRef<() => void>(() => {});
  const reloadLoopRef = useRef({ running: false, again: false });
  const eventResetSkipRef = useRef(true);

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

  if (recordsEventRef.current !== eventDocId) {
    recordsEventRef.current = eventDocId;
    eventGenRef.current += 1;
    recordsRef.current = attendanceRecords;
    seenPropsRecordsRef.current = attendanceRecords;
    localEpochRef.current = 0;
    serverEpochRef.current = 0;
    adoptNextPropsRef.current = false;
  } else if (attendanceRecords !== seenPropsRecordsRef.current) {
    const writing = Object.keys(inFlightMapRef.current).length > 0
      || Object.keys(queuedMapRef.current).length > 0;
    if (!writing && (localEpochRef.current === serverEpochRef.current || adoptNextPropsRef.current)) {
      seenPropsRecordsRef.current = attendanceRecords;
      recordsRef.current = attendanceRecords;
      serverEpochRef.current = localEpochRef.current;
      adoptNextPropsRef.current = false;
    } else if (!writing) {
      seenPropsRecordsRef.current = attendanceRecords;
    }
  }

  const captureCtx = (key: string): PendingAttendanceWriteContext => ({
    gen: eventGenRef.current,
    eventDocId: latestRef.current.eventDocId,
    publicEventId: latestRef.current.publicEventId,
    operatorUid: latestRef.current.operatorUid,
    registrations: latestRef.current.registrations,
    records: recordsRef.current,
    person: peopleByKeyRef.current.get(key) ?? null,
    selection: draftMapRef.current[key] ?? null,
  });

  const refreshPendingRecords = (
    gen: number,
    records: readonly RosterAttendanceRecordInput[],
  ): void => {
    for (const key of Object.keys(pendingCtxRef.current)) {
      const ctx = pendingCtxRef.current[key];
      if (ctx && ctx.gen === gen) pendingCtxRef.current[key] = { ...ctx, records };
    }
    for (const key of Object.keys(queuedCtxRef.current)) {
      const ctx = queuedCtxRef.current[key];
      if (ctx && ctx.gen === gen) queuedCtxRef.current[key] = { ...ctx, records };
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      for (const timer of Object.values(flashTimersRef.current)) clearTimeout(timer);
      flashTimersRef.current = {};
    };
  }, []);

  const syncBeforeUnload = useAttendanceLeaveGuard(eventDocId, flushRef);
  syncLeaveGuardRef.current = syncBeforeUnload;
  syncPendingRef.current = () => {
    const pending = Object.keys(noteTimersRef.current).length > 0
      || Object.keys(saveTimersRef.current).length > 0
      || Object.keys(inFlightMapRef.current).length > 0
      || Object.keys(queuedMapRef.current).length > 0;
    syncLeaveGuardRef.current(pending);
  };

  useEffect(() => {
    if (eventResetSkipRef.current) {
      eventResetSkipRef.current = false;
      return;
    }
    // 離頁 guard 的 cleanup 已先 flush 舊活動；這裡只清畫面，不砍 in-flight promise。
    draftMapRef.current = {};
    setDraftByKey({});
    setInFlightKeys({});
    setSavedFlashKeys({});
    setFailedFlashKeys({});
  }, [eventDocId]);

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
      return computeActualSelection(person, recordsRef.current);
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

  scheduleReloadRef.current = () => {
    const loop = reloadLoopRef.current;
    if (loop.running) {
      loop.again = true;
      return;
    }
    loop.running = true;
    void (async () => {
      try {
        do {
          loop.again = false;
          if (!aliveRef.current) break;
          const epoch = localEpochRef.current;
          const gen = eventGenRef.current;
          const docId = latestRef.current.eventDocId;
          try {
            const refreshed = await latestRef.current.onReloadAttendance();
            if (
              !aliveRef.current
              || eventGenRef.current !== gen
              || latestRef.current.eventDocId !== docId
              || localEpochRef.current !== epoch
              || loop.again
            ) {
              continue;
            }
            serverEpochRef.current = epoch;
            recordsRef.current = refreshed;
            adoptNextPropsRef.current = false;
            for (const key of Object.keys(draftMapRef.current)) {
              if (
                queuedMapRef.current[key]
                || noteTimersRef.current[key]
                || saveTimersRef.current[key]
                || inFlightMapRef.current[key]
              ) {
                continue;
              }
              setDraftForKey(key, null);
            }
          } catch {
            // 重讀失敗保留本地清單與樂觀草稿，不當成寫入失敗。
            // 下一筆頁面傳入的新清單要採用，避免計數永遠追不平。
            if (aliveRef.current) adoptNextPropsRef.current = true;
          }
        } while (loop.again && aliveRef.current);
      } finally {
        loop.running = false;
        if (loop.again && aliveRef.current) scheduleReloadRef.current();
      }
    })();
  };

  const writeForKey = useCallback(
    async (attendanceKey: string, pinned?: PendingAttendanceWriteContext): Promise<void> => {
      try {
        if (!attendanceKey) return;
        const frozen = Boolean(pinned && pinned.gen !== eventGenRef.current);
        if (attendanceKey in inFlightMapRef.current) {
          queuedMapRef.current[attendanceKey] = true;
          const ctx = frozen && pinned ? pinned : captureCtx(attendanceKey);
          const draft = draftMapRef.current[attendanceKey];
          queuedCtxRef.current[attendanceKey] = draft ? { ...ctx, selection: draft } : ctx;
          return;
        }

        const person = frozen
          ? pinned?.person ?? null
          : peopleByKeyRef.current.get(attendanceKey) ?? null;
        if (!person) return;

        const curDocId = frozen && pinned ? pinned.eventDocId : latestRef.current.eventDocId;
        const curEventId = frozen && pinned ? pinned.publicEventId : latestRef.current.publicEventId;
        const curOperatorUid = frozen && pinned ? pinned.operatorUid : latestRef.current.operatorUid;
        const curRegs = frozen && pinned ? pinned.registrations : latestRef.current.registrations;
        const curRecords = frozen && pinned ? pinned.records : recordsRef.current;
        const writeGen = frozen && pinned ? pinned.gen : eventGenRef.current;
        const ui = (): boolean => aliveRef.current && eventGenRef.current === writeGen;

        // 只有活動切換（frozen）才用凍結勾選。凍結勾選為空時用該次實際狀態，不讀新活動草稿。
        // 同一活動讀當下草稿：失敗還原已清草稿，防抖或排隊重送不會再寫失敗前的勾選。
        const wantedRaw = frozen
          ? (pinned?.selection ?? computeActualSelection(person, curRecords))
          : (draftMapRef.current[attendanceKey] ?? computeActualSelection(person, curRecords));
        const wanted = normalizeAttendanceSelection({
          checkin: wantedRaw.checkin,
          checkout: wantedRaw.checkout,
          note: wantedRaw.note.trim().slice(0, 20),
        });

        const resolved = buildAttendanceBaseRecord(curEventId, person, curRegs);
        if (!resolved.ok) {
          if (ui()) setDraftForKey(attendanceKey, null);
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
          if (ui()) {
            setDraftForKey(attendanceKey, null);
            triggerRowFlash(attendanceKey, 'failed');
          }
          latestRef.current.onSaveFailed(person.name || person.displayName || '');
          return;
        }

        if (ui()) {
          setInFlightKeys((prev) => ({ ...prev, [attendanceKey]: true }));
        }

        const runPromise = (async () => {
          try {
            const result = await writeAttendanceOps(curDocId, ops, curOperatorUid);
            // 即時存檔不發任何經驗值（決策第 4 點：經驗值集中在伺服器結算時發）。
            const base = eventGenRef.current === writeGen ? recordsRef.current : curRecords;
            const patched = applyAttendanceWriteResult(base, ops, result);
            if (eventGenRef.current === writeGen) {
              recordsRef.current = patched;
              localEpochRef.current += 1;
              refreshPendingRecords(writeGen, patched);
              const actual = computeActualSelection(person, patched);
              if (
                ui()
                && !queuedMapRef.current[attendanceKey]
                && !noteTimersRef.current[attendanceKey]
                && !saveTimersRef.current[attendanceKey]
                && actual.checkin === wanted.checkin
                && actual.checkout === wanted.checkout
                && actual.note === wanted.note
              ) {
                setDraftForKey(attendanceKey, null);
              }
              if (aliveRef.current && eventGenRef.current === writeGen) {
                scheduleReloadRef.current();
              }
            } else {
              refreshPendingRecords(writeGen, patched);
            }
            if (ui()) triggerRowFlash(attendanceKey, 'saved');
          } catch {
            // 寫入失敗：清除樂觀草稿（還原該列 checkbox／備註至實際狀態）並 toast（L-08、L-09）
            if (ui()) {
              setDraftForKey(attendanceKey, null);
              triggerRowFlash(attendanceKey, 'failed');
            }
            latestRef.current.onSaveFailed(person.name || person.displayName || '');
          } finally {
            delete inFlightMapRef.current[attendanceKey];
            if (ui()) {
              setInFlightKeys((prev) => {
                if (!prev[attendanceKey]) return prev;
                const copy = { ...prev };
                delete copy[attendanceKey];
                return copy;
              });
            }
            if (queuedMapRef.current[attendanceKey]) {
              const nextCtx = queuedCtxRef.current[attendanceKey];
              delete queuedMapRef.current[attendanceKey];
              delete queuedCtxRef.current[attendanceKey];
              void writeForKey(attendanceKey, nextCtx);
            }
          }
        })();

        inFlightMapRef.current[attendanceKey] = runPromise;
        await runPromise;
      } finally {
        syncPendingRef.current();
      }
    },
    [computeActualSelection, setDraftForKey, triggerRowFlash],
  );

  /** A `_onAttendanceCheckboxChange`：清掉同一人的計時器，300ms 後寫入。 */
  const scheduleSave = useCallback(
    (key: string): void => {
      if (saveTimersRef.current[key]) clearTimeout(saveTimersRef.current[key]);
      pendingCtxRef.current[key] = captureCtx(key);
      saveTimersRef.current[key] = setTimeout(() => {
        delete saveTimersRef.current[key];
        const pinned = pendingCtxRef.current[key];
        void writeForKey(key, pinned);
      }, CHECKBOX_DEBOUNCE_MS);
      syncPendingRef.current();
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
      pendingCtxRef.current[key] = captureCtx(key);
      noteTimersRef.current[key] = setTimeout(() => {
        delete noteTimersRef.current[key];
        // A：備註計時到後呼叫 `_onAttendanceCheckboxChange`（再延遲 300ms）。
        scheduleSave(key);
      }, NOTE_DEBOUNCE_MS);
      syncPendingRef.current();
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
      const pinned = pendingCtxRef.current[key];
      pendingWrites.push(writeForKey(key, pinned));
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
    syncPendingRef.current();
  }, [writeForKey]);

  const resetInstantSave = useCallback((): void => {
    for (const timer of Object.values(noteTimersRef.current)) clearTimeout(timer);
    for (const timer of Object.values(saveTimersRef.current)) clearTimeout(timer);
    noteTimersRef.current = {};
    saveTimersRef.current = {};
    queuedMapRef.current = {};
    queuedCtxRef.current = {};
    pendingCtxRef.current = {};
    draftMapRef.current = {};
    if (aliveRef.current) {
      setDraftByKey({});
    }
    if (Object.keys(inFlightMapRef.current).length === 0) {
      const pageRecords = latestRef.current.attendanceRecords;
      recordsRef.current = pageRecords;
      seenPropsRecordsRef.current = pageRecords;
      serverEpochRef.current = localEpochRef.current;
      adoptNextPropsRef.current = false;
    }
    syncPendingRef.current();
  }, []);

  flushRef.current = () => {
    void flushInstantSaves();
  };

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
