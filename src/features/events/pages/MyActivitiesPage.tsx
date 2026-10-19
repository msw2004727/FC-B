import './my-activities.css';
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { InternalTestBlockedError } from '@/data/internal-test';
import { useUserRoles } from '@/data/user-roles';
import { drawerOwnActivityManage } from '@/core/drawer-access';
import { useViewer } from '@/features/profile/data/viewer';
import { useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Tabs } from '@/ui/Tabs';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';
import { UserTag } from '@/ui/UserTag';
import { EventFormModal } from '../components/EventFormModal';
import { canCreateEvent } from '../data/event-create';
import {
  createEventContextFromViewer,
  operateContextFromViewer,
} from '../data/event-create-context';
import {
  EventLifecycleError,
  cancelEvent,
  isCourseLinkedLifecycleLocked,
  isEventStartPassed,
  relistEvent,
  reopenEvent,
} from '../data/event-lifecycle';
import { getEventsRepo } from '../data/events-repo';
import {
  MY_ACTIVITY_DEFAULT_PAGE_SIZE,
  MY_ACTIVITY_TABS,
  effectiveEventStatus,
  filterManageableEvents,
  getMyActivityPagingKey,
  getMyActivityVisibleLimit,
  progressTone,
  sortMyActivitiesByNearestTime,
  type MyActivityTab,
} from '../data/my-activities-model';
import {
  canCancelOwnActivity,
  canDeleteActivity,
  canEditOwnActivityBasic,
  canReopenOrRelistActivity,
} from '../data/operate-permissions';
import { eventCapacity, publicEventHref } from '../data/presentation';
import { eventSportTag, sportSymbol } from '../data/sports';
import type { EventDoc } from '../data/types';

type StatusCss = 'open' | 'full' | 'ended' | 'upcoming' | 'cancelled';

function getStatusBadgeConfig(status: string | undefined): {
  labelKey: string;
  css: StatusCss;
} {
  switch (status) {
    case 'full':
      return { labelKey: 'events.manage.status.full', css: 'full' };
    case 'ended':
      return { labelKey: 'events.manage.status.ended', css: 'ended' };
    case 'upcoming':
      return { labelKey: 'events.manage.status.upcoming', css: 'upcoming' };
    case 'cancelled':
      return { labelKey: 'events.manage.status.cancelled', css: 'cancelled' };
    case 'open':
    default:
      return { labelKey: 'events.manage.status.open', css: 'open' };
  }
}

/** 第一版不做刪除（PM 決策）：刪除按鈕導回舊版。 */
const LEGACY_SITE_URL = 'https://toosterx.com/';

type LifecycleKind = 'cancel' | 'reopen' | 'relist';

const LIFECYCLE_KEYS: Readonly<Record<LifecycleKind, {
  confirm: string;
  done: string;
  fail: string;
  startPassed: string;
}>> = {
  cancel: {
    confirm: 'events.manage.lifecycle.confirmCancel',
    done: 'events.manage.lifecycle.doneCancel',
    fail: 'events.manage.lifecycle.failCancel',
    startPassed: '',
  },
  reopen: {
    confirm: 'events.manage.lifecycle.confirmReopen',
    done: 'events.manage.lifecycle.doneReopen',
    fail: 'events.manage.lifecycle.failReopen',
    startPassed: 'events.manage.lifecycle.startPassedReopen',
  },
  relist: {
    confirm: 'events.manage.lifecycle.confirmRelist',
    done: 'events.manage.lifecycle.doneRelist',
    fail: 'events.manage.lifecycle.failRelist',
    startPassed: 'events.manage.lifecycle.startPassedRelist',
  },
};

function eventDocIdOf(e: EventDoc): string {
  return String(e._docId ?? e.docId ?? e.id ?? '');
}

function isHistoryTab(tab: MyActivityTab): boolean {
  return tab === 'all' || tab === 'ended' || tab === 'cancelled';
}

export default function MyActivitiesPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const location = useLocation();

  const canAccessPage = drawerOwnActivityManage(viewer);

  const [activeTab, setActiveTab] = useState<MyActivityTab>('all');
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [hasRemoteMore, setHasRemoteMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventDoc | null>(null);

  const loadSeqRef = useRef(0);
  const lifecycleBusyRef = useRef<Set<string>>(new Set());
  const historyLoadedRef = useRef(false);

  const syncFromRepo = useCallback(() => {
    const snap = getEventsRepo().getSnapshot();
    setEvents([...snap.active, ...snap.terminal]);
  }, []);

  const loadAll = useCallback(
    async (tab: MyActivityTab, force = false): Promise<void> => {
      const seq = ++loadSeqRef.current;
      setLoading(true);
      setError(false);
      try {
        const repo = getEventsRepo();
        if (isHistoryTab(tab)) {
          await repo.ensureTerminalEventsLoaded({ mode: 'history', force });
          historyLoadedRef.current = true;
        } else {
          await repo.loadEventsStatic({ terminalMode: 'preview', forceTerminalRefresh: force });
        }
        if (seq !== loadSeqRef.current) return;
        syncFromRepo();
        setLoading(false);
      } catch {
        if (seq !== loadSeqRef.current) return;
        syncFromRepo();
        setError(true);
        setLoading(false);
      }
    },
    [syncFromRepo],
  );

  useEffect(() => {
    if (!canAccessPage) return;
    void loadAll(activeTab, false);
  }, [canAccessPage, loadAll]);

  // 切換到 all / ended / cancelled 時確保 history 模式已載入（對應 A `_ensureManageHistoryEventsLoaded`）
  useEffect(() => {
    if (!canAccessPage) return;
    if (!isHistoryTab(activeTab) || historyLoadedRef.current) return;
    const repo = getEventsRepo();
    repo
      .ensureTerminalEventsLoaded({ mode: 'history' })
      .then(() => {
        historyLoadedRef.current = true;
        syncFromRepo();
      })
      .catch((err: unknown) => {
        console.warn('[MyActivitiesPage] ensureTerminalEventsLoaded failed:', err);
      });
  }, [activeTab, canAccessPage, syncFromRepo]);

  const createCtx = useMemo(() => createEventContextFromViewer(viewer), [viewer]);
  const showCreateButton = useMemo(
    () => (createCtx ? canCreateEvent(createCtx) : false),
    [createCtx],
  );
  const operateCtx = useMemo(() => operateContextFromViewer(viewer), [viewer]);
  // 有效狀態以這次畫面計算時的時間為準（A 每次 renderMyActivities 都重新同步）。
  const nowMs = Date.now();

  const sortedFiltered = useMemo(() => {
    const filtered = filterManageableEvents(events, viewer, activeTab);
    return sortMyActivitiesByNearestTime(filtered);
  }, [events, viewer, activeTab]);

  const visibleLimit = useMemo(
    () => getMyActivityVisibleLimit(activeTab, visibleCounts, MY_ACTIVITY_DEFAULT_PAGE_SIZE),
    [activeTab, visibleCounts],
  );

  const visibleEvents = useMemo(
    () => sortedFiltered.slice(0, visibleLimit),
    [sortedFiltered, visibleLimit],
  );

  // 主辦標籤照 A 顯示角色配色：依 creatorUid 查角色（R-ID-002：不用名字）。
  const roles = useUserRoles(
    canAccessPage ? visibleEvents.map((e) => String(e.creatorUid ?? '')).filter(Boolean) : [],
  );

  const hiddenLocalCount = Math.max(0, sortedFiltered.length - visibleEvents.length);
  const remoteMoreAvailable = isHistoryTab(activeTab) && hasRemoteMore;
  const showLoadMore = hiddenLocalCount > 0 || (sortedFiltered.length > 0 && remoteMoreAvailable);

  async function handleLoadMore(): Promise<void> {
    if (loadingMore) return;
    const key = getMyActivityPagingKey(activeTab, '');
    const nextLimit = visibleLimit + MY_ACTIVITY_DEFAULT_PAGE_SIZE;
    setVisibleCounts((prev) => ({
      ...prev,
      [key]: Math.max(nextLimit, sortedFiltered.length > visibleLimit ? nextLimit : prev[key] ?? nextLimit),
    }));

    if (isHistoryTab(activeTab) && hiddenLocalCount <= 0 && hasRemoteMore) {
      setLoadingMore(true);
      try {
        const added = await getEventsRepo().loadMoreTerminalEvents();
        syncFromRepo();
        if (added === 0) {
          setHasRemoteMore(false);
        }
      } catch (err: unknown) {
        console.warn('[MyActivitiesPage] loadMoreTerminalEvents failed:', err);
      } finally {
        setLoadingMore(false);
      }
    }
  }

  /**
   * A `cancelMyActivity`／`reopenMyActivity`／`relistMyActivity` 的畫面流程：
   * 課程連結 → 權限 →（重開／上架）時間已過提示 → 確認框 → 寫入 → 重新整理列表 → 成功提示。
   * 寫入函式內會再檢查一次，這裡先擋是為了照 A 在確認框之前就提示。
   */
  async function handleLifecycle(kind: LifecycleKind, e: EventDoc): Promise<void> {
    const docId = eventDocIdOf(e);
    if (!docId || lifecycleBusyRef.current.has(docId)) return;
    const keys = LIFECYCLE_KEYS[kind];
    if (isCourseLinkedLifecycleLocked(e)) {
      toast.show({ message: t('events.manage.lifecycle.courseLinked'), tone: 'error' });
      return;
    }
    const allowed = kind === 'cancel'
      ? canCancelOwnActivity(operateCtx, e)
      : canReopenOrRelistActivity(operateCtx, e);
    if (!allowed) {
      toast.show({ message: t('events.manage.lifecycle.notAllowed'), tone: 'error' });
      return;
    }
    if (kind !== 'cancel' && isEventStartPassed(e)) {
      // A 用 appConfirm 顯示這段提示，按哪顆都只是關閉。
      await appConfirm(t(keys.startPassed));
      return;
    }
    lifecycleBusyRef.current.add(docId);
    try {
      if (!await appConfirm(t(keys.confirm))) return;
      const input = { event: e, eventDocId: docId, viewer };
      if (kind === 'cancel') await cancelEvent(input);
      else if (kind === 'reopen') await reopenEvent(input);
      else await relistEvent(input);
      void loadAll(activeTab, true);
      toast.show({ message: t(keys.done), tone: 'success' });
    } catch (err: unknown) {
      if (err instanceof InternalTestBlockedError) {
        toast.show({ message: t(err.messageKey), tone: 'error' });
      } else if (err instanceof EventLifecycleError && err.code === 'COURSE_LINKED') {
        toast.show({ message: t('events.manage.lifecycle.courseLinked'), tone: 'error' });
      } else if (err instanceof EventLifecycleError && err.code === 'NOT_ALLOWED') {
        toast.show({ message: t('events.manage.lifecycle.notAllowed'), tone: 'error' });
      } else if (err instanceof EventLifecycleError && err.code === 'START_PASSED') {
        await appConfirm(t(keys.startPassed));
      } else {
        toast.show({ message: t(keys.fail), tone: 'error' });
      }
    } finally {
      lifecycleBusyRef.current.delete(docId);
    }
  }

  async function handleDeleteInLegacy(): Promise<void> {
    if (!await appConfirm(t('events.manage.lifecycle.deleteInLegacy'))) return;
    window.open(LEGACY_SITE_URL, '_blank', 'noopener');
  }

  function handleCardClick(ev: JSX.TargetedMouseEvent<HTMLDivElement>, item: EventDoc): void {
    const target = ev.target as HTMLElement | null;
    if (target?.closest('button') || target?.closest('.ui-user-tag')) {
      return;
    }
    const href = publicEventHref(item);
    if (href) {
      location.route(href);
    }
  }

  if (!canAccessPage) {
    return (
      <section class="page my-activity-page" id="page-my-activities">
        <EmptyState
          title={t('events.manage.permissionDenied')}
          body={t('events.manage.permissionDeniedBody')}
        />
      </section>
    );
  }

  const panelContent = (
    <div class="card-list my-activity-list" id="my-activity-list">
      {loading && events.length === 0 ? (
        <div class="my-activity-empty" role="status">
          <Text>{t('events.manage.loading')}</Text>
        </div>
      ) : error && events.length === 0 ? (
        <EmptyState
          title={t('events.manage.loadError')}
          body={t('events.manage.emptyCategory')}
          action={
            <Button
              variant="secondary"
              class="outline-btn"
              onClick={() => {
                void loadAll(activeTab, true);
              }}
            >
              {t('events.manage.retry')}
            </Button>
          }
        />
      ) : sortedFiltered.length === 0 ? (
        <div class="my-activity-empty">
          <Text>{t('events.manage.emptyCategory')}</Text>
        </div>
      ) : (
        <>
          {visibleEvents.map((e, idx) => {
            const ext = e as EventDoc & {
              pinned?: unknown;
              waitlist?: unknown;
            };
            const isPinned = Boolean(ext.pinned);
            const isExternal = e.type === 'external';
            // A 先 _autoEndExpiredEvents 同步狀態再畫卡片；這裡用同樣規則算出的有效狀態。
            const effStatus = effectiveEventStatus(e, nowMs);
            const statusConf = getStatusBadgeConfig(effStatus);
            // 按鈕照 A `renderMyActivities` 依狀態分支：編輯、取消／重新開放／上架、刪除（導回舊版）。
            // 尚未補：外部活動的編輯與分享、置頂（A 也標「功能未開放」）。
            const canEdit =
              !isExternal &&
              effStatus !== 'cancelled' &&
              canEditOwnActivityBasic(operateCtx, e);
            const canCancel = canCancelOwnActivity(operateCtx, e);
            const canReopenRelist = canReopenOrRelistActivity(operateCtx, e);
            const canDelete = canDeleteActivity(operateCtx, e);
            const showCancel = isExternal
              ? effStatus !== 'cancelled' && canCancel
              : (effStatus === 'upcoming' || effStatus === 'open' || effStatus === 'full') && canCancel;
            const showReopen = effStatus === 'cancelled' && canReopenRelist;
            const showRelist = !isExternal && effStatus === 'ended' && canReopenRelist;
            const showDelete = canDelete && (isExternal || effStatus === 'ended' || effStatus === 'cancelled');

            const cap = eventCapacity(e);
            const confirmedDisplay = cap.current ?? 0;
            const maxDisplay = cap.max ?? 0;
            const waitlistDisplay =
              typeof ext.waitlist === 'number' && Number.isFinite(ext.waitlist) && ext.waitlist > 0
                ? Math.floor(ext.waitlist)
                : 0;
            const progressPct =
              maxDisplay > 0
                ? Math.min(100, Math.round((confirmedDisplay / maxDisplay) * 100))
                : 0;
            const tone = progressTone(progressPct);

            const sport = eventSportTag(e);
            const symbol = sport ? sportSymbol(sport) : '';
            const cardKey = e.id ?? e._docId ?? e.docId ?? `idx-${idx}`;
            const creatorUid = String(e.creatorUid ?? e.ownerUid ?? e.captainUid ?? '');
            const creatorName = e.creator ?? e.creatorName ?? e.ownerName ?? '';
            const locationAndDate = [e.location ?? '', e.date ?? ''].join(' ・ ');

            return (
              <div
                key={cardKey}
                class={`msg-manage-card my-activity-card${isPinned ? ' my-activity-card--pinned' : ''}`}
                data-event-id={e.id ?? ''}
                onClick={(ev) => handleCardClick(ev, e)}
              >
                <div class="my-activity-card__top">
                  <span class="msg-manage-title my-activity-card__title">
                    <Text>{e.title ?? ''}</Text>
                    {e.teamOnly && (
                      <span class="tl-teamonly-badge my-activity-teamonly-badge">
                        <Text>{t('events.manage.teamOnlyBadge')}</Text>
                      </span>
                    )}
                  </span>
                  {isPinned && (
                    <span class="my-activity-pin-badge">
                      <Text>{t('events.manage.pinnedBadge')}</Text>
                    </span>
                  )}
                  <UserTag
                    uid={creatorUid}
                    name={creatorName}
                    role={roles[creatorUid]}
                    disabled={!creatorUid}
                    onOpenProfile={(uid) => {
                      // A：點使用者膠囊開個人名片（R-UI-023）
                      if (uid) location.route(`/profile/${encodeURIComponent(uid)}`);
                    }}
                  />
                  <span class={`banner-manage-status my-activity-status status-${statusConf.css}`}>
                    <Text>{t(statusConf.labelKey)}</Text>
                  </span>
                </div>

                <div class="my-activity-card__meta">
                  <Text>{locationAndDate}</Text>
                </div>

                {isExternal ? (
                  <div class="my-activity-external-row">
                    <Text>{t('events.manage.externalLinkLabel')}</Text>
                  </div>
                ) : (
                  <div class="my-activity-progress-row">
                    <div class="my-activity-progress-track" aria-hidden="true">
                      <div
                        class={`my-activity-progress-fill my-activity-progress-fill--${tone}`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span class="my-activity-progress-label">
                      <Text>
                        {waitlistDisplay > 0
                          ? t('events.manage.participantsWithWaitlist', {
                              current: confirmedDisplay,
                              max: maxDisplay,
                              waitlist: waitlistDisplay,
                            })
                          : t('events.manage.participants', {
                              current: confirmedDisplay,
                              max: maxDisplay,
                            })}
                      </Text>
                    </span>
                  </div>
                )}

                <div class="my-activity-card__actions">
                  {symbol && (
                    <span class="my-event-sport-icon my-activity-sport-icon" aria-hidden="true">
                      <Text>{symbol}</Text>
                    </span>
                  )}
                  {canEdit && (
                    <Button
                      variant="secondary"
                      size="sm"
                      class="outline-btn my-activity-edit-btn"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setEditingEvent(e);
                      }}
                    >
                      {t('events.manage.editBtn')}
                    </Button>
                  )}
                  {showCancel && (
                    <Button
                      variant="secondary"
                      size="sm"
                      class="outline-btn my-activity-edit-btn my-activity-btn--danger"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void handleLifecycle('cancel', e);
                      }}
                    >
                      {t('events.manage.cancelBtn')}
                    </Button>
                  )}
                  {showRelist && (
                    <Button
                      variant="secondary"
                      size="sm"
                      class="outline-btn my-activity-edit-btn my-activity-btn--success"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void handleLifecycle('relist', e);
                      }}
                    >
                      {t('events.manage.relistBtn')}
                    </Button>
                  )}
                  {showReopen && (
                    <Button
                      variant="secondary"
                      size="sm"
                      class="outline-btn my-activity-edit-btn my-activity-btn--success"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void handleLifecycle('reopen', e);
                      }}
                    >
                      {t('events.manage.reopenBtn')}
                    </Button>
                  )}
                  {showDelete && (
                    <Button
                      variant="secondary"
                      size="sm"
                      class="outline-btn my-activity-edit-btn my-activity-btn--danger"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void handleDeleteInLegacy();
                      }}
                    >
                      {t('events.manage.deleteBtn')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {showLoadMore && (
            <div class="my-activity-load-more">
              <div class="my-activity-load-more-note">
                <Text>
                  {t('events.manage.loadMoreNote', {
                    displayed: Math.min(visibleEvents.length, sortedFiltered.length),
                    total:
                      remoteMoreAvailable && hiddenLocalCount <= 0
                        ? `${sortedFiltered.length}+`
                        : String(sortedFiltered.length),
                  })}
                </Text>
              </div>
              <Button
                variant="secondary"
                class="outline-btn my-activity-load-more-btn"
                loading={loadingMore}
                disabled={loadingMore}
                onClick={() => {
                  void handleLoadMore();
                }}
              >
                {t('events.manage.loadMoreBtn')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );

  const tabItems = MY_ACTIVITY_TABS.map((tabCfg) => ({
    id: tabCfg.id,
    label: t(tabCfg.labelKey),
    panel: tabCfg.id === activeTab ? panelContent : null,
  }));

  return (
    <section class="page my-activity-page" id="page-my-activities">
      <div class="page-header my-activity-header">
        <button
          type="button"
          class="back-btn my-activity-back-btn"
          aria-label={t('events.manage.back')}
          onClick={() => location.route('/activities')}
        >
          <svg
            class="back-btn-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
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
        <Text as="h2" class="my-activity-heading">
          {t('events.manage.title')}
        </Text>
        {showCreateButton && (
          <div class="my-activity-header-actions">
            <Button
              id="my-activity-create-btn"
              variant="primary"
              size="sm"
              class="primary-btn small"
              leading={
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              }
              onClick={() => setCreateModalOpen(true)}
            >
              {t('events.form.openCreateBtn')}
            </Button>
          </div>
        )}
      </div>

      <Tabs
        id="my-activity-tabs"
        label={t('events.manage.tabsLabel')}
        variant="segmented"
        class="tab-bar my-activity-tabs"
        value={activeTab}
        onValueChange={(nextId) => setActiveTab(nextId as MyActivityTab)}
        items={tabItems}
      />

      <EventFormModal
        open={createModalOpen}
        mode="create"
        viewer={viewer}
        onClose={() => setCreateModalOpen(false)}
        onSaved={() => {
          setCreateModalOpen(false);
          void loadAll(activeTab, true);
        }}
      />

      <EventFormModal
        open={editingEvent !== null}
        mode="edit"
        existing={editingEvent ?? undefined}
        viewer={viewer}
        onClose={() => setEditingEvent(null)}
        onSaved={() => {
          setEditingEvent(null);
          void loadAll(activeTab, true);
        }}
      />
    </section>
  );
}
