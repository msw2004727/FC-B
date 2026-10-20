import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { lt, useT } from '@/i18n/i18n';
import { UserTag } from '@/ui/UserTag';
import { Toast, toast } from '@/ui/Toast';
import { appConfirm } from '@/ui/AppConfirm';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
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
import {
  canOperateEventSite,
  canRemoveConfirmedParticipant,
} from '../data/operate-permissions';
import { managerRemoveRegistration } from '../data/roster-remove';
import {
  count,
  eventDateRange,
  guestConfirmedCount,
  guestEventPeople,
  isActiveRegistration,
  isCompanion,
  registrationId,
  registrationOwner,
  sortRegistrations,
  type DetailEvent,
  type DetailRegistration,
} from '../data/detail-model';
import {
  buildConfirmedRoster,
  type ConfirmedRosterPerson,
} from '../data/attendance-roster-model';
import { AttendanceRosterTable } from '../components/AttendanceRosterTable';
import { UnregRosterTable, buildUnregPeopleList } from '../components/UnregRosterTable';
import { useAttendanceInstantSave } from '../components/useAttendanceInstantSave';
import { WaitlistRosterTable } from '../components/WaitlistRosterTable';
import {
  DetailAttendanceLoading,
  DetailAttendanceSummary,
} from '../components/legacy/DetailAttendanceSummary';
import {
  CompanionSelectModal,
  EventDetailCover,
  EventDetailInfoSection,
  EventDetailPrimaryButton,
  type LegacyDetailEvent,
} from '../components/legacy/EventDetailMainView';
import type { RegistrationDoc } from '../data/types';
import '../legacy/activity.css';
import '../legacy/tournament-td-img-placeholder.css';

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
type RosterPhase = 'idle' | 'loading' | 'ready' | 'error';

const UNAVAILABLE_MSG = '此功能尚未開放，請先使用舊版';

/**
 * 照舊版 A `event-detail.js#_canManageDetailAttendanceRecords`（第 129～134 行）。
 */
function canManageDetailAttendanceRecords(
  viewer: ViewerView,
  event: DetailEvent | null | undefined,
): boolean {
  if (!event) return false;
  return canOperateEventSite(operateContextFromViewer(viewer), event) === true;
}

/**
 * 照舊版 A `event-detail.js#_canViewDetailAttendanceRecordDetails`（第 136～140 行）。
 */
function canViewDetailAttendanceRecordDetails(
  viewer: ViewerView,
  event: DetailEvent | null | undefined,
): boolean {
  if (canManageDetailAttendanceRecords(viewer, event)) return true;
  return (
    viewer.hasPermission('activity.view_noshow')
    || viewer.hasPermission('admin.repair.no_show_adjust')
  );
}

export default function EventDetailPage({ id }: { id?: string }): JSX.Element {
  const location = useLocation();
  const routeId = id ?? location.path.split('/')[2] ?? '';
  const viewer = useViewer();

  // UID/活動變更立即隔離 DOM 與所有未完成操作，避免 effect 清理前洩漏舊資料。
  return (
    <EventDetailSession
      key={`${routeId}:${viewer.uid ?? 'guest'}`}
      publicId={routeId}
      viewer={viewer}
    />
  );
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
  const [rosterPhase, setRosterPhase] = useState<RosterPhase>('idle');
  const [rosterExpanded, setRosterExpanded] = useState(false);
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

  function handleUnavailable(e?: MouseEvent): void {
    if (e) e.stopPropagation();
    // 下一批補：瀏覽次數、重新整理、報名紀錄、公開切換、分享、行事曆、留言、收藏、聯繫主辦
    toast.show({ message: UNAVAILABLE_MSG });
  }

  function errorKey(error: unknown, fallback: string): string {
    if (!(error instanceof SignupError)) return fallback;
    return error.messageKey.startsWith('event.')
      ? `events.${error.messageKey.slice('event.'.length)}`
      : error.messageKey;
  }

  useEffect(() => {
    const request = ++sequence.current;
    rosterSequence.current += 1;
    rosterPending.current = false;
    let disposed = false;
    const current = (): boolean =>
      !disposed && alive.current && request === sequence.current;

    setPhase('loading');
    setRosterPhase('idle');
    setRosterExpanded(false);
    setHistoryFailed(false);
    setSnapshot(null);

    async function load(): Promise<void> {
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(publicId)) {
        if (current()) setPhase('missing');
        return;
      }

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

      if (!viewer.uid) {
        setRosterPhase('ready');
      }
    }

    load().catch(() => {
      if (current()) setPhase('error');
    });
    return () => {
      disposed = true;
    };
  }, [publicId, viewer.uid, reload]);

  async function fetchRosterForSnapshot(current: Snapshot): Promise<void> {
    if (
      !currentViewer.current.uid
      || rosterPending.current
      || operation.current
      || refreshFailed
      || !isEventVisibleToUser(current.event, currentViewer.current, current.viewerRegistrations)
    ) {
      return;
    }
    rosterPending.current = true;
    const request = ++rosterSequence.current;
    setRosterPhase('loading');
    const canViewDetails = canViewDetailAttendanceRecordDetails(
      currentViewer.current,
      current.event,
    );
    try {
      const [registrations, attendanceRecords] = await Promise.all([
        loadEventRegistrations(current.eventDocId),
        canViewDetails
          ? loadEventAttendance(current.eventDocId).catch(() => [] as EventAttendanceEntry[])
          : Promise.resolve([] as EventAttendanceEntry[]),
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

  function handleOpenDetailAttendanceRecords(): void {
    const current = snapshot;
    if (!current || !currentViewer.current.uid) return;
    setRosterExpanded(true);
    if (rosterPhase === 'ready' || rosterPhase === 'loading') return;
    fetchRosterForSnapshot(current).catch(() => {});
  }

  async function retryRoster(): Promise<void> {
    const current = snapshot;
    if (!current) return;
    await fetchRosterForSnapshot(current);
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
    const uid = currentViewer.current.uid;
    if (!uid) return;
    const request = ++rosterSequence.current;
    const canViewDetails = canViewDetailAttendanceRecordDetails(
      currentViewer.current,
      current.event,
    );
    try {
      const [registrations, history, attendanceRecords] = await Promise.all([
        loadEventRegistrations(current.eventDocId),
        loadViewerRegistrations(uid),
        rosterExpanded && canViewDetails
          ? loadEventAttendance(current.eventDocId).catch(() => current.attendanceRecords)
          : Promise.resolve(current.attendanceRecords),
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
      if (rosterExpanded) {
        setRosterPhase('ready');
      }
      setHistoryFailed(false);
      setRefreshFailed(false);
    } catch (error) {
      if (!alive.current || request !== rosterSequence.current) return;
      if (rosterExpanded) {
        setRosterPhase('error');
      }
      setRefreshFailed(true);
      show(errorKey(error, 'events.detailPage.refreshError'));
    }
  }

  const visible = snapshot !== null &&
    isEventVisibleToUser(snapshot.event, viewer, snapshot.viewerRegistrations);
  const event = snapshot?.event as LegacyDetailEvent | undefined;
  const active = sortRegistrations(snapshot?.registrations ?? []);

  // 收集頁面上會出現的所有 UserTag uid，一次查角色（R-ID-002：只用 UID）。
  const roleUids: string[] = [];
  if (event) {
    if (event.creatorUid) roleUids.push(event.creatorUid);
    if (Array.isArray(event.delegates)) {
      for (const d of event.delegates as unknown[]) {
        if (d && typeof d === 'object' && 'uid' in d && typeof d.uid === 'string' && d.uid) {
          roleUids.push(d.uid);
        }
      }
    }
    for (const person of guestEventPeople(event, 'participants')) roleUids.push(person.uid);
    for (const person of guestEventPeople(event, 'waitlistNames')) roleUids.push(person.uid);
  }
  for (const reg of active) {
    if (isCompanion(reg)) continue;
    const owner = registrationOwner(reg);
    if (owner) roleUids.push(owner);
  }
  const roles = useUserRoles(viewer.uid ? roleUids : []);

  const eventId = event?.id ?? publicId;
  const operateCtx = operateContextFromViewer(viewer);
  const canManageRoster = canManageDetailAttendanceRecords(viewer, event);
  const canRemoveConfirmed = Boolean(
    event && canRemoveConfirmedParticipant(operateCtx, event) === true,
  );
  const canViewAttendanceDetails = canViewDetailAttendanceRecordDetails(viewer, event);
  const publicRosterOnly = !canViewAttendanceDetails;

  const reloadAttendanceOnly = async (): Promise<readonly EventAttendanceEntry[]> => {
    const docId = snapshot?.eventDocId;
    if (!docId || !canViewDetailAttendanceRecordDetails(currentViewer.current, snapshot?.event)) {
      return snapshot?.attendanceRecords ?? [];
    }
    const records = await loadEventAttendance(docId);
    if (alive.current) {
      setSnapshot((prev) => (prev && prev.eventDocId === docId
        ? { ...prev, attendanceRecords: records }
        : prev));
    }
    return records;
  };

  const instantSave = useAttendanceInstantSave({
    event,
    eventDocId: snapshot?.eventDocId ?? '',
    publicEventId: eventId,
    operatorUid: viewer.uid,
    registrations: snapshot?.registrations ?? [],
    attendanceRecords: snapshot?.attendanceRecords ?? [],
    onReloadAttendance: reloadAttendanceOnly,
    onSaveFailed: (personName) => {
      show('events.roster.saveFailed', { name: personName });
    },
  });

  function handleStartRosterEdit(): void {
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

  async function handleKickParticipant(person: ConfirmedRosterPerson): Promise<void> {
    if (!snapshot || rosterSubmitting) return;
    const targetName = person.name || person.displayName || '';
    const confirmed = await appConfirm(`確定要將 ${targetName} 從報名名單中移除嗎？`);
    if (!confirmed || !alive.current) return;

    setRosterSubmitting(true);
    try {
      await instantSave.flushInstantSaves();
      if (!alive.current) return;

      const actionRegistrationId = person.courseLinkedRegistration ? (person.regDocId || '') : '';
      const result = await managerRemoveRegistration({
        eventId,
        event: snapshot.event,
        registration: {
          uid: person.uid,
          name: targetName,
          isCompanion: person.isCompanion,
          registrationId: actionRegistrationId,
        },
        registrations: snapshot.registrations,
        operatorUid: currentViewer.current.uid,
        operatorName: currentViewer.current.displayName || undefined,
        context: operateContextFromViewer(currentViewer.current),
      });

      if (!alive.current) return;
      if (result.toastMessage) {
        toast.show({
          message: result.toastMessage,
          tone: result.ok ? 'success' : 'error',
        });
      }
      if (result.ok) {
        await refresh(snapshot);
      }
    } finally {
      if (alive.current) {
        setRosterSubmitting(false);
      }
    }
  }

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
    const history = current.viewerRegistrations.filter((reg) => reg.eventId === currentEventId);
    const result = precheckSignup(current.event, currentViewer.current, history, new Date());
    if (result.ok) return true;

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
    if (status === 'waitlisted' && people.length === 0) return null;
    return (
      <div class="detail-section">
        <div class="detail-section-title">
          {`${t(`events.detailPage.${status}`)} ${people.length}`}
        </div>
        {people.length === 0 ? (
          <div>{t('events.detailPage.emptyRoster')}</div>
        ) : (
          <ul class="participant-list" style="list-style:none;padding:0;margin:0">
            {people.map((person, index) => (
              <li key={`${status}:${index}:${person.uid}`}>
                <UserTag
                  uid={person.uid}
                  name={person.name}
                  role={roles[person.uid]}
                  disabled={!person.uid}
                  onOpenProfile={profile}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const noticeToast = notice && (
    <Toast
      key={notice.serial}
      message={t(notice.key, notice.params)}
      onClose={() => setNotice(null)}
    />
  );

  if (phase === 'loading') {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-activity-detail" aria-busy="true">
          <div class="detail-body" id="detail-body">
            <div class="reg-loading">{t('events.detailPage.loading')}</div>
          </div>
          {noticeToast}
        </section>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-activity-detail">
          <div class="detail-body" id="detail-body">
            <h1>{t('events.detailPage.loadError')}</h1>
            <button
              type="button"
              class="outline-btn"
              onClick={() => setReload((value) => value + 1)}
            >
              {t('events.retry')}
            </button>
          </div>
          {noticeToast}
        </section>
      </div>
    );
  }

  if (phase === 'missing' || !snapshot || !event || !visible) {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-activity-detail">
          <div class="detail-body" id="detail-body">
            <h1>{t('events.detailPage.notFound')}</h1>
            <a href="/activities">{t('events.pageTitle')}</a>
          </div>
        </section>
      </div>
    );
  }

  const confirmedCount = viewer.uid ? count(event.current) : guestConfirmedCount(event);
  const waitlistCount = !viewer.uid && Array.isArray(event.waitlistNames)
    ? event.waitlistNames.length : count(event.waitlist);

  // 照舊版 A `_getDetailAttendanceSummaryCounts`（第 103～123 行）：
  // 尚未展開讀取 registrations 時，`canUseRegistrationRows = false`，以權威計數與 `participantsWithUid` 取大者。
  const summaryConfirmedResult = buildConfirmedRoster(event, snapshot.registrations, {
    canUseRegistrationRows: rosterPhase === 'ready',
  });
  const summaryConfirmedCount = Number.isFinite(summaryConfirmedResult.count)
    ? summaryConfirmedResult.count
    : confirmedCount;
  const summaryWaitlistCount = Math.max(0, count(event.waitlist));

  const state = getSignupButtonState({
    event: viewer.uid ? event : { ...event, current: confirmedCount },
    viewer,
    registrations: actionRegistrations,
    now: new Date(now),
  });
  const range = eventDateRange(event.date);
  const maximum = count(event.max);
  const remaining = maximum > 0 ? Math.max(0, maximum - confirmedCount) : null;
  const fee = count(event.fee);
  const selectedCount = selected.length;
  const waitlistedEstimate = remaining === null ? 0 : Math.max(0, selectedCount - remaining);
  const canAdd = !['ended', 'upcoming', 'cancelled'].includes(event.status ?? '') &&
    !(range && Date.parse(range.start) <= now);
  const viewCountNum = count(event.viewCount);
  const hasUnregRecords =
    rosterExpanded
    && rosterPhase === 'ready'
    && buildUnregPeopleList(snapshot.attendanceRecords).length > 0;

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-activity-detail">
        <div class="page-header">
          <button
            type="button"
            class="back-btn"
            aria-label={lt('返回', '返回')}
            data-i18n-aria-label="返回"
            onClick={() => location.route('/activities')}
          >
            <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M15 6l-6 6 6 6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex:1;min-width:0">
            <h2 id="detail-title" style="margin:0;min-width:0;flex:1" data-i18n="活動名稱">
              {event.title || t('events.card.untitled')}
              {' '}
              {/* 下一批補：收藏愛心 */}
              <button
                type="button"
                class="fav-heart"
                data-fav-type="Event"
                data-fav-id={eventId}
                title="加入收藏"
                aria-label="加入收藏"
                onClick={handleUnavailable}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--text-muted)"
                  stroke-width="2"
                >
                  <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
                </svg>
              </button>
            </h2>
            {/* 下一批補：公開／私密活動切換 */}
            <div
              id="detail-public-toggle-wrap"
              style={canManageRoster ? 'flex-shrink:0' : 'display:none;flex-shrink:0'}
            >
              <button
                type="button"
                class="event-reg-log-btn"
                onClick={handleUnavailable}
              >
                {event.privateEvent ? '私密' : '公開'}
              </button>
            </div>
            {/* 下一批補：瀏覽次數累積寫入 */}
            <div
              id="detail-view-count-wrap"
              class="event-view-count"
              style="flex-shrink:0"
              aria-label={lt('瀏覽次數', '瀏覽次數')}
              title={lt('瀏覽次數', '瀏覽次數')}
              data-i18n-aria-label="瀏覽次數"
              data-i18n-title="瀏覽次數"
              onClick={handleUnavailable}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span id="detail-view-count-num">{viewCountNum.toLocaleString()}</span>
            </div>
            {/* 下一批補：手動重新整理按鈕 */}
            <div
              id="detail-refresh-btn-wrap"
              style={viewer.uid ? 'flex-shrink:0' : 'display:none;flex-shrink:0'}
            >
              <button
                type="button"
                class="event-detail-refresh-btn"
                title="重新整理"
                aria-label="重新整理"
                onClick={handleUnavailable}
              >
                ↻
              </button>
            </div>
            {/* 下一批補：報名紀錄彈窗 */}
            <div
              id="detail-log-btn-wrap"
              style={viewer.uid ? 'flex-shrink:0' : 'display:none;flex-shrink:0'}
            >
              <button
                type="button"
                class="event-reg-log-btn"
                onClick={handleUnavailable}
              >
                報名紀錄
              </button>
            </div>
          </div>
        </div>

        <EventDetailCover
          event={event}
          canEdit={canManageRoster}
          onUnavailable={handleUnavailable}
        />

        <div class="detail-body" id="detail-body">
          <EventDetailInfoSection
            event={event}
            confirmedCount={confirmedCount}
            waitlistCount={waitlistCount}
            nowMs={now}
            roles={roles}
            onOpenProfile={profile}
            onUnavailable={handleUnavailable}
          />

          <div class="detail-action-zone">
            <div class="detail-action-toolbar">
              <div
                class="signup-glow-wrap"
                style="--glow-c:#2563eb;--glow-c-light:#60a5fa"
              >
                <div class="signup-glow-border" />
                <div class="signup-glow-shadow" />
                <div class="signup-flipper">
                  <button
                    type="button"
                    class="detail-toolbar-btn companion-signup-toolbar-action"
                    disabled={busy || refreshFailed || !canAdd}
                    onClick={() => start(() => beginSignup(true))}
                  >
                    幫夥伴報名
                  </button>
                </div>
                <div class="signup-loading-hint">
                  <div class="mini-spinner" />
                  <span class="mini-text">寫入中</span>
                </div>
              </div>
              {/* 下一批補：分享活動 */}
              <button
                type="button"
                class="detail-toolbar-btn"
                onClick={handleUnavailable}
              >
                分享活動
              </button>
              {/* 下一批補：加入行事曆 */}
              <button
                type="button"
                class="detail-toolbar-btn"
                onClick={handleUnavailable}
              >
                加入行事曆
              </button>
              {/* 下一批補：現場簽到導覽 */}
              {canManageRoster && (
                <button
                  type="button"
                  class="detail-toolbar-btn"
                  onClick={handleUnavailable}
                >
                  現場簽到
                </button>
              )}
            </div>

            <div class="detail-action-primary" id="detail-action-primary">
              <EventDetailPrimaryButton
                event={event}
                isGuest={!viewer.uid}
                state={state}
                label={t(state.labelKey)}
                disabled={state.disabled || busy || refreshFailed}
                busy={busy}
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
              />
            </div>

            {historyFailed && !refreshFailed && (
              <div role="alert" style="margin-top:.5rem">
                <span>{t('events.detailPage.historyError')}</span>
                <button
                  type="button"
                  class="outline-btn"
                  disabled={busy}
                  onClick={() => setReload((value) => value + 1)}
                >
                  {t('events.retry')}
                </button>
              </div>
            )}

            {refreshFailed && (
              <div role="alert" style="margin-top:.5rem">
                <span>{t('events.detailPage.refreshError')}</span>
                <button
                  type="button"
                  class="outline-btn"
                  disabled={busy}
                  onClick={() => start(() => refresh(snapshot))}
                >
                  {t('events.retry')}
                </button>
              </div>
            )}
          </div>

          {!viewer.uid ? (
            <>
              <div class="detail-section">
                <div id="detail-attendance-table">
                  {guestRoster('confirmed')}
                </div>
              </div>
              <div id="detail-waitlist-container">
                {guestRoster('waitlisted')}
              </div>
              <div class="detail-section" id="detail-unreg-section" style="display:none">
                <div id="detail-unreg-table" />
              </div>
            </>
          ) : (
            <section
              aria-label={t('events.detailPage.roster')}
              aria-busy={rosterExpanded && rosterPhase === 'loading'}
            >
              <div class="detail-section">
                <div id="detail-attendance-table">
                  {!rosterExpanded ? (
                    <DetailAttendanceSummary
                      eventId={eventId}
                      confirmedCount={summaryConfirmedCount}
                      waitlistCount={summaryWaitlistCount}
                      max={maximum}
                      canManage={canManageRoster}
                      canViewRecords={canViewAttendanceDetails}
                      onOpen={handleOpenDetailAttendanceRecords}
                    />
                  ) : rosterPhase === 'loading' ? (
                    <DetailAttendanceLoading
                      canManage={canManageRoster}
                      canViewRecords={canViewAttendanceDetails}
                    />
                  ) : rosterPhase === 'error' ? (
                    <div role="alert">
                      <div>{t('events.detailPage.rosterError')}</div>
                      {!refreshFailed && (
                        <button
                          type="button"
                          class="outline-btn"
                          disabled={busy}
                          onClick={() => { retryRoster().catch(() => {}); }}
                        >
                          {t('events.retry')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <AttendanceRosterTable
                      event={event}
                      registrations={snapshot.registrations}
                      attendanceRecords={snapshot.attendanceRecords}
                      roles={roles}
                      onOpenProfile={profile}
                      canManage={canManageRoster}
                      canRemoveConfirmed={canRemoveConfirmed}
                      publicRosterOnly={publicRosterOnly}
                      editing={rosterEditing}
                      submitting={rosterSubmitting}
                      onStartEdit={handleStartRosterEdit}
                      onCloseEdit={() => { handleCloseRosterEdit().catch(() => {}); }}
                      onKickParticipant={(person) => { handleKickParticipant(person).catch(() => {}); }}
                      getRowSelection={instantSave.getRowSelection}
                      inFlightKeys={instantSave.inFlightKeys}
                      savedFlashKeys={instantSave.savedFlashKeys}
                      failedFlashKeys={instantSave.failedFlashKeys}
                      onToggleCheckbox={instantSave.onToggleCheckbox}
                      onChangeNote={instantSave.onChangeNote}
                    />
                  )}
                </div>
              </div>
              <div id="detail-waitlist-container">
                {rosterExpanded && rosterPhase === 'ready' && (
                  <WaitlistRosterTable
                    event={event}
                    registrations={snapshot.registrations}
                    roles={roles}
                    onOpenProfile={profile}
                  />
                )}
              </div>
              <div
                class="detail-section"
                id="detail-unreg-section"
                style={hasUnregRecords ? '' : 'display:none'}
              >
                <div id="detail-unreg-table">
                  {hasUnregRecords && (
                    <UnregRosterTable
                      eventId={eventId}
                      eventDocId={snapshot.eventDocId}
                      eventTitle={event.title || t('events.card.untitled')}
                      attendanceRecords={snapshot.attendanceRecords}
                      canManage={canManageRoster}
                      operatorUid={viewer.uid}
                      operatorName={viewer.displayName || undefined}
                      onReloadAttendance={reloadAttendanceOnly}
                      onToast={(message) => {
                        toast.show({ message });
                      }}
                    />
                  )}
                </div>
              </div>
            </section>
          )}

          {/* 下一批補：活動留言區塊 */}
          <div id="detail-comments-container" onClick={handleUnavailable}>
            <div class="detail-section event-comments-section">
              <div class="detail-section-title">留言</div>
              <div class="event-comments-empty" style="cursor:pointer">
                留言功能（點擊查看）
              </div>
            </div>
          </div>
        </div>

        <CompanionSelectModal
          open={sheet !== null}
          mode={sheet}
          eventTitle={event.title || t('events.card.untitled')}
          viewerName={viewer.displayName || t('events.detailPage.unnamed')}
          selfRegistered={selfRegistered}
          companions={companions}
          signedCompanions={signedCompanions}
          ownedItems={owned.map((reg) => ({
            key: registrationId(reg),
            label: name(reg),
          }))}
          selected={selected}
          busy={busy}
          fee={fee}
          remaining={remaining}
          waitlistedEstimate={waitlistedEstimate}
          t={t}
          onToggle={toggle}
          onClose={() => { if (!busy) setSheet(null); }}
          onConfirm={() => start(() => (sheet === 'cancel'
            ? submitCancel()
            : submitSignup(snapshot, selected)))}
        />
        {noticeToast}
      </section>
    </div>
  );
}
