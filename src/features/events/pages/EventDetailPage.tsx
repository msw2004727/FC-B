import type { JSX } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
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
import { GuestRosterSections } from '../components/legacy/GuestRosterSections';
import {
  CompanionSelectModal,
  EventDetailCover,
  EventDetailInfoSection,
  EventDetailPrimaryButton,
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
