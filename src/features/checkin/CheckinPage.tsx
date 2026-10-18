import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { Text } from '@/ui/Text';
import { EmptyState } from '@/ui/EmptyState';
import { Modal } from '@/ui/Modal';
import { UserTag } from '@/ui/UserTag';
import { useOperateContext } from '@/features/profile/data/viewer-operate';
import {
  canOperateEventSite,
  type OperateContext,
} from '@/features/events/data/operate-permissions';
import type { EventDoc } from '@/features/events/data/types';

import {
  loadScanEvents,
  pickScanBucket,
  type ScanEventEntry,
} from './data/scan-events';
import {
  findScanUser,
  loadScanEventDocuments,
  loadScanRegistrations,
  type ScanUser,
} from './data/scan-reads';
import {
  buildFamilyCheckinRecords,
  decideScanAction,
  loadEventAttendance,
  recordAttendance,
  removeAttendance,
  shouldUseFamilyFlow,
  type AttendanceWritePayload,
  type EventAttendanceEntry,
  type FamilyMemberSelection,
  type ScanMode,
  type ScanRegistration,
} from './data/attendance';
import {
  createQrScanner,
  scannerFailure,
  type QrScanner,
  type ScannerFailure,
} from './scanner';
import { useCheckinText, type CheckinTextKey } from './useCheckinText';
import './checkin.css';

// ASSUMPTION: UI 元件位於 @/ui，viewer-operate 位於 profile/data；
// 附件未提供實際匯入路徑。測試內容已提供，本次未讀檔或執行測試。
// Text 例外：原生 option、aria-label。UserTag／EmptyState／Modal
// 採用既有元件內部文字呈現；動態名稱不作字典 key。

type Bucket = 'today' | 'future' | 'past';
const bucketOrder: readonly Bucket[] = ['today', 'future', 'past'];

interface Popup {
  tone: 'success' | 'warning' | 'error';
  key: CheckinTextKey;
  user?: ScanUser;
  count?: number;
}

interface Family {
  user: ScanUser;
  registrations: ScanRegistration[];
  selected: Set<string>;
}

const memberKey = (id: string | null | undefined): string => JSON.stringify(id ?? null);

function openProfile(uid: string): void {
  // ASSUMPTION: 個人公開資料頁使用 /profile?uid=；URL 中 UID 必須編碼。
  window.location.assign(`/profile?uid=${encodeURIComponent(uid)}`);
}

export default function CheckinPage() {
  const t = useCheckinText();
  const context = useOperateContext();
  const [snapshot, setSnapshot] = useState<{
    uid: string;
    events: EventDoc[];
  } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<Bucket>('today');
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState<ScanMode>('checkin');

  useEffect(() => {
    let active = true;
    if (!context.uid || context.role === null) return;

    const uid = context.uid;
    setLoadError(false);
    loadScanEventDocuments().then(
      (events) => {
        if (!active) return;
        setSnapshot({ uid, events });
      },
      () => {
        if (active) setLoadError(true);
      },
    );

    return () => { active = false; };
  }, [context.uid, context.role, revision]);

  const available = snapshot?.uid === context.uid ? snapshot.events : [];
  const buckets = useMemo(
    () => loadScanEvents({ events: available, context }),
    [available, context],
  );
  const total = buckets.today.length + buckets.future.length + buckets.past.length;
  const list = pickScanBucket(buckets, filter);
  const selected = list.find((entry) => entry.value === selectedId)
    ?? (list.length === 1 ? list[0] : undefined);

  useEffect(() => {
    if (buckets[filter].length > 0) return;
    const first = bucketOrder.find((bucket) => buckets[bucket].length > 0);
    if (first) {
      setFilter(first);
      setSelectedId('');
    }
  }, [buckets, filter]);

  return (
    <section class="checkin-page">
      <header class="scan-page-header">
        <button type="button" onClick={() => window.history.back()}>
          <Text>{t('back')}</Text>
        </button>
        <h1><Text>{t('pageTitle')}</Text></h1>
      </header>

      {loadError && (
        <div class="scan-notice" role="alert">
          <Text>{t('loadError')}</Text>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            <Text>{t('retry')}</Text>
          </button>
        </div>
      )}

      {!context.uid || context.role === null || total === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <div class="scan-content">
          <label class="scan-select-label" for="scan-event-select">
            <Text>{t('event')}</Text>
          </label>
          <select
            id="scan-event-select"
            class="scan-event-select"
            value={selected?.value ?? ''}
            onChange={(event) => setSelectedId(event.currentTarget.value)}
          >
            <option value="">{t('selectEvent')}</option>
            {list.map((entry) => (
              <option key={entry.docId} value={entry.value}>
                {`${entry.typeLabel}${entry.title}（${entry.date}）`}
              </option>
            ))}
          </select>

          <div class="scan-date-filter" role="group" aria-label={t('dateFilter')}>
            {bucketOrder.map((bucket) => (
              <button
                type="button"
                key={bucket}
                aria-pressed={filter === bucket}
                onClick={() => {
                  setFilter(bucket);
                  setSelectedId('');
                }}
              >
                <Text>{`${t(bucket)} (${buckets[bucket].length})`}</Text>
              </button>
            ))}
          </div>

          <div class="scan-mode-toggle" role="group" aria-label={t('mode')}>
            {(['checkin', 'checkout'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                <Text>{t(value)}</Text>
              </button>
            ))}
          </div>

          {selected && canOperateEventSite(context, selected.event) ? (
            <ScanSession
              key={`${context.uid}:${selected.docId}:${mode}`}
              entry={selected}
              context={context}
              mode={mode}
            />
          ) : (
            <EmptyState title={t('selectEvent')} body={t('selectEventHint')} />
          )}
        </div>
      )}
    </section>
  );
}

interface SessionProps {
  entry: ScanEventEntry;
  context: OperateContext;
  mode: ScanMode;
}

function ScanSession({ entry, context, mode }: SessionProps) {
  const t = useCheckinText();
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScanner | null>(null);
  const alive = useRef(true);
  const locked = useRef(false);
  const modalOpen = useRef(false);
  const latest = useRef({ entry, context });
  latest.current = { entry, context };

  const [records, setRecords] = useState<EventAttendanceEntry[]>([]);
  const [registrations, setRegistrations] = useState<ScanRegistration[]>([]);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on'>('off');
  const [cameraError, setCameraError] = useState<ScannerFailure | null>(null);
  const [manualVisible, setManualVisible] = useState(false);
  const [uid, setUid] = useState('');
  const [notice, setNotice] = useState<CheckinTextKey | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [removeTarget, setRemoveTarget] = useState<EventAttendanceEntry | null>(null);
  const readSequence = useRef(0);

  const allowed = (): boolean => alive.current
    && !!latest.current.context.uid
    && canOperateEventSite(latest.current.context, latest.current.entry.event);

  const refresh = async (): Promise<void> => {
    const sequence = ++readSequence.current;
    const [nextRecords, nextRegistrations] = await Promise.all([
      loadEventAttendance(entry.docId),
      loadScanRegistrations(entry.docId),
    ]);

    if (!allowed() || sequence !== readSequence.current) return;
    setRecords(nextRecords);
    setRegistrations(nextRegistrations);
  };

  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      readSequence.current += 1;
      scanner.current?.stop();
      scanner.current = null;
    };
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      if (allowed()) setNotice('loadError');
    });
  }, []);

  const stopCamera = (): void => {
    scanner.current?.stop();
    scanner.current = null;
    setCamera('off');
  };

  const showPopup = (value: Popup): void => {
    if (!allowed()) return;
    modalOpen.current = true;
    stopCamera();
    setPopup(value);
  };

  const begin = (): boolean => {
    if (!allowed() || locked.current) return false;
    locked.current = true;
    setBusy(true);
    setNotice(null);
    return true;
  };

  const finish = (): void => {
    locked.current = false;
    if (alive.current) setBusy(false);
  };

  const writeRecords = async (
    values: readonly AttendanceWritePayload[],
  ): Promise<void> => {
    for (const value of values) {
      if (!allowed()) return;
      await recordAttendance(entry.docId, value);
    }
  };

  const recoverWriteFailure = async (): Promise<void> => {
    if (!allowed()) return;
    try {
      await refresh();
    } catch {
      // 保留上一份完整列表。錯誤彈窗提醒可能部分完成，重試前重新讀取。
    }
    showPopup({ tone: 'error', key: 'writeError' });
  };

  const processUid = async (input: string): Promise<void> => {
    if (modalOpen.current || !begin()) return;

    try {
      const operatorUid = latest.current.context.uid;
      if (!operatorUid) return;

      const user = await findScanUser(input, operatorUid);
      if (!allowed()) return;
      if (!user) {
        showPopup({ tone: 'error', key: 'unknownUser' });
        return;
      }

      const [attendance, regs] = await Promise.all([
        loadEventAttendance(entry.docId),
        loadScanRegistrations(entry.docId),
      ]);
      if (!allowed()) return;
      readSequence.current += 1;
      setRecords(attendance);
      setRegistrations(regs);

      if (shouldUseFamilyFlow(regs, user.uid)) {
        const own = regs.filter((row) =>
          row.userId === user.uid && row.status === 'confirmed');
        const selected = new Set(own.filter((row) =>
          !attendance.some((record) =>
            record.status !== 'removed'
            && record.uid === user.uid
            && record.type === mode
            && (record.companionId ?? null) === (row.companionId ?? null),
          ),
        ).map((row) => memberKey(row.companionId)));

        modalOpen.current = true;
        stopCamera();
        setFamily({ user, registrations: own, selected });
        return;
      }

      const decision = decideScanAction({
        eventId: entry.eventId,
        // EventDoc 型別未宣告 participants（A 的舊欄位），只取 decideScanAction 需要的部分。
        event: { participants: (entry.event as Record<string, unknown>).participants },
        uid: user.uid,
        userName: user.name,
        mode,
        registrations: regs,
        attendance,
        now: new Date(),
      });

      await writeRecords(decision.records);
      if (!allowed()) return;
      await refresh();
      showPopup({
        tone: decision.resultClass,
        key: decision.reasonKey,
        user,
      });
    } catch {
      await recoverWriteFailure();
    } finally {
      finish();
    }
  };

  const startCamera = async (): Promise<void> => {
    if (!allowed() || locked.current || modalOpen.current || !video.current) return;
    stopCamera();
    setCamera('starting');
    setCameraError(null);

    const instance = createQrScanner({
      video: video.current,
      onScan: processUid,
      onError: (error) => {
        if (!allowed()) return;
        setCamera('off');
        setCameraError(error);
        setManualVisible(true);
      },
    });
    scanner.current = instance;

    try {
      await instance.start();
      if (allowed() && scanner.current === instance) setCamera('on');
    } catch (error: unknown) {
      if (!allowed() || scanner.current !== instance) return;
      setCamera('off');
      setCameraError(scannerFailure(error));
      setManualVisible(true);
    }
  };

  const confirmFamily = async (): Promise<void> => {
    const chosen = family;
    if (!chosen || !begin()) return;

    try {
      if (chosen.selected.size === 0) {
        setNotice('selectMembers');
        return;
      }

      const [attendance, regs] = await Promise.all([
        loadEventAttendance(entry.docId),
        loadScanRegistrations(entry.docId),
      ]);
      if (!allowed()) return;

      const unique = new Map<string, FamilyMemberSelection>();
      for (const row of regs) {
        const key = memberKey(row.companionId);
        if (
          row.userId !== chosen.user.uid
          || row.status !== 'confirmed'
          || !chosen.selected.has(key)
        ) continue;

        unique.set(key, {
          companionId: row.companionId ?? null,
          companionName: row.companionName ?? null,
          displayName: row.companionName || row.userName || chosen.user.name,
        });
      }

      if (unique.size !== chosen.selected.size) {
        setNotice('familyChanged');
        return;
      }

      const values = buildFamilyCheckinRecords({
        eventId: entry.eventId,
        uid: chosen.user.uid,
        userName: chosen.user.name,
        mode,
        members: [...unique.values()],
        attendance,
        now: new Date(),
      });

      await writeRecords(values);
      if (!allowed()) return;
      await refresh();
      setFamily(null);
      showPopup({
        tone: values.length ? 'success' : 'warning',
        key: values.length ? 'familySuccess' : `${mode}.already`,
        user: chosen.user,
        count: unique.size,
      });
    } catch {
      if (alive.current) setFamily(null);
      await recoverWriteFailure();
    } finally {
      finish();
    }
  };

  const confirmRemoval = async (): Promise<void> => {
    const target = removeTarget;
    if (!target || !begin()) return;

    try {
      const operatorUid = latest.current.context.uid;
      if (!operatorUid || !allowed()) return;
      await removeAttendance(entry.docId, target._docId, operatorUid);
      if (!allowed()) return;
      await refresh();
      setRemoveTarget(null);
      showPopup({ tone: 'success', key: 'removed' });
    } catch {
      if (alive.current) setRemoveTarget(null);
      await recoverWriteFailure();
    } finally {
      finish();
    }
  };

  const closeModal = (): void => {
    if (locked.current) return;
    modalOpen.current = false;
    setPopup(null);
    setFamily(null);
    setRemoveTarget(null);
    setNotice(null);
  };

  const activeRecords = records.filter((record) => record.status !== 'removed')
    .sort((a, b) => b.time.localeCompare(a.time));

  const cameraMessage: CheckinTextKey = cameraError === 'denied'
    ? 'cameraDenied'
    : cameraError === 'unsupported'
      ? 'cameraUnsupported'
      : 'cameraFailed';

  return (
    <>
      <div class="scan-camera">
        <div class="scan-qr-reader">
          <video ref={video} muted playsInline hidden={camera !== 'on'} />
          {camera !== 'on' && <Text>{t('cameraHint')}</Text>}
        </div>
        <button
          type="button"
          class="scan-camera-btn"
          disabled={busy || modalOpen.current}
          onClick={() => {
            if (camera !== 'off') stopCamera();
            else startCamera().catch(() => {
              if (!allowed()) return;
              stopCamera();
              setCameraError('failed');
              setManualVisible(true);
            });
          }}
        >
          <Text>{t(camera === 'off' ? 'startCamera' : 'stopCamera')}</Text>
        </button>
      </div>

      {cameraError && (
        <div role="alert" class="scan-notice"><Text>{t(cameraMessage)}</Text></div>
      )}

      {!manualVisible && (
        <button type="button" onClick={() => setManualVisible(true)}>
          <Text>{t('manual')}</Text>
        </button>
      )}

      {manualVisible && (
        <form
          class="scan-manual-section"
          onSubmit={(event) => {
            event.preventDefault();
            const value = uid.trim();
            if (!value) {
              setNotice('enterUid');
              return;
            }
            if (locked.current || modalOpen.current || !allowed()) return;
            setUid('');
            processUid(value).catch(() => {
              if (allowed()) setNotice('writeError');
            });
          }}
        >
          <label for="scan-manual-uid"><Text>{t('manual')}</Text></label>
          <div class="scan-manual-row">
            <input
              id="scan-manual-uid"
              type="text"
              autoComplete="off"
              value={uid}
              disabled={busy}
              onInput={(event) => setUid(event.currentTarget.value)}
            />
            <button type="submit" disabled={busy}>
              <Text>{t('confirm')}</Text>
            </button>
          </div>
        </form>
      )}

      {notice && (
        <div role="alert" class="scan-notice">
          <Text>{t(notice)}</Text>
          {!family && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setNotice(null);
                refresh().catch(() => {
                  if (allowed()) setNotice('loadError');
                });
              }}
            >
              <Text>{t('retry')}</Text>
            </button>
          )}
        </div>
      )}

      <div class="scan-results" aria-live="polite" aria-busy={busy}>
        {activeRecords.map((record) => (
          <div
            key={record._docId}
            class={`scan-result ${record.type === 'unreg' ? 'error' : 'success'}`}
          >
            <UserTag
              uid={record.uid}
              name={record.displayName || record.uid}
              onOpenProfile={openProfile}
            />
            <Text>
              {t(record.type === 'checkin'
                ? 'checkin.success'
                : record.type === 'checkout'
                  ? 'checkout.success'
                  : 'unregistered')}
            </Text>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                modalOpen.current = true;
                stopCamera();
                setRemoveTarget(record);
              }}
            >
              <Text>{t('remove')}</Text>
            </button>
          </div>
        ))}
      </div>

      <AttendanceSummary
        entry={entry}
        records={activeRecords}
        registrations={registrations}
      />

      <Modal
        open={popup !== null}
        title={popup ? t(popup.key) : t('pageTitle')}
        onClose={closeModal}
        size="sm"
        footer={(
          <button type="button" class="scan-result-close" onClick={closeModal}>
            <Text>{t('confirm')}</Text>
          </button>
        )}
      >
        {popup && (
          <div class={`scan-result-box ${popup.tone}`}>
            <div class="scan-result-icon" aria-hidden="true">
              <Text>{popup.tone === 'success' ? '✅' : popup.tone === 'warning' ? '⚠️' : '❌'}</Text>
            </div>
            {popup.user && (
              <UserTag uid={popup.user.uid} name={popup.user.name} onOpenProfile={openProfile} />
            )}
            {popup.count !== undefined && <Text>{` × ${popup.count}`}</Text>}
            <div class="scan-result-name"><Text>{entry.title}</Text></div>
          </div>
        )}
      </Modal>

      <Modal
        open={family !== null}
        title={`${t('family')} · ${t(mode)}`}
        onClose={closeModal}
        closeOnOverlay={!busy}
        closeOnEsc={!busy}
        loading={busy}
        size="sm"
        footer={(
          <div class="scan-modal-actions">
            <button type="button" disabled={busy} onClick={closeModal}>
              <Text>{t('cancel')}</Text>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                confirmFamily().catch(() => {
                  if (allowed()) setNotice('writeError');
                });
              }}
            >
              <Text>{t('confirm')}</Text>
            </button>
          </div>
        )}
      >
        {family && (
          <div class="scan-family-list">
            <UserTag uid={family.user.uid} name={family.user.name} onOpenProfile={openProfile} />
            {family.registrations.map((row, index) => {
              const key = memberKey(row.companionId);
              const matching = activeRecords.filter((record) =>
                record.uid === family.user.uid
                && (record.companionId ?? null) === (row.companionId ?? null));
              const hasCheckin = matching.some((record) => record.type === 'checkin');
              const hasCheckout = matching.some((record) => record.type === 'checkout');
              const disabled = mode === 'checkin' ? hasCheckin : hasCheckout;

              return (
                <label key={`${key}:${index}`} class="scan-family-row">
                  <input
                    type="checkbox"
                    checked={family.selected.has(key)}
                    disabled={busy || disabled}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setFamily((previous) => {
                        if (!previous) return previous;
                        const selected = new Set(previous.selected);
                        if (checked) selected.add(key);
                        else selected.delete(key);
                        return { ...previous, selected };
                      });
                    }}
                  />
                  <Text>{row.companionName || row.userName || family.user.name}</Text>
                  {!row.companionId && <Text>{t('self')}</Text>}
                  <Text>{t(hasCheckout
                    ? 'checkout.already'
                    : hasCheckin
                      ? 'checkin.already'
                      : 'pending')}</Text>
                </label>
              );
            })}
            {notice && <div role="alert"><Text>{t(notice)}</Text></div>}
          </div>
        )}
      </Modal>

      <Modal
        open={removeTarget !== null}
        title={t('remove')}
        onClose={closeModal}
        closeOnEsc={!busy}
        closeOnOverlay={!busy}
        loading={busy}
        size="sm"
        footer={(
          <div class="scan-modal-actions">
            <button type="button" disabled={busy} onClick={closeModal}>
              <Text>{t('cancel')}</Text>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                confirmRemoval().catch(() => {
                  if (allowed()) setNotice('writeError');
                });
              }}
            >
              <Text>{t('confirm')}</Text>
            </button>
          </div>
        )}
      >
        <Text>{t('removeConfirm')}</Text>
        {removeTarget && (
          <UserTag
            uid={removeTarget.uid}
            name={removeTarget.displayName || removeTarget.uid}
            onOpenProfile={openProfile}
          />
        )}
      </Modal>
    </>
  );
}

interface SummaryProps {
  entry: ScanEventEntry;
  records: EventAttendanceEntry[];
  registrations: ScanRegistration[];
}

function AttendanceSummary({ entry, records, registrations }: SummaryProps) {
  const t = useCheckinText();
  const people = new Map<string, {
    uid: string;
    name: string;
    checkin: boolean;
    checkout: boolean;
    unreg: boolean;
  }>();

  for (const record of records) {
    const key = JSON.stringify([record.uid, record.companionId]);
    const person = people.get(key) ?? {
      uid: record.uid,
      name: record.displayName || record.uid,
      checkin: false,
      checkout: false,
      unreg: false,
    };
    if (record.type === 'checkin') person.checkin = true;
    if (record.type === 'checkout') person.checkout = true;
    if (record.type === 'unreg') person.unreg = true;
    people.set(key, person);
  }

  const confirmed = registrations.filter((row) => row.status === 'confirmed');
  const counts = new Map<string, number>();
  for (const row of confirmed) {
    if (row.userId) counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
  }

  const registered = [...people.values()].filter((person) => !person.unreg);
  const unregistered = [...people.values()].filter((person) => person.unreg);
  const grouped = new Map<string, (typeof registered)[number]>();
  for (const person of registered) {
    const previous = grouped.get(person.uid);
    grouped.set(person.uid, previous ? {
      ...previous,
      checkin: previous.checkin || person.checkin,
      checkout: previous.checkout || person.checkout,
    } : { ...person });
  }

  const raw = entry.event as unknown as { current?: unknown; participants?: unknown };
  const documentTotal = Number(raw.current ?? 0);
  const total = Number.isFinite(documentTotal) && documentTotal > 0
    ? documentTotal
    : confirmed.length || (Array.isArray(raw.participants) ? raw.participants.length : 0);
  const checkins = registered.filter((person) => person.checkin).length;
  const checkouts = registered.filter((person) => person.checkout).length;
  const rate = total > 0 ? Math.round(checkins / total * 100) : 0;

  return (
    <>
      <div class="scan-stats">
        <Text>{`${t('registered')}: ${total}`}</Text>
        <Text>{`${t('checkin')}: ${checkins}`}</Text>
        <Text>{`${t('checkout')}: ${checkouts}`}</Text>
        <Text>{`${t('unregistered')}: ${unregistered.length}`}</Text>
        <Text>{`${t('rate')}: ${rate}%`}</Text>
      </div>
      {([
        { key: 'registered', people: [...grouped.values()] },
        { key: 'unregistered', people: unregistered },
      ] as const).map((section) => (
        (section.key === 'registered' || section.people.length > 0) && (
          <section class={`scan-section scan-section-${section.key}`} key={section.key}>
            <h2><Text>{`${t(section.key)} (${section.people.length})`}</Text></h2>
            <div class="scan-user-tags">
              {section.people.length === 0 && <Text>{t('none')}</Text>}
              {[...section.people].sort((a, b) => a.name.localeCompare(b.name))
                .map((person, index) => (
                  <div class="scan-person-tag" key={`${person.uid}:${index}`}>
                    <UserTag uid={person.uid} name={person.name} onOpenProfile={openProfile} />
                    {section.key === 'registered' && (counts.get(person.uid) ?? 0) > 1 && (
                      <Text>{` × ${counts.get(person.uid)}`}</Text>
                    )}
                    {person.checkin && <Text>{`✓ ${t('checkin')}`}</Text>}
                    {person.checkout && <Text>{`✓ ${t('checkout')}`}</Text>}
                  </div>
                ))}
            </div>
          </section>
        )
      ))}
    </>
  );
}
