import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { BottomSheet } from '@/ui/BottomSheet';
import { Checkbox } from '@/ui/Checkbox';
import { DateTime } from '@/ui/DateTime';
import { UserTag } from '@/ui/UserTag';
import { Toast } from '@/ui/Toast';
import { useViewer } from '@/features/profile/data/viewer';
import { useUserRoles } from '@/data/user-roles';
import { loadEventAttendance, type EventAttendanceEntry } from '@/features/checkin/data/attendance';
import { loadEventDetail, loadEventRegistrations } from '../data/event-detail';
import { loadViewerRegistrations } from '../data/viewer-registrations';
import { isEventVisibleToUser } from '../data/visibility';
import { precheckSignup, cancelRegistration, SignupError } from '../data/signup';
import { registerSelection } from '../data/signup-selection';
import { loadSignupCompanions, type SignupCompanion } from '../data/companions';
import { getSignupButtonState } from '../data/signup-state';
import { operateContextFromViewer } from '../data/event-create-context';
import { canOperateEventSite } from '../data/operate-permissions';
import {
  count,
  eventDateRange,
  guestConfirmedCount,
  guestEventPeople,
  isActiveRegistration,
  isCompanion,
  registrationId,
  registrationOwner,
  safeImageUrl,
  sortRegistrations,
  type DetailEvent,
  type DetailRegistration,
} from '../data/detail-model';
import { AttendanceRosterTable } from '../components/AttendanceRosterTable';
import { useAttendanceInstantSave } from '../components/useAttendanceInstantSave';
import { WaitlistRosterTable } from '../components/WaitlistRosterTable';
import type { RegistrationDoc } from '../data/types';
import './event-detail.css';

interface Snapshot {
  event: DetailEvent;
  eventDocId: string;
  viewerRegistrations: RegistrationDoc[];
  registrations: DetailRegistration[];
  attendanceRecords: EventAttendanceEntry[];
}

interface Notice {
  key: string;
  params?: Record<string, string | number>;
  serial: number;
}

type Sheet = 'signup' | 'cancel' | null;
type RosterPhase = 'loading' | 'ready' | 'error';

export default function EventDetailPage({ id }: { id?: string }): JSX.Element {
  const location = useLocation();
  const routeId = id ?? location.path.split('/')[2] ?? '';
  const viewer = useViewer();

  // UID/活動變更立即隔離 DOM 與所有未完成操作，避免 effect 清理前洩漏舊資料。
  return <EventDetailSession key={`${routeId}:${viewer.uid ?? 'guest'}`}
    publicId={routeId} viewer={viewer} />;
}

function EventDetailSession({
  publicId,
  viewer,
}: {
  publicId: string;
  viewer: ReturnType<typeof useViewer>;
}): JSX.Element {
  const t = useT();
  const location = useLocation();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [rosterPhase, setRosterPhase] = useState<RosterPhase>('loading');
  const [historyFailed, setHistoryFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [companions, setCompanions] = useState<SignupCompanion[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [rosterEditing, setRosterEditing] = useState(false);
  const [rosterSubmitting, setRosterSubmitting] = useState(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const rosterSequence = useRef(0);
  const rosterPending = useRef(false);
  const operation = useRef(false);
  const noticeSequence = useRef(0);
  const currentViewer = useRef(viewer);
  currentViewer.current = viewer;

  useEffect(() => {
    alive.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive.current = false;
      sequence.current += 1;
      rosterSequence.current += 1;
      window.clearInterval(timer);
    };
  }, []);

  function show(key: string, params?: Record<string, string | number>): void {
    if (alive.current) setNotice({ key, params, serial: ++noticeSequence.current });
  }

  function errorKey(error: unknown, fallback: string): string {
    if (!(error instanceof SignupError)) return fallback;
    // 資料層使用 event.*；功能字典由 i18n loader 加 events.* 前綴。
    return error.messageKey.startsWith('event.')
      ? `events.${error.messageKey.slice('event.'.length)}`
      : error.messageKey;
  }

  useEffect(() => {
    const request = ++sequence.current;
    const rosterRequest = ++rosterSequence.current;
    let disposed = false;
    const current = (): boolean =>
      !disposed && alive.current && request === sequence.current;

    setPhase('loading');
    setRosterPhase('loading');
    setHistoryFailed(false);
    setSnapshot(null);

    async function load(): Promise<void> {
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(publicId)) {
        if (current()) setPhase('missing');
        return;
      }

      // 整頁 error 僅由活動文件讀取失敗觸發。
      let detail: Awaited<ReturnType<typeof loadEventDetail>>;
      try {
        detail = await loadEventDetail(publicId);
      } catch {
        if (current()) setPhase('error');
        return;
      }
      if (!current()) return;
      if (!detail) {
        setPhase('missing');
        return;
      }

      let history: RegistrationDoc[] = [];
      let failedHistory = false;
      if (viewer.uid) {
        try {
          history = await loadViewerRegistrations(viewer.uid);
        } catch {
          failedHistory = true;
        }
      }
      if (!current()) return;

      // 歷史失敗不捏造參加紀錄；可見性仍使用既有守衛，不能放寬私密活動權限。
      if (!isEventVisibleToUser(detail.event, currentViewer.current, history)) {
        setPhase('missing');
        return;
      }

      const next: Snapshot = {
        event: { ...detail.event, id: detail.event.id ?? publicId },
        eventDocId: detail.eventDocId,
        viewerRegistrations: history,
        registrations: [],
        attendanceRecords: [],
      };
      setSnapshot(next);
      setHistoryFailed(failedHistory);
      setPhase('ready');

      // A 的 showEventDetail、_renderGuestAttendanceTable、
      // _renderGuestWaitlistSection 透過 _buildGuestEventPeople 顯示活動文件上的公開名單。
      // 訪客不讀 registrations，公開名單也不作為報名／取消的身分證據。
      if (!viewer.uid) {
        setRosterPhase('ready');
        return;
      }

      try {
        const [registrations, attendanceRecords] = await Promise.all([
          loadEventRegistrations(detail.eventDocId),
          loadEventAttendance(detail.eventDocId).catch(() => [] as EventAttendanceEntry[]),
        ]);
        if (!current() || rosterRequest !== rosterSequence.current) return;
        setSnapshot((previous) => previous && ({
          ...previous,
          registrations,
          attendanceRecords,
        }));
        setRosterPhase('ready');
      } catch {
        if (current() && rosterRequest === rosterSequence.current) {
          setRosterPhase('error');
        }
      }
    }

    void load();
    return () => {
      disposed = true;
    };
  }, [publicId, viewer.uid, reload]);

  async function retryRoster(): Promise<void> {
    const current = snapshot;
    if (!current || !currentViewer.current.uid || rosterPending.current ||
      operation.current || refreshFailed ||
      !isEventVisibleToUser(current.event, currentViewer.current, current.viewerRegistrations)) {
      return;
    }
    rosterPending.current = true;
    const request = ++rosterSequence.current;
    setRosterPhase('loading');
    try {
      const [registrations, attendanceRecords] = await Promise.all([
        loadEventRegistrations(current.eventDocId),
        loadEventAttendance(current.eventDocId).catch(() => [] as EventAttendanceEntry[]),
      ]);
      if (!alive.current || request !== rosterSequence.current) return;
      setSnapshot((previous) => previous && ({
        ...previous,
        registrations,
        attendanceRecords,
      }));
      setRosterPhase('ready');
    } catch {
      if (alive.current && request === rosterSequence.current) {
        setRosterPhase('error');
      }
    } finally {
      rosterPending.current = false;
    }
  }

  async function run(work: () => Promise<void>): Promise<void> {
    if (operation.current || !alive.current) return;
    operation.current = true;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      show(errorKey(error, 'events.detailPage.actionError'));
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function start(work: () => Promise<void>): void {
    run(work).catch(() => show('events.detailPage.actionError'));
  }

  async function login(): Promise<void> {
    const auth = await import('@/data/auth');
    if (alive.current) await auth.signIn();
  }

  async function refresh(current: Snapshot): Promise<void> {
    // 包含寫入後刷新在內，所有 registrations 入口都必須有登入身分。
    const uid = currentViewer.current.uid;
    if (!uid) return;
    const request = ++rosterSequence.current;
    try {
      const [registrations, history, attendanceRecords] = await Promise.all([
        loadEventRegistrations(current.eventDocId),
        loadViewerRegistrations(uid),
        loadEventAttendance(current.eventDocId).catch(() => current.attendanceRecords),
      ]);
      if (!alive.current || request !== rosterSequence.current) return;
      const active = registrations.filter(isActiveRegistration);
      setSnapshot({
        ...current,
        event: {
          ...current.event,
          current: active.filter((reg) => reg.status === 'confirmed').length,
          waitlist: active.filter((reg) => reg.status === 'waitlisted').length,
        },
        registrations,
        viewerRegistrations: history,
        attendanceRecords,
      });
      setRosterPhase('ready');
      setHistoryFailed(false);
      setRefreshFailed(false);
    } catch (error) {
      if (!alive.current || request !== rosterSequence.current) return;
      // 寫入可能已成功，保留原有防重送契約；不同於首次唯讀名單失敗。
      setRosterPhase('error');
      setRefreshFailed(true);
      show(errorKey(error, 'events.detailPage.refreshError'));
    }
  }

  const visible = snapshot !== null &&
    isEventVisibleToUser(snapshot.event, viewer, snapshot.viewerRegistrations);
  const event = snapshot?.event;
  const active = sortRegistrations(snapshot?.registrations ?? []);

  // 收集頁面上會出現的所有 UserTag uid，一次查角色（R-ID-002：只用 UID）。
  const roleUids: string[] = [];
  if (event) {
    if (event.creatorUid) roleUids.push(event.creatorUid);
    for (const person of guestEventPeople(event, 'participants')) roleUids.push(person.uid);
    for (const person of guestEventPeople(event, 'waitlistNames')) roleUids.push(person.uid);
  }
  for (const reg of active) {
    if (isCompanion(reg)) continue;
    const owner = registrationOwner(reg);
    if (owner) roleUids.push(owner);
  }
  // 訪客不能讀 users（Rules isAuth），不查。
  const roles = useUserRoles(viewer.uid ? roleUids : []);

  const eventId = event?.id ?? publicId;
  const canManageRoster = Boolean(
    event && canOperateEventSite(operateContextFromViewer(viewer), event),
  );

  const instantSave = useAttendanceInstantSave({
    event,
    eventDocId: snapshot?.eventDocId ?? '',
    publicEventId: eventId,
    operatorUid: viewer.uid,
    registrations: snapshot?.registrations ?? [],
    attendanceRecords: snapshot?.attendanceRecords ?? [],
    onReloadAttendance: async () => {
      const docId = snapshot?.eventDocId;
      if (!docId) return snapshot?.attendanceRecords ?? [];
      const records = await loadEventAttendance(docId);
      if (alive.current) {
        setSnapshot((prev) => (prev && prev.eventDocId === docId
          ? { ...prev, attendanceRecords: records }
          : prev));
      }
      return records;
    },
    onSaveFailed: (personName) => {
      show('events.roster.saveFailed', { name: personName });
    },
  });

  function handleStartRosterEdit(): void {
    // 對照 A `_startTableEdit`：按下時再檢查一次權限，不通過 toast「權限不足」。
    const curEvent = snapshot?.event;
    if (
      !curEvent
      || canOperateEventSite(operateContextFromViewer(currentViewer.current), curEvent) !== true
    ) {
      show('events.roster.noPermission');
      return;
    }
    instantSave.resetInstantSave();
    setRosterEditing(true);
  }

  async function handleCloseRosterEdit(): Promise<void> {
    if (rosterSubmitting) return;
    setRosterSubmitting(true);
    try {
      await instantSave.flushInstantSaves();
    } finally {
      instantSave.resetInstantSave();
      if (alive.current) {
        setRosterSubmitting(false);
        setRosterEditing(false);
      }
    }
  }

  // 名單載入中或失敗時，可用已讀到的本人歷史維持原本報名按鈕狀態。
  // 不使用活動文件的公開姓名陣列推導本人報名。
  const actionRegistrations = !viewer.uid ? [] : rosterPhase === 'ready'
    ? active
    : sortRegistrations(
      snapshot?.viewerRegistrations.filter((reg) => reg.eventId === eventId) ?? [],
    );
  const owned = actionRegistrations.filter((reg) => registrationOwner(reg) === viewer.uid);
  const selfRegistered = owned.some((reg) => !isCompanion(reg));
  const signedCompanions = new Set(owned.map((reg) => reg.companionId).filter(Boolean));

  function check(current: Snapshot, includeSelf: boolean): boolean {
    if (historyFailed) {
      show('events.detailPage.historyError');
      return false;
    }
    const currentEventId = current.event.id ?? publicId;
    // precheckSignup 不自行按 eventId 篩選，禁止將其他活動的紀錄直接傳入。
    const history = current.viewerRegistrations.filter((reg) => reg.eventId === currentEventId);
    const result = precheckSignup(current.event, currentViewer.current, history, new Date());
    if (result.ok) return true;

    // 只替同行者報名可已有本人報名；其餘前置檢查仍全部執行。
    if (!includeSelf && result.reason === 'already_registered') return true;
    show(result.messageKey.replace(/^event\./, 'events.'));
    return false;
  }

  async function submitSignup(current: Snapshot, keys: readonly string[]): Promise<void> {
    const uid = currentViewer.current.uid;
    if (!uid) {
      await login();
      return;
    }
    const includeSelf = keys.includes('self');
    if (!check(current, includeSelf)) return;
    const chosen = companions.filter((item) => keys.includes(`companion:${item.id}`));
    if (!includeSelf && chosen.length === 0) {
      show('events.detailPage.selectSomeone');
      return;
    }
    await registerSelection({
      eventId: current.event.id ?? publicId,
      user: { uid, displayName: currentViewer.current.displayName },
      companions: chosen.map((item) => ({
        companionId: item.id,
        companionName: item.name,
      })),
    }, includeSelf);
    if (!alive.current) return;
    setSheet(null);
    show('events.detailPage.signupSuccess');
    await refresh(current);
  }

  async function beginSignup(forceSheet: boolean): Promise<void> {
    if (!snapshot || !visible || refreshFailed) return;
    if (!viewer.uid) {
      await login();
      return;
    }
    if (!check(snapshot, !forceSheet)) return;

    const available = await loadSignupCompanions(viewer.uid);
    if (!alive.current) return;
    if (available.length > 0 || forceSheet) {
      setCompanions(available);
      setSelected(forceSheet || selfRegistered ? [] : ['self']);
      setSheet('signup');
    } else {
      await submitSignup(snapshot, ['self']);
    }
  }

  async function submitCancel(): Promise<void> {
    if (!snapshot || !viewer.uid || !visible || selected.length === 0) return;
    const targets = owned.filter((reg) => selected.includes(registrationId(reg)));
    if (targets.length !== selected.length || targets.some((reg) => !registrationId(reg))) {
      show('events.detailPage.refreshError');
      setRefreshFailed(true);
      return;
    }
    await cancelRegistration({
      eventId: snapshot.event.id ?? publicId,
      userId: viewer.uid,
      registrationIds: targets.map(registrationId),
      kind: targets.length === 1 && !isCompanion(targets[0]!)
        ? 'self' : 'companion',
    });
    if (!alive.current) return;
    setSheet(null);
    show('events.detailPage.cancelSuccess');
    await refresh(snapshot);
  }

  function toggle(key: string, checked: boolean): void {
    setSelected((previous) => checked
      ? Array.from(new Set([...previous, key]))
      : previous.filter((value) => value !== key));
  }

  function profile(uid: string): void {
    if (uid) location.route(`/profile/${encodeURIComponent(uid)}`);
  }

  function name(reg: DetailRegistration): string {
    return reg.companionName || reg.userName || t('events.detailPage.unnamed');
  }

  function guestRoster(status: 'confirmed' | 'waitlisted'): JSX.Element | null {
    if (!event) return null;
    const people = guestEventPeople(
      event,
      status === 'confirmed' ? 'participants' : 'waitlistNames',
    );
    // A 的 _renderGuestWaitlistSection 在無候補姓名時不顯示候補名單區塊。
    if (status === 'waitlisted' && people.length === 0) return null;
    return (
      <section class="event-detail__section">
        <Text as="h2">{t(`events.detailPage.${status}`)} {people.length}</Text>
        {people.length === 0 ? <Text>{t('events.detailPage.emptyRoster')}</Text> : (
          <ul class="event-detail__roster">
            {people.map((person, index) => (
              <li key={`${status}:${index}:${person.uid}`}>
                <UserTag uid={person.uid} name={person.name} role={roles[person.uid]}
                  disabled={!person.uid} onOpenProfile={profile} />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const toast = notice && (
    <Toast
      key={notice.serial}
      message={t(notice.key, notice.params)}
      onClose={() => setNotice(null)}
    />
  );

  if (phase === 'loading') {
    return <section class="event-detail" aria-busy="true">
      <Text>{t('events.detailPage.loading')}</Text>{toast}
    </section>;
  }
  if (phase === 'error') {
    return <section class="event-detail">
      <Text as="h1">{t('events.detailPage.loadError')}</Text>
      <Button onClick={() => setReload((value) => value + 1)}>
        {t('events.retry')}
      </Button>
      {toast}
    </section>;
  }
  if (phase === 'missing' || !snapshot || !event || !visible) {
    return <section class="event-detail">
      <Text as="h1">{t('events.detailPage.notFound')}</Text>
      <a href="/activities"><Text>{t('events.pageTitle')}</Text></a>
    </section>;
  }

  const confirmedCount = viewer.uid ? count(event.current) : guestConfirmedCount(event);
  const waitlistCount = !viewer.uid && Array.isArray(event.waitlistNames)
    ? event.waitlistNames.length : count(event.waitlist);
  const state = getSignupButtonState({
    event: viewer.uid ? event : { ...event, current: confirmedCount },
    viewer,
    registrations: actionRegistrations,
    now: new Date(now),
  });
  const cover = safeImageUrl(event.imageVariants?.cover || event.image);
  const range = eventDateRange(event.date);
  const maximum = count(event.max);
  const remaining = maximum > 0 ? Math.max(0, maximum - confirmedCount) : null;
  const fee = count(event.fee);
  const selectedCount = selected.length;
  const waitlistedEstimate = remaining === null ? 0 : Math.max(0, selectedCount - remaining);
  const hostUid = event.creatorUid ?? '';
  const canAdd = !['ended', 'upcoming', 'cancelled'].includes(event.status ?? '') &&
    !(range && Date.parse(range.start) <= now);

  return (
    <section class="event-detail">
      <header class="event-detail__header">
        <a href="/activities" aria-label={t('events.pageTitle')}>
          <Text>‹</Text>
        </a>
        <Text as="h1">{event.title || t('events.card.untitled')}</Text>
        {/* 收藏、編輯／管理按鈕延後。 */}
      </header>

      <div class="event-detail__cover">
        {cover ? (
          <img src={cover} alt={event.title ?? ''} width="1200" height="450"
            decoding="async" />
        ) : <Text>{t('events.detailPage.noCover')}</Text>}
      </div>

      <div class="event-detail__body">
        <div class="event-detail__row">
          <Text class="event-detail__label">{t('events.detailPage.location')}</Text>
          <div>
            <Text>{event.location || t('events.card.locationUnknown')}</Text>
            {event.location && (
              <a class="event-detail__map"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                target="_blank" rel="noopener noreferrer">
                <Text>{t('events.detailPage.map')}</Text>
              </a>
            )}
          </div>
        </div>

        <div class="event-detail__row">
          <Text class="event-detail__label">{t('events.detailPage.time')}</Text>
          {range ? <div>
            <DateTime value={range.start} variant="datetime"
              options={{ timeZone: 'Asia/Taipei' }} />
            {range.end && <>
              <Text> – </Text>
              <DateTime value={range.end} variant="time"
                options={{ timeZone: 'Asia/Taipei' }} />
            </>}
          </div> : <Text>{event.date || t('events.card.dateUnknown')}</Text>}
        </div>

        {event.regOpenTime && Number.isFinite(Date.parse(event.regOpenTime)) && (
          <div class="event-detail__row">
            <Text class="event-detail__label">{t('events.detailPage.opens')}</Text>
            <DateTime value={event.regOpenTime} options={{ timeZone: 'Asia/Taipei' }} />
          </div>
        )}

        <div class="event-detail__stats" aria-live="polite">
          <div>
            <Text class="event-detail__label">{t('events.detailPage.fee')}</Text>
            <Text>{fee > 0 ? `NT$${fee}` : t('events.detailPage.free')}</Text>
          </div>
          <div>
            <Text class="event-detail__label">{t('events.detailPage.people')}</Text>
            <Text>{t('events.card.capacity', {
              current: confirmedCount,
              max: maximum,
            })}</Text>
          </div>
          <div>
            <Text class="event-detail__label">{t('events.detailPage.waitlisted')}</Text>
            <Text>{waitlistCount}</Text>
          </div>
        </div>

        <div class="event-detail__row event-detail__host">
          <Text class="event-detail__label">{t('events.detailPage.host')}</Text>
          <UserTag uid={hostUid} role={roles[hostUid]}
            name={event.creator || event.creatorName || t('events.detailPage.unnamed')}
            disabled={!hostUid} onOpenProfile={profile} />
        </div>

        <section class="event-detail__section">
          <Text as="h2">{t('events.detailPage.notes')}</Text>
          <Text as="p" class="event-detail__notes">
            {event.notes || t('events.detailPage.noNotes')}
          </Text>
        </section>

        <div class="event-detail__actions">
          <div class="event-detail__toolbar">
            <Button disabled={busy || refreshFailed || !canAdd}
              onClick={() => start(() => beginSignup(true))}>
              {t('events.detailPage.companionSignup')}
            </Button>
            {/* A 的分享、行事曆位置本批留空，不放不可用按鈕。 */}
          </div>
          <Button
            class={`event-detail__primary event-detail__primary--${state.tone}`}
            loading={busy}
            disabled={state.disabled || busy || refreshFailed}
            onClick={() => {
              if (state.action === 'cancel') {
                setSelected(owned.map(registrationId).filter(Boolean));
                setSheet('cancel');
              } else if (state.action === 'explain') {
                show(state.messageKey ?? 'events.detailPage.actionError');
              } else if (state.action === 'signup') {
                start(() => beginSignup(false));
              }
            }}
          >
            {t(state.labelKey)}
          </Button>
          {historyFailed && !refreshFailed && (
            <div role="alert">
              <Text>{t('events.detailPage.historyError')}</Text>
              <Button disabled={busy}
                onClick={() => setReload((value) => value + 1)}>
                {t('events.retry')}
              </Button>
            </div>
          )}
          {refreshFailed && (
            <div role="alert">
              <Text>{t('events.detailPage.refreshError')}</Text>
              <Button loading={busy} disabled={busy}
                onClick={() => start(() => refresh(snapshot))}>
                {t('events.retry')}
              </Button>
            </div>
          )}
        </div>

        {!viewer.uid ? <>
          {guestRoster('confirmed')}
          {guestRoster('waitlisted')}
        </> : (
          <section class="event-detail__section"
            aria-label={t('events.detailPage.roster')}
            aria-busy={rosterPhase === 'loading'}>
            {rosterPhase === 'loading' ? (
              <Text>{t('events.detailPage.rosterLoading')}</Text>
            ) : rosterPhase === 'error' ? (
              <div role="alert">
                <Text>{t('events.detailPage.rosterError')}</Text>
                {!refreshFailed && (
                  <Button disabled={busy} onClick={() => { void retryRoster(); }}>
                    {t('events.retry')}
                  </Button>
                )}
              </div>
            ) : <>
              <AttendanceRosterTable
                event={event}
                registrations={snapshot.registrations}
                attendanceRecords={snapshot.attendanceRecords}
                roles={roles}
                onOpenProfile={profile}
                canManage={canManageRoster}
                editing={rosterEditing}
                submitting={rosterSubmitting}
                onStartEdit={handleStartRosterEdit}
                onCloseEdit={() => { void handleCloseRosterEdit(); }}
                getRowSelection={instantSave.getRowSelection}
                inFlightKeys={instantSave.inFlightKeys}
                savedFlashKeys={instantSave.savedFlashKeys}
                failedFlashKeys={instantSave.failedFlashKeys}
                onToggleCheckbox={instantSave.onToggleCheckbox}
                onChangeNote={instantSave.onChangeNote}
              />
              <WaitlistRosterTable
                event={event}
                registrations={snapshot.registrations}
                roles={roles}
                onOpenProfile={profile}
              />
            </>}
          </section>
        )}
        {/* A 名單下方留言區延後。 */}
      </div>

      <BottomSheet
        open={sheet !== null}
        title={t(sheet === 'cancel'
          ? 'events.detailPage.cancelTitle' : 'events.detailPage.chooseParticipants')}
        loading={busy}
        closeOnEsc={!busy}
        closeOnOverlay={!busy}
        onClose={() => { if (!busy) setSheet(null); }}
        footer={<Button
          loading={busy}
          disabled={busy || selected.length === 0}
          onClick={() => start(() => sheet === 'cancel'
            ? submitCancel()
            : submitSignup(snapshot, selected))}
        >
          {t(sheet === 'cancel'
            ? 'events.detailPage.confirmCancel' : 'events.detailPage.confirmSignup')}
        </Button>}
      >
        <div class="event-detail__selection">
          <Text>{event.title || t('events.card.untitled')}</Text>
          {sheet === 'cancel' ? <>
            <Text as="p">{t('events.detailPage.cancelHint')}</Text>
            {owned.map((reg) => {
              const key = registrationId(reg);
              return <Checkbox key={key} label={name(reg)}
                disabled={busy || !key}
                checked={selected.includes(key)}
                onCheckedChange={(checked) => toggle(key, checked)} />;
            })}
          </> : <>
            <Checkbox
              label={`${viewer.displayName || t('events.detailPage.unnamed')} ${t('events.detailPage.self')}`}
              disabled={busy || selfRegistered}
              checked={selfRegistered || selected.includes('self')}
              onCheckedChange={(checked) => toggle('self', checked)}
            />
            {companions.map((item) => {
              const registered = signedCompanions.has(item.id);
              const key = `companion:${item.id}`;
              return <Checkbox key={item.id}
                label={`${item.name}${registered ? ` ${t('events.detailPage.registered')}` : ''}`}
                checked={registered || selected.includes(key)}
                disabled={busy || registered}
                onCheckedChange={(checked) => toggle(key, checked)} />;
            })}
            {companions.length === 0 && <Text>{t('events.detailPage.noCompanions')}</Text>}
            <div aria-live="polite">
              <Text as="p">{t('events.detailPage.selected', { count: selectedCount })}</Text>
              <Text as="p">{t('events.detailPage.totalFee', { fee: fee * selectedCount })}</Text>
              {remaining !== null && <Text as="p">
                {t('events.detailPage.remaining', { count: remaining })}
              </Text>}
              {waitlistedEstimate > 0 && <Text as="p">
                {t('events.detailPage.waitlistEstimate', { count: waitlistedEstimate })}
              </Text>}
            </div>
          </>}
        </div>
      </BottomSheet>
      {toast}
    </section>
  );
}
