import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { toast } from '@/ui/Toast';
import {
  canOperateEventSite,
  type OperateContext,
} from '@/features/events/data/operate-permissions';
import { isAdminPlusRole } from '@/features/profile/components/legacy/profile-legacy-helpers';

import type { ScanEventEntry } from './data/scan-events';
import {
  findScanUser,
  loadScanRegistrations,
  type ScanUser,
} from './data/scan-reads';
import {
  buildFamilyCheckinRecords,
  commitAttendanceBatch,
  decideScanAction,
  loadEventAttendance,
  shouldUseFamilyFlow,
  type AttendanceWritePayload,
  type EventAttendanceEntry,
  type FamilyMemberSelection,
  type ScanMode,
  type ScanRegistration,
} from './data/attendance';
import type { QrScanner, ScannerFailure } from './scanner';
import { fillText, useCheckinText, type CheckinTextKey } from './useCheckinText';

interface Popup {
  tone: 'success' | 'warning' | 'error';
  key: CheckinTextKey;
  name?: string;
  count?: number;
  mode?: ScanMode;
}

interface Family {
  user: ScanUser;
  mode: ScanMode;
  registrations: ScanRegistration[];
  selected: Set<string>;
}

interface ScanPerson {
  key: string;
  uid: string;
  name: string;
  checkin: boolean;
  checkout: boolean;
  unreg: boolean;
}

interface SessionProps {
  entry: ScanEventEntry;
  context: OperateContext;
  mode: ScanMode;
}

const memberKey = (id: string | null | undefined): string => JSON.stringify(id ?? null);

function inflightKey(record: { uid: string; type: string; companionId?: string | null }): string {
  return `${record.uid}\0${record.type}\0${record.companionId ?? ''}`;
}

interface LocalWrite {
  writeId: number;
  entry: EventAttendanceEntry;
}

interface AckedWrite {
  /** 寫入完成當下的讀取序號。比這次讀取更早開始的快照可能還沒看到它。 */
  epoch: number;
  entry: EventAttendanceEntry;
}

function activeAttendance(records: readonly EventAttendanceEntry[]): EventAttendanceEntry[] {
  return records.filter((record) =>
    record.status !== 'removed' && record.status !== 'cancelled');
}

function entryFromWrite(record: AttendanceWritePayload, docId: string): EventAttendanceEntry {
  const companionId = record.companionId ?? null;
  const companionName = record.companionName ?? null;
  return {
    _docId: docId,
    uid: record.uid,
    userName: record.userName,
    companionId,
    companionName,
    displayName: companionName || record.userName,
    type: record.type,
    time: record.time,
    status: record.status ?? 'active',
    data: {},
  };
}

/** 照 A `_renderScanResults`、`_renderAttendanceSections`。 */
export function buildScanView(
  entry: ScanEventEntry,
  records: readonly EventAttendanceEntry[],
  registrations: readonly ScanRegistration[],
  role: OperateContext['role'],
  fallback: string,
) {
  const nameOf = (name: string | null | undefined, uid: string): string =>
    name?.trim() || (isAdminPlusRole(role) ? uid.trim() : '') || fallback;

  const active = records.filter((record) =>
    record.status !== 'removed' && record.status !== 'cancelled');

  const results = [...active]
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''))
    .map((record) => ({
      record,
      name: nameOf(record.companionName || record.userName, record.uid),
    }));

  const confirmed = registrations.filter((row) => row.status === 'confirmed');
  const counts = new Map<string, number>();
  for (const row of confirmed) {
    if (row.userId) counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
  }

  const people = new Map<string, ScanPerson>();
  for (const record of active) {
    const key = record.companionId
      ? `${record.uid}_${record.companionId}`
      : record.uid;
    const person = people.get(key) ?? {
      key,
      uid: record.uid,
      name: nameOf(
        record.companionId ? record.companionName || record.userName : record.userName,
        record.uid,
      ),
      checkin: false,
      checkout: false,
      unreg: false,
    };
    if (record.type === 'checkin') person.checkin = true;
    if (record.type === 'checkout') person.checkout = true;
    if (record.type === 'unreg') person.unreg = true;
    people.set(key, person);
  }

  const registeredPeople = [...people.values()].filter((person) => !person.unreg);
  const unregistered = [...people.values()].filter((person) => person.unreg);
  const grouped = new Map<string, ScanPerson>();
  for (const person of registeredPeople) {
    const previous = grouped.get(person.uid);
    if (previous) {
      previous.checkin ||= person.checkin;
      previous.checkout ||= person.checkout;
    } else {
      grouped.set(person.uid, { ...person });
    }
  }

  const registered = [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  unregistered.sort((a, b) => a.name.localeCompare(b.name));

  const raw = entry.event as unknown as { current?: unknown; participants?: unknown };
  const current = Number(raw.current || 0);
  const total = current > 0
    ? current
    : confirmed.length || (Array.isArray(raw.participants) ? raw.participants.length : 0);
  const checkins = registeredPeople.filter((person) => person.checkin).length;
  const checkouts = registeredPeople.filter((person) => person.checkout).length;

  return {
    active,
    results,
    counts,
    registered,
    unregistered,
    total,
    checkins,
    checkouts,
    rate: total > 0 ? Math.round(checkins / total * 100) : 0,
  };
}

export function ScanSession({ entry, context, mode }: SessionProps) {
  const t = useCheckinText();
  const permitted = !!context.uid && canOperateEventSite(context, entry.event);
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScanner | null>(null);
  const alive = useRef(true);
  const locked = useRef(false);
  const familyRef = useRef<Family | null>(null);
  const readSequence = useRef(0);
  const cameraSequence = useRef(0);
  const epoch = useRef(0);
  const identity = useRef({
    uid: context.uid,
    docId: entry.docId,
    eventId: entry.eventId,
    permitted,
  });

  // 換人、換活動或權限失效後，即使稍後恢復也不接受舊請求。
  if (
    identity.current.uid !== context.uid
    || identity.current.docId !== entry.docId
    || identity.current.eventId !== entry.eventId
    || identity.current.permitted !== permitted
  ) {
    epoch.current += 1;
    identity.current = {
      uid: context.uid,
      docId: entry.docId,
      eventId: entry.eventId,
      permitted,
    };
  }

  const latest = useRef({ entry, context, mode, t });
  latest.current = { entry, context, mode, t };

  const [records, setRecords] = useState<EventAttendanceEntry[]>([]);
  const [registrations, setRegistrations] = useState<ScanRegistration[]>([]);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on'>('off');
  const [cameraError, setCameraError] = useState<CheckinTextKey | null>(null);
  const [manualVisible, setManualVisible] = useState(false);
  const [uid, setUid] = useState('');
  const [popup, setPopup] = useState<Popup | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const recordsRef = useRef<EventAttendanceEntry[]>([]);
  const regsRef = useRef<ScanRegistration[]>([]);
  const inflight = useRef(new Map<string, LocalWrite>());
  const acked = useRef(new Map<string, AckedWrite>());
  const writeSeq = useRef(0);
  const popupOwner = useRef<string | null>(null);

  const allowed = (): boolean =>
    alive.current
    && !!latest.current.context.uid
    && canOperateEventSite(latest.current.context, latest.current.entry.event);

  const guard = (): (() => boolean) => {
    const current = epoch.current;
    return () => current === epoch.current && allowed();
  };

  const mergeAttendance = (
    server: readonly EventAttendanceEntry[],
    readEpoch: number,
    publish: boolean,
  ): EventAttendanceEntry[] => {
    const activeKeys = new Set(activeAttendance(server).map((record) => inflightKey(record)));
    const extras: EventAttendanceEntry[] = [];
    const seen = new Set<string>();
    for (const [key, item] of inflight.current) {
      if (activeKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      extras.push(item.entry);
    }
    for (const [key, item] of acked.current) {
      const onServer = activeKeys.has(key);
      // 這次讀取開始後才寫完、伺服器快照還沒有：留在畫面上，避免下一碼把簽到蓋掉又重寫。
      const snapshotMissedWrite = item.epoch >= readEpoch && !onServer;
      if (!snapshotMissedWrite) {
        if (publish) acked.current.delete(key);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      extras.push(item.entry);
    }
    return [...extras, ...server];
  };

  const publishRecords = (next: EventAttendanceEntry[]): void => {
    recordsRef.current = next;
    if (alive.current) setRecords(next);
  };

  const applyRead = (
    serverRecords: readonly EventAttendanceEntry[],
    serverRegs: readonly ScanRegistration[],
    sequence: number,
    readEpoch: number,
    valid: () => boolean,
  ): EventAttendanceEntry[] => {
    const publish = valid() && sequence === readSequence.current;
    const merged = mergeAttendance(serverRecords, readEpoch, publish);
    if (publish) {
      recordsRef.current = merged;
      regsRef.current = [...serverRegs];
      if (alive.current) {
        setRecords(merged);
        setRegistrations([...serverRegs]);
      }
    }
    return merged;
  };

  const refresh = async (valid = guard()): Promise<boolean> => {
    if (!valid()) return false;
    const sequence = ++readSequence.current;
    const docId = latest.current.entry.docId;
    try {
      const [nextRecords, nextRegistrations] = await Promise.all([
        loadEventAttendance(docId),
        loadScanRegistrations(docId),
      ]);
      if (!valid() || sequence !== readSequence.current) return false;
      applyRead(nextRecords, nextRegistrations, sequence, sequence, valid);
      return true;
    } catch {
      if (valid() && sequence === readSequence.current) {
        toast.show(latest.current.t('loadError'));
      }
      return false;
    }
  };

  const stopCamera = (): void => {
    cameraSequence.current += 1;
    scanner.current?.stop();
    scanner.current = null;
    if (alive.current) setCamera('off');
  };

  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      epoch.current += 1;
      readSequence.current += 1;
      cameraSequence.current += 1;
      scanner.current?.stop();
      scanner.current = null;
      familyRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    stopCamera();
    familyRef.current = null;
    recordsRef.current = [];
    regsRef.current = [];
    inflight.current.clear();
    acked.current.clear();
    popupOwner.current = null;
    setFamily(null);
    setPopup(null);
    setRecords([]);
    setRegistrations([]);
    setUid('');
  }, [context.uid, entry.docId, entry.eventId, permitted]);

  useEffect(() => {
    if (!permitted) return;
    refresh().catch(() => {
      if (allowed()) toast.show(latest.current.t('loadError'));
    });
  }, [context.uid, entry.docId, entry.eventId, permitted]);

  const closePopup = (): void => {
    popupOwner.current = null;
    setPopup(null);
  };

  const closeFamily = (): boolean => {
    if (locked.current) return false;
    familyRef.current = null;
    setFamily(null);
    return true;
  };

  const closeRef = useRef({ closePopup, closeFamily });
  closeRef.current = { closePopup, closeFamily };
  const overlayKind = family ? 'family' : popup ? 'result' : null;

  // 照 A 彈窗；沿用 CompanionCancelModal 的返回鍵生命週期。
  useLayoutEffect(() => {
    if (!overlayKind) return;
    return pushOverlay(() => {
      if (overlayKind === 'family') return closeRef.current.closeFamily();
      closeRef.current.closePopup();
      return true;
    });
  }, [overlayKind]);

  const showPopup = (value: Popup, ownerUid: string | null = null): void => {
    if (!allowed()) return;
    popupOwner.current = ownerUid;
    setPopup(value);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(value.tone === 'success' ? 80 : 300);
      }
    } catch {
      // U-033：不支援震動時略過。
    }
  };

  const begin = (): boolean => {
    if (!allowed()) {
      if (alive.current) toast.show(latest.current.t('noPermission'));
      return false;
    }
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    return true;
  };

  const finish = (): void => {
    locked.current = false;
    if (alive.current) setBusy(false);
  };

  const clearWrite = (keys: readonly string[], writeId: number): void => {
    for (const key of keys) {
      const item = inflight.current.get(key);
      if (item && item.writeId === writeId) inflight.current.delete(key);
    }
  };

  const runWrite = (
    docId: string,
    toWrite: readonly AttendanceWritePayload[],
    optimisticIds: readonly string[],
    keys: readonly string[],
    writeId: number,
    ownerUid: string,
    valid: () => boolean,
  ): void => {
    // 不等這次 Promise：onScan 在顯示結果後即可 resolve，鏡頭才能掃下一碼。
    void commitAttendanceBatch(docId, toWrite)
      .then((ids) => {
        if (!valid()) {
          clearWrite(keys, writeId);
          return;
        }
        const renamed = new Map(optimisticIds.map((id, index) => [id, ids[index] ?? id]));
        const rename = (record: EventAttendanceEntry): EventAttendanceEntry => {
          const nextId = renamed.get(record._docId);
          return nextId && nextId !== record._docId ? { ...record, _docId: nextId } : record;
        };
        for (const key of keys) {
          const item = inflight.current.get(key);
          if (!item || item.writeId !== writeId) continue;
          inflight.current.delete(key);
          acked.current.set(key, { epoch: readSequence.current, entry: rename(item.entry) });
        }
        const next = recordsRef.current.map(rename);
        const present = new Set(next.map((record) => inflightKey(record)));
        const missing: EventAttendanceEntry[] = [];
        for (const key of keys) {
          const item = acked.current.get(key);
          if (item && !present.has(key)) missing.push(item.entry);
        }
        publishRecords([...missing, ...next]);
      })
      .catch(() => {
        clearWrite(keys, writeId);
        if (!valid()) return;
        const drop = new Set(optimisticIds);
        publishRecords(recordsRef.current.filter((record) => !drop.has(record._docId)));
        if (popupOwner.current === ownerUid) {
          popupOwner.current = null;
          setPopup(null);
        }
        toast.show(latest.current.t('writeError'));
        // 失敗後背景重讀，不擋下一碼；讓畫面回到伺服器上的出席。
        void refresh(valid);
      });
  };

  const processUid = async (input: string): Promise<void> => {
    // ASSUMPTION: 家庭彈窗開啟時忽略新碼，避免覆蓋尚未送出的勾選。
    if (familyRef.current || !begin()) return;
    const valid = guard();
    const selectedEntry = latest.current.entry;
    const operatorUid = latest.current.context.uid;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      finish();
    };

    try {
      if (!operatorUid) return;
      // 查人與出席、報名同時讀。進場那次載入只供列表，不能拿來判斷這一碼。
      const sequence = ++readSequence.current;
      const [user, serverRecords, serverRegs] = await Promise.all([
        findScanUser(input, operatorUid),
        loadEventAttendance(selectedEntry.docId),
        loadScanRegistrations(selectedEntry.docId),
      ]);
      if (!valid()) return;
      const merged = applyRead(serverRecords, serverRegs, sequence, sequence, valid);
      if (!user) {
        showPopup({ tone: 'error', key: 'unknownUser' });
        return;
      }

      const regs = serverRegs;
      const active = activeAttendance(merged);

      if (shouldUseFamilyFlow(regs, user.uid)) {
        const familyMode = latest.current.mode;
        const own = regs.filter((row) =>
          row.userId === user.uid && row.status === 'confirmed');
        const selected = new Set(own.filter((row) =>
          !active.some((record) =>
            record.uid === user.uid
            && record.type === familyMode
            && (record.companionId ?? null) === (row.companionId ?? null),
          ),
        ).map((row) => memberKey(row.companionId)));
        const nextFamily: Family = {
          user,
          mode: familyMode,
          registrations: own,
          selected,
        };
        familyRef.current = nextFamily;
        popupOwner.current = null;
        setPopup(null);
        setFamily(nextFamily);
        return;
      }

      const decision = decideScanAction({
        eventId: selectedEntry.eventId,
        // 照 A `_processAttendance`：同 UID 或同名的 confirmed 報名、或 participants 含名字都算已報名（決策在 attendance.ts，不改語意）。
        // EventDoc 型別未宣告 participants（A 的舊欄位），只取 decideScanAction 需要的部分。
        event: { participants: (selectedEntry.event as Record<string, unknown>).participants },
        registrations: regs,
        uid: user.uid,
        userName: user.name,
        // 照 A `_processAttendance`；這次讀完才取最新模式。
        mode: latest.current.mode,
        attendance: active,
        now: new Date(),
      });

      // 寫入尚未確認前，同一筆不得再送一次。仍在寫入的本地紀錄已併進這次出席。
      const toWrite = decision.records.filter((record) => !inflight.current.has(inflightKey(record)));
      const writeId = toWrite.length > 0 ? ++writeSeq.current : 0;
      const optimistic = toWrite.map((record) => entryFromWrite(record, `pending:${record.id}`));
      const keys = toWrite.map((record) => inflightKey(record));
      if (toWrite.length > 0) {
        for (let index = 0; index < keys.length; index += 1) {
          const key = keys[index];
          const entry = optimistic[index];
          if (!key || !entry) continue;
          inflight.current.set(key, { writeId, entry });
        }
        const keySet = new Set(keys);
        publishRecords([
          ...optimistic,
          ...recordsRef.current.filter((record) => !keySet.has(inflightKey(record))),
        ]);
      }
      showPopup({
        tone: decision.resultClass,
        key: decision.reasonKey,
        name: user.name,
      }, user.uid);
      // 結果已顯示就解鎖，下一碼不必等寫入；同碼去重仍在掃描器。
      release();
      if (toWrite.length === 0) return;
      // ASSUMPTION: 第一筆寫入開始後維持這次完整決策，避免模式切換造成半套 payload。
      runWrite(
        selectedEntry.docId,
        toWrite,
        optimistic.map((record) => record._docId),
        keys,
        writeId,
        user.uid,
        valid,
      );
    } catch {
      if (!valid()) return;
      toast.show(latest.current.t('loadError'));
    } finally {
      release();
    }
  };

  const processRef = useRef(processUid);
  processRef.current = processUid;

  const startCamera = async (): Promise<void> => {
    if (!allowed()) {
      if (alive.current) toast.show(latest.current.t('noPermission'));
      return;
    }
    if (!video.current) return;
    stopCamera();
    const request = ++cameraSequence.current;
    const valid = guard();
    setCamera('starting');
    setCameraError(null);

    const fail = (code: ScannerFailure): void => {
      if (!valid() || request !== cameraSequence.current) return;
      const key: CheckinTextKey = !window.isSecureContext
        ? 'cameraHttps'
        : code === 'denied'
          ? 'cameraDenied'
          : code === 'unsupported'
            ? 'cameraUnsupported'
            : /Line\//i.test(navigator.userAgent) && /Android/i.test(navigator.userAgent)
              ? 'cameraLineAndroid'
              : 'cameraFailed';
      stopCamera();
      setCameraError(key);
      setManualVisible(true);
      toast.show(latest.current.t(key));
    };

    if (!window.isSecureContext) {
      fail('failed');
      return;
    }

    try {
      const { createQrScanner, scannerFailure } = await import('./scanner');
      if (!valid() || request !== cameraSequence.current || !video.current) return;
      const instance = createQrScanner({
        video: video.current,
        onScan: (value) => {
          if (!valid() || request !== cameraSequence.current) return;
          return processRef.current(value.trim());
        },
        onError: fail,
      });
      scanner.current = instance;
      try {
        await instance.start();
        if (!valid() || request !== cameraSequence.current) {
          instance.stop();
          return;
        }
        setCamera('on');
      } catch (error: unknown) {
        if (!valid() || request !== cameraSequence.current) return;
        fail(scannerFailure(error));
      }
    } catch {
      if (!valid() || request !== cameraSequence.current) return;
      fail('failed');
    }
  };

  const confirmFamily = async (): Promise<void> => {
    const chosen = familyRef.current;
    if (!chosen || !begin()) return;
    const valid = guard();
    const selectedEntry = latest.current.entry;
    let writing = false;

    try {
      if (chosen.selected.size === 0) {
        toast.show(latest.current.t('selectMembers'));
        return;
      }

      // 送出前重讀報名（家庭報名資料已變更）與出席，並把仍在寫入的本地紀錄併回來。
      const sequence = ++readSequence.current;
      const [serverRecords, regs] = await Promise.all([
        loadEventAttendance(selectedEntry.docId),
        loadScanRegistrations(selectedEntry.docId),
      ]);
      if (!valid()) return;
      const merged = applyRead(serverRecords, regs, sequence, sequence, valid);

      const own = regs.filter((row) =>
        row.userId === chosen.user.uid && row.status === 'confirmed');
      // 照 A `_confirmFamilyCheckin`；保留 B 的報名變更防護。
      const previousSnapshot = chosen.registrations.map((row) => JSON.stringify([
        row.userId, row.companionId ?? null, row.companionName ?? null,
        row.userName ?? null, row.status,
      ])).sort();
      const currentSnapshot = own.map((row) => JSON.stringify([
        row.userId, row.companionId ?? null, row.companionName ?? null,
        row.userName ?? null, row.status,
      ])).sort();
      if (JSON.stringify(previousSnapshot) !== JSON.stringify(currentSnapshot)) {
        toast.show(latest.current.t('familyChanged'));
        return;
      }

      const unique = new Map<string, FamilyMemberSelection>();
      for (const row of own) {
        const key = memberKey(row.companionId);
        if (!chosen.selected.has(key)) continue;
        unique.set(key, {
          companionId: row.companionId ?? null,
          // 照 A `_showFamilyCheckinMenu`：data-name 是 `companionName || userName`，同行者寫入的 companionName 就是它（空字串也改用 userName）。
          companionName: row.companionName || row.userName || null,
          displayName: row.companionName || row.userName || chosen.user.name,
        });
      }
      if (unique.size !== chosen.selected.size) {
        toast.show(latest.current.t('familyChanged'));
        return;
      }

      const values = buildFamilyCheckinRecords({
        eventId: selectedEntry.eventId,
        uid: chosen.user.uid,
        userName: chosen.user.name,
        mode: chosen.mode,
        members: [...unique.values()],
        attendance: activeAttendance(merged),
        now: new Date(),
      });

      if (values.length > 0) {
        writing = true;
        const writeId = ++writeSeq.current;
        const pending = values.map((value) => entryFromWrite(value, `pending:${value.id}`));
        const keys = values.map((value) => inflightKey(value));
        for (let index = 0; index < keys.length; index += 1) {
          const key = keys[index];
          const entry = pending[index];
          if (!key || !entry) continue;
          inflight.current.set(key, { writeId, entry });
        }
        try {
          const ids = await commitAttendanceBatch(selectedEntry.docId, values);
          if (!valid()) {
            clearWrite(keys, writeId);
            return;
          }
          clearWrite(keys, writeId);
          const added = values.map((value, index) =>
            entryFromWrite(value, ids[index] ?? `pending:${value.id}`));
          for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index];
            const entry = added[index];
            if (!key || !entry) continue;
            acked.current.set(key, { epoch: readSequence.current, entry });
          }
          const keySet = new Set(keys);
          publishRecords([
            ...added,
            ...recordsRef.current.filter((record) => !keySet.has(inflightKey(record))),
          ]);
        } catch (error) {
          clearWrite(keys, writeId);
          throw error;
        }
      }
      if (!valid()) return;
      familyRef.current = null;
      setFamily(null);
      showPopup({
        tone: 'success',
        key: 'familySuccess',
        name: chosen.user.name,
        count: unique.size,
        mode: chosen.mode,
      }, chosen.user.uid);
    } catch {
      if (!valid()) return;
      if (writing) {
        toast.show(latest.current.t('writeError'));
        void refresh(valid);
        return;
      }
      toast.show(latest.current.t('loadError'));
    } finally {
      finish();
    }
  };

  const submitManual = (): void => {
    const value = uid.trim();
    if (!value) {
      toast.show(t('enterUid'));
      return;
    }
    setUid('');
    processUid(value).catch(() => {
      if (allowed()) toast.show(latest.current.t('writeError'));
    });
  };

  const view = buildScanView(entry, records, registrations, context.role, t('userFallback'));

  if (!permitted) return null;

  return (
    <>
      <div class="scan-camera">
        <div class="scan-qr-reader" id="scan-qr-reader">
          <video ref={video} muted playsInline hidden={camera === 'off'} />
          {camera === 'off' && (
            cameraError
              ? <span style="color:var(--danger);font-size:.82rem;">{t(cameraError)}</span>
              : <span style="color:var(--text-muted);font-size:.85rem;">{t('cameraHint')}</span>
          )}
        </div>
        <button
          type="button"
          class="scan-camera-btn"
          id="scan-camera-btn"
          onClick={() => {
            if (camera !== 'off') {
              stopCamera();
              setCameraError(null);
            } else {
              startCamera().catch(() => {
                if (allowed()) toast.show(latest.current.t('cameraFailed'));
              });
            }
          }}
        >
          {t(camera === 'off' ? 'startCamera' : 'stopCamera')}
        </button>
      </div>

      {manualVisible && (
        <div
          id="scan-manual-section"
          style="margin-top:.8rem;padding:.6rem .8rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-elevated)"
        >
          <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.4rem">
            {t('manual')}
          </div>
          <div style="display:flex;gap:.4rem">
            <input
              type="text"
              id="scan-manual-uid"
              placeholder={t('manualPlaceholder')}
              autoComplete="off"
              style="flex:1;padding:.35rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:.85rem;background:var(--bg);color:var(--text-primary)"
              value={uid}
              onInput={(event) => setUid(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                submitManual();
              }}
            />
            <button
              type="button"
              class="primary-btn"
              style="padding:.35rem .7rem;font-size:.82rem"
              onClick={submitManual}
            >
              {t('confirm')}
            </button>
          </div>
        </div>
      )}

      <div class="scan-results" id="scan-results" aria-busy={busy}>
        {view.results.map(({ record, name }) => (
          <div
            key={record._docId}
            class={`scan-result ${record.type === 'checkin' || record.type === 'checkout' ? 'success' : 'error'}`}
            data-no-translate
          >
            {fillText(t(record.type === 'checkin'
              ? 'checkin.success'
              : record.type === 'checkout'
                ? 'checkout.success'
                : 'resultUnregistered'), { name })}
          </div>
        ))}
      </div>

      <div class="scan-stats" id="scan-stats">
        <span>{t('statTotal')}<strong>{view.total}</strong></span>
        <span>{t('statCheckin')}<strong>{view.checkins}</strong></span>
        <span>{t('statCheckout')}<strong>{view.checkouts}</strong></span>
        <span>{t('statUnregistered')}<strong>{view.unregistered.length}</strong></span>
        <span>{t('statRate')}<strong>{view.rate}%</strong></span>
      </div>

      {([
        { id: 'scan-registered-section', unreg: false, people: view.registered },
        { id: 'scan-unreg-section', unreg: true, people: view.unregistered },
      ] as const).map((section) => (
        <div id={section.id} key={section.id}>
          {(!section.unreg || section.people.length > 0) && (
            <div class={`scan-section ${section.unreg ? 'scan-section-unreg' : 'scan-section-registered'}`}>
              <h4>
                {fillText(t(section.unreg ? 'unregisteredTitle' : 'registeredTitle'), {
                  count: section.people.length,
                })}
              </h4>
              <div class="scan-user-tags">
                {section.people.length === 0 && (
                  <span style="font-size:.78rem;color:var(--text-muted)">{t('none')}</span>
                )}
                {section.people.map((person) => (
                  <span
                    key={person.key}
                    class={`scan-user-tag${person.checkin || person.checkout ? ' has-checks' : ''}`}
                    data-no-translate
                  >
                    {person.name}
                    {!section.unreg && (view.counts.get(person.uid) ?? 0) > 1
                      ? ` *${view.counts.get(person.uid)}`
                      : ''}
                    {(person.checkin || person.checkout) && (
                      <span class="scan-tag-checks">
                        {person.checkin && <span class="scan-check scan-check-in">✓</span>}
                        {person.checkout && (
                          <span class={`scan-check ${section.unreg ? 'scan-check-out-unreg' : 'scan-check-out-ok'}`}>
                            ✓
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {popup && (
        <div
          class="scan-result-overlay open"
          id="scan-result-modal"
          onTouchMove={(event) => {
            if (!(event.target instanceof Element)
              || !event.target.closest('.scan-result-box')) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <div class={`scan-result-box ${popup.tone}`} id="scan-result-box">
            <div class="scan-result-icon" id="scan-result-icon">
              {popup.tone === 'success' ? '✅' : popup.tone === 'warning' ? '⚠️' : '❌'}
            </div>
            <div class="scan-result-title" id="scan-result-title">
              {fillText(t(popup.key), {
                name: popup.name ?? '',
                count: popup.count ?? 0,
                mode: t(popup.mode ?? mode),
              })}
            </div>
            <div class="scan-result-name" id="scan-result-name">{entry.title}</div>
            <button type="button" class="scan-result-close" onClick={closePopup}>
              {t('confirm')}
            </button>
          </div>
        </div>
      )}

      {family && (
        <div
          class="scan-result-overlay open"
          id="scan-family-modal"
          onTouchMove={(event) => {
            if (!(event.target instanceof Element)
              || !event.target.closest('.scan-result-box')) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <div class="scan-result-box" style="max-width:360px;text-align:left">
            <div id="scan-family-title" style="font-weight:700;margin-bottom:.5rem">
              {fillText(t('familyTitle'), {
                mode: t(family.mode),
                name: family.user.name,
              })}
            </div>
            <div id="scan-family-list">
              {family.registrations.map((row, index) => {
                const key = memberKey(row.companionId);
                const matching = view.active.filter((record) =>
                  record.uid === family.user.uid
                  && (record.companionId ?? null) === (row.companionId ?? null));
                const hasCheckin = matching.some((record) => record.type === 'checkin');
                const hasCheckout = matching.some((record) => record.type === 'checkout');
                const disabled = family.mode === 'checkin' ? hasCheckin : hasCheckout;

                return (
                  <label
                    key={`${key}:${index}`}
                    style="display:flex;align-items:center;gap:.5rem;padding:.3rem 0;border-bottom:1px solid var(--border);cursor:pointer"
                  >
                    <input
                      type="checkbox"
                      name="family-scan"
                      style="width:15px;height:15px"
                      checked={!disabled && family.selected.has(key)}
                      disabled={disabled}
                      onChange={(event) => {
                        if (locked.current || !allowed() || disabled) return;
                        const current = familyRef.current;
                        if (!current) return;
                        const selected = new Set(current.selected);
                        if (event.currentTarget.checked) selected.add(key);
                        else selected.delete(key);
                        const next = { ...current, selected };
                        familyRef.current = next;
                        setFamily(next);
                      }}
                    />
                    <span style="flex:1;font-size:.82rem">
                      {row.companionName || row.userName}
                      {!row.companionId ? t('self') : ''}
                    </span>
                    <span style="font-size:.68rem;color:var(--text-muted)">
                      {t(hasCheckout
                        ? 'familyCheckedOut'
                        : hasCheckin
                          ? 'familyCheckedIn'
                          : 'pending')}
                    </span>
                  </label>
                );
              })}
            </div>
            <div style="display:flex;gap:.5rem;margin-top:.6rem">
              <button
                type="button"
                class="scan-result-close"
                style="flex:1;background:var(--border);color:var(--text-primary)"
                onClick={() => { closeFamily(); }}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                class="scan-result-close"
                style="flex:1"
                id="scan-family-confirm-btn"
                disabled={busy}
                onClick={() => {
                  confirmFamily().catch(() => {
                    if (allowed()) toast.show(latest.current.t('writeError'));
                  });
                }}
              >
                {fillText(t('familyConfirm'), { mode: t(family.mode) })}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
