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
  decideScanAction,
  loadEventAttendance,
  recordAttendance,
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

  const allowed = (): boolean =>
    alive.current
    && !!latest.current.context.uid
    && canOperateEventSite(latest.current.context, latest.current.entry.event);

  const guard = (): (() => boolean) => {
    const current = epoch.current;
    return () => current === epoch.current && allowed();
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
      setRecords(nextRecords);
      setRegistrations(nextRegistrations);
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

  const showPopup = (value: Popup): void => {
    if (!allowed()) return;
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

  const writeRecords = async (
    values: readonly AttendanceWritePayload[],
    docId: string,
    valid: () => boolean,
  ): Promise<boolean> => {
    for (const value of values) {
      if (!valid()) return false;
      await recordAttendance(docId, value);
      if (!valid()) return false;
    }
    return valid();
  };

  const recoverWriteFailure = async (valid: () => boolean): Promise<void> => {
    if (!valid()) return;
    toast.show(latest.current.t('writeError'));
    await refresh(valid);
    if (!valid()) return;
  };

  const processUid = async (input: string): Promise<void> => {
    // ASSUMPTION: 家庭彈窗開啟時忽略新碼，避免覆蓋尚未送出的勾選。
    if (familyRef.current || !begin()) return;
    const valid = guard();
    const selectedEntry = latest.current.entry;
    const operatorUid = latest.current.context.uid;
    let writing = false;
    readSequence.current += 1;

    try {
      if (!operatorUid) return;
      const user = await findScanUser(input, operatorUid);
      if (!valid()) return;
      if (!user) {
        showPopup({ tone: 'error', key: 'unknownUser' });
        return;
      }

      const sequence = ++readSequence.current;
      const [attendance, regs] = await Promise.all([
        loadEventAttendance(selectedEntry.docId),
        loadScanRegistrations(selectedEntry.docId),
      ]);
      if (!valid() || sequence !== readSequence.current) return;
      setRecords(attendance);
      setRegistrations(regs);
      const active = attendance.filter((record) =>
        record.status !== 'removed' && record.status !== 'cancelled');

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
        // 照 A `_processAttendance`；非同步讀取完成後取最新模式。
        mode: latest.current.mode,
        attendance: active,
        now: new Date(),
      });

      // ASSUMPTION: 第一筆寫入開始後維持這次完整決策，避免模式切換造成半套 payload。
      writing = true;
      const written = await writeRecords(decision.records, selectedEntry.docId, valid);
      if (!valid() || !written) return;
      await refresh(valid);
      if (!valid()) return;
      showPopup({
        tone: decision.resultClass,
        key: decision.reasonKey,
        name: user.name,
      });
    } catch {
      if (!valid()) return;
      if (writing) {
        await recoverWriteFailure(valid);
        if (!valid()) return;
      } else {
        toast.show(latest.current.t('loadError'));
      }
    } finally {
      finish();
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

      const sequence = ++readSequence.current;
      const [attendance, regs] = await Promise.all([
        loadEventAttendance(selectedEntry.docId),
        loadScanRegistrations(selectedEntry.docId),
      ]);
      if (!valid() || sequence !== readSequence.current) return;
      setRecords(attendance);
      setRegistrations(regs);

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
        attendance: attendance.filter((record) =>
          record.status !== 'removed' && record.status !== 'cancelled'),
        now: new Date(),
      });

      writing = true;
      const written = await writeRecords(values, selectedEntry.docId, valid);
      if (!valid() || !written) return;
      await refresh(valid);
      if (!valid()) return;
      familyRef.current = null;
      setFamily(null);
      showPopup({
        tone: 'success',
        key: 'familySuccess',
        name: chosen.user.name,
        count: unique.size,
        mode: chosen.mode,
      });
    } catch {
      if (!valid()) return;
      if (writing) {
        await recoverWriteFailure(valid);
        if (!valid()) return;
      } else {
        toast.show(latest.current.t('loadError'));
      }
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
