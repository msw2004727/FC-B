import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import { InternalTestBlockedError } from '@/data/internal-test';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { EmptyState } from '@/ui/EmptyState';
import { UserTag, type UserTagProps } from '@/ui/UserTag';
import { useViewer, requestViewerRefresh, type ViewerView } from '@/features/profile/data/viewer';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { loadViewerRegistrations } from '@/features/events/data/viewer-registrations';
import { getVisibleEvents } from '@/features/events/data/visibility';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';
import { SPORTS } from '@/features/events/data/sports';
import { loadTeam, loadTeamMembers } from '../data/teams-repo';
import { leaveTeam, requestTeamJoin } from '../data/membership';
import {
  buildTeamRoster,
  canEditTeamByRoleOrCaptain,
  canManageTeamMembers,
  getTeamDetailVisibility,
  getTeamFutureEvents,
  getTeamPrimaryAction,
  isTeamDetailSectionVisible,
} from '../data/team-detail-model';
import {
  getTeamCategoryMeta,
  getTeamCoverImageUrl,
  getTeamRank,
  getTeamThemeColor,
} from '../data/team-list-model';
import type { TeamDoc, TeamMember, TeamRosterRow } from '../data/types';
import {
  clearPendingJoin,
  getSessionJoinState,
  loginForClubs,
  rememberPendingJoin,
} from './clubs-session';
import '../clubs.css';

type Resource<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: T };

interface EventResource {
  events: EventDoc[];
  registrations: RegistrationDoc[];
}

type Tab = 'overview' | 'events' | 'members';
type Confirmation = 'join' | 'leave' | null;

function rosterRole(row: TeamRosterRow): UserTagProps['role'] {
  // 俱樂部角色 key 與 UserTag 的全站 role 分開處理。
  // 領隊以獨立翻譯標籤呈現，不假設 UserRole 另有 team-leader enum。
  if (row.roles.includes('clubs.role.captain')) return 'captain';
  if (row.roles.includes('clubs.role.coach')) return 'coach';
  return 'user';
}

function safeText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function ResourceError({ onRetry }: { onRetry: () => void }): JSX.Element {
  const t = useT();
  return (
    <div class="clubs-feedback" role="alert">
      <Text>{t('clubs.loadError')}</Text>
      <Button onClick={onRetry}>{t('clubs.retry')}</Button>
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
  const [membersState, setMembersState] = useState<Resource<TeamMember[] | null>>({ status: 'loading' });
  const [eventsState, setEventsState] = useState<Resource<EventResource>>({ status: 'loading' });
  const [teamAttempt, setTeamAttempt] = useState(0);
  const [memberAttempt, setMemberAttempt] = useState(0);
  const [eventAttempt, setEventAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('overview');
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState(false);
  const [, setPendingRevision] = useState(0);
  const alive = useRef(true);
  const actionLock = useRef(false);
  const teamSequence = useRef(0);
  const memberSequence = useRef(0);
  const eventSequence = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const sequence = ++teamSequence.current;
    let cancelled = false;
    setTeamState({ status: 'loading' });
    loadTeam(id).then(
      (team) => {
        if (cancelled || sequence !== teamSequence.current) return;
        // 文件缺少 public id 時才用文件 ID；已有 id 時不可覆寫。
        const normalized = team
          ? { ...team, id: team.id || team._docId || id }
          : null;
        setTeamState({ status: 'ready', value: normalized });
      },
      () => {
        if (!cancelled && sequence === teamSequence.current) {
          setTeamState({ status: 'error' });
        }
      },
    );
    return () => { cancelled = true; };
  }, [id, teamAttempt]);

  const team = teamState.status === 'ready' ? teamState.value : null;
  const showMembers = !!team && isTeamDetailSectionVisible(team, 'members');
  const showEvents = !!team && isTeamDetailSectionVisible(team, 'events');

  useEffect(() => {
    const sequence = ++memberSequence.current;
    let cancelled = false;
    setMembersState({ status: 'loading' });
    if (!team || !showMembers) return;

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
    return () => { cancelled = true; };
  }, [team, showMembers, viewer.uid, memberAttempt]);

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
          // 報名載入失敗也顯示重試，不能將不完整的權限輸入當作成功。
          setEventsState({ status: 'error' });
        }
      },
    );
    return () => { cancelled = true; };
  }, [team, showEvents, viewer.uid, eventAttempt]);

  useEffect(() => {
    if (!team?.id || !viewer.uid || !viewer.teamIds.has(team.id)) return;
    // 成員身分優先；避免核准後殘留本 session 的 pending。
    clearPendingJoin(team.id, viewer.uid);
  }, [team, viewer.uid, viewer.teamIds]);

  async function login(): Promise<void> {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setActionError(false);
    setNotice('');
    try {
      await loginForClubs();
    } catch {
      if (alive.current) setActionError(true);
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  if (teamState.status === 'loading') {
    return (
      <section class="clubs-detail">
        <a class="clubs-back-link" href="/teams"><Text>{t('clubs.back')}</Text></a>
        <div role="status" class="clubs-feedback"><Text>{t('clubs.loading')}</Text></div>
      </section>
    );
  }
  if (teamState.status === 'error') {
    return (
      <section class="clubs-detail">
        <a class="clubs-back-link" href="/teams"><Text>{t('clubs.back')}</Text></a>
        <ResourceError onRetry={() => setTeamAttempt((value) => value + 1)} />
      </section>
    );
  }
  if (!team) {
    return (
      <section class="clubs-detail">
        <EmptyState
          title={t('clubs.notFound')}
          action={<a class="clubs-back-link" href="/teams"><Text>{t('clubs.back')}</Text></a>}
        />
      </section>
    );
  }

  const teamId = team.id || id;
  const name = team.name || t('clubs.unnamed');
  const visibility = getTeamDetailVisibility(team);
  const category = getTeamCategoryMeta(team);
  const rank = getTeamRank(team.teamExp);
  const theme = getTeamThemeColor(team);
  const cover = getTeamCoverImageUrl(team, 'cover');
  const action = getTeamPrimaryAction(team, viewer, getSessionJoinState(teamId, viewer.uid));
  const canManage = canEditTeamByRoleOrCaptain(team, viewer) || canManageTeamMembers(team, viewer);
  const bio = safeText(team.bio);
  const sport = SPORTS.find((item) => item.sportTag === team.sportTag);
  const sportLabel = sport ? t(`events.sport.${sport.key}`) : team.sportTag || '';
  const tabs: Tab[] = [
    'overview',
    ...(showEvents ? ['events' as const] : []),
    ...(showMembers ? ['members' as const] : []),
  ];
  const activeTab = tabs.includes(tab) ? tab : 'overview';
  const visibleEvents = eventsState.status === 'ready'
    ? getTeamFutureEvents(
        teamId,
        getVisibleEvents(eventsState.value.events, viewer, eventsState.value.registrations),
      )
    : [];
  const roster = membersState.status === 'ready' && membersState.value !== null
    ? buildTeamRoster(team, membersState.value)
    : [];

  function primaryClick(): void {
    if (actionLock.current) return;
    setActionError(false);
    setNotice('');
    if (action === 'pending') {
      setNotice(t('clubs.pendingNotice'));
      return;
    }
    if (!viewer.uid) {
      void login();
      return;
    }
    setConfirmation(action);
  }

  async function confirmAction(): Promise<void> {
    if (actionLock.current || !confirmation || !viewer.uid || !team) return;
    actionLock.current = true;
    setBusy(true);
    setActionError(false);
    setNotice('');
    const requestedAction = confirmation;
    const uid = viewer.uid;
    const self: TeamMember = { uid, displayName: viewer.displayName ?? '' };
    try {
      if (requestedAction === 'join') {
        await requestTeamJoin({ team, applicant: self });
        // 即使已離開頁面，成功申請仍保留在同 session 的 teamId + uid 下。
        rememberPendingJoin(teamId, uid);
        requestViewerRefresh();
        if (alive.current) {
          setPendingRevision((value) => value + 1);
          setNotice(t('clubs.joinSuccess'));
        }
      } else {
        const result = await leaveTeam({ team, self });
        clearPendingJoin(teamId, uid);
        requestViewerRefresh();
        if (alive.current) {
          setMemberAttempt((value) => value + 1);
          setNotice(t(result.stillStaff ? 'clubs.stillStaff' : 'clubs.leaveSuccess'));
        }
      }
      if (alive.current) setConfirmation(null);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof InternalTestBlockedError) {
        setConfirmation(null);
        setNotice(t(error.messageKey));
      } else {
        setActionError(true);
      }
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function eventRows(limit?: number): JSX.Element {
    if (eventsState.status === 'loading') {
      return <div role="status"><Text>{t('clubs.loading')}</Text></div>;
    }
    if (eventsState.status === 'error') {
      return <ResourceError onRetry={() => setEventAttempt((value) => value + 1)} />;
    }
    const events = limit ? visibleEvents.slice(0, limit) : visibleEvents;
    if (!events.length) return <EmptyState icon={null} title={t('clubs.noEvents')} />;
    return (
      <div class="clubs-event-list">
        {events.map((event, index) => (
          <a
            key={event.id || event._docId || index}
            href={`/events/${encodeURIComponent(event.id || event._docId || '')}`}
            class="clubs-event"
          >
            <div class="clubs-event__date">
              <Text>{safeText(event.date)}</Text>
            </div>
            <div class="clubs-event__body">
              <Text as="h3">{event.title || t('clubs.unnamedEvent')}</Text>
              <Text>{safeText(event.location)}</Text>
            </div>
            <span aria-hidden="true"><Text>›</Text></span>
          </a>
        ))}
      </div>
    );
  }

  function memberRows(): JSX.Element {
    if (membersState.status === 'loading') {
      return <div role="status"><Text>{t('clubs.loading')}</Text></div>;
    }
    if (membersState.status === 'error') {
      return <ResourceError onRetry={() => setMemberAttempt((value) => value + 1)} />;
    }
    if (!viewer.uid || membersState.value === null) {
      return (
        <EmptyState
          icon={null}
          title={t('clubs.loginMembers')}
          action={<Button disabled={busy} onClick={() => { void login(); }}>{t('clubs.login')}</Button>}
        />
      );
    }
    if (!roster.length) return <EmptyState icon={null} title={t('clubs.noMembers')} />;
    return (
      <ul class="clubs-roster">
        {roster.map((row) => (
          <li key={row.uid} class="clubs-roster__row">
            <span class="clubs-roster__initial" aria-hidden="true">
              <Text>{Array.from(row.name)[0] || '·'}</Text>
            </span>
            <div class="clubs-roster__person">
              <UserTag
                uid={row.uid}
                name={row.name || t('clubs.missingName')}
                role={rosterRole(row)}
                class="clubs-roster__tag"
                onOpenProfile={(uid) => location.route(`/profile/${encodeURIComponent(uid)}`)}
              />
              <Text class="clubs-muted">
                {(row.roles.length ? row.roles : [row.labelKey]).map((key) => t(key)).join(' · ')}
              </Text>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section class="clubs-detail">
      <header class="clubs-detail__topbar">
        <a class="clubs-icon-button" href="/teams" aria-label={t('clubs.back')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </a>
        <div class="clubs-detail__title">
          <Text as="h1">{name}</Text>
          <Text class="clubs-muted">{team.nameEn || sportLabel || team.region || t('clubs.detail')}</Text>
        </div>
        {canManage
          ? <button
              type="button"
              class="clubs-manage"
              disabled
              aria-describedby="clubs-management-note"
            ><Text>{t('clubs.manage')}</Text></button>
          : <span class="clubs-topbar-spacer" aria-hidden="true" />}
      </header>

      <div class="clubs-hero" style={theme ? { background: theme } : undefined}>
        {cover && <img class="clubs-hero__cover" src={cover} alt="" decoding="async" />}
        <div class="clubs-hero__shade" />
        <div class="clubs-hero__inner">
          <div class="clubs-hero__logo" aria-hidden="true">
            <Text>{Array.from(name)[0] || '·'}</Text>
          </div>
          <div class="clubs-hero__chips">
            {category.key !== 'none' && (
              <span class={`clubs-pill clubs-category--${category.key}`}>
                <Text>{t(category.labelKey)}</Text>
              </span>
            )}
            {sportLabel && <span class="clubs-hero__chip"><Text>{sportLabel}</Text></span>}
            {team.region && <span class="clubs-hero__chip"><Text>{team.region}</Text></span>}
          </div>
        </div>
        <div class="clubs-hero__status">
          <Text>{t('clubs.welcome')}</Text>
          <span class="clubs-hero__rank" style={{ color: rank.color }}>
            <Text>{`${(team.teamExp ?? 0).toLocaleString()} ${rank.rank}`}</Text>
          </span>
        </div>
      </div>

      <div class="clubs-actions">
        <button
          type="button"
          class={`clubs-primary clubs-primary--${action}`}
          disabled={busy}
          aria-busy={busy}
          onClick={primaryClick}
        >
          <Text>{t(`clubs.action.${action}`)}</Text>
        </button>
        {/* 保留 A 的分享、聯繫、邀請 QR 順序與欄位。分享功能尚未實作。 */}
        <button type="button" class="clubs-action-slot" hidden disabled>
          <Text>{t('clubs.share')}</Text>
        </button>
        <div class="clubs-contact-slot">
          {team.captainUid
            ? <a
                class="clubs-secondary"
                href={`/profile/${encodeURIComponent(team.captainUid)}`}
              ><Text>{t('clubs.contactCaptain')}</Text></a>
            : <button type="button" class="clubs-secondary" disabled>
                <Text>{t('clubs.contactCaptain')}</Text>
              </button>}
        </div>
        {/* 邀請 QR 待 share 功能；隱藏控制項，不提供無作用互動。 */}
        <button type="button" class="clubs-action-slot" hidden disabled>
          <Text>{t('clubs.inviteQr')}</Text>
        </button>
      </div>

      {canManage && (
        <div id="clubs-management-note" class="clubs-management-note">
          <Text>{t('clubs.managementSoon')}</Text>
        </div>
      )}
      {notice && <div class="clubs-feedback" role="status"><Text>{notice}</Text></div>}
      {actionError && confirmation === null && (
        <div class="clubs-feedback" role="alert">
          <Text>{t('clubs.actionError')}</Text>
          <Button disabled={busy} onClick={primaryClick}>{t('clubs.retry')}</Button>
        </div>
      )}

      <div class="clubs-stats">
        <div><Text class="clubs-stats__value">{team.members ?? 0}</Text><Text>{t('clubs.members')}</Text></div>
        {showEvents && (
          <div>
            <Text class="clubs-stats__value">{eventsState.status === 'ready' ? visibleEvents.length : '—'}</Text>
            <Text>{t('clubs.events')}</Text>
          </div>
        )}
      </div>

      <div class="clubs-detail__tab-rail">
        <div role="tablist" aria-label={t('clubs.detail')} class="clubs-detail__tabs">
          {tabs.map((item) => (
            <button
              key={item}
              id={`clubs-tab-${item}`}
              type="button"
              role="tab"
              aria-selected={activeTab === item}
              aria-controls={`clubs-panel-${item}`}
              tabIndex={activeTab === item ? 0 : -1}
              onClick={() => setTab(item)}
              onKeyDown={(event) => {
                const current = tabs.indexOf(item);
                let next: Tab | undefined;
                if (event.key === 'ArrowRight') next = tabs[(current + 1) % tabs.length];
                if (event.key === 'ArrowLeft') next = tabs[(current - 1 + tabs.length) % tabs.length];
                if (event.key === 'Home') next = tabs[0];
                if (event.key === 'End') next = tabs[tabs.length - 1];
                if (!next) return;
                event.preventDefault();
                setTab(next);
                document.getElementById(`clubs-tab-${next}`)?.focus();
              }}
            >
              <Text>{t(`clubs.${item}`)}</Text>
            </button>
          ))}
        </div>
      </div>

      <div class="clubs-detail__content">
        <section
          role="tabpanel"
          id="clubs-panel-overview"
          aria-labelledby="clubs-tab-overview"
          hidden={activeTab !== 'overview'}
          class="clubs-detail__panel"
        >
          {(showEvents || showMembers) && (
            <div class="clubs-detail-card">
              <Text as="h2">{t('clubs.quickLinks')}</Text>
              <div class="clubs-quick-links">
                {showEvents && <button type="button" onClick={() => setTab('events')}>
                  <strong>{eventsState.status === 'ready' ? visibleEvents.length : '—'}</strong>
                  <Text>{t('clubs.recentEvents')}</Text>
                </button>}
                {showMembers && <button type="button" onClick={() => setTab('members')}>
                  <strong>{team.members ?? 0}</strong>
                  <Text>{t('clubs.members')}</Text>
                </button>}
              </div>
            </div>
          )}
          {visibility.bio && (
            <div class="clubs-detail-card">
              <Text as="h2">{t('clubs.about')}</Text>
              <Text as="p" class="clubs-bio">{bio || t('clubs.noBio')}</Text>
            </div>
          )}
          {visibility.info && (
            <div class="clubs-detail-card">
              <Text as="h2">{t('clubs.info')}</Text>
              <div class="clubs-info-grid">
                <div><Text class="clubs-muted">{t('clubs.region')}</Text><Text>{team.region || t('clubs.notSet')}</Text></div>
                <div><Text class="clubs-muted">{t('clubs.sport')}</Text><Text>{sportLabel || t('clubs.notSet')}</Text></div>
                {safeText(team.founded) && <div><Text class="clubs-muted">{t('clubs.founded')}</Text><Text>{safeText(team.founded)}</Text></div>}
                {safeText(team.nationality) && <div><Text class="clubs-muted">{t('clubs.nationality')}</Text><Text>{safeText(team.nationality)}</Text></div>}
              </div>
            </div>
          )}
          {showEvents && (
            <div class="clubs-detail-card">
              <div class="clubs-section-heading">
                <Text as="h2">{t('clubs.recentEvents')}</Text>
                <button type="button" onClick={() => setTab('events')}><Text>{t('clubs.all')}</Text></button>
              </div>
              {eventRows(2)}
            </div>
          )}
        </section>

        {showEvents && (
          <section
            role="tabpanel"
            id="clubs-panel-events"
            aria-labelledby="clubs-tab-events"
            hidden={activeTab !== 'events'}
            class="clubs-detail__panel"
          >
            <div class="clubs-detail-card">
              <Text as="h2">{t('clubs.recentEvents')}</Text>
              {eventRows()}
            </div>
          </section>
        )}
        {showMembers && (
          <section
            role="tabpanel"
            id="clubs-panel-members"
            aria-labelledby="clubs-tab-members"
            hidden={activeTab !== 'members'}
            class="clubs-detail__panel"
          >
            <div class="clubs-detail-card">
              <Text as="h2">{t('clubs.rosterTitle')}</Text>
              {memberRows()}
            </div>
          </section>
        )}
      </div>

      <Modal
        open={confirmation !== null}
        title={t(confirmation === 'leave' ? 'clubs.action.leave' : 'clubs.action.join')}
        onClose={() => {
          if (actionLock.current) return;
          setConfirmation(null);
          setActionError(false);
        }}
        closeOnOverlay={!busy}
        closeOnEsc={!busy}
        footer={
          <div class="clubs-dialog-actions">
            <Button disabled={busy} onClick={() => {
              setConfirmation(null);
              setActionError(false);
            }}>{t('clubs.cancel')}</Button>
            <Button disabled={busy} loading={busy} onClick={() => { void confirmAction(); }}>
              {t(actionError ? 'clubs.retry' : 'clubs.confirm')}
            </Button>
          </div>
        }
      >
        <Text as="p">
          {t(confirmation === 'leave' ? 'clubs.leaveConfirm' : 'clubs.joinConfirm', { name })}
        </Text>
        {actionError && <div role="alert"><Text>{t('clubs.actionError')}</Text></div>}
      </Modal>
    </section>
  );
}

export default function TeamDetailPage(): JSX.Element {
  const { params } = useRoute();
  const viewer = useViewer();
  const id = params.id || '';

  /**
   * ID／登入帳號改變即建立新的頁面狀態。
   * 舊 component 的 cleanup + request sequence 阻止舊請求提交；
   * 同 UID 的 viewer refresh 保留當前頁籤與操作結果。
   */
  return <TeamDetailContent key={JSON.stringify([id, viewer.uid])} id={id} viewer={viewer} />;
}
