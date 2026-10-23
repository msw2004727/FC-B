import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { useGoBack } from '@/core/back-guard';
import { getLastKnownAuthUid } from '@/data/auth';
import { lt, useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';
import { useViewer, requestViewerRefresh, type ViewerView } from '@/features/profile/data/viewer';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { loadViewerRegistrations } from '@/features/events/data/viewer-registrations';
import { getVisibleEvents } from '@/features/events/data/visibility';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';
import { loadTeam, loadTeamMembers } from '../data/teams-repo';
import { leaveTeam, requestTeamJoin } from '../data/membership';
import {
  buildTeamRoster,
  canEditTeamByRoleOrCaptain,
  canManageTeamMembers,
  getTeamFutureEvents,
  getTeamMemberCount,
  getTeamPrimaryAction,
  getTeamStaffIdentity,
  isTeamDetailSectionVisible,
} from '../data/team-detail-model';
import { canShowInviteQr, resolveClubDetailAccess } from '../club-policy';
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
  UNAVAILABLE_MSG,
  type V2TabDef,
  type V2TabKey,
} from '../components/legacy/TeamDetailV2Header';
import { TeamDetailV2Panels } from '../components/legacy/TeamDetailV2Panels';
import { TeamInviteQrOverlay } from '../components/legacy/TeamInviteQrOverlay';
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

function getTabsForTeam(team: TeamDoc, courseCount: number, eventCount: number): V2TabDef[] {
  const tabs: V2TabDef[] = [{ key: 'overview', label: '總覽' }];
  if (isTeamDetailSectionVisible(team, 'courses')) {
    tabs.push({ key: 'courses', label: '課程', badge: courseCount });
  }
  if (isTeamDetailSectionVisible(team, 'events')) {
    tabs.push({ key: 'events', label: '活動', badge: eventCount });
  }
  if (isTeamDetailSectionVisible(team, 'members')) {
    tabs.push({ key: 'members', label: '成員' });
  }
  if (
    isTeamDetailSectionVisible(team, 'record') ||
    isTeamDetailSectionVisible(team, 'matches')
  ) {
    tabs.push({ key: 'record', label: '戰績' });
  }
  tabs.push({ key: 'feed', label: '動態' });
  return tabs;
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
  const [tab, setTab] = useState<V2TabKey>('overview');
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [, setPendingRevision] = useState(0);
  const alive = useRef(true);
  const actionLock = useRef(false);
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
          ? { ...loaded, id: loaded.id || loaded._docId || id }
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
  const showMembers = !!team && isTeamDetailSectionVisible(team, 'members');
  const showEvents = !!team && isTeamDetailSectionVisible(team, 'events');
  const showInfo = !!team && isTeamDetailSectionVisible(team, 'info');

  useEffect(() => {
    const sequence = ++memberSequence.current;
    let cancelled = false;
    setMembersState({ status: 'loading' });
    if (!team || (!showMembers && !showInfo)) return;

    loadTeamMembers(team).then(
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
  }, [team, showMembers, showInfo, viewer.uid, memberAttempt]);

  useEffect(() => {
    const sequence = ++eventSequence.current;
    let cancelled = false;
    setEventsState({ status: 'loading' });
    if (!team || !showEvents) return;

    const repo = getEventsRepo();
    Promise.all([
      repo.loadEventsStatic({ terminalMode: 'none' }).then(() => repo.getSnapshot().active),
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
  }, [team, showEvents, viewer.uid, eventAttempt]);

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

  function handleUnavailable(): void {
    toast.show({ message: UNAVAILABLE_MSG });
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

  const teamId = team.id || id;
  const teamName = team.name || '未命名俱樂部';
  const themeColor = getTeamThemeColor(team);
  const canEdit = canEditTeamByRoleOrCaptain(team, viewer);
  const canManageRoster = canManageTeamMembers(team, viewer);
  const joinState = getSessionJoinState(teamId, viewer.uid);
  const primaryAction = getTeamPrimaryAction(team, viewer, joinState);

  const visibleEvents =
    eventsState.status === 'ready'
      ? getTeamFutureEvents(
          teamId,
          getVisibleEvents(eventsState.value.events, viewer, eventsState.value.registrations),
        )
      : [];

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

  const memberCount = getTeamMemberCount(team);
  const courseCount = 0;
  const eventCount = visibleEvents.length;
  const wins = Number(team['wins'] || 0);
  const draws = Number(team['draws'] || 0);
  const losses = Number(team['losses'] || 0);
  const totalGames = wins + draws + losses;
  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

  const tabs = getTabsForTeam(team, courseCount, eventCount);
  const activeTab = tabs.some((item) => item.key === tab) ? tab : 'overview';

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
      toast.show({ message: `您已是「${teamName}」隊員，無需重複申請` });
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
      await requestTeamJoin({ team, applicant: self });
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
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function handleLeave(): Promise<void> {
    if (actionLock.current || !team || !viewer.uid) return;
    actionLock.current = true;
    setBusy(true);
    try {
      const confirmed = await appConfirm(`確定要退出「${teamName}」俱樂部？退出後如需重新加入，可能需要再次送出申請。`);
      if (!confirmed || !alive.current) return;

      const uid = viewer.uid;
      const staff = getTeamStaffIdentity(team);
      if (staff.captainUids.has(uid)) {
        toast.show({ message: '經理無法退出俱樂部，請先轉移經理職務', tone: 'warning' });
        return;
      }
      if (staff.leaderUids.has(uid)) {
        toast.show({ message: '領隊無法退出俱樂部，請先轉移領隊職務', tone: 'warning' });
        return;
      }

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

  return (
    <div class="legacy-ui">
      <section class="page active td-v2-active" id="page-team-detail">
        <div class="detail-body" id="team-detail-body">
          <div
            class="td-v2-shell"
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
              onContact={handleContact}
              onInvite={handleInvite}
              onUnavailable={handleUnavailable}
              onJoin={() => {
                void handleJoin();
              }}
              onJoined={handleJoined}
              onJoinPending={handleJoinPending}
              onLeave={() => {
                void handleLeave();
              }}
              onSelectTab={(nextTab) => setTab(nextTab)}
            />

            <TeamDetailV2Panels
              team={team}
              activeTab={activeTab}
              roster={roster}
              membersStatus={membersStatus}
              events={visibleEvents}
              eventsStatus={eventsState.status}
              memberCount={memberCount}
              courseCount={courseCount}
              totalGames={totalGames}
              winRate={winRate}
              canManageMembers={canManageRoster}
              busy={busy}
              onSelectTab={(nextTab) => setTab(nextTab)}
              onSelectEvent={(eventId) =>
                location.route(`/events/${encodeURIComponent(eventId)}`)
              }
              onOpenProfile={onOpenProfile}
              onRetryMembers={() => setMemberAttempt((v) => v + 1)}
              onRetryEvents={() => setEventAttempt((v) => v + 1)}
              onLogin={() => {
                void login();
              }}
              onUnavailable={handleUnavailable}
            />

            <div class="td-v2-course-modal" hidden aria-hidden="true">
              <div class="td-v2-modal-backdrop" data-td-v2-action="close-course" />
              <div class="td-v2-modal-card" role="dialog" aria-modal="true">
                <div class="td-v2-modal-handle" />
                <div class="td-v2-course-modal-body" />
              </div>
            </div>
            {inviteOpen && team ? (
              <TeamInviteQrOverlay
                teamId={String(team.id ?? '')}
                teamName={String(team.name ?? '')}
                onClose={() => setInviteOpen(false)}
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
  const id = params.id || '';

  return <TeamDetailContent key={JSON.stringify([id, viewer.uid])} id={id} viewer={viewer} />;
}
