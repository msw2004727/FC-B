import type { JSX } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import type { EventCommentsSectionProps } from '../components/legacy/EventCommentsSection';
import {
  EventDetailHeaderActions,
  canEditDetailActivity,
} from '../components/legacy/EventDetailHeaderActions';
import { canManageTeamSplit, canViewEventOperationLog } from '../data/operate-permissions';
import {
  getSplitTeams,
  getTeamSplit,
  type TeamBatchAction,
  type TeamRegistration,
} from '../data/team-split';
import {
  TeamInfoCards,
  TeamBatchButtons,
  TeamSelectUI,
} from '../components/legacy/TeamSplitSection';
import { getEventLimitedTeamIds, loadEventStaffTeamIds } from '../data/team-staff';
import { incrementEventViewCount, mergeViewCount } from '../data/event-view-count';
import type { RegLogRegistration } from '../data/event-reg-log';
import { readAuthHint } from '@/data/auth-hint';
import { useGoBack } from '@/core/back-guard';
import { SHOW_FAVORITES } from '@/core/hidden-features';
import { lt, useT } from '@/i18n/i18n';
import { Toast, toast } from '@/ui/Toast';
import { appConfirm } from '@/ui/AppConfirm';
import { useActionRingControl } from '@/ui/action-ring';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { useUserRoles } from '@/data/user-roles';
import { CALLABLES_DEPLOYED } from '@/data/callables-deployed';
import { settleAttendance } from '../data/attendance-settle';
import { resolveOperator } from '../data/event-lifecycle';
import { loadEventAttendance, type EventAttendanceEntry } from '@/features/checkin/data/attendance';
import { loadEventDetail, loadEventRegistrations, type LoadedEventDetail } from '../data/event-detail';
import {
  loadEventDetailThroughSessionCache,
  type SessionDetailCacheEntry,
} from '../data/event-detail-session-cache';
import { readEarlyEventDetail, readEarlyEventPromise } from '../data/early-event-shell';
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
  type SignupSettle,
} from '../components/legacy/EventDetailPrimaryButton';
import type { CompanionSelectItem } from '../components/legacy/CompanionSelectModal';
import { useCancelRegistration } from '../components/legacy/use-cancel-registration';
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
import { useRosterNoShow } from '../components/useRosterNoShow';
import { NO_SHOW_FEATURE_ENABLED } from '../data/noshow-roster';
import { UnregRosterTable, buildUnregPeopleList } from '../components/UnregRosterTable';
import { useAttendanceInstantSave } from '../components/useAttendanceInstantSave';
import { useRosterStatusActions } from '../components/useRosterStatusActions';
import { WaitlistRosterTable } from '../components/WaitlistRosterTable';
import {
  DetailAttendanceLoading,
  DetailAttendanceSummary,
} from '../components/legacy/DetailAttendanceSummary';
import { GuestRosterSections } from '../components/legacy/GuestRosterSections';
import {
  EventDetailCover,
  EventDetailInfoSection,
  type LegacyDetailEvent,
} from '../components/legacy/EventDetailMainView';
import {
  EventDetailLoadingShell,
  EventDetailMissing,
  EventDetailToolbarActions,
} from '../components/legacy/EventDetailLoadingShell';
import type { RegistrationDoc } from '../data/types';
import { useTeamReservation, type ReservationSuccess } from '../components/legacy/use-team-reservation';
import { applyReservationPromotions } from '../components/legacy/team-reservation-sync';
import '../legacy/activity.css';
import '../legacy/tournament-td-img-placeholder.css';
import { EventFormPostSaveBoundary } from '../components/event-form/use-event-form-post-save';

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

// 與 publishTeamRows 同一套對應：缺 _docId 的列不參與；teamKey 空值寫成 null。
function teamKeysByDoc(rows: readonly TeamRegistration[]): Map<string, string | null> {
  const teamByDoc = new Map<string, string | null>();
  for (const row of rows) {
    if (!row._docId) continue;
    teamByDoc.set(row._docId, row.teamKey ?? null);
  }
  return teamByDoc;
}

function applyTeamKeyMap<T extends { _docId?: string }>(
  registrations: readonly T[],
  teamByDoc: ReadonlyMap<string, string | null>,
): T[] {
  let changed = false;
  const next = registrations.map(reg => {
    if (!reg._docId || !teamByDoc.has(reg._docId)) return reg;
    const teamKey = teamByDoc.get(reg._docId) ?? null;
    if ((reg as TeamRegistration).teamKey === teamKey) return reg;
    changed = true;
    return { ...reg, teamKey } as T;
  });
  return changed ? next : registrations as T[];
}

const DetailCompanionSelectModal = lazy(() =>
  import('../components/legacy/CompanionSelectModal')
    .then(module => ({ default: module.CompanionSelectModal })));
const DetailLineNotifyPrompt = lazy(() =>
  import('../components/legacy/LineNotifyPrompt')
    .then(module => ({ default: module.LineNotifyPrompt })));

let nextSignupGeneration = 0;
type RosterPhase = 'idle' | 'loading' | 'ready' | 'error';
// T-074：展開與讀取共用一份狀態；已展開不可能仍是 idle。
type RosterState =
  | { expanded: false; phase: RosterPhase }
  | { expanded: true; phase: Exclude<RosterPhase, 'idle'> };

const UNAVAILABLE_MSG = '此功能尚未開放，請先使用舊版';
const FLIP_MIN_MS = 750;
const FLIP_MAX_MS = 15_000;

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

/**
 * 登入線索為真、uid 還沒到、黑名單非空：先不拿早取文件畫首屏。
 * 沒有 uid 時可見性會放行；外殼同一條也先不畫標題。改走原本的 SDK 讀取，不永久停住。
 */
function earlyAuthWithheld(event: { blockedUids?: unknown }, uid: string | null): boolean {
  if (uid || !readAuthHint()) return false;
  const blocked = event.blockedUids;
  return Array.isArray(blocked) && blocked.length > 0;
}

export default function EventDetailPage({ id }: { id?: string }): JSX.Element {
  const location = useLocation();
  const routeId = id ?? location.path.split('/')[2] ?? '';
  const viewer = useViewer();
  // 快取活在 session 外面。訪客 → 第一次登入不重掛；換帳號或登出才清。頁面卸載就丟。
  const detailCache = useRef(new Map<string, SessionDetailCacheEntry<LoadedEventDetail>>());
  // 換活動就清：preact-iso 同一路由元件不重掛，A → B → 返回 A 不能拿 A 的舊讀取（Opus 終審 P2-2）。
  const cacheRouteId = useRef(routeId);
  if (cacheRouteId.current !== routeId) {
    detailCache.current.clear();
    cacheRouteId.current = routeId;
  }
  // 只有「訪客 → 登入」（登入確認那一次）沿用；換帳號或登出都重讀，保留帳號隔離。
  const cacheUid = useRef(viewer.uid ?? null);
  if (cacheUid.current !== (viewer.uid ?? null)) {
    if (cacheUid.current !== null) detailCache.current.clear();
    cacheUid.current = viewer.uid ?? null;
  }

  // 換活動才重掛。訪客 → 第一次登入不重掛；換帳號或登出由上面清快取，session effect 整頁重讀（L-43）。
  return (
    <EventDetailSession
      key={routeId}
      publicId={routeId}
      viewer={viewer}
      detailCache={detailCache.current}
    />
  );
}

function EventDetailSession({
  publicId,
  viewer,
  detailCache,
}: {
  publicId: string;
  viewer: ReturnType<typeof useViewer>;
  detailCache: Map<string, SessionDetailCacheEntry<LoadedEventDetail>>;
}): JSX.Element {
  const t = useT();
  const location = useLocation();
  // M-045：共用返回（前面有本站頁就退回，否則回活動列表）。
  const goBack = useGoBack('/activities');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [rosterState, setRosterState] = useState<RosterState>({ expanded: false, phase: 'idle' });
  const { phase: rosterPhase, expanded: rosterExpanded } = rosterState;
  function setRosterPhase(update: RosterPhase | ((phase: RosterPhase) => RosterPhase)): void {
    setRosterState(current => {
      const phase = typeof update === 'function' ? update(current.phase) : update;
      return phase === 'idle' ? { expanded: false, phase } : { ...current, phase };
    });
  }
  const [historyFailed, setHistoryFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [companions, setCompanions] = useState<SignupCompanion[]>([]);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionBusy, setCompanionBusy] = useState(false);
  const [signupProfile, setSignupProfile] = useState<SignupProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(Boolean(viewer.uid));
  const [settle, setSettle] = useState<SignupSettle>({ serial: 0, pending: false });
  // 主按鈕自己的動作進行中（進度環只跟這個走；幫夥伴報名等其他忙碌不變形）。
  const [primaryBusy, setPrimaryBusy] = useState(false);
  const [teamDoneSerial, setTeamDoneSerial] = useState(0);
  const [linePromptOpen, setLinePromptOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [rosterEditing, setRosterEditing] = useState(false);
  const [rosterSubmitting, setRosterSubmitting] = useState(false);
  // 幫夥伴報名「確認」與名單「完成」的進度環（只在真正送出時轉、成功才打勾）。
  const companionRing = useActionRingControl();
  const rosterRing = useActionRingControl();
  const [selectedTeamKey, setSelectedTeamKey] = useState<string | null>(null);
  const [teamRegistrations, setTeamRegistrations] = useState<TeamRegistration[] | null>(null);
  const teamRowsRef = useRef<TeamRegistration[] | null>(null);
  const teamLoadRef = useRef<Promise<TeamRegistration[]> | null>(null);
  const teamLoadSequence = useRef(0);
  const teamBatchPending = useRef(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const rosterSequence = useRef(0);
  const attendanceReloadSeq = useRef(0);
  // T-088：出席重讀「真正寫入快照」時才加一；讀取失敗或被較新重讀作廢時不加，晚到的整包讀取才不會誤丟新資料。
  const attendanceCommitSeq = useRef(0);
  // T-088：publishTeamRows 每次加一。讀取開始時記下，提交時若已變就重套 teamKey。
  const teamPublishSeq = useRef(0);
  const rosterPending = useRef(false);
  // 每個活動只自動展開一次；載入 effect 在交出新快照前會重置。不寫入持久化。
  const rosterAutoOpened = useRef(false);
  const rosterAutoHold = useRef(true);
  // T-086a：背景名單重讀的序號（0＝無）；完成時以 tick 觸發自動展開 effect 重新判斷。
  const backgroundRefreshSeq = useRef(0);
  const [backgroundRefreshTick, setBackgroundRefreshTick] = useState(0);
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
  const ringStartedAt = useRef(0);
  const lineAbort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  if (!generation.current) generation.current = ++nextSignupGeneration;
  // undefined＝還沒交出過畫面；null＝以訪客交出。換帳號比對這個，不靠整頁重掛。
  const paintedUid = useRef<string | null | undefined>(undefined);
  const keepForUid = useRef<string | null>(null);
  const snapshotNow = useRef(snapshot);
  snapshotNow.current = snapshot;
  const phaseNow = useRef(phase);
  phaseNow.current = phase;
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
    rosterAutoHold.current = true;
    let disposed = false;
    const current = (): boolean =>
      !disposed && alive.current && request === sequence.current;

    const uid = viewer.uid ?? null;
    const painted = snapshotNow.current;
    // 訪客已畫出、第一次 uid 到位：不把 phase 打回載入中，只補本場報名。換帳號或尚未畫出則整頁重讀。
    const keep =
      paintedUid.current === null
      && uid !== null
      && phaseNow.current === 'ready'
      && painted !== null
      && (painted.event.id ?? publicId) === publicId
      && (keepForUid.current === null || keepForUid.current === uid);

    if (!keep) {
      paintedUid.current = undefined;
      keepForUid.current = null;
      setPhase('loading');
      setRosterState({ expanded: false, phase: 'idle' });
      setHistoryFailed(false);
      setSnapshot(null);
    } else {
      keepForUid.current = uid;
      setRosterState({ expanded: false, phase: 'idle' });
      rosterAutoOpened.current = false;
      setHistoryFailed(false);
    }

    async function loadKept(paintedSnapshot: Snapshot, nextUid: string): Promise<void> {
      let history: RegistrationDoc[] = [];
      let failedHistory = false;
      try {
        history = await loadViewerRegistrations(nextUid, paintedSnapshot.eventDocId);
      } catch {
        failedHistory = true;
      }
      if (!current()) return;
      paintedUid.current = nextUid;
      keepForUid.current = null;
      if (!isEventVisibleToUser(paintedSnapshot.event, currentViewer.current, history)) {
        setSnapshot(null);
        setPhase('missing');
        return;
      }
      setSnapshot((prev) => (prev ? { ...prev, viewerRegistrations: history } : prev));
      setHistoryFailed(failedHistory);
      rosterAutoOpened.current = false;
      rosterAutoHold.current = false;
    }

    async function load(): Promise<void> {
      if (keep && painted && uid) {
        await loadKept(painted, uid);
        return;
      }

      if (!/^[A-Za-z0-9_-]{1,120}$/.test(publicId)) {
        if (current()) {
          paintedUid.current = uid;
          setPhase('missing');
        }
        return;
      }

      let detail: LoadedEventDetail | null = null;
      try {
        // 沒有提早 Promise 時同步開 SDK，不先空等一個微任務。
        if (reload === 0 && readEarlyEventPromise()) {
          const early = await readEarlyEventDetail(publicId);
          if (!current()) return;
          if (early && !earlyAuthWithheld(early.event, uid)) {
            detail = early;
            if (!detailCache.has(publicId)) {
              detailCache.set(publicId, { at: Date.now(), promise: Promise.resolve(early) });
            }
          }
        }
        if (!detail) {
          detail = await loadEventDetailThroughSessionCache(
            detailCache, publicId, reload, loadEventDetail,
          );
        }
      } catch {
        if (current()) setPhase('error');
        return;
      }
      if (!current()) return;
      if (!detail) {
        paintedUid.current = uid;
        setPhase('missing');
        return;
      }

      let history: RegistrationDoc[] = [];
      let failedHistory = false;
      if (uid) {
        try {
          history = await loadViewerRegistrations(uid, detail.eventDocId);
        } catch {
          failedHistory = true;
        }
        if (!current()) return;
      }

      if (!isEventVisibleToUser(detail.event, currentViewer.current, history)) {
        paintedUid.current = uid;
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
      rosterAutoOpened.current = false;
      rosterAutoHold.current = false;
      setPhase('ready');
      paintedUid.current = uid;

      if (!uid) {
        setRosterPhase('ready');
      }
    }

    load().catch(() => {
      if (!current()) return;
      if (keep) {
        paintedUid.current = uid;
        keepForUid.current = null;
        setHistoryFailed(true);
        return;
      }
      setPhase('error');
    });
    return () => {
      disposed = true;
    };
  }, [publicId, viewer.uid, reload, detailCache]);

  async function fetchRosterForSnapshot(current: Snapshot, expand = false): Promise<void> {
    // 讀取與展開在同一入口准入；被重讀鎖擋下時不改 UI 狀態。
    if (
      !alive.current
      || !currentViewer.current.uid
      || reservation.isPending()
      || operation.current
      || refreshFailed
      || !isEventVisibleToUser(current.event, currentViewer.current, current.viewerRegistrations)
    ) {
      return;
    }
    if (expand && (rosterPhase === 'ready' || rosterPending.current)) {
      // 已有完整資料直接顯示；預讀仍在進行則接手同一個 Promise。
      setRosterState({ expanded: true, phase: rosterPhase === 'ready' ? 'ready' : 'loading' });
      return;
    }
    if (rosterPending.current) return;
    rosterPending.current = true;
    const request = ++rosterSequence.current;
    const attendanceSeq = attendanceCommitSeq.current;
    const teamSeq = teamPublishSeq.current;
    setRosterState(previous => ({ expanded: expand || previous.expanded, phase: 'loading' }));
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
      setSnapshot((previous) => {
        if (!previous) return null;
        return adoptLoadedSnapshot(previous, {
          ...previous,
          registrations,
          attendanceRecords,
        }, attendanceSeq, teamSeq);
      });
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
    fetchRosterForSnapshot(current, true).catch(() => {});
  }

  function prefetchDetailAttendanceRecords(): void {
    const current = snapshot;
    if (!current || !currentViewer.current.uid) return;
    if (rosterPhase === 'ready' || rosterPending.current) return;
    fetchRosterForSnapshot(current).catch(() => {});
  }

  async function retryRoster(): Promise<void> {
    const current = snapshot;
    if (!current) return;
    await fetchRosterForSnapshot(current);
  }

  async function run(work: () => Promise<void>): Promise<void> {
    if (operation.current || reservation.isPending() || !alive.current) return;
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

  // 主按鈕的報名／候補／早鳥／取消：同 start，另標記進度環起點（比照 startCompanion）。
  function startPrimary(work: () => Promise<void>): void {
    start(async () => {
      ringStartedAt.current = Date.now();
      setPrimaryBusy(true);
      try {
        await work();
      } finally {
        if (alive.current) setPrimaryBusy(false);
      }
    });
  }

  async function login(): Promise<void> {
    const auth = await import('@/data/auth');
    if (alive.current) await auth.signIn();
  }

  // outcomeUnknown：寫入結果未知（deduplicated／逾時／無投影）時一併重讀活動文件，
  // 改用伺服器重算過的 current（R-REG-002）；正常成功路徑不多讀。
  async function refresh(current: Snapshot, outcomeUnknown = false): Promise<void> {
    const uid = currentViewer.current.uid;
    if (!uid) return;
    const request = ++rosterSequence.current;
    // 收起中的預讀被序號作廢後，未結束的那一輪不能繼續占著鎖，否則展開會永遠跳過。
    if (!rosterExpanded) rosterPending.current = false;
    const attendanceSeq = attendanceCommitSeq.current;
    const teamSeq = teamPublishSeq.current;
    const canViewDetails = canViewDetailAttendanceRecordDetails(
      currentViewer.current,
      current.event,
    );
    try {
      const [registrations, history, attendanceRecords, fresh] = await Promise.all([
        loadEventRegistrations(current.eventDocId),
        loadViewerRegistrations(uid),
        rosterExpanded && canViewDetails
          ? loadEventAttendance(current.eventDocId).catch(() => current.attendanceRecords)
          : Promise.resolve(current.attendanceRecords),
        outcomeUnknown
          ? loadEventDetail(current.event.id ?? publicId).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!alive.current || request !== rosterSequence.current) return;
      const active = registrations.filter(isActiveRegistration);
      // 活動文件重讀失敗或不符時沿用原投影，不讓名單重讀失敗。
      const baseEvent = fresh && fresh.eventDocId === current.eventDocId
        ? {
          ...current.event,
          ...fresh.event,
          id: fresh.event.id ?? current.event.id,
          viewCount: mergeViewCount(
            (fresh.event as LegacyDetailEvent).viewCount,
            (current.event as LegacyDetailEvent).viewCount,
          ),
        }
        : current.event;
      const next: Snapshot = {
        ...current,
        event: {
          ...baseEvent,
          // R-REG-002：current 沿用佔位重算的權威投影（含團隊剩餘預留），不可改成正取筆數。
          waitlist: active.filter((reg) => reg.status === 'waitlisted').length,
        },
        registrations,
        viewerRegistrations: history,
        attendanceRecords,
      };
      setSnapshot((previous) => adoptLoadedSnapshot(previous, next, attendanceSeq, teamSeq));
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

  // T-086a：伺服器已確認寫入後的名單重讀改背景，不占 busy；錯誤沿用 refresh 內的 refreshFailed／提示。
  // 進行中暫停管理者自動展開，避免自動展開的讀取以序號作廢這次重讀；較新的讀取仍可作廢它。
  async function refreshInBackground(current: Snapshot): Promise<void> {
    const pending = refresh(current);
    // refresh 在第一個 await 前已同步取號。
    const request = rosterSequence.current;
    backgroundRefreshSeq.current = request;
    try {
      await pending;
    } catch (error) {
      if (alive.current && request === rosterSequence.current) {
        setRefreshFailed(true);
        show(errorKey(error, 'events.detailPage.refreshError'));
      }
    } finally {
      if (backgroundRefreshSeq.current === request) {
        backgroundRefreshSeq.current = 0;
        if (alive.current) setBackgroundRefreshTick(value => value + 1);
      }
    }
  }

  const uidNow = viewer.uid ?? null;
  // 訪客頁已畫出、本場報名還沒回來：按鈕維持同步中，且先不要因空報名把黑名單打成找不到。
  const regsPending =
    paintedUid.current === null
    && uidNow !== null
    && phase === 'ready'
    && snapshot !== null
    && (snapshot.event.id ?? publicId) === publicId;
  // 已畫出的登入者換人或登出：這一幀就改畫載入外殼，不等 effect 清掉舊畫面。
  const accountReset =
    paintedUid.current !== undefined
    && paintedUid.current !== null
    && paintedUid.current !== uidNow;
  const visible = snapshot !== null && (
    regsPending
    || isEventVisibleToUser(snapshot.event, viewer, snapshot.viewerRegistrations)
  );
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

  // R-REG-002：current 只來自 Callable 回傳的佔位重算投影；名單重讀不再以正取筆數覆寫，
  // 寫入成功後先套用回傳投影再重讀名單。
  function adoptEventProjection(base: Snapshot, raw: unknown): Snapshot {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    const projection = raw as Partial<Snapshot['event']>;
    setSnapshot(previous => previous && ({ ...previous, event: { ...previous.event, ...projection } }));
    return { ...base, event: { ...base.event, ...projection } };
  }

  // 僅供完整重讀完成前的即時顯示；重讀後不再重播 promoted 或推測其他會員歸屬。
  function applyReservationResult(current: Snapshot, result: ReservationSuccess): Snapshot {
    const eventId = current.event.id ?? publicId;
    return {
      ...current,
      event: { ...current.event, ...result.eventPatch },
      registrations: applyReservationPromotions(current.registrations, result.promoted, eventId, result.eventPatch.participantsWithUid),
      viewerRegistrations: applyReservationPromotions(current.viewerRegistrations, result.promoted, eventId, result.eventPatch.participantsWithUid),
    };
  }

  const reservation = useTeamReservation({
    event: snapshot ? {
      ...snapshot.event,
      status: snapshot.event.status === 'upcoming' ? 'upcoming' : effectiveEventStatus(snapshot.event, now),
    } : null,
    viewer,
    loading: phase !== 'ready' || !visible || profileLoading || historyFailed || regsPending
      || refreshFailed || rosterPhase === 'loading',
    blocked: busy || rosterSubmitting,
    now,
    sessionKey: reload,
    onSuccess: async result => {
      // 團隊報名按鈕的進度環：寫入成功才打勾（名單重讀仍在 busy 內，結束後才展開）。
      if (alive.current) setTeamDoneSerial(value => value + 1);
      const current = headerState.current.snapshot;
      const uid = currentViewer.current.uid;
      if (!alive.current || !current || !uid || !headerState.current.visible) return;
      // 完整重讀取代補丁重播：先作廢寫入前開始的名單／分隊讀取，避免晚到舊資料覆蓋。
      const request = ++rosterSequence.current;
      const session = sequence.current;
      const teamSeq = teamPublishSeq.current;
      teamLoadSequence.current += 1;
      teamLoadRef.current = null;
      const isCurrent = () => alive.current && request === rosterSequence.current
        && session === sequence.current && currentViewer.current.uid === uid
        && headerState.current.snapshot?.eventDocId === current.eventDocId
        && headerState.current.visible;
      headerState.current = {
        ...headerState.current,
        snapshot: applyReservationResult(current, result),
      };
      setSnapshot(previous => previous ? applyReservationResult(previous, result) : previous);
      if (teamRowsRef.current) {
        const rows = applyReservationPromotions(teamRowsRef.current, result.promoted, publicId, result.eventPatch.participantsWithUid);
        teamRowsRef.current = rows;
        setTeamRegistrations(rows);
      }
      try {
        // 職員每次成功只重讀這個活動的 registrations 一次；不加活動、會員或出席查詢。
        const loaded = await loadEventRegistrations(current.eventDocId);
        if (!isCurrent()) return;
        const registrations = registrationsWithPublishedTeams(loaded, teamSeq);
        const eventId = current.event.id ?? publicId;
        teamRowsRef.current = registrations;
        setTeamRegistrations(registrations);
        setSnapshot(previous => previous ? {
          ...previous,
          registrations,
          viewerRegistrations: [
            ...previous.viewerRegistrations.filter(row => row.eventId !== eventId),
            ...registrations.filter(row => registrationOwner(row) === uid),
          ],
        } : previous);
        // 這次只載入報名；有出席查看權時保留原狀態，首次展開仍須補讀出席紀錄。
        // 無出席查看權則報名資料已完整，可沿用這次重讀，避免首次展開重複查詢。
        if (!canViewDetailAttendanceRecordDetails(currentViewer.current, current.event)) {
          setRosterPhase('ready');
        }
      } catch {
        if (!isCurrent()) return;
        // Callable 結果與已載入的名單仍保留；尚無名單時提供既有重試入口。
        setRosterPhase(phase => phase === 'ready' ? phase : 'error');
        throw new Error('reservation-roster-refresh-failed');
      }
    },
  });

  const teamSplitEnabled = getTeamSplit(event)?.enabled === true;
  // ASSUMPTION: 訪客不讀 registrations，分隊人數照本單顯示 0。
  const teamDisplayRegistrations: readonly TeamRegistration[] = viewer.uid
    ? teamRegistrations ?? snapshot?.registrations ?? []
    : [];

  // T-088：讀取期間若出席重讀或分隊發布跑過，提交時保留較新的出席與 teamKey。
  // previous 為 null（已切走）維持 null，不憑空建快照。teamRowsRef 尚未載入則不改 registrations。
  function registrationsWithPublishedTeams<T extends { _docId?: string }>(
    registrations: readonly T[],
    teamSeq: number,
  ): T[] {
    const rows = teamRowsRef.current;
    if (rows === null || teamPublishSeq.current === teamSeq) return registrations as T[];
    return applyTeamKeyMap(registrations, teamKeysByDoc(rows));
  }

  function adoptLoadedSnapshot(
    previous: Snapshot | null,
    next: Snapshot,
    attendanceSeq: number,
    teamSeq: number,
  ): Snapshot | null {
    if (!previous) return null;
    const registrations = registrationsWithPublishedTeams(next.registrations, teamSeq);
    const attendanceRecords = attendanceCommitSeq.current !== attendanceSeq
      ? previous.attendanceRecords
      : next.attendanceRecords;
    if (registrations === next.registrations && attendanceRecords === next.attendanceRecords) {
      return next;
    }
    return { ...next, registrations, attendanceRecords };
  }

  // countAsPublish=false：只是把快照自己的名單同步回來（沒有新資料），不能讓進行中的讀取誤判「期間有發布」。
  function publishTeamRows(rows: TeamRegistration[], countAsPublish = true): void {
    if (!alive.current) return;
    if (countAsPublish) teamPublishSeq.current += 1;
    teamRowsRef.current = rows;
    setTeamRegistrations(rows);
    // 照 A _tsApplyTeamAssignments＋_tsRefreshTeamSplitUi：已載入的名單也同步隊伍（含失敗還原）（Gemini 審查 P2）。
    const teamByDoc = teamKeysByDoc(rows);
    setSnapshot(prev => {
      if (!prev || prev.registrations.length === 0) return prev;
      const registrations = applyTeamKeyMap(prev.registrations, teamByDoc);
      return registrations === prev.registrations ? prev : { ...prev, registrations };
    });
  }

  // 照 A _tsLoadWritableRegistrations；成功才快取，失敗清除 inflight。
  function loadTeamRows(eventDocId: string): Promise<TeamRegistration[]> {
    if (teamRowsRef.current !== null) return Promise.resolve(teamRowsRef.current);
    if (teamLoadRef.current) return teamLoadRef.current;
    const request = ++teamLoadSequence.current;
    const task = loadEventRegistrations(eventDocId).then(rows => {
      if (alive.current && request === teamLoadSequence.current
        && headerState.current.snapshot?.eventDocId === eventDocId
        && headerState.current.visible) {
        publishTeamRows(rows);
      }
      return rows;
    }).finally(() => {
      if (teamLoadRef.current === task) teamLoadRef.current = null;
    });
    teamLoadRef.current = task;
    return task;
  }

  useEffect(() => {
    teamLoadSequence.current += 1;
    teamLoadRef.current = null;
    teamRowsRef.current = null;
    setTeamRegistrations(null);
    setSelectedTeamKey(null);
    if (visible && viewer.uid && teamSplitEnabled && snapshot?.eventDocId) {
      // 照 A _tsPreloadWritableRegistrations；不展開或改變名單載入狀態。
      loadTeamRows(snapshot.eventDocId).catch(() => {
        // 照 A：預載失敗不阻斷詳情；批次操作時重新讀取。
      });
    }
    return () => {
      teamLoadSequence.current += 1;
      teamLoadRef.current = null;
    };
  }, [snapshot?.eventDocId, visible, viewer.uid, teamSplitEnabled]);

  useEffect(() => {
    if (!viewer.uid || !snapshot || teamBatchPending.current) return;
    // 照 A 重讀名單後更新分隊快取；初始空陣列不能覆蓋預載結果。
    if (rosterPhase !== 'ready' && snapshot.registrations.length === 0) return;
    teamLoadSequence.current += 1;
    publishTeamRows(snapshot.registrations, false);
  }, [snapshot?.registrations, rosterPhase, viewer.uid]);

  async function runTeamBatch(action: TeamBatchAction): Promise<void> {
    const current = headerState.current;
    const target = current.snapshot;
    if (!target || !current.visible || !getTeamSplit(target.event)?.enabled) return;
    const permitted = (): boolean => canManageTeamSplit(
      operateContextFromViewer(currentViewer.current),
      headerState.current.snapshot?.event,
    );
    if (!permitted()) {
      toast.show({ message: '權限不足' });
      return;
    }
    if (teamBatchPending.current) {
      toast.show({ message: '分隊更新中，請稍候' });
      return;
    }
    teamBatchPending.current = true;
    const uid = currentViewer.current.uid;
    const isCurrent = (): boolean => alive.current
      && currentViewer.current.uid === uid
      && headerState.current.visible
      && headerState.current.snapshot === target;
    try {
      const { runTeamSplitBatch } = await import('../data/team-split-writes');
      if (!isCurrent()) return;
      await runTeamSplitBatch({
        eventDocId: target.eventDocId,
        action,
        teams: getSplitTeams(target.event),
        canManage: permitted,
        isCurrent,
        loadRegistrations: () => loadTeamRows(target.eventDocId),
        confirm: message => appConfirm(message),
        notify: message => {
          if (isCurrent()) toast.show({ message });
        },
        publish: rows => {
          if (isCurrent()) publishTeamRows(rows);
        },
      });
    } catch {
      if (isCurrent()) toast.show({ message: '分隊更新失敗，請稍後再試' });
    } finally {
      teamBatchPending.current = false;
    }
  }

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
      || operation.current || reservation.isPending() || rosterSubmitting) return;
    headerRefreshPending.current = true;
    const request = sequence.current;
    const rosterRequest = ++rosterSequence.current;
    rosterPending.current = false;
    const attendanceSeq = attendanceCommitSeq.current;
    const teamSeq = teamPublishSeq.current;
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
        setRosterPhase((phase) => (phase === 'loading' ? 'error' : phase));
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
      setSnapshot((previous) => adoptLoadedSnapshot(previous, {
        event: nextEvent,
        eventDocId: fresh.eventDocId,
        viewerRegistrations: history,
        registrations,
        attendanceRecords,
      }, attendanceSeq, teamSeq));
      if (!registrationsFailed) setRosterPhase('ready');
      else setRosterPhase((phase) => (phase === 'loading' ? 'error' : phase));
      setHistoryFailed(false);
      setRefreshFailed(false);
    } finally {
      headerRefreshPending.current = false;
    }
  }

  const eventId = event?.id ?? publicId;
  const operateCtx = operateContextFromViewer(viewer);
  const canManageRoster = canManageDetailAttendanceRecords(viewer, event);

  useEffect(() => {
    if (rosterAutoHold.current || rosterAutoOpened.current) return;
    if (phase !== 'ready' || !snapshot || !canManageRoster) return;
    if (
      !currentViewer.current.uid
      || operation.current
      || reservation.isPending()
      || refreshFailed
      || rosterPending.current
      || (backgroundRefreshSeq.current !== 0
        && backgroundRefreshSeq.current === rosterSequence.current)
      || !isEventVisibleToUser(
        snapshot.event,
        currentViewer.current,
        snapshot.viewerRegistrations,
      )
    ) {
      return;
    }
    rosterAutoOpened.current = true;
    fetchRosterForSnapshot(snapshot, true).catch(() => {});
  }, [phase, snapshot, canManageRoster, refreshFailed, busy, viewer.uid, rosterPhase,
    backgroundRefreshTick, reservation.busy]);

  const canRemoveConfirmed = Boolean(
    event && canRemoveConfirmedParticipant(operateCtx, event) === true,
  );
  const canViewAttendanceDetails = canViewDetailAttendanceRecordDetails(viewer, event);
  const publicRosterOnly = !canViewAttendanceDetails;
  const canViewNoShow = canViewAttendanceDetails;
  const noShowEnabled = Boolean(visible && rosterExpanded && rosterPhase === 'ready'
    && canViewNoShow && NO_SHOW_FEATURE_ENABLED && viewer.uid && snapshot?.eventDocId);
  // 展開跨過 TTL 時，仍由既有完整 UID 批次更新角色及統計，不另開 users 查詢。
  const roles = useUserRoles(viewer.uid ? roleUids : [], noShowEnabled);
  const noShowData = useRosterNoShow({
    viewerUid: viewer.uid,
    eventDocId: snapshot?.eventDocId,
    people: event ? buildConfirmedRoster(event, snapshot?.registrations ?? []).people : [],
    roles,
    canViewNoShow,
    enabled: noShowEnabled,
    // 管理名單（編輯模式）才讀 userAttendanceStats，一般瀏覽不讀（站長 11-06 放鴿子 v2）。
    managing: Boolean(canManageRoster && rosterEditing),
  });

  const reloadAttendanceOnly = async (): Promise<readonly EventAttendanceEntry[]> => {
    const docId = snapshot?.eventDocId;
    if (!docId || !canViewDetailAttendanceRecordDetails(currentViewer.current, snapshot?.event)) {
      return snapshot?.attendanceRecords ?? [];
    }
    const request = ++attendanceReloadSeq.current;
    const records = await loadEventAttendance(docId);
    if (!alive.current || request !== attendanceReloadSeq.current) {
      return records;
    }
    attendanceCommitSeq.current += 1;
    setSnapshot((prev) => (prev && prev.eventDocId === docId
      ? { ...prev, attendanceRecords: records }
      : prev));
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

  const rosterStatusActions = useRosterStatusActions({
    eventId,
    submitting: rosterSubmitting,
    setSubmitting: setRosterSubmitting,
    isCurrent: () => alive.current && headerState.current.snapshot?.eventDocId === snapshot?.eventDocId,
    getLatest: () => ({
      event: headerState.current.snapshot?.event ?? {},
      registrations: headerState.current.snapshot?.registrations ?? [],
      context: operateContextFromViewer(currentViewer.current),
      operatorName: resolveOperator(currentViewer.current),
    }),
    flush: instantSave.flushInstantSaves,
    adopt: (next) => {
      const current = headerState.current.snapshot;
      if (!current || !alive.current) return;
      // 先作廢寫入前開始的名單讀取（比照 reservation.onSuccess），避免舊讀取蓋回投影。
      rosterSequence.current += 1;
      const projected = adoptEventProjection(current, next.event);
      const registrations = next.registrations as DetailRegistration[];
      const updated: Snapshot = { ...projected, registrations };
      headerState.current = { snapshot: updated, visible: headerState.current.visible };
      setSnapshot((previous) => (
        previous && previous.eventDocId === current.eventDocId
          ? { ...previous, event: updated.event, registrations }
          : previous
      ));
    },
    reload: async () => {
      const current = headerState.current.snapshot;
      const uid = currentViewer.current.uid;
      if (!current || !uid) throw new Error('stale');
      const teamSeq = teamPublishSeq.current;
      const request = ++rosterSequence.current;
      const [fresh, registrations, history] = await Promise.all([
        loadEventDetail(current.event.id || eventId),
        loadEventRegistrations(current.eventDocId),
        loadViewerRegistrations(uid),
      ]);
      if (!alive.current || currentViewer.current.uid !== uid || request !== rosterSequence.current
        || headerState.current.snapshot?.eventDocId !== current.eventDocId) throw new Error('stale');
      if (!fresh || fresh.eventDocId !== current.eventDocId) throw new Error('EVENT_NOT_FOUND');
      if (!isEventVisibleToUser(fresh.event, currentViewer.current, history)) {
        setSnapshot(null);
        setPhase('missing');
        throw new Error('PERMISSION_DENIED');
      }
      // 直接採用伺服器活動投影，保留團隊席位；不以報名筆數覆蓋 current。
      const next: Snapshot = {
        ...(headerState.current.snapshot ?? current),
        event: { ...fresh.event, id: fresh.event.id || eventId },
        eventDocId: current.eventDocId,
        registrations: registrationsWithPublishedTeams(registrations, teamSeq),
        viewerRegistrations: history,
      };
      headerState.current = { snapshot: next, visible: true };
      setSnapshot(next);
      instantSave.resetInstantSave();
      setRosterPhase('ready');
      setRefreshFailed(false);
      setHistoryFailed(false);
      return {
        event: next.event, registrations: next.registrations,
        context: operateContextFromViewer(currentViewer.current),
        operatorName: resolveOperator(currentViewer.current),
      };
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
    if (rosterSubmitting || rosterStatusActions.busy() || !alive.current) return;
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

    rosterRing.start();
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

      // 等 ✓ 期間卸載（succeed 回 false）就不再跑後續的關窗、回填、提示。

      if (!(await rosterRing.succeed())) return;
      show('events.roster.settleSuccess');
      if (result.failed.length > 0) {
        toast.show({
          message: t('events.roster.expGrantFailed', { count: result.failed.length }),
        });
      }

      if (!alive.current) return;
      instantSave.resetInstantSave();
      setRosterEditing(false);
      // 成功提示與退出編輯不等待重讀。重讀失敗維持降級：不改成功結果、不標 refreshFailed。
      void reloadAttendanceOnly().catch(() => {
        // 結算已成功；重讀失敗不影響成功提示與退出編輯。
      });
    } catch {
      show('events.roster.settleFailed');
    } finally {
      rosterRing.fail();
      if (alive.current) setRosterSubmitting(false);
    }
  }

  async function handleKickParticipant(person: ConfirmedRosterPerson): Promise<void> {
    if (!snapshot || rosterSubmitting || rosterStatusActions.busy()) return;
    const targetName = person.name || person.displayName || '';
    const confirmed = await appConfirm(`確定要將 ${targetName} 從報名名單中移除嗎？`);
    if (!confirmed || !alive.current || rosterStatusActions.busy()) return;

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
        // 按鈕加速①：已確認成功先顯示人數投影；名單重讀仍在鎖內做完，避免重讀前重複踢同一人（Opus／Gemini 審查）。
        const next = adoptEventProjection(snapshot, result.response.event);
        const outcomeUnknown = result.response.deduplicated === true || !result.response.event;
        await refresh(next, outcomeUnknown);
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
  // 照 A handleSignup／handleCancelSignup 的完成時機。11-09 起翻牌改成進度環（站長核可「A＋B 變形加進度環」）：
  // 伺服器確認成功後環繼續爬，至少從按下起算 FLIP_MIN_MS、且 settled（背景重讀）完成，才放行補滿＋✓＋展開成新狀態，
  // 否則會先露出舊狀態再跳新狀態（0.20261108i 修的「多翻一次」）；重讀超過 FLIP_MAX_MS 仍未完成就直接放行，不卡在環上。
  // 最短時間改從按下起算（原本從翻牌起算）：環在按下時就開始，伺服器回來後不必再多等 0.75 秒。
  function showFlip(settled?: Promise<unknown>): void {
    if (!alive.current) return;
    if (flipTimer.current !== null) clearTimeout(flipTimer.current);
    const serial = ++flipSequence.current;
    setSettle({ serial, pending: true });
    let minElapsed = false;
    let dataSettled = !settled;
    const flipBack = (): void => {
      if (flipSequence.current !== serial) return;
      if (flipTimer.current !== null) clearTimeout(flipTimer.current);
      flipTimer.current = null;
      if (alive.current) setSettle({ serial, pending: false });
    };
    const minDelay = Math.max(0, FLIP_MIN_MS - (Date.now() - ringStartedAt.current));
    flipTimer.current = setTimeout(() => {
      minElapsed = true;
      if (dataSettled) flipBack();
      else flipTimer.current = setTimeout(flipBack, FLIP_MAX_MS - FLIP_MIN_MS);
    }, minDelay);
    if (settled) {
      void (async () => {
        await settled;
        dataSettled = true;
        if (minElapsed) flipBack();
      })();
    }
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
    if (profileLoading || historyFailed || regsPending) return;

    // T-086a：讀取開始時間與世代（同 contexts 的 generation）交給 registerForEvent，3 秒內可省掉函式內的重讀。
    const latestLoadedAt = Date.now();
    const latestGeneration = generation.current;
    const latest = await contexts.signup.load(current.event.id ?? publicId, [{ type: 'self' }]);
    if (!alive.current || currentViewer.current.uid !== uid) return;
    const earlyBird = latest.earlyBirdWindow
      && (opts.earlyBird === true || latest.event.status === 'upcoming');
    // 照 A handleSignup：自選模式先選隊，使用重讀後的活動設定。
    const signupTeamSplit = getTeamSplit(latest.event);
    const requiresTeamSelection = signupTeamSplit?.enabled === true
      && signupTeamSplit.mode === 'self-select';
    const signupTeamKey = requiresTeamSelection ? selectedTeamKey : null;
    if (requiresTeamSelection && !signupTeamKey) {
      toast.show({ message: lt('teamSplit.select.required', '請先選擇隊伍') });
      return;
    }
    const result = precheckSignup(
      latest.event, latest.viewer, latest.registrations, new Date(), {
        profileComplete: latest.profileComplete,
        participantCheck: latest.participantCheck,
        earlyBirdWindow: latest.earlyBirdWindow,
        earlyBirdAccepted: earlyBird,
        teamSignupAllowed: latest.teamSignupAllowed,
        // 照 A：本頁已檢查選隊；registerForEvent 的 context 仍要求 teamKey。
        requiresTeamSelection: requiresTeamSelection && !signupTeamKey,
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

    const reservationTeamId = await reservation.chooseSignupTeam(latest.event);
    if (reservationTeamId === null || !alive.current || currentViewer.current.uid !== uid) return;

    let response: Awaited<ReturnType<typeof registerForEvent>>;
    try {
      response = await registerForEvent({
        eventId: current.event.id ?? publicId,
        user: { uid, displayName: currentViewer.current.displayName },
        context: contexts.signup,
        ...(reservationTeamId ? { preferredTeamReservationTeamId: reservationTeamId } : {}),
        ...(signupTeamKey ? { teamKey: signupTeamKey } : {}),
        // T-086a：早鳥確認視窗之後不傳快照，確保確認後一定重讀。
        ...(earlyBird ? { earlyBirdAccepted: true, earlyBirdExpectedCost: cost } : {
          snapshot: latest,
          snapshotLoadedAt: latestLoadedAt,
          snapshotGeneration: latestGeneration,
          snapshotParticipants: [{ type: 'self' as const }],
        }),
      });
    } catch (error) {
      // T-086a：逾時＝結果未知，顯示既有錯誤訊息後重讀名單；不自動重送。
      if (error instanceof SignupError && error.originalCode === 'CALLABLE_TIMEOUT'
        && alive.current && currentViewer.current.uid === uid) {
        toast.show({ message: error.message });
        await refresh(current, true);
        return;
      }
      throw error;
    }
    if (!alive.current || currentViewer.current.uid !== uid) return;
    if (response.deduplicated) {
      toast.show({ message: '報名處理中，請稍候' });
      await refresh(current, true);
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
    let signupMessage = waitlisted ? '已加入候補名單'
      : response.earlyBirdCharged
        ? `早鳥報名成功，已扣除 ${charged} 積分` : '報名成功！';
    // ASSUMPTION: B 批次 Callable 將 A registration 放在 registrations 的本人項目；
    // 同時接受 A 單筆 registration 回傳，兩者都只讀取 teamKey。
    const singleRegistration: unknown = (
      response as unknown as { registration?: unknown }
    ).registration;
    const assignedRegistration = selfResult ?? singleRegistration;
    const assignedKey = assignedRegistration !== null
      && typeof assignedRegistration === 'object'
      && 'teamKey' in assignedRegistration
      && typeof assignedRegistration.teamKey === 'string'
      ? assignedRegistration.teamKey : null;
    if (!waitlisted && signupTeamSplit?.enabled
      && signupTeamSplit.mode === 'random' && assignedKey) {
      const assignedTeam = getSplitTeams(latest.event).find(team => team.key === assignedKey);
      if (assignedTeam) {
        signupMessage += ` 你被分配到 ${assignedTeam.name || `${assignedTeam.key} 隊`}`;
      }
    }
    toast.show({ message: signupMessage });
    // T-086a：額滿相關欄位先用伺服器回傳的活動投影；名單與「我的報名」仍以背景重讀為準，
    // 不把 response.registrations 當名單渲染。
    const rawEvent: unknown = response.event;
    const responseEvent = rawEvent && typeof rawEvent === 'object' && !Array.isArray(rawEvent)
      ? rawEvent as Partial<Snapshot['event']> : null;
    const next: Snapshot = responseEvent
      ? { ...current, event: { ...current.event, ...responseEvent } }
      : current;
    if (responseEvent) {
      setSnapshot(previous => previous && ({
        ...previous,
        event: { ...previous.event, ...responseEvent },
      }));
    }
    showFlip(refreshInBackground(next));
    // 照 A _maybeShowLineNotifyPrompt；引導失敗不改寫報名成功結果。
    maybeShowLinePrompt(uid).catch(() => {});
  }

  // 照 A handleCancelSignup；抽成可重用 hook，行為與原 beginCancel／confirmCancel 相同。
  const cancelFlow = useCancelRegistration({
    getViewerUid: () => currentViewer.current.uid ?? null,
    isAlive: () => alive.current,
    canRun: () => visible && !refreshFailed && alive.current,
    login,
    cancelContext: contexts.cancel,
    onIntegrityError: () => {
      show('events.detailPage.refreshError');
      setRefreshFailed(true);
    },
    onSelfCancelled: async ({ deduplicated, updatedEvent }) => {
      const current = snapshot;
      if (!current) return;
      // T-086a：結果未知（deduplicated／逾時）時等重讀完成（顧問規則 3）；已確認成功改背景重讀。
      if (deduplicated) {
        await refresh(current, true);
        return;
      }
      if (updatedEvent) {
        setSnapshot(previous => previous && ({ ...previous, event: updatedEvent }));
      }
      // 原本只在有投影時翻牌（背面文字要靠投影判斷額滿）；進度環不需要文字，一律等重讀完成才展開。
      showFlip(refreshInBackground(updatedEvent ? { ...current, event: updatedEvent } : current));
    },
    onBatchCancelled: async (result) => {
      const current = snapshot;
      if (!current) return;
      // 省略 result（ALREADY_CANCELLED）也沒有投影，同樣要重讀活動文件。
      if (!result || result.deduplicated) {
        await refresh(current, true);
        return;
      }
      void refreshInBackground(adoptEventProjection(current, result?.event));
    },
  });

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
    companionRing.start();
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

    // 先完成俱樂部選擇再寫入，取消選擇不應先取消既有同行者報名。
    const reservationTeamId = chosen.length ? await reservation.chooseSignupTeam(latest.event) : '';
    if (reservationTeamId === null || !alive.current || currentViewer.current.uid !== uid) return;

    let confirmed = 0;
    let waitlisted = 0;
    let cancelled = 0;
    let writeAttempted = false;
    let projection: unknown = null;
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
          await refresh(current, true);
          return;
        }
        cancelled = cancelRegistrationIds.length;
        projection = response.event;
      }
      if (chosen.length) {
        if (!alive.current || currentViewer.current.uid !== uid) return;
        writeAttempted = true;
        const response = await registerSelection({
          eventId: current.event.id ?? publicId,
          user: { uid, displayName: currentViewer.current.displayName },
          participants,
          companionToggle: true,
          ...(reservationTeamId ? { preferredTeamReservationTeamId: reservationTeamId } : {}),
        }, false);
        if (!alive.current) return;
        if (response.deduplicated) {
          toast.show({ message: '報名處理中，請稍候' });
          setCompanionOpen(false);
          await refresh(adoptEventProjection(current, projection), true);
          return;
        }
        confirmed = count(response.confirmed);
        waitlisted = count(response.waitlisted);
        projection = response.event ?? projection;
      }
      // 等 ✓ 期間卸載（succeed 回 false）就不再跑後續的關窗、回填、提示。
      if (!(await companionRing.succeed())) return;
      const parts: string[] = [];
      if (confirmed + waitlisted > 0) parts.push(`新增 ${confirmed + waitlisted} 人`);
      if (waitlisted > 0) parts.push(`候補 ${waitlisted} 人`);
      if (cancelled > 0) parts.push(`取消 ${cancelled} 人`);
      toast.show({
        message: parts.length ? `夥伴報名已更新：${parts.join('、')}` : '夥伴報名已更新',
      });
      setCompanionOpen(false);
      await refresh(adoptEventProjection(current, projection));
    } catch (error) {
      companionRing.fail();
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
        // T-087a 伺服器檢查；文案同伺服器 message（A 原文）
        EVENT_STARTED: '活動已於開始時間結束，無法取消報名',
        EVENT_UNAVAILABLE: '此活動目前無法報名',
        REQUEST_ID_CONFLICT: '請重新整理後再試',
        PARTICIPANT_NOT_ALLOWED: '無權限執行此操作',
        // T-074 同行者加報選隊被伺服器拒絕；沿用本人報名的 locale key。
        TEAM_RESERVATION_TEAM_DENIED: t('events.signup.error.teamReservationDenied'),
        TEAM_RESERVATION_TEAM_NOT_AVAILABLE: t('events.signup.error.teamReservationUnavailable'),
      };
      toast.show({ message: messages[code] || '夥伴報名調整失敗，請稍後再試' });
      // 照 A：部分成功後重讀，避免用舊勾選狀態重送已成功的加報。
      if (writeAttempted) {
        setCompanionOpen(false);
        await refresh(adoptEventProjection(current, projection), true);
      }
    }
  }

  function startCompanion(work: () => Promise<void>): void {
    start(async () => {
      setCompanionBusy(true);
      try {
        await work();
      } finally {
        companionRing.fail();
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

  if (phase === 'loading' || accountReset) {
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
    historyFailed: historyFailed || regsPending,
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
              {SHOW_FAVORITES && (
                <>
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
                </>
              )}
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
            teamSplitSlot={<>
              <TeamInfoCards event={event} registrations={teamDisplayRegistrations} />
              <TeamBatchButtons
                event={event}
                context={operateCtx}
                onAction={action => { runTeamBatch(action).catch(() => {}); }}
              />
            </>}
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
                registrations={teamSplitEnabled ? teamDisplayRegistrations : snapshot.registrations}
                canScan={() => Boolean(
                  currentViewer.current.uid
                  && canManageDetailAttendanceRecords(currentViewer.current, snapshot.event)
                )}
                onScan={() => {
                  location.route(`/checkin?eventId=${encodeURIComponent(eventId)}`);
                }}
              />
            </div>

            <TeamSelectUI
              event={event}
              registrations={teamDisplayRegistrations}
              selectedKey={selectedTeamKey}
              onSelect={setSelectedTeamKey}
            />

            <div class="detail-action-primary" id="detail-action-primary">
              <EventDetailPrimaryButton
                state={state}
                disabled={state.disabled || busy || reservation.busy || refreshFailed}
                busy={busy}
                running={primaryBusy}
                settle={settle}
                teamReservation={reservation.action ? {
                  ...reservation.action,
                  busy: reservation.busy,
                  doneSerial: teamDoneSerial,
                  disabled: rosterSubmitting,
                  onClick: () => reservation.open(reservation.action?.preferredTeamId),
                } : null}
                onClick={() => {
                  if (state.action === 'cancel') {
                    const current = snapshot;
                    if (current) {
                      startPrimary(() => cancelFlow.beginCancel({
                        event: current.event,
                        publicId,
                        owned,
                      }));
                    }
                  }
                  else if (state.action === 'signup') startPrimary(() => beginSelfSignup({}));
                  else if (state.action === 'earlyBird') {
                    startPrimary(() => beginSelfSignup({ earlyBird: true }));
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
              onExpand={() => setRosterState({ expanded: true, phase: 'ready' })}
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
                      disabled={busy || reservation.busy || refreshFailed}
                      onOpen={handleOpenDetailAttendanceRecords}
                      onPrefetch={prefetchDetailAttendanceRecords}
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
                  ) : rosterPhase === 'ready' ? (
                    <AttendanceRosterTable
                      event={event}
                      canAdjustTeamReservation={reservation.canAdjustTeam}
                      onAdjustTeamReservation={reservation.open}
                      registrations={snapshot.registrations}
                      attendanceRecords={snapshot.attendanceRecords}
                      roles={roles}
                      onOpenProfile={profile}
                      canManage={canManageRoster}
                      canViewNoShow={canViewNoShow}
                      noShowData={noShowData}
                      canRemoveConfirmed={canRemoveConfirmed}
                      rosterContext={operateCtx}
                      demotePendingKeys={rosterStatusActions.demotePendingKeys}
                      onDemoteParticipant={person => {
                        rosterStatusActions.perform('demote', {
                          userId: person.uid, name: person.name || person.displayName,
                          isCompanion: person.isCompanion,
                        }).catch(() => show('events.roster.statusFailed'));
                      }}
                      publicRosterOnly={publicRosterOnly}
                      editing={rosterEditing}
                      submitting={rosterSubmitting || reservation.busy}
                      finishRing={rosterRing}
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
                  ) : null}
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
                    editing={rosterEditing}
                    submitting={rosterSubmitting || reservation.busy}
                    rosterContext={operateCtx}
                    promotePendingKeys={rosterStatusActions.promotePendingKeys}
                    onPromoteParticipant={item => {
                      rosterStatusActions.perform('promote', {
                        userId: item.userId, name: item.name,
                      }).catch(() => show('events.roster.statusFailed'));
                    }}
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

        {reservation.dialogs}
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
              ring={companionRing}
              onClose={() => { if (!busy) setCompanionOpen(false); }}
              onConfirm={selection => startCompanion(() => confirmCompanions(selection))}
            />
          </Suspense>
        )}
        {cancelFlow.renderModal({
          busy,
          eventTitle: event.title || '',
          onConfirm: ids => {
            const current = snapshot;
            if (!current) return;
            start(() => cancelFlow.confirmCancel({
              event: current.event,
              publicId,
              owned,
            }, ids));
          },
        })}
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
            <EventFormPostSaveBoundary
              viewer={viewer}
              close={() => {
                if (alive.current) setEditingDetail(false);
              }}
              refresh={() => {
                if (alive.current) setReload(value => value + 1);
              }}
            >
              {(onSaved) => (
                <DetailEventFormModal
                  open
                  mode="edit"
                  existing={{ ...event, _docId: snapshot.eventDocId, docId: snapshot.eventDocId }}
                  viewer={viewer}
                  onClose={() => setEditingDetail(false)}
                  onSaved={onSaved}
                />
              )}
            </EventFormPostSaveBoundary>
          </Suspense>
        )}
        {noticeToast}
      </section>
    </div>
  );
}
