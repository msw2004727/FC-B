import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { useGoBack } from '@/core/back-guard';
import { COURSES_ENABLED } from '@/features/education/flags';
import { getLastKnownAuthUid } from '@/data/auth';
import { lt, useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';
import { useActionRingControl } from '@/ui/action-ring';
import { useViewer, requestViewerRefresh, type ViewerView } from '@/features/profile/data/viewer';
import { getEventsRepo } from '@/features/events/data/events-repo';
import {
  loadEventFormModal,
  type EventFormModalComponent,
} from '@/features/home/data/event-form-loader';
import { useCreateEventEntry } from '@/features/events/components/event-form/use-create-event-entry';
import { useEventFormPostSave } from '@/features/events/components/event-form/use-event-form-post-save';
import { getSportKeySafe } from '@/features/events/data/sports';
import { loadViewerRegistrations } from '@/features/events/data/viewer-registrations';
import { getVisibleEvents } from '@/features/events/data/visibility';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';
import { copyToClipboard } from '@/features/events/data/activity-share';
import { buildShareUrl } from '@/features/events/data/event-share-builders';
import { loadTeam, loadTeamMembers } from '../data/teams-repo';
import { leaveTeam, requestTeamJoin } from '../data/membership';
import {
  buildTeamRoster,
  // ASSUMPTION: 未附 import 區塊，此具名 import 為獨立一行且僅供原 canManageRoster 使用。
  getTeamFutureEvents,
  getTeamMemberCount,
  getTeamPrimaryAction,
  getTeamStaffIdentity,
  isTeamDetailSectionVisible,
} from '../data/team-detail-model';
import { deleteTeamViaCallable } from '../data/teams-admin-write';
import { getTransferCandidates, resolveTransferTeamId } from '../data/team-transfer';
import {
  canCreateClubEvent,
  canEditTeamSettings,
  canOwnerDeleteUserTeam,
  canShowInviteQr,
  isUserCapabilityTeam,
  resolveClubDetailAccess,
} from '../club-policy';
import { getTeamThemeColor } from '../data/team-list-model';
import type { TeamDoc, TeamMember } from '../data/types';
import {
  clearPendingJoin,
  getSessionJoinState,
  getSessionJoinHoursLeft,
  loginForClubs,
  rememberPendingJoin,
} from './clubs-session';
import {
  TeamDetailV2Header,
  type V2TabDef,
  type V2TabKey,
} from '../components/legacy/TeamDetailV2Header';
import { TeamDetailV2Panels } from '../components/legacy/TeamDetailV2Panels';
import {
  getRememberedTeamTab,
  rememberTeamTab,
} from '../components/legacy/team-detail-tab-memory';
import { TeamInviteQrOverlay } from '../components/legacy/TeamInviteQrOverlay';
import { TeamSettingsModal } from '../components/legacy/TeamSettingsModal';
import {
  loadTeamFormModal,
  type TeamFormModalComponent,
} from '../components/legacy/team-form-loader';
import { useTeamImageUpload } from '../components/legacy/use-team-image-upload';
import '../legacy/team.css';
import '../legacy/team-detail-v2.css';

type Resource<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: T };

interface EventResource {
  events: EventDoc[];
  registrations: RegistrationDoc[];
}

/**
 * C1 頁籤：戰績沒有資料、動態沒有貼文就不出頁籤；頁籤不帶數字徽章。
 * 課程（K1）：課程開關 COURSES_ENABLED 打開（K3 驗收前關閉）才出，條件照 A（自建俱樂部不開放、教學標籤＋區塊可見）。
 */
function getTabsForTeam(team: TeamDoc, totalGames: number): V2TabDef[] {
  const tabs: V2TabDef[] = [{ key: 'overview', label: '總覽' }];
  // T-090：自建俱樂部不開放教學（課程）與賽事入口。
  const userCapabilityTeam = isUserCapabilityTeam(team);
  if (COURSES_ENABLED && !userCapabilityTeam && isTeamDetailSectionVisible(team, 'courses')) {
    tabs.push({ key: 'courses', label: '課程' });
  }
  if (isTeamDetailSectionVisible(team, 'events')) {
    tabs.push({ key: 'events', label: '活動' });
  }
  if (isTeamDetailSectionVisible(team, 'members')) {
    tabs.push({ key: 'members', label: '成員' });
  }
  if (
    totalGames > 0 && (
      isTeamDetailSectionVisible(team, 'record') ||
      (!userCapabilityTeam && isTeamDetailSectionVisible(team, 'matches'))
    )
  ) {
    tabs.push({ key: 'record', label: '戰績' });
  }
  if (Array.isArray(team['feed']) && team['feed'].length > 0) {
    tabs.push({ key: 'feed', label: '動態' });
  }
  return tabs;
}

type CourseTabComponent = typeof import('@/features/education/components/CourseTab').CourseTab;

/** 課程頁籤按需載入（只有開關打開、切到課程頁籤才下載課程程式與字典）。 */
function LazyCourseTab(props: Parameters<CourseTabComponent>[0]): JSX.Element {
  const t = useT();
  const [Comp, setComp] = useState<CourseTabComponent | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    import('@/features/education/components/CourseTab')
      .then((m) => {
        if (alive) setComp(() => m.CourseTab);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  if (Comp) return <Comp {...props} />;
  return (
    <div class="td-v2-empty" role={failed ? 'alert' : undefined}>
      <div>{t(failed ? 'common.error' : 'common.loading')}</div>
      {failed ? (
        <button type="button" class="primary-btn small" style="margin-top:8px" onClick={() => setAttempt((v) => v + 1)}>
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  );
}

function ShellState({
  teamId,
  children,
}: {
  teamId: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class="legacy-ui">
      <section class="page active td-v2-active" id="page-team-detail">
        <div class="detail-body" id="team-detail-body">
          <div class="td-v2-shell" data-team-id={teamId}>
            <div class="td-v2-content">{children}</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function TeamDetailContent({
  id,
  viewer,
}: {
  id: string;
  viewer: ViewerView;
}): JSX.Element {
  const t = useT();
  const location = useLocation();
  const [teamState, setTeamState] = useState<Resource<TeamDoc | null>>({ status: 'loading' });
  const [membersState, setMembersState] = useState<Resource<TeamMember[] | null>>({
    status: 'loading',
  });
  const [eventsState, setEventsState] = useState<Resource<EventResource>>({ status: 'loading' });
  const [teamAttempt, setTeamAttempt] = useState(0);
  const [memberAttempt, setMemberAttempt] = useState(0);
  const [eventAttempt, setEventAttempt] = useState(0);
  const [pickedTab, setPickedTab] = useState<V2TabKey | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // 單一狀態確保設定與基本資料表單不會同時掛載。
  const [teamOverlay, setTeamOverlay] = useState<'settings' | 'edit-basic' | null>(null);
  const [TeamForm, setTeamForm] = useState<TeamFormModalComponent | null>(null);
  const [EventForm, setEventForm] = useState<EventFormModalComponent | null>(null);
  const [, setPendingRevision] = useState(0);
  const alive = useRef(true);
  const actionLock = useRef(false);
  // 「加入俱樂部」進度環：確認後送出申請才轉，成功打勾後展開成「審核中」。
  const joinRing = useActionRingControl();
  const teamSequence = useRef(0);
  const memberSequence = useRef(0);
  const eventSequence = useRef(0);
  // M-119：照 A team-detail.js:997-1000。存取只走 resolveClubDetailAccess。
  // pending：不讀資料、不要求登入（含 auth 已是字串但 viewer 還沒 uid）。login-required 才出閘門。
  const access = resolveClubDetailAccess(viewer, getLastKnownAuthUid());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    // 只有 allowed 才讀俱樂部。uid 或 access 變了就依相依項重跑。
    if (access !== 'allowed') return;
    const sequence = ++teamSequence.current;
    let cancelled = false;
    setTeamState({ status: 'loading' });
    loadTeam(id).then(
      (loaded) => {
        if (cancelled || sequence !== teamSequence.current) return;
        const normalized = loaded
          ? { ...loaded, id: String(loaded.id || loaded._docId || id).trim() }
          : null;
        setTeamState({ status: 'ready', value: normalized });
      },
      () => {
        if (!cancelled && sequence === teamSequence.current) {
          setTeamState({ status: 'error' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, teamAttempt, access, viewer.uid]);

  const team = teamState.status === 'ready' ? teamState.value : null;
  const teamId = String(team?.id ?? id).trim();
  const teamRef = useRef<TeamDoc | null>(team);
  teamRef.current = team;
  const membersKey = team
    ? JSON.stringify([
        team.id ?? team._docId ?? '',
        team.captainUid ?? '',
        Array.isArray(team.leaderUids) ? team.leaderUids : [],
        team.leaderUid ?? '',
        Array.isArray(team.coachUids) ? team.coachUids : [],
      ])
    : '';
  const imageUpload = useTeamImageUpload({
    team,
    viewer,
    onSaved: () => reloadTeamSilently(),
  });
  const createEntry = useCreateEventEntry(viewer);
  const onFormSaved = useEventFormPostSave({
    viewer,
    close: createEntry.closeForm,
    refresh: () => setEventAttempt((v) => v + 1),
  });
  const eventFormOpen = createEntry.formOpen;
  const closeEventForm = createEntry.closeForm;
  useEffect(() => {
    if (!eventFormOpen || EventForm) return undefined;
    let alive = true;
    loadEventFormModal().then(
      (component) => {
        if (alive) setEventForm(() => component);
      },
      () => {
        if (!alive) return;
        toast.show({ message: t('clubs.actionError'), tone: 'error' });
        closeEventForm();
      },
    );
    return () => {
      alive = false;
    };
  }, [eventFormOpen, EventForm, closeEventForm, t]);
  useEffect(() => {
    if (teamOverlay !== 'edit-basic' || TeamForm) return undefined;
    let alive = true;
    loadTeamFormModal().then(
      (component) => {
        if (alive) setTeamForm(() => component);
      },
      () => {
        if (!alive) return;
        toast.show({ message: t('clubs.actionError'), tone: 'error' });
        setTeamOverlay(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [teamOverlay, TeamForm, t]);
  const canCreateEvent = canCreateClubEvent(viewer, team);
  // 同一批資料切換頁籤或開啟 overlay 時保留 events 與日期 Set 的參照。
  const visibleEvents = useMemo(
    () => eventsState.status === 'ready'
      ? getTeamFutureEvents(
          teamId,
          getVisibleEvents(eventsState.value.events, viewer, eventsState.value.registrations),
        )
      : [],
    [eventsState, teamId, viewer],
  );
  const showMembers = !!team && isTeamDetailSectionVisible(team, 'members');
  const showEvents = !!team && isTeamDetailSectionVisible(team, 'events');
  const showInfo = !!team && isTeamDetailSectionVisible(team, 'info');
  // T-090h：轉移經理的候選人取自成員名單；成員與資訊都隱藏時，擁有者開設定才讀名單。
  const needMembers = showMembers || showInfo
    || (teamOverlay === 'settings' && canOwnerDeleteUserTeam(viewer, team));

  useEffect(() => {
    const sequence = ++memberSequence.current;
    let cancelled = false;
    setMembersState({ status: 'loading' });
    if (!teamRef.current || !needMembers) return;

    loadTeamMembers(teamRef.current).then(
      (members) => {
        if (!cancelled && sequence === memberSequence.current) {
          setMembersState({ status: 'ready', value: members });
        }
      },
      () => {
        if (!cancelled && sequence === memberSequence.current) {
          setMembersState({ status: 'error' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [membersKey, needMembers, viewer.uid, memberAttempt]);

  useEffect(() => {
    const sequence = ++eventSequence.current;
    let cancelled = false;
    setEventsState({ status: 'loading' });
    if (!teamId || !showEvents) return;

    const repo = getEventsRepo();
    // 第一次載入沿用 30 秒內已成功的 active（上限 200 筆），避免從首頁或列表再查一次。
    // 重試與開團後刷新（eventAttempt > 0）不沿用，新活動才不會被快取擋到。
    const reuseActiveIfFresh = eventAttempt === 0;
    Promise.all([
      repo.loadEventsStatic({
        terminalMode: 'none',
        ...(reuseActiveIfFresh ? { reuseActiveIfFresh: true } : {}),
      }).then(() => repo.getSnapshot().active),
      viewer.uid ? loadViewerRegistrations(viewer.uid) : Promise.resolve<RegistrationDoc[]>([]),
    ]).then(
      ([events, registrations]) => {
        if (!cancelled && sequence === eventSequence.current) {
          setEventsState({ status: 'ready', value: { events, registrations } });
        }
      },
      () => {
        if (!cancelled && sequence === eventSequence.current) {
          setEventsState({ status: 'error' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [teamId, showEvents, viewer.uid, eventAttempt]);

  useEffect(() => {
    if (!team?.id || !viewer.uid || !viewer.teamIds.has(team.id)) return;
    clearPendingJoin(team.id, viewer.uid);
  }, [team, viewer.uid, viewer.teamIds]);

  async function login(): Promise<void> {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await loginForClubs();
    } catch {
      toast.show({ message: t('clubs.actionError'), tone: 'error' });
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  // M-045：共用返回（前面有本站頁就退回，否則回俱樂部列表）。
  const handleBack = useGoBack('/teams');

  // C1：「⋯」只給可編輯者（開設定）；其他人頂欄不出「⋯」。
  function handleMore(): void {
    if (team && canEditTeamSettings(viewer, team)) setTeamOverlay('settings');
  }

  /** C1：所有人都能複製俱樂部連結；網址與邀請 QR 相同（buildShareUrl('team', id)）。 */
  async function handleCopyLink(): Promise<void> {
    const targetId = String(team?.id ?? '').trim();
    if (!targetId) return;
    const copied = await copyToClipboard(buildShareUrl('team', targetId));
    toast.show({
      message: t(copied ? 'clubs.copyLink.done' : 'clubs.copyLink.failed'),
      tone: copied ? 'success' : 'error',
    });
  }

  function handleEditBasic(): void {
    if (!team || !canEditTeamSettings(viewer, team)) {
      toast.show({ message: '您沒有編輯此俱樂部的權限' });
      return;
    }

    // 同一次更新卸載設定彈窗，再掛載表單；各彈窗沿用自己的 overlay cleanup。
    setTeamOverlay('edit-basic');
  }

  async function handleBasicSaved(): Promise<void> {
    setTeamOverlay(null);
    await reloadTeamSilently();
  }

  /** K4：剔除後只從已載入的成員名單移除該人，不重讀成員（俱樂部文件由 onTeamChanged 重讀 1 次）。 */
  function handleMemberRemoved(uid: string): void {
    const target = uid.trim();
    setMembersState((prev) => (prev.status === 'ready' && prev.value
      ? {
          status: 'ready',
          value: prev.value.filter((member) => String(member.uid ?? member._docId ?? '').trim() !== target),
        }
      : prev));
  }

  async function reloadTeamSilently(): Promise<void> {
    const sequence = ++teamSequence.current;
    try {
      const loaded = await loadTeam(id);
      if (sequence !== teamSequence.current || !alive.current) return;
      setTeamState({
        status: 'ready',
        value: loaded
          ? { ...loaded, id: String(loaded.id || loaded._docId || id).trim() }
          : null,
      });
    } catch (error) {
      console.error('[TeamDetailPage.reloadTeamSilently]', error);
    }
  }

  function selectTab(next: V2TabKey): void {
    setPickedTab(next);
    rememberTeamTab(teamId, next);
    try {
      shellRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    } catch { /* 忽略 */ }
  }

  function handleCreateEvent(): void {
    if (!team || !canCreateClubEvent(viewer, team)) {
      toast.show({ message: '只有俱樂部職員可以新增俱樂部活動' });
      return;
    }
    createEntry.onClickCustom({
      teamIds: [String(team.id ?? '').trim()],
      teamNames: [String(team.name ?? '')],
      sportTag: getSportKeySafe(team.sportTag ?? ''),
    });
  }

  function handleInvite(): void {
    if (!team || !canShowInviteQr(viewer, team)) return;
    setInviteOpen(true);
  }

  const onOpenProfile = (uid: string): void => {
    location.route(`/profile/${encodeURIComponent(uid)}`);
  };

  function handleContact(): void {
    const captainUid = String(team?.captainUid ?? '').trim();
    if (!captainUid) {
      toast.show({ message: '此俱樂部尚未設定負責人' });
      return;
    }
    onOpenProfile(captainUid);
  }

  // ASSUMPTION: 閘門不載入俱樂部，頁首只留既有返回鈕，不顯示隊名與統計。
  // 不自動 signIn，避免使用者取消登入後按返回又被送去登入。
  if (access === 'login-required') {
    return (
      <div class="legacy-ui">
        <section class="page active td-v2-active" id="page-team-detail">
          <div class="detail-body" id="team-detail-body">
            <div class="td-v2-shell" data-team-id={id}>
              <div class="td-v2-topbar">
                <button
                  class="td-v2-icon-btn"
                  type="button"
                  data-td-v2-action="back"
                  aria-label="返回"
                  onClick={handleBack}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                </button>
              </div>
              <main class="td-v2-content">
                <div class="td-v2-empty">
                  <div>
                    <Text>{lt('請先登入 LINE 帳號', '請先登入 LINE 帳號')}</Text>
                  </div>
                  <button
                    type="button"
                    class="primary-btn small"
                    style="margin-top:8px;min-height:44px;min-width:96px"
                    disabled={busy}
                    onClick={() => {
                      void login();
                    }}
                  >
                    <Text>{lt('登入', '登入')}</Text>
                  </button>
                </div>
              </main>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (access === 'pending' || teamState.status === 'loading') {
    return (
      <ShellState teamId={id}>
        <div class="td-v2-empty" role="status">
          載入中…
        </div>
      </ShellState>
    );
  }

  if (teamState.status === 'error') {
    return (
      <ShellState teamId={id}>
        <div class="td-v2-empty" role="alert">
          <div>載入失敗</div>
          <button
            type="button"
            class="primary-btn small"
            style="margin-top:8px"
            onClick={() => setTeamAttempt((v) => v + 1)}
          >
            重試
          </button>
        </div>
      </ShellState>
    );
  }

  if (!team) {
    return (
      <ShellState teamId={id}>
        <div class="td-v2-empty">
          <div>找不到此俱樂部</div>
          <button
            type="button"
            class="primary-btn small"
            style="margin-top:8px"
            onClick={() => location.route('/teams')}
          >
            返回俱樂部列表
          </button>
        </div>
      </ShellState>
    );
  }

  const teamName = team.name || '未命名俱樂部';
  const themeColor = getTeamThemeColor(team);
  const canEdit = canEditTeamSettings(viewer, team);
  const joinState = getSessionJoinState(teamId, viewer.uid);
  const primaryAction = getTeamPrimaryAction(team, viewer, joinState);



  const roster =
    membersState.status === 'ready' && membersState.value !== null
      ? buildTeamRoster(team, membersState.value)
      : [];

  const membersStatus: 'loading' | 'error' | 'guest' | 'ready' =
    membersState.status === 'loading'
      ? 'loading'
      : membersState.status === 'error'
        ? 'error'
        : !viewer.uid || membersState.value === null
          ? 'guest'
          : 'ready';

  const transferCandidates = membersState.status === 'loading'
    ? null
    : getTransferCandidates(roster, viewer.uid, resolveTransferTeamId(team));

  const memberCount = getTeamMemberCount(team);
  const courseCount = 0;
  const eventCount = visibleEvents.length;
  const wins = Number(team['wins'] || 0);
  const draws = Number(team['draws'] || 0);
  const losses = Number(team['losses'] || 0);
  const totalGames = wins + draws + losses;
  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

  const tabs = getTabsForTeam(team, totalGames);
  const tabKeys = new Set(tabs.map((item) => item.key));
  const activeTab = pickedTab && tabs.some((item) => item.key === pickedTab)
    ? pickedTab
    : getRememberedTeamTab(teamId, tabs.map((item) => item.key));

  function handleJoinPending(): void {
    const state = getSessionJoinState(teamId, viewer.uid);
    if (state?.status === 'pending') {
      const hours = getSessionJoinHoursLeft(teamId, viewer.uid) ?? 24;
      toast.show({
        message: `您已申請此俱樂部，請等候審核（可於 ${hours} 小時後再次申請）`,
      });
      return;
    }
    void handleJoin();
  }

  function handleJoined(): void {
    toast.show({ message: '您已加入此俱樂部' });
  }

  async function handleJoin(): Promise<void> {
    if (actionLock.current || !team) return;
    if (!viewer.uid) {
      await login();
      return;
    }
    if (viewer.teamIds.has(teamId)) {
      toast.show({ message: `您已是「${teamName}」成員，無需重複申請` });
      return;
    }
    const currentJoinState = getSessionJoinState(teamId, viewer.uid);
    if (currentJoinState?.status === 'pending') {
      const hours = getSessionJoinHoursLeft(teamId, viewer.uid) ?? 24;
      toast.show({
        message: `您已申請此俱樂部，請等候審核（可於 ${hours} 小時後再次申請）`,
      });
      return;
    }

    actionLock.current = true;
    setBusy(true);
    try {
      const confirmed = await appConfirm(`確定要加入「${teamName}」俱樂部？`);
      if (!confirmed || !alive.current) return;

      const uid = viewer.uid;
      const self: TeamMember = { uid, displayName: viewer.displayName ?? '' };
      joinRing.start();
      await requestTeamJoin({ team, applicant: self });
      // 等 ✓ 期間卸載（succeed 回 false）就不再跑後續的關窗、回填、提示。
      if (!(await joinRing.succeed())) return;
      rememberPendingJoin(teamId, uid);
      requestViewerRefresh();
      if (alive.current) {
        setPendingRevision((v) => v + 1);
        toast.show({ message: '已送出加入申請！', tone: 'success' });
      }
    } catch (error) {
      if (!alive.current) return;
      toast.show({ message: t('clubs.actionError'), tone: 'error' });
    } finally {
      joinRing.fail();
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function handleLeave(): Promise<void> {
    if (actionLock.current || !team || !viewer.uid) return;
    const uid = viewer.uid;
    // C1（P-09）：經理、領隊先擋，不必先按確認框才被告知不能退。
    const staff = getTeamStaffIdentity(team);
    if (staff.captainUids.has(uid)) {
      toast.show({ message: '經理無法退出俱樂部，請先轉移經理職務', tone: 'warning' });
      return;
    }
    if (staff.leaderUids.has(uid)) {
      toast.show({ message: '領隊無法退出俱樂部，請先轉移領隊職務', tone: 'warning' });
      return;
    }
    actionLock.current = true;
    setBusy(true);
    try {
      const confirmed = await appConfirm(`確定要退出「${teamName}」俱樂部？退出後如需重新加入，可能需要再次送出申請。`);
      if (!confirmed || !alive.current) return;

      const self: TeamMember = { uid, displayName: viewer.displayName ?? '' };
      await leaveTeam({ team, self });
      clearPendingJoin(teamId, uid);
      requestViewerRefresh();
      if (alive.current) {
        setMemberAttempt((v) => v + 1);
        toast.show({ message: `已退出「${teamName}」`, tone: 'success' });
      }
    } catch (error) {
      if (!alive.current) return;
      toast.show({ message: '退出俱樂部失敗，請重試', tone: 'error' });
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  /** T-090d：自建俱樂部擁有者刪除。確認框與文案沿用管理頁；只走 Callable deleteTeam，成功導回列表並重讀 viewer。 */
  async function handleOwnerDelete(): Promise<void> {
    if (actionLock.current || !team || !canOwnerDeleteUserTeam(viewer, team)) return;
    actionLock.current = true;
    setBusy(true);
    try {
      if (!(await appConfirm(`確定要刪除「${team.name ?? ''}」？此操作無法復原。`))) return;
      if (!alive.current) return;
      setDeleting(true);
      const result = await deleteTeamViaCallable(team);
      if (result.status === 'partial') {
        if (alive.current) toast.show({ message: '部分成員資料尚未清除，請再按一次刪除', tone: 'error' });
        return;
      }
      requestViewerRefresh();
      toast.show({ message: `已刪除「${team.name ?? ''}」` });
      location.route('/teams', true);
    } catch (error) {
      console.error('[TeamDetailPage.ownerDelete]', error);
      if (alive.current) toast.show({ message: '刪除俱樂部失敗，請稍後再試', tone: 'error' });
    } finally {
      actionLock.current = false;
      if (alive.current) {
        setDeleting(false);
        setBusy(false);
      }
    }
  }

  /**
   * T-090h：轉移成功（toast 已由區塊顯示）後關閉設定、重讀俱樂部與 viewer（本人已不是經理）。
   * 成員名單不另外 +1 重讀：重讀後 captainUid 改變會讓 membersKey 變動，名單只讀一次（審查 P3-1）。
   */
  async function handleTransferred(): Promise<void> {
    setTeamOverlay(null);
    requestViewerRefresh();
    await reloadTeamSilently();
  }

  return (
    <div class="legacy-ui">
      <section class="page active td-v2-active" id="page-team-detail">
        <div class="detail-body" id="team-detail-body">
          <div
            class="td-v2-shell"
            ref={shellRef}
            data-team-id={teamId}
            style={themeColor ? { '--td-v2-theme': themeColor } : undefined}
          >
            <TeamDetailV2Header
              team={team}
              viewer={viewer}
              canEdit={canEdit}
              primaryAction={primaryAction}
              busy={busy}
              memberCount={memberCount}
              courseCount={courseCount}
              eventCount={eventCount}
              totalGames={totalGames}
              winRate={winRate}
              tabs={tabs}
              activeTab={activeTab}
              onBack={handleBack}
              onMore={canEdit ? handleMore : undefined}
              onContact={handleContact}
              onInvite={handleInvite}
              onCopyLink={() => {
                void handleCopyLink().catch(() => undefined);
              }}
              onEditAvatar={() => imageUpload.pick('avatar')}
              onEditCover={() => imageUpload.pick('cover')}
              imageBusyKind={imageUpload.busyKind}
              onJoin={() => {
                void handleJoin();
              }}
              joinRing={joinRing}
              onJoined={handleJoined}
              onJoinPending={handleJoinPending}
              onLeave={() => {
                void handleLeave();
              }}
              onSelectTab={selectTab}
            />

            <TeamDetailV2Panels
              team={team}
              courseSlot={COURSES_ENABLED && tabKeys.has('courses') && activeTab === 'courses' ? (
                <LazyCourseTab
                  team={team}
                  viewer={viewer}
                  onLogin={() => {
                    void login();
                  }}
                />
              ) : null}
              activeTab={activeTab}
              tabKeys={tabKeys}
              roster={roster}
              membersStatus={membersStatus}
              events={visibleEvents}
              eventsStatus={eventsState.status}
              totalGames={totalGames}
              winRate={winRate}
              viewer={viewer}
              onTeamChanged={() => reloadTeamSilently()}
              onMemberRemoved={handleMemberRemoved}
              canCreateEvent={canCreateEvent}
              onCreateEvent={handleCreateEvent}
              busy={busy}
              onSelectTab={selectTab}
              onSelectEvent={(eventId) =>
                location.route(`/events/${encodeURIComponent(eventId)}`)
              }
              onOpenProfile={onOpenProfile}
              onRetryMembers={() => setMemberAttempt((v) => v + 1)}
              onRetryEvents={() => setEventAttempt((v) => v + 1)}
              onLogin={() => {
                void login();
              }}
            />

            <div class="td-v2-course-modal" hidden aria-hidden="true">
              <div class="td-v2-modal-backdrop" data-td-v2-action="close-course" />
              <div class="td-v2-modal-card" role="dialog" aria-modal="true">
                <div class="td-v2-modal-handle" />
                <div class="td-v2-course-modal-body" />
              </div>
            </div>
            {createEntry.overlays}
            {EventForm ? (
              <EventForm
                open={createEntry.formOpen}
                mode="create"
                viewer={viewer}
                preset={createEntry.preset}
                onClose={createEntry.closeForm}
                onSaved={onFormSaved}
              />
            ) : null}
            {imageUpload.overlay}
            {inviteOpen && team ? (
              <TeamInviteQrOverlay
                teamId={String(team.id ?? '')}
                teamName={String(team.name ?? '')}
                onClose={() => setInviteOpen(false)}
              />
            ) : null}
            {teamOverlay === 'settings' ? (
              <TeamSettingsModal
                team={team}
                viewer={viewer}
                onClose={() => setTeamOverlay(null)}
                onSaved={() => reloadTeamSilently()}
                onEditBasic={handleEditBasic}
                onDeleteTeam={canOwnerDeleteUserTeam(viewer, team)
                  ? () => { void handleOwnerDelete(); }
                  : undefined}
                deleting={deleting}
                transfer={canOwnerDeleteUserTeam(viewer, team)
                  ? {
                      candidates: transferCandidates,
                      loadFailed: membersState.status === 'error',
                      onTransferred: handleTransferred,
                    }
                  : undefined}
              />
            ) : teamOverlay === 'edit-basic' && TeamForm && team ? (
              <TeamForm
                open
                mode="edit"
                team={team}
                viewer={viewer}
                onClose={() => setTeamOverlay(null)}
                onSaved={handleBasicSaved}
              />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function TeamDetailPage(): JSX.Element {
  const { params } = useRoute();
  const viewer = useViewer();
  const id = String(params.id || '').trim();

  return <TeamDetailContent key={JSON.stringify([id, viewer.uid])} id={id} viewer={viewer} />;
}
