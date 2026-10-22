import type { JSX } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import type { EventCommentsSectionProps } from '../components/legacy/EventCommentsSection';
import {
  EventDetailHeaderActions,
  canEditDetailActivity,
} from '../components/legacy/EventDetailHeaderActions';
import { canViewEventOperationLog } from '../data/operate-permissions';
import { getEventLimitedTeamIds, loadEventStaffTeamIds } from '../data/team-staff';
import { incrementEventViewCount, mergeViewCount } from '../data/event-view-count';
import type { RegLogRegistration } from '../data/event-reg-log';
import { useGoBack } from '@/core/back-guard';
import { lt, useT } from '@/i18n/i18n';
import { Toast, toast } from '@/ui/Toast';
import { appConfirm } from '@/ui/AppConfirm';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { useUserRoles } from '@/data/user-roles';
import { CALLABLES_DEPLOYED } from '@/data/callables-deployed';
import { settleAttendance } from '../data/attendance-settle';
import { resolveOperator } from '../data/event-lifecycle';
import { loadEventAttendance, type EventAttendanceEntry } from '@/features/checkin/data/attendance';
import { loadEventDetail, loadEventRegistrations } from '../data/event-detail';
import { loadViewerRegistrations } from '../data/viewer-registrations';
import { isEventVisibleToUser } from '../data/visibility';
import { precheckSignup, registerForEvent, cancelRegistration, SignupError } from '../data/signup';
import { registerSelection } from '../data/signup-selection';
import { loadSignupCompanions, type SignupCompanion } from '../data/companions';
import { getSignupButtonState } from '../data/signup-state';
import { loadSignupProfile, type SignupProfile } from '../data/signup-profile';
import {
  canDetailCompanionSignup,
  createDetailSignupContexts,
  detailCompanionGenderMessage,
} from '../data/signup-context';
import { getEventEarlyBirdCost } from '../data/signup-restrictions';
import { effectiveEventStatus } from '../data/my-activities-model';
import { getEventParticipantStats } from '../data/participant-stats';
import { eventStartMs } from '../data/terminal';
import {
  EventDetailPrimaryButton,
  type SignupFlip,
} from '../components/legacy/EventDetailPrimaryButton';
import type { CompanionSelectItem } from '../components/legacy/CompanionSelectModal';
import type { CompanionCancelTarget } from '../components/legacy/CompanionCancelModal';
import { operateContextFromViewer } from '../data/event-create-context';
import {
  canOperateEventSite,
  canRemoveConfirmedParticipant,
} from '../data/operate-permissions';
import { managerRemoveRegistration } from '../data/roster-remove';
import {
  count,
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
import { GuestRosterSections } from '../components/legacy/GuestRosterSections';
import {
  EventDetailCover,
  EventDetailInfoSection,
  calcHeatPrediction,
  type LegacyDetailEvent,
} from '../components/legacy/EventDetailMainView';
import {
  EventDetailLoadingShell,
  EventDetailMissing,
  EventDetailToolbarActions,
} from '../components/legacy/EventDetailLoadingShell';
import type { RegistrationDoc } from '../data/types';
import '../legacy/activity.css';
import '../legacy/tournament-td-img-placeholder.css';

// 照 A _renderDetailCommentsLoadFailure，chunk 失敗只影響留言區。
const EventCommentsSection = lazy(() =>
  import('../components/legacy/EventCommentsSection')
    .catch(() => ({ default: EventCommentsChunkRetry })),
);

function EventCommentsChunkRetry(props: EventCommentsSectionProps): JSX.Element {
  const [Loaded, setLoaded] = useState<
    typeof import('../components/legacy/EventCommentsSection').default | null
  >(null);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  if (Loaded) return <Loaded {...props} />;
  return (
    <div class="detail-section event-comments-section">
      <div class="detail-section-title">留言</div>
      <div class="event-comments-empty event-comments-load-state">
        <div class="event-comments-load-title">
          {loading ? '留言重新載入中...' : '留言暫時無法載入'}
        </div>
        <div class="event-comments-load-note">
          可以先瀏覽活動資訊，稍後再重新載入留言。
        </div>
        <div class="event-comments-load-actions">
          <button
            type="button"
            class="event-comment-retry-btn"
            disabled={loading}
            onClick={() => {
              if (pending.current) return;
              pending.current = true;
              setLoading(true);
              import('../components/legacy/EventCommentsSection').then(
                (module) => {
                  if (alive.current) setLoaded(() => module.default);
                },
                () => {
                  if (alive.current) setLoading(false);
                },
              ).catch(() => {
                if (alive.current) setLoading(false);
              }).finally(() => { pending.current = false; });
            }}
          >
            重新載入留言
          </button>
        </div>
      </div>
    </div>
  );
}

// 照 A 編輯與 Log 入口；穩定 lazy 型別，只在開啟時下載。
const DetailEventFormModal = lazy(() => import('../components/EventFormModal')
  .then(module => ({ default: module.EventFormModal })));
const DetailEventRegLogModal = lazy(() => import('../components/legacy/EventRegLogModal')
  .then(module => ({ default: module.EventRegLogModal })));

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

const DetailCompanionSelectModal = lazy(() =>
  import('../components/legacy/CompanionSelectModal')
    .then(module => ({ default: module.CompanionSelectModal })));
const DetailCompanionCancelModal = lazy(() =>
  import('../components/legacy/CompanionCancelModal')
    .then(module => ({ default: module.CompanionCancelModal })));
const DetailLineNotifyPrompt = lazy(() =>
  import('../components/legacy/LineNotifyPrompt')
    .then(module => ({ default: module.LineNotifyPrompt })));

let nextSignupGeneration = 0;
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
  // M-045：共用返回（前面有本站頁就退回，否則回活動列表）。
  const goBack = useGoBack('/activities');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [rosterPhase, setRosterPhase] = useState<RosterPhase>('idle');
  const [rosterExpanded, setRosterExpanded] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [companions, setCompanions] = useState<SignupCompanion[]>([]);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionBusy, setCompanionBusy] = useState(false);
  const [cancelModal, setCancelModal] = useState<{
    targets: CompanionCancelTarget[];
    selectAll: boolean;
  } | null>(null);
  const [signupProfile, setSignupProfile] = useState<SignupProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(Boolean(viewer.uid));
  const [flip, setFlip] = useState<SignupFlip | null>(null);
  const [linePromptOpen, setLinePromptOpen] = useState(false);
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
  const profileRef = useRef(signupProfile);
  profileRef.current = signupProfile;
  const companionsRef = useRef(companions);
  companionsRef.current = companions;
  const profileSequence = useRef(0);
  const flipSequence = useRef(0);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineAbort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  if (!generation.current) generation.current = ++nextSignupGeneration;
  const signupContexts = useRef<ReturnType<typeof createDetailSignupContexts> | null>(null);
  if (!signupContexts.current) {
    signupContexts.current = createDetailSignupContexts({
      getViewer: () => alive.current ? currentViewer.current : null,
      generation: generation.current,
      getProfile: () => profileRef.current,
      getCompanionGender: id => companionsRef.current.find(item => item.id === id)?.gender,
    });
  }
  const contexts = signupContexts.current;

  useEffect(() => {
    const request = ++profileSequence.current;
    const uid = viewer.uid;
    setProfileLoading(Boolean(uid));
    setSignupProfile(null);
    profileRef.current = null;
    if (!uid) return;
    loadSignupProfile(uid).then(
      value => {
        if (!alive.current || request !== profileSequence.current) return;
        profileRef.current = value;
        setSignupProfile(value);
      },
      () => {
        if (!alive.current || request !== profileSequence.current) return;
        profileRef.current = null;
        setSignupProfile(null);
      },
    ).finally(() => {
      if (alive.current && request === profileSequence.current) setProfileLoading(false);
    });
    return () => { profileSequence.current += 1; };
  }, [viewer.uid]);

  useEffect(() => {
    alive.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive.current = false;
      sequence.current += 1;
      rosterSequence.current += 1;
      profileSequence.current += 1;
      if (flipTimer.current !== null) clearTimeout(flipTimer.current);
      lineAbort.current?.abort();
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
      if (alive.current) {
        if (error instanceof SignupError && [
          'gender_restricted', 'age_restricted', 'event_unavailable',
          'event_ended', 'event_started', 'event_not_open',
          'event_team_only_restricted', 'already_registered',
          'EVENT_ENDED', 'EVENT_STARTED',
        ].includes(error.originalCode)) {
          toast.show({ message: error.message });
        } else {
          show(errorKey(error, 'events.detailPage.actionError'));
        }
      }
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

  const [staffState, setStaffState] = useState<{
    key: string;
    ids: ReadonlySet<string>;
  }>({ key: '', ids: new Set<string>() });
  const [detailViewCount, setDetailViewCount] = useState(0);
  const [editingDetail, setEditingDetail] = useState(false);
  const [detailLogOpen, setDetailLogOpen] = useState(false);
  const headerRefreshPending = useRef(false);
  const headerState = useRef({ snapshot, visible });
  headerState.current = { snapshot, visible };
  const staffKey = JSON.stringify([
    viewer.uid, snapshot?.eventDocId, !!event?.teamOnly, getEventLimitedTeamIds(event),
  ]);
  const staffTeamIds: ReadonlySet<string> = staffState.key === staffKey
    ? staffState.ids : new Set<string>();
  const canEditCover = visible
    && canEditDetailActivity(operateContextFromViewer(viewer), event);
  const canShowDetailLog = visible && !!viewer.uid
    && canViewEventOperationLog(operateContextFromViewer(viewer), event);

  useEffect(() => {
    let disposed = false;
    setStaffState({ key: staffKey, ids: new Set<string>() });
    if (visible && viewer.uid && event?.teamOnly) {
      loadEventStaffTeamIds(viewer.uid, event).then(ids => {
        if (!disposed && alive.current) setStaffState({ key: staffKey, ids });
      }).catch(() => {
        if (!disposed && alive.current) setStaffState({ key: staffKey, ids: new Set<string>() });
      });
    }
    return () => { disposed = true; };
  }, [staffKey, visible]);

  useEffect(() => {
    let disposed = false;
    if (visible && viewer.uid && event?.id && snapshot?.eventDocId) {
      incrementEventViewCount(viewer.uid, event.id, snapshot.eventDocId).then(result => {
        if (disposed || !alive.current || !result) return;
        setDetailViewCount(previous => mergeViewCount(
          previous, (headerState.current.snapshot?.event as LegacyDetailEvent | undefined)?.viewCount, result.viewCount,
        ));
      }).catch(() => {});
    }
    return () => { disposed = true; };
  }, [visible, viewer.uid, event?.id, snapshot?.eventDocId]);

  useEffect(() => {
    if (!canEditCover) setEditingDetail(false);
    if (!canShowDetailLog) setDetailLogOpen(false);
  }, [canEditCover, canShowDetailLog]);

  function editDetail(): void {
    const current = headerState.current;
    if (!current.visible || !canEditDetailActivity(
      operateContextFromViewer(currentViewer.current),
      current.snapshot?.event,
    )) {
      toast.show({ message: '權限不足' });
      return;
    }
    setEditingDetail(true);
  }

  function openDetailLog(): void {
    const current = headerState.current;
    if (!current.visible || !currentViewer.current.uid || !canViewEventOperationLog(
      operateContextFromViewer(currentViewer.current),
      current.snapshot?.event,
    )) {
      toast.show({ message: '權限不足' });
      return;
    }
    setDetailLogOpen(true);
  }

  // 照 A `_refreshEventDetail`：重讀活動與名單；原 refresh 會吞錯，這裡同批讀完才提交。
  async function refreshDetailHeader(): Promise<void> {
    const current = headerState.current.snapshot;
    const uid = currentViewer.current.uid;
    if (!current || !uid || !headerState.current.visible || headerRefreshPending.current
      || operation.current || rosterSubmitting) return;
    headerRefreshPending.current = true;
    const request = sequence.current;
    const rosterRequest = ++rosterSequence.current;
    try {
      // 照 A `_refreshEventDetail`＋`_forceRefreshEventDetailRosterData`（Promise.allSettled）：
      // 名單／紀錄重讀失敗只保留舊資料，不讓整次重新整理失敗（Gemini 審查 P2）。
      let registrationsFailed = false;
      const [fresh, registrations, history, attendanceRecords] = await Promise.all([
        loadEventDetail(current.event.id ?? publicId),
        loadEventRegistrations(current.eventDocId).catch(() => {
          registrationsFailed = true;
          return current.registrations;
        }),
        loadViewerRegistrations(uid).catch(() => current.viewerRegistrations),
        canViewDetailAttendanceRecordDetails(currentViewer.current, current.event)
          ? loadEventAttendance(current.eventDocId).catch(() => current.attendanceRecords)
          : Promise.resolve([] as EventAttendanceEntry[]),
      ]);
      if (!alive.current || request !== sequence.current
        || rosterRequest !== rosterSequence.current || currentViewer.current.uid !== uid) return;
      if (!fresh || fresh.eventDocId !== current.eventDocId) {
        // 照 A：找不到最新活動文件時的專用提示，不走一般失敗。
        toast.show({ message: '刷新失敗，找不到最新活動資料' });
        return;
      }
      const nextEvent = {
        ...fresh.event,
        id: fresh.event.id ?? publicId,
        viewCount: mergeViewCount(
          (fresh.event as LegacyDetailEvent).viewCount,
          (headerState.current.snapshot?.event as LegacyDetailEvent | undefined)?.viewCount,
          detailViewCount,
        ),
      };
      if (!isEventVisibleToUser(nextEvent, currentViewer.current, history)) {
        setSnapshot(null);
        setPhase('missing');
        return;
      }
      setSnapshot({
        event: nextEvent,
        eventDocId: fresh.eventDocId,
        viewerRegistrations: history,
        registrations,
        attendanceRecords,
      });
      if (!registrationsFailed) setRosterPhase('ready');
      setHistoryFailed(false);
      setRefreshFailed(false);
    } finally {
      headerRefreshPending.current = false;
    }
  }

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
    if (rosterSubmitting || !alive.current) return;
    setRosterSubmitting(true);

    if (!CALLABLES_DEPLOYED) {
      try {
        await instantSave.flushInstantSaves();
      } finally {
        instantSave.resetInstantSave();
        if (alive.current) {
          setRosterSubmitting(false);
          setRosterEditing(false);
        }
      }
      return;
    }

    const curEvent = snapshot?.event;
    if (
      !snapshot
      || !curEvent
      || canOperateEventSite(operateContextFromViewer(currentViewer.current), curEvent) !== true
    ) {
      show('events.roster.noPermission');
      if (alive.current) setRosterSubmitting(false);
      return;
    }

    try {
      await instantSave.flushInstantSaves();
      if (!alive.current) return;

      const people = buildConfirmedRoster(curEvent, snapshot.registrations).people;
      const result = await settleAttendance({
        event: { id: curEvent.id || eventId, title: curEvent.title, date: curEvent.date },
        people,
        getSelection: instantSave.getRowSelection,
        operatorUid: currentViewer.current.uid ?? null,
        operatorName: resolveOperator(currentViewer.current),
      });
      if (!alive.current) return;

      if (result.ok === false) {
        show('events.roster.settleFailed');
        return;
      }

      show('events.roster.settleSuccess');
      if (result.failed.length > 0) {
        toast.show({
          message: t('events.roster.expGrantFailed', { count: result.failed.length }),
        });
      }

      try {
        await reloadAttendanceOnly();
      } catch {
        // 結算已成功；重讀失敗不影響成功提示與退出編輯。
      }
      if (!alive.current) return;
      instantSave.resetInstantSave();
      setRosterEditing(false);
    } catch {
      show('events.roster.settleFailed');
    } finally {
      if (alive.current) setRosterSubmitting(false);
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
  // 照 A handleSignup／handleCancelSignup 的翻牌生命週期。
  function showFlip(text: string, background: string): void {
    if (!alive.current) return;
    if (flipTimer.current !== null) clearTimeout(flipTimer.current);
    setFlip({ text, background, serial: ++flipSequence.current });
    flipTimer.current = setTimeout(() => {
      flipTimer.current = null;
      if (alive.current) setFlip(null);
    }, 750);
  }

  async function maybeShowLinePrompt(uid: string): Promise<void> {
    if (!alive.current || profileRef.current?.lineNotifyBound === true) return;
    const module = await import('../data/line-notify-bind');
    if (!alive.current || currentViewer.current.uid !== uid) return;
    const allowed = await module.shouldShowLineNotifyPrompt(uid);
    // await 後重讀 ref（TS 會沿用前面的窄化，改用函式讀最新值）。
    const boundNow = (): boolean => profileRef.current?.lineNotifyBound === true;
    if (alive.current && currentViewer.current.uid === uid && !boundNow() && allowed) {
      setLinePromptOpen(true);
    }
  }

  async function bindNotify(): Promise<void> {
    const uid = currentViewer.current.uid;
    if (!uid || !alive.current) return;
    const module = await import('../data/line-notify-bind');
    if (!alive.current || currentViewer.current.uid !== uid) return;
    lineAbort.current?.abort();
    const controller = new AbortController();
    lineAbort.current = controller;
    await module.bindLineNotify(uid, currentViewer.current.displayName || undefined, {
      signal: controller.signal,
      notify: message => {
        if (alive.current && currentViewer.current.uid === uid) toast.show({ message });
      },
    });
    if (!alive.current || currentViewer.current.uid !== uid) return;
    const next = {
      ...(profileRef.current ?? { gender: '', birthday: '', exp: 0 }),
      lineNotifyBound: true,
    };
    profileRef.current = next;
    setSignupProfile(next);
  }

  // 照 A handleSignup；本人報名不載入同行者，也不開選人彈窗。
  async function beginSelfSignup(opts: { earlyBird?: boolean }): Promise<void> {
    const current = snapshot;
    const uid = currentViewer.current.uid;
    if (!uid) {
      await login();
      return;
    }
    if (!current || refreshFailed || !alive.current) return;
    if (profileLoading || historyFailed) return;

    const latest = await contexts.signup.load(current.event.id ?? publicId, [{ type: 'self' }]);
    if (!alive.current || currentViewer.current.uid !== uid) return;
    const earlyBird = latest.earlyBirdWindow
      && (opts.earlyBird === true || latest.event.status === 'upcoming');
    const result = precheckSignup(
      latest.event, latest.viewer, latest.registrations, new Date(), {
        profileComplete: latest.profileComplete,
        participantCheck: latest.participantCheck,
        earlyBirdWindow: latest.earlyBirdWindow,
        earlyBirdAccepted: earlyBird,
        teamSignupAllowed: latest.teamSignupAllowed,
        requiresTeamSelection: false,
      },
    );
    if (!result.ok) {
      const messages: Record<string, string> = {
        event_unavailable: '此活動目前無法報名',
        event_ended: '活動已開始，報名已結束',
        event_started: '活動已於開始時間結束，無法報名',
        event_not_open: '報名尚未開放，請稍後再試',
        event_team_only_restricted: '俱樂部限定活動，僅限該隊成員報名',
        already_registered: '你已經報名這場活動',
      };
      if (result.message || messages[result.reason]) {
        toast.show({ message: result.message || messages[result.reason] || '' });
      } else {
        show(result.messageKey.replace(/^event\./, 'events.'));
      }
      return;
    }

    const signupEvent = latest.event as DetailEvent & {
      earlyBirdEnabled?: unknown;
      earlyBirdCost?: unknown;
    };
    const cost = getEventEarlyBirdCost(signupEvent);
    if (earlyBird) {
      if (getEventParticipantStats(latest.event, []).isCapacityFull) {
        toast.show({ message: '早鳥名額已滿，正式開放後可依活動狀態候補報名' });
        return;
      }
      if ((profileRef.current?.exp ?? 0) < cost) {
        toast.show({ message: '目前積分不足，可等正式開放後報名' });
        return;
      }
      const accepted = await appConfirm(
        `早鳥報名確認\n你將使用 ${cost} 積分提前報名「${latest.event.title || '此活動'}」。\n若活動取消，系統會退回積分；若你自行取消報名，已扣除的早鳥積分不會退回。`,
        { okText: '確認扣除並報名' },
      );
      if (!accepted || !alive.current || currentViewer.current.uid !== uid) return;
    }

    const response = await registerForEvent({
      eventId: current.event.id ?? publicId,
      user: { uid, displayName: currentViewer.current.displayName },
      context: contexts.signup,
      ...(earlyBird ? { earlyBirdAccepted: true, earlyBirdExpectedCost: cost } : {}),
    });
    if (!alive.current || currentViewer.current.uid !== uid) return;
    if (response.deduplicated) {
      toast.show({ message: '報名處理中，請稍候' });
      await refresh(current);
      return;
    }

    const registrations: unknown[] = Array.isArray(response.registrations)
      ? response.registrations : [];
    const selfResult = registrations.find(value =>
      value !== null && typeof value === 'object'
      && 'participantType' in value && value.participantType === 'self')
      ?? registrations[0];
    const responseStatus = selfResult !== null && typeof selfResult === 'object'
      && 'status' in selfResult ? selfResult.status : undefined;
    const waitlisted = responseStatus === 'waitlisted'
      || (!selfResult && count(response.waitlisted) > 0);
    const charged = count(response.earlyBirdCost);
    if (response.earlyBirdCharged && profileRef.current) {
      const next = {
        ...profileRef.current,
        exp: Math.max(0, profileRef.current.exp - charged),
      };
      profileRef.current = next;
      setSignupProfile(next);
    }
    toast.show({
      message: waitlisted ? '已加入候補名單'
        : response.earlyBirdCharged
          ? `早鳥報名成功，已扣除 ${charged} 積分` : '報名成功！',
    });
    showFlip(waitlisted ? '取消候補' : '取消報名', waitlisted ? '#7c3aed' : '#dc2626');
    await refresh(current);
    if (!alive.current) return;
    // 照 A _maybeShowLineNotifyPrompt；引導失敗不改寫報名成功結果。
    maybeShowLinePrompt(uid).catch(() => {});
  }

  // 照 A handleCancelSignup；重複本人紀錄依課程目標去重判斷。
  async function beginCancel(): Promise<void> {
    const current = snapshot;
    const uid = currentViewer.current.uid;
    if (!uid) {
      await login();
      return;
    }
    if (!current || !visible || refreshFailed || !alive.current) return;
    const selfRegs = owned.filter(reg => !isCompanion(reg));
    if (selfRegs.length === 0) {
      toast.show({ message: '你尚未報名此活動' });
      return;
    }
    const selfKeys = new Set(selfRegs.map(reg => {
      const course = reg as DetailRegistration & {
        courseStudentId?: string;
        courseLinkId?: string;
      };
      const student = String(course.courseStudentId || '').trim();
      const link = String(course.courseLinkId || '').trim();
      return student || link
        ? `course:${link}:${student || registrationId(reg)}`
        : `ordinary:${registrationOwner(reg) || uid}`;
    }));
    if (owned.some(isCompanion) || selfKeys.size > 1) {
      // 照 A：selfRegs.concat(companionRegs)，本人在前。
      const ordered = [...selfRegs, ...owned.filter(isCompanion)];
      const targets: CompanionCancelTarget[] = ordered.map(reg => {
        const course = reg as DetailRegistration & {
          courseStudentId?: string;
          courseLinkId?: string;
        };
        return {
          registrationId: registrationId(reg),
          isSelf: !isCompanion(reg),
          name: reg.companionName || reg.userName || '',
          status: reg.status === 'waitlisted' ? 'waitlisted' : 'confirmed',
          courseStudentId: course.courseStudentId,
          courseLinkId: course.courseLinkId,
        };
      });
      setCancelModal({ targets, selectAll: selfKeys.size === 1 });
      return;
    }

    const latest = await contexts.cancel.load(current.event.id ?? publicId);
    if (!alive.current) return;
    if (latest.event.status === 'ended' || latest.event.status === 'cancelled') {
      toast.show({ message: '活動已開始，無法再取消報名' });
      return;
    }
    const start = eventStartMs(latest.event);
    if (start > 0 && start <= Date.now()) {
      toast.show({ message: '活動已於開始時間結束，無法取消報名' });
      return;
    }
    const waitlisted = selfRegs.every(reg => reg.status === 'waitlisted');
    if (!await appConfirm(waitlisted ? '確定要取消候補？' : '確定要取消報名？')) return;
    if (!alive.current || currentViewer.current.uid !== uid) return;
    const ids = selfRegs.map(registrationId);
    if (ids.some(id => !id)) {
      toast.show({ message: '報名資料尚未同步完成，請重新整理後再試' });
      return;
    }
    const response = await cancelRegistration({
      eventId: current.event.id ?? publicId,
      userId: uid,
      registrationIds: ids,
      kind: 'self',
      context: contexts.cancel,
    });
    if (!alive.current) return;
    if (response.deduplicated) {
      toast.show({ message: '取消處理中，請稍候' });
      await refresh(current);
      return;
    }
    toast.show({ message: waitlisted ? '已取消候補' : '已取消報名' });
    const rawEvent: unknown = (response as { event?: unknown }).event;
    // ASSUMPTION: 舊 Callable 無 event 投影時，重讀活動以判斷取消後是否仍額滿。
    const updated = rawEvent && typeof rawEvent === 'object' && !Array.isArray(rawEvent)
      ? { ...current.event, ...rawEvent } as DetailEvent
      : (await loadEventDetail(current.event.id ?? publicId))?.event;
    if (!alive.current) return;
    if (updated) {
      const full = getEventParticipantStats(updated, []).isCapacityFull;
      showFlip(full ? '報名候補' : '立即報名', full ? '#7c3aed' : 'var(--accent)');
    }
    await refresh(updated ? { ...current, event: updated } : current);
  }

  async function confirmCancel(ids: string[]): Promise<void> {
    const current = snapshot;
    const uid = currentViewer.current.uid;
    if (!current || !uid || !visible || refreshFailed || !alive.current) return;
    if (!ids.length) {
      toast.show({ message: '請選擇要取消的報名' });
      return;
    }
    const targets = owned.filter(reg => ids.includes(registrationId(reg)));
    if (new Set(ids).size !== ids.length || targets.length !== ids.length
      || targets.some(reg => !registrationId(reg))) {
      show('events.detailPage.refreshError');
      setRefreshFailed(true);
      return;
    }
    try {
      const response = await cancelRegistration({
        eventId: current.event.id ?? publicId,
        userId: uid,
        registrationIds: ids,
        kind: targets.every(reg => !isCompanion(reg)) ? 'self' : 'companion',
        context: contexts.cancel,
      });
      if (!alive.current) return;
      toast.show({ message: response.deduplicated
        ? '取消處理中，請稍候' : `已取消 ${ids.length} 筆報名` });
      setCancelModal(null);
      await refresh(current);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof SignupError && error.originalCode === 'ALREADY_CANCELLED') {
        toast.show({ message: `已取消 ${ids.length} 筆報名` });
        setCancelModal(null);
        await refresh(current);
        return;
      }
      const messages: Record<string, string> = {
        REG_NOT_FOUND: '找不到報名紀錄',
        EVENT_NOT_FOUND: '活動不存在',
        PERMISSION_DENIED: '無權限執行此操作',
        EVENT_ENDED: '活動已開始，無法再取消報名',
        EVENT_STARTED: '活動已於開始時間結束，無法取消報名',
      };
      const code = error instanceof SignupError ? error.originalCode : '';
      toast.show({ message: `取消失敗：${messages[code] || '連線逾時，請檢查網路後重新整理再試'}` });
    }
  }

  // 照 A _openCompanionSelectModal；只在工具列入口讀同行者。
  async function openCompanionSelect(): Promise<void> {
    const uid = currentViewer.current.uid;
    if (!uid) {
      await login();
      return;
    }
    const current = snapshot;
    if (!current || !visible || refreshFailed || !alive.current) return;
    const status = effectiveEventStatus(current.event);
    if (status === 'ended' || status === 'cancelled') {
      toast.show({ message: '活動已開始，無法再調整夥伴報名' });
      return;
    }
    if (status === 'upcoming') {
      toast.show({ message: '報名尚未開放，請稍後再試' });
      return;
    }
    const available = await loadSignupCompanions(uid);
    if (!alive.current || currentViewer.current.uid !== uid) return;
    if (!available.length) {
      toast.show({ message: '請先到個人資訊新增同行者' });
      return;
    }
    companionsRef.current = available;
    setCompanions(available);
    setCompanionOpen(true);
  }

  async function confirmCompanions(selection: {
    addCompanionIds: string[];
    cancelRegistrationIds: string[];
  }): Promise<void> {
    const current = snapshot;
    const uid = currentViewer.current.uid;
    if (!current || !uid || !visible || refreshFailed || !alive.current) return;
    const { addCompanionIds, cancelRegistrationIds } = selection;
    if (!addCompanionIds.length && !cancelRegistrationIds.length) {
      toast.show({ message: '沒有需要調整的同行者' });
      return;
    }
    const chosen = companionsRef.current.filter(item => addCompanionIds.includes(item.id));
    const targets = owned.filter(reg =>
      isCompanion(reg) && cancelRegistrationIds.includes(registrationId(reg)));
    if (new Set(addCompanionIds).size !== addCompanionIds.length
      || chosen.length !== addCompanionIds.length
      || new Set(cancelRegistrationIds).size !== cancelRegistrationIds.length
      || targets.length !== cancelRegistrationIds.length) {
      show('events.detailPage.refreshError');
      return;
    }

    const participants = chosen.map(item => ({
      type: 'companion' as const,
      companionId: item.id,
      companionName: item.name,
    }));
    const latest = await contexts.signup.load(current.event.id ?? publicId, participants);
    if (!alive.current || currentViewer.current.uid !== uid) return;
    if (!isEventVisibleToUser(latest.event, latest.viewer, latest.registrations)) {
      toast.show({ message: '此活動目前無法報名' });
      setCompanionOpen(false);
      return;
    }
    if (latest.event.status === 'ended' || latest.event.status === 'cancelled') {
      toast.show({ message: '活動已開始，報名已結束' });
      setCompanionOpen(false);
      return;
    }
    if (latest.event.status === 'upcoming') {
      toast.show({ message: '報名尚未開放，請稍後再試' });
      return;
    }
    if (!latest.teamSignupAllowed) {
      toast.show({ message: '俱樂部限定活動，僅限該隊成員報名' });
      return;
    }
    const invalid = chosen.find(item =>
      !canDetailCompanionSignup(latest.event as LegacyDetailEvent, item.gender));
    if (invalid) {
      toast.show({
        message: detailCompanionGenderMessage(latest.event, invalid.name),
      });
      return;
    }

    let confirmed = 0;
    let waitlisted = 0;
    let cancelled = 0;
    let writeAttempted = false;
    try {
      // 照 A _confirmCompanionRegisterUnlocked：先取消再加報（Gemini 審查 P1，原交件順序相反）。
      if (cancelRegistrationIds.length) {
        if (!alive.current || currentViewer.current.uid !== uid) return;
        writeAttempted = true;
        const response = await cancelRegistration({
          eventId: current.event.id ?? publicId,
          userId: uid,
          registrationIds: cancelRegistrationIds,
          kind: 'companion',
          companionToggle: true,
          context: contexts.cancel,
        });
        if (!alive.current) return;
        if (response.deduplicated) {
          toast.show({ message: '取消處理中，請稍候' });
          setCompanionOpen(false);
          await refresh(current);
          return;
        }
        cancelled = cancelRegistrationIds.length;
      }
      if (chosen.length) {
        if (!alive.current || currentViewer.current.uid !== uid) return;
        writeAttempted = true;
        const response = await registerSelection({
          eventId: current.event.id ?? publicId,
          user: { uid, displayName: currentViewer.current.displayName },
          participants,
          companionToggle: true,
        }, false);
        if (!alive.current) return;
        if (response.deduplicated) {
          toast.show({ message: '報名處理中，請稍候' });
          setCompanionOpen(false);
          await refresh(current);
          return;
        }
        confirmed = count(response.confirmed);
        waitlisted = count(response.waitlisted);
      }
      const parts: string[] = [];
      if (confirmed + waitlisted > 0) parts.push(`新增 ${confirmed + waitlisted} 人`);
      if (waitlisted > 0) parts.push(`候補 ${waitlisted} 人`);
      if (cancelled > 0) parts.push(`取消 ${cancelled} 人`);
      toast.show({
        message: parts.length ? `夥伴報名已更新：${parts.join('、')}` : '夥伴報名已更新',
      });
      setCompanionOpen(false);
      await refresh(current);
    } catch (error) {
      if (!alive.current) return;
      const code = error instanceof SignupError ? error.originalCode : '';
      const messages: Record<string, string> = {
        ALREADY_REGISTERED: '已有相同報名，請重新整理後再試',
        EVENT_NOT_FOUND: '找不到活動',
        EVENT_ENDED: '活動已開始，無法調整',
        EVENT_CANCELLED: '活動已取消',
        REG_NOT_OPEN: '報名尚未開放',
        GENDER_RESTRICTED: '同行者不符合性別限制',
        TEAM_RESTRICTED: '不符合球隊限定',
        PROFILE_INCOMPLETE: '請先補齊個人資料',
        ALREADY_CANCELLED: '報名狀態已更新',
      };
      toast.show({ message: messages[code] || '夥伴報名調整失敗，請稍後再試' });
      // 照 A：部分成功後重讀，避免用舊勾選狀態重送已成功的加報。
      if (writeAttempted) {
        setCompanionOpen(false);
        await refresh(current);
      }
    }
  }

  function startCompanion(work: () => Promise<void>): void {
    start(async () => {
      setCompanionBusy(true);
      try {
        await work();
      } finally {
        if (alive.current) setCompanionBusy(false);
      }
    });
  }

  function profile(uid: string): void {
    if (uid) location.route(`/profile/${encodeURIComponent(uid)}`);
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
      <EventDetailLoadingShell publicId={publicId} viewer={viewer} goBack={goBack}>
        {noticeToast}
      </EventDetailLoadingShell>
    );
  }

  if (phase === 'error') {
    // ASSUMPTION: A 沒有錯誤頁；沿用 B 重試內容，套用首次載入外框。
    return (
      <EventDetailLoadingShell
        publicId={publicId}
        viewer={viewer}
        goBack={goBack}
        loading={false}
      >
            <h1>{t('events.detailPage.loadError')}</h1>
            <button
              type="button"
              class="outline-btn"
              onClick={() => setReload((value) => value + 1)}
            >
              {t('events.retry')}
            </button>
          {noticeToast}
      </EventDetailLoadingShell>
    );
  }

  if (phase === 'missing' || !snapshot || !event || !visible) {
    return <EventDetailMissing goBack={goBack} />;
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
    profile: signupProfile,
    profileLoading,
    historyFailed,
    viewerTeamIds: viewer.teamIds,
  });
  const maximum = count(event.max);
  const companionStats = getEventParticipantStats(
    event, rosterPhase === 'ready' ? snapshot.registrations : [],
  );
  const feeEnabled = event.feeEnabled ?? count(event.fee) > 0;
  const fee = feeEnabled ? count(event.fee) : 0;
  const allowedGender = event.genderRestrictionEnabled
    && (event.allowedGender === '男' || event.allowedGender === '女')
    ? event.allowedGender : '';
  const companionItems: CompanionSelectItem[] = companions.map(item => {
    // 照 A regByCompanionId → regByCompanionName；名字只比對沒有 companionId 的舊紀錄（Gemini 審查 P1）。
    const cid = item.id.trim();
    const cname = item.name.trim();
    const reg = owned.find(value => isCompanion(value)
      && String(value.companionId || '').trim() === cid)
      ?? owned.find(value => isCompanion(value)
        && !String(value.companionId || '').trim()
        && cname !== ''
        && String(value.companionName || value.userName || '').trim() === cname);
    return {
      ...item,
      registered: Boolean(reg),
      registrationId: reg ? registrationId(reg) : undefined,
      status: reg ? (reg.status === 'waitlisted' ? 'waitlisted' : 'confirmed') : undefined,
      genderAllowed: canDetailCompanionSignup(event, item.gender),
    };
  });
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
            onClick={goBack}
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
            <EventDetailHeaderActions context={operateCtx} event={event} eventDocId={snapshot.eventDocId} staffTeamIds={staffTeamIds} viewCount={mergeViewCount(viewCountNum, detailViewCount)} onReload={() => setReload(value => value + 1)} onRefresh={refreshDetailHeader} onOpenLog={openDetailLog} />
          </div>
        </div>

        <EventDetailCover
          event={event}
          canEdit={canEditCover}
          onEdit={editDetail}
        />

        <div class="detail-body" id="detail-body">
          <EventDetailInfoSection
            event={event}
            confirmedCount={confirmedCount}
            waitlistCount={waitlistCount}
            nowMs={now}
            roles={roles}
            onOpenProfile={profile}
            onContactHost={() => {
              // 照 A contactEventOrganizer；身分只認 UID。
              const uid = (event.creatorUid || '').trim();
              if (uid) profile(uid);
              else toast.show({ message: '暫時找不到主辦人資料。' });
            }}
            onOpenTeam={(teamId) => {
              location.route(`/teams/${encodeURIComponent(teamId)}`);
            }}
          />

          <div class="detail-action-zone">
            <div class="detail-action-toolbar">
              <div
                class={`signup-glow-wrap${companionBusy ? ' loading' : ''}`}
                style="--glow-c:#2563eb;--glow-c-light:#60a5fa"
              >
                <div class="signup-glow-border" />
                <div class="signup-glow-shadow" />
                <div class="signup-flipper">
                  <button
                    type="button"
                    class="detail-toolbar-btn companion-signup-toolbar-action"
                    disabled={busy || refreshFailed}
                    aria-busy={companionBusy ? 'true' : undefined}
                    aria-disabled={companionBusy ? 'true' : undefined}
                    onClick={() => startCompanion(openCompanionSelect)}
                  >
                    幫夥伴報名
                    {companionBusy && <span class="fcb-sr-only">（處理中）</span>}
                  </button>
                </div>
                <div class="signup-loading-hint">
                  <div class="mini-spinner" />
                  <span class="mini-text">寫入中</span>
                </div>
              </div>
              <EventDetailToolbarActions
                event={event}
                loggedIn={Boolean(viewer.uid)}
                heat={calcHeatPrediction(event, now)}
                registrations={snapshot.registrations}
                canScan={() => Boolean(
                  currentViewer.current.uid
                  && canManageDetailAttendanceRecords(currentViewer.current, snapshot.event)
                )}
                onScan={() => {
                  location.route(`/checkin?eventId=${encodeURIComponent(eventId)}`);
                }}
              />
            </div>

            <div class="detail-action-primary" id="detail-action-primary">
              <EventDetailPrimaryButton
                state={state}
                disabled={state.disabled || busy || refreshFailed}
                busy={busy}
                flip={flip}
                onClick={() => {
                  if (state.action === 'cancel') start(beginCancel);
                  else if (state.action === 'signup') start(() => beginSelfSignup({}));
                  else if (state.action === 'earlyBird') {
                    start(() => beginSelfSignup({ earlyBird: true }));
                  } else if (state.action === 'login') start(login);
                  else if (state.action === 'explain' && state.messageText) {
                    toast.show({ message: state.messageText });
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
            <GuestRosterSections
              event={event}
              eventId={eventId}
              expanded={rosterExpanded}
              onExpand={() => setRosterExpanded(true)}
              onOpenProfile={profile}
              max={maximum}
              confirmedCount={confirmedCount}
              waitlistCount={waitlistCount}
            />
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
            </section>
          )}

          {/* 照 A _renderDetailComments；M-093 在詳情 ready 後才載入留言。 */}
          <div id="detail-comments-container">
            <Suspense fallback={
              <div class="detail-section event-comments-section">
                <div class="detail-section-title">留言</div>
                <div class="reg-loading">留言將在報名名單完成後載入...</div>
              </div>
            }>
              <EventCommentsSection
                event={event}
                eventDocId={snapshot.eventDocId}
                viewer={viewer}
                canLoad={phase === 'ready'}
              />
            </Suspense>
          </div>
        </div>

        {companionOpen && (
          <Suspense fallback={null}>
            <DetailCompanionSelectModal
              open
              eventTitle={event.title || ''}
              feeEnabled={feeEnabled}
              fee={fee}
              remaining={companionStats.remainingCount}
              max={companionStats.maxCount}
              genderDetailText={allowedGender
                ? (allowedGender === '男' ? '限男性報名' : '限女性報名') : ''}
              items={companionItems}
              busy={busy}
              onClose={() => { if (!busy) setCompanionOpen(false); }}
              onConfirm={selection => startCompanion(() => confirmCompanions(selection))}
            />
          </Suspense>
        )}
        {cancelModal && (
          <Suspense fallback={null}>
            <DetailCompanionCancelModal
              open
              targets={cancelModal.targets}
              selectAll={cancelModal.selectAll}
              busy={busy}
              eventTitle={event.title || ''}
              onClose={() => { if (!busy) setCancelModal(null); }}
              onConfirm={ids => start(() => confirmCancel(ids))}
            />
          </Suspense>
        )}
        {linePromptOpen && (
          <Suspense fallback={null}>
            <DetailLineNotifyPrompt
              open
              onClosed={() => { if (alive.current) setLinePromptOpen(false); }}
              onBind={() => start(bindNotify)}
            />
          </Suspense>
        )}
        {detailLogOpen && canShowDetailLog && (
          <Suspense fallback={<div role="status">載入中…</div>}>
            <DetailEventRegLogModal
              eventId={eventId}
              eventDocId={snapshot.eventDocId}
              cachedRegistrations={snapshot.registrations as readonly RegLogRegistration[]}
              onClose={() => setDetailLogOpen(false)}
            />
          </Suspense>
        )}
        {editingDetail && canEditCover && (
          <Suspense fallback={<div role="status">載入中…</div>}>
            <DetailEventFormModal
              open
              mode="edit"
              existing={{ ...event, _docId: snapshot.eventDocId, docId: snapshot.eventDocId }}
              viewer={viewer}
              onClose={() => setEditingDetail(false)}
              onSaved={() => {
                if (!alive.current) return;
                setEditingDetail(false);
                setReload(value => value + 1);
              }}
            />
          </Suspense>
        )}
        {noticeToast}
      </section>
    </div>
  );
}
