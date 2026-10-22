/**
 * 活動詳情「未報名單」檢視與編輯元件。
 *
 * 對照舊版 A：
 * - `js/modules/event/event-manage-attendance.js#_renderUnregTable`（第 1092～1232 行）
 * - `js/modules/event/event-manage-confirm.js#_removeUnregUser`（第 281～308 行）
 * - `js/modules/event/event-manage-confirm.js#_startUnregTableEdit`（第 270～279 行）
 *
 * 重點規則：
 * - 資料來源：該活動 `attendanceRecords` 中 `type === 'unreg'` 且未刪除（排除 `removed`／`cancelled`）的紀錄；同一 `uid` 只列一次，依名字排序。
 * - 權限：照 A `canManage = canOperateEventSite(e) === true`。無權限時不顯示「編輯」按鈕，僅唯讀顯示表格。
 * - 「踢掉」：`appConfirm('確定要將 {名字} 從未報名單中移除嗎？')` → 以 `removeAttendance` 軟刪該用戶於此活動的所有有效出席紀錄（unreg / checkin / checkout / note），寫 `writeOpLog('unreg_removed', '移除未報名掃碼', '從「{活動}」移除 {名字}')`，toast「已將 {名字} 從未報名單中移除」。
 * - 「編輯／完成」：編輯模式開放勾選簽到／簽退與備註；旗標 true 時「完成」只 flush 即時存檔並提示「儲存完成」，不呼叫結算或發經驗值；false 回退「關閉編輯」與舊版結算提示。
 * - R-ID-002：只以 `uid` 比對，不移植名字比對分支。
 */

import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CALLABLES_DEPLOYED } from '@/data/callables-deployed';
import { writeOpLog } from '@/data/op-log';
import { removeAttendance } from '@/features/checkin/data/attendance';
import { appConfirm } from '@/ui/AppConfirm';
import {
  collectAttendanceOps,
  formatAttendanceDateTime,
  normalizeAttendanceSelection,
  writeAttendanceOps,
  type AttendanceSelection,
} from '../data/attendance-edit';
import {
  getLatestAttendanceRecord,
  matchAttendanceRecord,
  type ConfirmedRosterPerson,
  type RosterAttendanceRecordInput,
} from '../data/attendance-roster-model';
import {
  CHECKBOX_DEBOUNCE_MS,
  NOTE_DEBOUNCE_MS,
  ROW_FAILED_FLASH_MS,
  ROW_SAVED_FLASH_MS,
} from './useAttendanceInstantSave';

export interface UnregPerson {
  uid: string;
  name: string;
}

export interface UnregRosterTableProps {
  /** public eventId（R-ID-009）。 */
  eventId: string;
  /** Firestore eventDocId（R-REG-014）。 */
  eventDocId: string;
  /** 活動標題（用於操作紀錄）。 */
  eventTitle: string;
  /** 該活動的出席紀錄清單。 */
  attendanceRecords: readonly RosterAttendanceRecordInput[];
  /** 是否具備現場操作權限（`canOperateEventSite(e) === true`）。 */
  canManage?: boolean;
  /** 目前操作者 uid（軟刪與操作紀錄用）。 */
  operatorUid: string | null;
  /** 目前操作者顯示名稱（操作紀錄用）。 */
  operatorName?: string;
  /** 重新載入該活動出席紀錄。 */
  onReloadAttendance?: () => Promise<readonly RosterAttendanceRecordInput[]>;
  /** 顯示 Toast 訊息回呼。 */
  onToast?: (message: string) => void;
}

const LEGACY_SETTLE_URL = 'https://toosterx.com/';

function str(val: unknown): string {
  return typeof val === 'string'
    ? val.trim()
    : val != null && typeof val === 'number'
      ? String(val)
      : '';
}

function isActiveRecord(record: RosterAttendanceRecordInput): boolean {
  const status = str(record.status ?? record.data?.status) || 'active';
  return status !== 'removed' && status !== 'cancelled';
}

function toPersonModel(p: UnregPerson): ConfirmedRosterPerson {
  return {
    uid: p.uid,
    ownerUid: p.uid,
    name: p.name,
    displayName: p.name,
    isCompanion: false,
    hasSelfReg: false,
    proxyOnly: false,
    displayBadges: [],
    teamKey: null,
    regDocId: null,
    teamReservationTeamId: null,
    teamReservationTeamName: null,
    teamSeatSource: null,
  };
}

/**
 * 收集不重複且有效的未報名用戶（對照 A `_renderUnregTable` 第 1126～1158 行）。
 */
export function buildUnregPeopleList(
  records: readonly RosterAttendanceRecordInput[],
): UnregPerson[] {
  const unregMap = new Map<string, UnregPerson>();
  for (const r of records) {
    if (!isActiveRecord(r)) continue;
    if (str(r.type) !== 'unreg') continue;
    const uid = str(r.uid);
    if (!uid || unregMap.has(uid)) continue;
    const userName = str(r.userName ?? r.data?.userName);
    unregMap.set(uid, { uid, name: userName });
  }
  const people = Array.from(unregMap.values());
  people.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return people;
}

export function UnregRosterTable({
  eventId,
  eventDocId,
  eventTitle,
  attendanceRecords,
  canManage = false,
  operatorUid,
  operatorName,
  onReloadAttendance,
  onToast,
}: UnregRosterTableProps): JSX.Element | null {
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draftByUid, setDraftByUid] = useState<Record<string, AttendanceSelection>>({});
  const [inFlightUids, setInFlightUids] = useState<Record<string, boolean>>({});
  const [savedFlashUids, setSavedFlashUids] = useState<Record<string, boolean>>({});
  const [failedFlashUids, setFailedFlashUids] = useState<Record<string, boolean>>({});

  const aliveRef = useRef(true);
  const draftMapRef = useRef<Record<string, AttendanceSelection>>({});
  const inFlightMapRef = useRef<Record<string, Promise<void>>>({});
  const queuedMapRef = useRef<Record<string, boolean>>({});
  const noteTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const flashTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const idCounterRef = useRef<{ v: number }>({ v: Date.now() });

  const latestRef = useRef({
    eventId,
    eventDocId,
    eventTitle,
    attendanceRecords,
    canManage,
    operatorUid,
    operatorName,
    onReloadAttendance,
    onToast,
  });
  latestRef.current = {
    eventId,
    eventDocId,
    eventTitle,
    attendanceRecords,
    canManage,
    operatorUid,
    operatorName,
    onReloadAttendance,
    onToast,
  };

  const activeRecords = attendanceRecords.filter(isActiveRecord);
  const people = buildUnregPeopleList(activeRecords);
  const peopleByUidRef = useRef<Map<string, UnregPerson>>(new Map());
  const nextPeopleMap = new Map<string, UnregPerson>();
  for (const p of people) {
    nextPeopleMap.set(p.uid, p);
  }
  peopleByUidRef.current = nextPeopleMap;

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
      person: UnregPerson,
      records: readonly RosterAttendanceRecordInput[],
    ): AttendanceSelection => {
      const active = records.filter(isActiveRecord);
      const model = toPersonModel(person);
      const hasCheckin = active.some(
        (r) => str(r.type) === 'checkin' && matchAttendanceRecord(r, model),
      );
      const hasCheckout = active.some(
        (r) => str(r.type) === 'checkout' && matchAttendanceRecord(r, model),
      );
      const noteRec = getLatestAttendanceRecord(active, model, 'note');
      const noteText = noteRec ? str(noteRec.note ?? noteRec.data?.note) : '';
      return normalizeAttendanceSelection({
        checkin: hasCheckin,
        checkout: hasCheckout,
        note: noteText,
      });
    },
    [],
  );

  const getRowSelection = useCallback(
    (person: UnregPerson): AttendanceSelection => {
      const draft = draftMapRef.current[person.uid] ?? draftByUid[person.uid];
      if (draft) return draft;
      return computeActualSelection(person, latestRef.current.attendanceRecords);
    },
    [computeActualSelection, draftByUid],
  );

  const setDraftForUid = useCallback((uid: string, next: AttendanceSelection | null): void => {
    if (next === null) {
      delete draftMapRef.current[uid];
      if (aliveRef.current) {
        setDraftByUid((prev) => {
          if (!(uid in prev)) return prev;
          const copy = { ...prev };
          delete copy[uid];
          return copy;
        });
      }
      return;
    }
    draftMapRef.current[uid] = next;
    if (aliveRef.current) {
      setDraftByUid((prev) => ({ ...prev, [uid]: next }));
    }
  }, []);

  const triggerRowFlash = useCallback((uid: string, kind: 'saved' | 'failed'): void => {
    if (!aliveRef.current) return;
    const timerKey = `${kind}:${uid}`;
    if (flashTimersRef.current[timerKey]) {
      clearTimeout(flashTimersRef.current[timerKey]);
    }
    if (kind === 'saved') {
      setSavedFlashUids((prev) => ({ ...prev, [uid]: true }));
      flashTimersRef.current[timerKey] = setTimeout(() => {
        delete flashTimersRef.current[timerKey];
        if (aliveRef.current) {
          setSavedFlashUids((prev) => {
            if (!prev[uid]) return prev;
            const copy = { ...prev };
            delete copy[uid];
            return copy;
          });
        }
      }, ROW_SAVED_FLASH_MS);
    } else {
      setFailedFlashUids((prev) => ({ ...prev, [uid]: true }));
      flashTimersRef.current[timerKey] = setTimeout(() => {
        delete flashTimersRef.current[timerKey];
        if (aliveRef.current) {
          setFailedFlashUids((prev) => {
            if (!prev[uid]) return prev;
            const copy = { ...prev };
            delete copy[uid];
            return copy;
          });
        }
      }, ROW_FAILED_FLASH_MS);
    }
  }, []);

  const writeForUid = useCallback(
    async (uid: string): Promise<void> => {
      if (!uid) return;
      if (uid in inFlightMapRef.current) {
        queuedMapRef.current[uid] = true;
        return;
      }

      const person = peopleByUidRef.current.get(uid);
      if (!person) return;

      const {
        eventId: curEventId,
        eventDocId: curDocId,
        operatorUid: curOperatorUid,
        attendanceRecords: curRecords,
      } = latestRef.current;

      const wantedRaw =
        draftMapRef.current[uid] ?? computeActualSelection(person, curRecords);
      const wanted = normalizeAttendanceSelection({
        checkin: wantedRaw.checkin,
        checkout: wantedRaw.checkout,
        note: wantedRaw.note.trim().slice(0, 20),
      });

      const baseRecord = {
        eventId: curEventId,
        uid: person.uid,
        userName: person.name,
        participantType: 'self' as const,
        companionId: null,
        companionName: null,
      };
      const timeStr = formatAttendanceDateTime(new Date());
      const ops = collectAttendanceOps(
        { uid: person.uid, name: person.name, isCompanion: false },
        wanted,
        curRecords,
        curEventId,
        timeStr,
        baseRecord,
        idCounterRef.current,
      );

      if (ops.blocked || (ops.adds.length === 0 && ops.removes.length === 0)) {
        return;
      }

      if (!curOperatorUid || !curDocId) {
        setDraftForUid(uid, null);
        triggerRowFlash(uid, 'failed');
        latestRef.current.onToast?.(`${person.name} 儲存失敗，已還原`);
        return;
      }

      if (aliveRef.current) {
        setInFlightUids((prev) => ({ ...prev, [uid]: true }));
      }

      const runPromise = (async () => {
        try {
          await writeAttendanceOps(curDocId, ops, curOperatorUid);
          try {
            if (latestRef.current.onReloadAttendance) {
              const refreshed = await latestRef.current.onReloadAttendance();
              latestRef.current.attendanceRecords = refreshed;
            }
            if (
              !queuedMapRef.current[uid]
              && !noteTimersRef.current[uid]
              && !saveTimersRef.current[uid]
            ) {
              setDraftForUid(uid, null);
            }
          } catch {
            // 重讀失敗保留樂觀草稿
          }
          triggerRowFlash(uid, 'saved');
        } catch {
          setDraftForUid(uid, null);
          triggerRowFlash(uid, 'failed');
          latestRef.current.onToast?.(`${person.name} 儲存失敗，已還原`);
        } finally {
          delete inFlightMapRef.current[uid];
          if (aliveRef.current) {
            setInFlightUids((prev) => {
              if (!prev[uid]) return prev;
              const copy = { ...prev };
              delete copy[uid];
              return copy;
            });
          }
          if (queuedMapRef.current[uid]) {
            delete queuedMapRef.current[uid];
            if (aliveRef.current) {
              void writeForUid(uid);
            }
          }
        }
      })();

      inFlightMapRef.current[uid] = runPromise;
      await runPromise;
    },
    [computeActualSelection, setDraftForUid, triggerRowFlash],
  );

  const scheduleSave = useCallback(
    (uid: string): void => {
      if (saveTimersRef.current[uid]) clearTimeout(saveTimersRef.current[uid]);
      saveTimersRef.current[uid] = setTimeout(() => {
        delete saveTimersRef.current[uid];
        void writeForUid(uid);
      }, CHECKBOX_DEBOUNCE_MS);
    },
    [writeForUid],
  );

  const handleToggleCheckbox = useCallback(
    (person: UnregPerson, field: 'checkin' | 'checkout', checked: boolean): void => {
      const current = getRowSelection(person);
      let nextCheckin = current.checkin;
      let nextCheckout = current.checkout;

      // 對照 A `_bindAttendanceCheckboxLink`
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
      setDraftForUid(person.uid, nextSelection);
      scheduleSave(person.uid);
    },
    [getRowSelection, scheduleSave, setDraftForUid],
  );

  const handleChangeNote = useCallback(
    (person: UnregPerson, noteValue: string): void => {
      const clipped = noteValue.slice(0, 20);
      const current = getRowSelection(person);
      setDraftForUid(person.uid, {
        checkin: current.checkin,
        checkout: current.checkout,
        note: clipped,
      });

      if (noteTimersRef.current[person.uid]) {
        clearTimeout(noteTimersRef.current[person.uid]);
      }
      noteTimersRef.current[person.uid] = setTimeout(() => {
        delete noteTimersRef.current[person.uid];
        scheduleSave(person.uid);
      }, NOTE_DEBOUNCE_MS);
    },
    [getRowSelection, scheduleSave, setDraftForUid],
  );

  const flushInstantSaves = useCallback(async (): Promise<void> => {
    const pendingUids = new Set([
      ...Object.keys(noteTimersRef.current),
      ...Object.keys(saveTimersRef.current),
    ]);
    const pendingWrites: Promise<void>[] = [];
    for (const uid of pendingUids) {
      clearTimeout(noteTimersRef.current[uid]);
      clearTimeout(saveTimersRef.current[uid]);
      delete noteTimersRef.current[uid];
      delete saveTimersRef.current[uid];
      pendingWrites.push(writeForUid(uid));
    }
    if (pendingWrites.length > 0) {
      await Promise.allSettled(pendingWrites);
    }
    let safety = 0;
    while (Object.keys(inFlightMapRef.current).length > 0 && safety < 20) {
      safety += 1;
      await Promise.allSettled(Object.values(inFlightMapRef.current));
    }
  }, [writeForUid]);

  const resetInstantSave = useCallback((): void => {
    for (const timer of Object.values(noteTimersRef.current)) clearTimeout(timer);
    for (const timer of Object.values(saveTimersRef.current)) clearTimeout(timer);
    noteTimersRef.current = {};
    saveTimersRef.current = {};
    queuedMapRef.current = {};
    draftMapRef.current = {};
    if (aliveRef.current) {
      setDraftByUid({});
    }
  }, []);

  if (people.length === 0) {
    return null;
  }

  const tableEditing = Boolean(canManage && editing);
  const isSubmitting = Boolean(canManage && submitting);
  const kickStyle =
    'font-size:.7rem;padding:.2rem .4rem;border:1px solid var(--danger);color:var(--danger);background:transparent;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap'
    + (isSubmitting ? ';opacity:.65;cursor:not-allowed' : '');
  const noteInputStyle =
    'width:100%;font-size:.72rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:3px;box-sizing:border-box'
    + (isSubmitting ? ';opacity:.7;cursor:not-allowed' : '');

  function handleStartEdit(): void {
    if (!latestRef.current.canManage) {
      latestRef.current.onToast?.('權限不足');
      return;
    }
    resetInstantSave();
    setEditing(true);
  }

  async function handleCloseEdit(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      await flushInstantSaves();
      if (CALLABLES_DEPLOYED && aliveRef.current) {
        latestRef.current.onToast?.('儲存完成');
      }
    } finally {
      resetInstantSave();
      if (aliveRef.current) {
        setSubmitting(false);
        setEditing(false);
      }
    }
  }

  async function handleRemoveUnregUser(person: UnregPerson): Promise<void> {
    if (!latestRef.current.canManage || !latestRef.current.operatorUid) {
      latestRef.current.onToast?.('權限不足');
      return;
    }
    const confirmed = await appConfirm(`確定要將 ${person.name} 從未報名單中移除嗎？`);
    if (!confirmed || !aliveRef.current) return;

    await flushInstantSaves();
    if (!aliveRef.current) return;

    const curRecords = latestRef.current.attendanceRecords.filter(isActiveRecord);
    const model = toPersonModel(person);
    // 對照 A `_removeUnregUser`：軟刪除該用戶於此活動的所有有效出席紀錄（unreg / checkin / checkout / note）
    const targets = curRecords.filter(
      (r) => str(r.uid) === person.uid || matchAttendanceRecord(r, model),
    );

    const curDocId = latestRef.current.eventDocId;
    const curOperatorUid = latestRef.current.operatorUid;
    for (const rec of targets) {
      const recDocId = str(rec._docId) || str(rec.id);
      if (!recDocId || !curDocId || !curOperatorUid) continue;
      await removeAttendance(curDocId, recDocId, curOperatorUid).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[removeUnregUser]', err);
      });
    }

    await writeOpLog({
      type: 'unreg_removed',
      typeName: '移除未報名掃碼',
      content: `從「${latestRef.current.eventTitle}」移除 ${person.name}`,
      actorUid: curOperatorUid,
      operator: str(latestRef.current.operatorName) || '管理員',
    });

    if (latestRef.current.onReloadAttendance) {
      await latestRef.current.onReloadAttendance().catch(() => {});
    }
    if (aliveRef.current) {
      latestRef.current.onToast?.(`已將 ${person.name} 從未報名單中移除`);
    }
  }

  function renderTopButton(): JSX.Element | null {
    if (!canManage) return null;
    if (tableEditing) {
      const finishStyle = `font-size:.75rem;padding:.25rem .6rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);${
        isSubmitting ? 'cursor:not-allowed;opacity:.72' : 'cursor:pointer'
      }`;
      return (
        <button
          type="button"
          style={finishStyle}
          disabled={isSubmitting}
          onClick={() => {
            handleCloseEdit().catch(() => {});
          }}
        >
          {isSubmitting ? '儲存中...' : CALLABLES_DEPLOYED ? '完成' : '關閉編輯'}
        </button>
      );
    }
    return (
      <button
        type="button"
        style="font-size:.75rem;padding:.25rem .6rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer"
        onClick={handleStartEdit}
      >
        編輯
      </button>
    );
  }

  function renderLegacySettleBanner(): JSX.Element | null {
    if (!tableEditing || CALLABLES_DEPLOYED) return null;
    return (
      <div
        role="note"
        style="display:flex;align-items:center;flex-wrap:wrap;gap:.4rem;margin:.25rem 0 .45rem;padding:.25rem .5rem;border-radius:var(--radius-sm);background:rgba(245,158,11,.14);color:var(--text-primary);font-size:.75rem;line-height:1.4"
      >
        <span>請在舊版按完成以結算經驗值與放鴿子</span>
        <a
          href={LEGACY_SETTLE_URL}
          target="_blank"
          rel="noopener noreferrer"
          style="color:var(--primary, #1565c0);font-weight:600;text-decoration:underline;white-space:nowrap"
        >
          前往舊版
        </a>
      </div>
    );
  }

  const topBtn = renderTopButton();
  const headerTitle = `未報名單（${people.length}）`;

  return (
    <div style="overflow-x:auto">
      {renderLegacySettleBanner()}
      <table style="width:100%;border-collapse:collapse;font-size:.8rem;table-layout:fixed">
        <thead>
          <tr style="border-bottom:2px solid var(--border)">
            {tableEditing && (
              <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2rem">踢</th>
            )}
            <th style="text-align:left;padding:.4rem .3rem;font-weight:600">
              {topBtn ? (
                <div style="display:flex;align-items:center;gap:.4rem;white-space:nowrap">
                  {headerTitle}
                  {topBtn}
                </div>
              ) : (
                headerTitle
              )}
            </th>
            <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
            <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
            <th style="text-align:left;padding:.4rem .3rem;font-weight:600;width:4.5rem">備註</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const model = toPersonModel(p);
            const hasCheckin = activeRecords.some(
              (r) => str(r.type) === 'checkin' && matchAttendanceRecord(r, model),
            );
            const hasCheckout = activeRecords.some(
              (r) => str(r.type) === 'checkout' && matchAttendanceRecord(r, model),
            );
            const noteRec = getLatestAttendanceRecord(activeRecords, model, 'note');
            const noteText = noteRec ? str(noteRec.note ?? noteRec.data?.note) : '';
            const combinedNote = ['未報名', noteText].filter(Boolean).join('・');
            const flashClass = savedFlashUids[p.uid]
              ? 'att-row-saved'
              : failedFlashUids[p.uid]
                ? 'att-row-failed'
                : '';

            if (tableEditing) {
              const sel = getRowSelection(p);
              const rowBusy = isSubmitting || Boolean(inFlightUids[p.uid]);
              const checkinId = `unreg-checkin-${p.uid}`;
              const checkoutId = `unreg-checkout-${p.uid}`;
              const noteId = `unreg-note-${p.uid}`;

              return (
                <tr
                  key={p.uid}
                  data-uid={p.uid}
                  class={flashClass || undefined}
                  style="border-bottom:1px solid var(--border)"
                >
                  <td style="padding:.35rem .2rem;text-align:center">
                    <button
                      type="button"
                      style={kickStyle}
                      disabled={isSubmitting}
                      onClick={() => {
                        handleRemoveUnregUser(p).catch(() => {});
                      }}
                    >
                      踢掉
                    </button>
                  </td>
                  <td style="padding:.35rem .3rem;text-align:left" data-no-translate>
                    {p.name}
                  </td>
                  <td style="padding:.35rem .2rem;text-align:center">
                    <input
                      type="checkbox"
                      id={checkinId}
                      class="att-cb"
                      checked={sel.checkin}
                      disabled={rowBusy}
                      aria-label={`${p.name} 簽到`}
                      onChange={(e) => {
                        handleToggleCheckbox(p, 'checkin', e.currentTarget.checked);
                      }}
                    />
                    <label for={checkinId} class="att-lbl">
                      <span class="att-box" />
                    </label>
                  </td>
                  <td style="padding:.35rem .2rem;text-align:center">
                    <input
                      type="checkbox"
                      id={checkoutId}
                      class="att-cb"
                      checked={sel.checkout}
                      disabled={rowBusy}
                      aria-label={`${p.name} 簽退`}
                      onChange={(e) => {
                        handleToggleCheckbox(p, 'checkout', e.currentTarget.checked);
                      }}
                    />
                    <label for={checkoutId} class="att-lbl">
                      <span class="att-box" />
                    </label>
                  </td>
                  <td style="padding:.35rem .3rem">
                    <input
                      type="text"
                      maxLength={20}
                      value={sel.note}
                      id={noteId}
                      placeholder="備註"
                      disabled={isSubmitting}
                      style={noteInputStyle}
                      aria-label={`${p.name} 備註`}
                      onInput={(e) => {
                        handleChangeNote(p, e.currentTarget.value);
                      }}
                    />
                  </td>
                </tr>
              );
            }

            return (
              <tr
                key={p.uid}
                class={flashClass || undefined}
                style="border-bottom:1px solid var(--border)"
              >
                <td style="padding:.35rem .3rem;text-align:left" data-no-translate>
                  {p.name}
                </td>
                <td style="padding:.35rem .2rem;text-align:center">
                  {hasCheckin ? (
                    <span style="color:var(--success);font-size:1rem">✓</span>
                  ) : null}
                </td>
                <td style="padding:.35rem .2rem;text-align:center">
                  {hasCheckout ? (
                    <span style="color:var(--success);font-size:1rem">✓</span>
                  ) : null}
                </td>
                <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">
                  {combinedNote}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
