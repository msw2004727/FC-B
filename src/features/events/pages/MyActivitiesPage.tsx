import '../legacy/activity.css';
import '@/styles/legacy/message.css';
import '@/styles/legacy/manage-status.css';
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { drawerOwnActivityManage } from '@/core/drawer-access';
import { InternalTestBlockedError } from '@/data/internal-test';
import { useUserRoles } from '@/data/user-roles';
import { useViewer } from '@/features/profile/data/viewer';
import { lt, useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { EmptyState } from '@/ui/EmptyState';
import { toast } from '@/ui/Toast';
import { EventFormModal } from '../components/EventFormModal';
import {
  MyActivityCard,
  getEventCreatorName,
  getEventCreatorUid,
  type LifecycleKind,
} from '../components/legacy/MyActivityCard';
import {
  MyActivityDetailModal,
  MyActivityStatsModal,
} from '../components/legacy/MyActivityModals';
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
  filterManageableEvents,
  getMyActivityPagingKey,
  getMyActivityVisibleLimit,
  sortMyActivitiesByNearestTime,
  type MyActivityTab,
} from '../data/my-activities-model';
import {
  canCancelOwnActivity,
  canManageAllActivities,
  canReopenOrRelistActivity,
} from '../data/operate-permissions';
import type { EventDoc } from '../data/types';

/** 第一版不做刪除（PM 決策）：刪除按鈕導回舊版。 */
const LEGACY_SITE_URL = 'https://toosterx.com/';
const UNAVAILABLE_MSG = '此功能尚未開放，請先使用舊版';

const TAB_CONFIG: readonly { id: MyActivityTab; text: string }[] = [
  { id: 'all', text: '全部' },
  { id: 'upcoming', text: '即將開放' },
  { id: 'open', text: '報名中' },
  { id: 'full', text: '已額滿' },
  { id: 'ended', text: '已結束' },
  { id: 'cancelled', text: '已取消' },
] as const;

const LIFECYCLE_MESSAGES: Readonly<
  Record<
    LifecycleKind,
    {
      confirm: string;
      done: string;
      fail: string;
      startPassed: string;
    }
  >
> = {
  cancel: {
    confirm: '確定要取消此活動？',
    done: '活動已取消',
    fail: '取消失敗，請重試',
    startPassed: '',
  },
  reopen: {
    confirm: '確定要重新開放此活動？',
    done: '活動已重新開放',
    fail: '重新開放失敗，請重試',
    startPassed: '活動時間已過，請先編輯活動並更新時間後再重新開放。',
  },
  relist: {
    confirm: '確定要重新上架此活動？\n報名名單與候補名單將會保留。',
    done: '活動已重新上架',
    fail: '重新上架失敗，請重試',
    startPassed: '活動時間已過，請先編輯活動並更新時間後再上架。',
  },
};

function eventDocIdOf(e: EventDoc): string {
  return String(e._docId ?? e.docId ?? e.id ?? '');
}

function isHistoryTab(tab: MyActivityTab): boolean {
  return tab === 'all' || tab === 'ended' || tab === 'cancelled';
}

interface CreatorOption {
  uid: string;
  name: string;
  count: number;
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

  const [creatorQuery, setCreatorQuery] = useState('');
  const [selectedCreatorUid, setSelectedCreatorUid] = useState('');
  const [creatorDropdownOpen, setCreatorDropdownOpen] = useState(false);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventDoc | null>(null);
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [detailEvent, setDetailEvent] = useState<EventDoc | null>(null);

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
  const isAdmin = useMemo(
    () => canManageAllActivities(operateCtx) || viewer.hasPermission('event.edit_all'),
    [operateCtx, viewer],
  );
  const isSuperAdmin = viewer.role === 'super_admin' || viewer.roleLevel >= 5;

  // 有效狀態以這次畫面計算時的時間為準（A 每次 renderMyActivities 都重新同步）。
  const nowMs = Date.now();

  // 所有此用戶可管理的活動（不分頁、不套用主辦人篩選，供統計彈窗與主辦人下拉計算）
  const allManageableEvents = useMemo(
    () => filterManageableEvents(events, viewer, 'all'),
    [events, viewer],
  );

  // 主辦人下拉清單：以 creatorUid 分組統計，顯示用名稱（遵守 R-ID-002：身分比對只用 UID）
  const creatorOptions = useMemo<CreatorOption[]>(() => {
    const map = new Map<string, CreatorOption>();
    for (const ev of allManageableEvents) {
      const uid = getEventCreatorUid(ev);
      if (!uid) continue;
      const name = getEventCreatorName(ev) || uid;
      const existing = map.get(uid);
      if (existing) {
        existing.count += 1;
        if (!existing.name && name) existing.name = name;
      } else {
        map.set(uid, { uid, name, count: 1 });
      }
    }
    return Array.from(map.values());
  }, [allManageableEvents]);

  const matchedCreatorOptions = useMemo<CreatorOption[]>(() => {
    const kw = creatorQuery.trim().toLowerCase();
    if (!kw) return [];
    return creatorOptions
      .filter((c) => c.name.toLowerCase().includes(kw))
      .slice(0, 8);
  }, [creatorOptions, creatorQuery]);

  const sortedFiltered = useMemo(() => {
    let filtered = filterManageableEvents(events, viewer, activeTab);
    if (selectedCreatorUid) {
      filtered = filtered.filter((ev) => getEventCreatorUid(ev) === selectedCreatorUid);
    }
    return sortMyActivitiesByNearestTime(filtered);
  }, [events, viewer, activeTab, selectedCreatorUid]);

  const visibleLimit = useMemo(
    () =>
      getMyActivityVisibleLimit(
        activeTab,
        visibleCounts,
        MY_ACTIVITY_DEFAULT_PAGE_SIZE,
        selectedCreatorUid,
      ),
    [activeTab, visibleCounts, selectedCreatorUid],
  );

  const visibleEvents = useMemo(
    () => sortedFiltered.slice(0, visibleLimit),
    [sortedFiltered, visibleLimit],
  );

  // 主辦標籤照 A 顯示角色配色：依 creatorUid 查角色（R-ID-002：不用名字）。
  const roles = useUserRoles(
    canAccessPage ? visibleEvents.map((e) => getEventCreatorUid(e)).filter(Boolean) : [],
  );

  const hiddenLocalCount = Math.max(0, sortedFiltered.length - visibleEvents.length);
  const remoteMoreAvailable = isHistoryTab(activeTab) && hasRemoteMore;
  const showLoadMore = hiddenLocalCount > 0 || (sortedFiltered.length > 0 && remoteMoreAvailable);

  function handleCreatorInput(value: string): void {
    setCreatorQuery(value);
    const kw = value.trim().toLowerCase();
    if (!kw) {
      setCreatorDropdownOpen(false);
      if (selectedCreatorUid) {
        setSelectedCreatorUid('');
      }
      return;
    }
    const hasMatch = creatorOptions.some((c) => c.name.toLowerCase().includes(kw));
    setCreatorDropdownOpen(hasMatch);
  }

  function handleSelectCreator(option: CreatorOption): void {
    setCreatorQuery(option.name);
    setSelectedCreatorUid(option.uid);
    setCreatorDropdownOpen(false);
  }

  function handleClearCreator(): void {
    setCreatorQuery('');
    setSelectedCreatorUid('');
    setCreatorDropdownOpen(false);
  }

  async function handleLoadMore(): Promise<void> {
    if (loadingMore) return;
    const key = getMyActivityPagingKey(activeTab, selectedCreatorUid);
    const nextLimit = visibleLimit + MY_ACTIVITY_DEFAULT_PAGE_SIZE;
    setVisibleCounts((prev) => ({
      ...prev,
      [key]: Math.max(
        nextLimit,
        sortedFiltered.length > visibleLimit ? nextLimit : (prev[key] ?? nextLimit),
      ),
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
        toast.show({ message: '載入失敗，請稍後再試', tone: 'error' });
      } finally {
        setLoadingMore(false);
      }
    }
  }

  /**
   * A `cancelMyActivity`／`reopenMyActivity`／`relistMyActivity` 的畫面流程：
   * 課程連結 → 權限 →（重開／上架）時間已過提示 → 確認框 → 寫入 → 重新整理列表 → 成功提示。
   */
  async function handleLifecycle(kind: LifecycleKind, e: EventDoc): Promise<void> {
    const docId = eventDocIdOf(e);
    if (!docId || lifecycleBusyRef.current.has(docId)) return;
    const msgs = LIFECYCLE_MESSAGES[kind];
    if (isCourseLinkedLifecycleLocked(e)) {
      toast.show({
        message: '課程轉化的活動請回課堂管理，不能在活動端取消、結束、刪除或重新開放',
        tone: 'error',
      });
      return;
    }
    const allowed =
      kind === 'cancel'
        ? canCancelOwnActivity(operateCtx, e)
        : canReopenOrRelistActivity(operateCtx, e);
    if (!allowed) {
      toast.show({ message: '您只能管理自己的活動', tone: 'error' });
      return;
    }
    if (kind !== 'cancel' && isEventStartPassed(e)) {
      await appConfirm(msgs.startPassed);
      return;
    }
    lifecycleBusyRef.current.add(docId);
    try {
      if (!(await appConfirm(msgs.confirm))) return;
      const input = { event: e, eventDocId: docId, viewer };
      if (kind === 'cancel') await cancelEvent(input);
      else if (kind === 'reopen') await reopenEvent(input);
      else await relistEvent(input);
      void loadAll(activeTab, true);
      toast.show({ message: msgs.done, tone: 'success' });
    } catch (err: unknown) {
      if (err instanceof InternalTestBlockedError) {
        toast.show({ message: t(err.messageKey), tone: 'error' });
      } else if (err instanceof EventLifecycleError && err.code === 'COURSE_LINKED') {
        toast.show({
          message: '課程轉化的活動請回課堂管理，不能在活動端取消、結束、刪除或重新開放',
          tone: 'error',
        });
      } else if (err instanceof EventLifecycleError && err.code === 'NOT_ALLOWED') {
        toast.show({ message: '您只能管理自己的活動', tone: 'error' });
      } else if (err instanceof EventLifecycleError && err.code === 'START_PASSED') {
        await appConfirm(msgs.startPassed);
      } else {
        toast.show({ message: msgs.fail, tone: 'error' });
      }
    } finally {
      lifecycleBusyRef.current.delete(docId);
    }
  }

  async function handleDeleteInLegacy(): Promise<void> {
    if (!(await appConfirm(t('events.manage.lifecycle.deleteInLegacy')))) return;
    window.open(LEGACY_SITE_URL, '_blank', 'noopener');
  }

  function handleUnavailable(): void {
    // 下一批補：置頂、外部活動編輯、外部活動分享
    toast.show({ message: UNAVAILABLE_MSG });
  }

  if (!canAccessPage) {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-my-activities">
          <EmptyState
            title={t('events.manage.permissionDenied')}
            body={t('events.manage.permissionDeniedBody')}
          />
        </section>
      </div>
    );
  }

  const displayedCount = Math.min(visibleEvents.length, sortedFiltered.length);
  const totalLabel =
    remoteMoreAvailable && hiddenLocalCount <= 0
      ? `${sortedFiltered.length}+`
      : String(sortedFiltered.length);

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-my-activities">
        <div class="page-header">
          <button
            type="button"
            class="back-btn"
            aria-label={lt('返回', '返回')}
            data-i18n-aria-label="返回"
            onClick={() => {
              // A App.goBack()：有上一頁就回上一頁，直接開這頁時回活動列表。
              if (history.length > 1) history.back();
              else location.route('/activities');
            }}
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
          <h2 data-i18n="活動管理">{lt('活動管理', '活動管理')}</h2>
          <button
            type="button"
            class="page-header-doc-btn"
            title={lt('活動統計', '活動統計')}
            style="margin-left:.35rem;width:28px;height:28px"
            data-i18n-title="活動統計"
            onClick={(ev) => {
              ev.stopPropagation();
              setStatsModalOpen(true);
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              <line x1="8" y1="7" x2="16" y2="7" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <div
            id="my-activity-creator-wrap"
            style={isAdmin ? 'position:relative' : 'display:none;position:relative'}
          >
            <input
              type="text"
              id="my-activity-creator-input"
              value={creatorQuery}
              placeholder={lt('篩選主辦人...', '篩選主辦人...')}
              autocomplete="off"
              style="font-size:.72rem;padding:.25rem 1.4rem .25rem .4rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);width:110px"
              data-i18n-placeholder="篩選主辦人..."
              onInput={(ev) => handleCreatorInput(ev.currentTarget.value)}
            />
            <span
              id="my-activity-creator-clear"
              style={
                selectedCreatorUid || creatorQuery
                  ? 'position:absolute;right:4px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:.7rem;color:var(--text-muted);line-height:1'
                  : 'display:none;position:absolute;right:4px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:.7rem;color:var(--text-muted);line-height:1'
              }
              onClick={handleClearCreator}
            >
              ✕
            </span>
            <div
              id="my-activity-creator-dropdown"
              class={`ce-delegate-dropdown${creatorDropdownOpen && matchedCreatorOptions.length > 0 ? ' open' : ''}`}
              style="min-width:140px"
            >
              {creatorDropdownOpen &&
                matchedCreatorOptions.map((opt) => (
                  <div
                    key={opt.uid}
                    class="ce-delegate-item"
                    onClick={() => handleSelectCreator(opt)}
                  >
                    <span class="ce-delegate-item-name">{opt.name}</span>
                    <span style="color:var(--text-muted);font-size:.68rem">
                      {`${opt.count} 場`}
                    </span>
                  </div>
                ))}
            </div>
          </div>
          <button
            type="button"
            class="primary-btn small"
            id="my-activity-create-btn"
            style={showCreateButton ? undefined : 'display:none'}
            data-i18n="＋ 新增"
            onClick={() => setCreateModalOpen(true)}
          >
            {lt('＋ 新增', '＋ 新增')}
          </button>
        </div>

        {/* stats moved to modal: _showActivityStatsModal */}
        <div class="tab-bar" id="my-activity-tabs">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.id}
              type="button"
              class={`tab${activeTab === tab.id ? ' active' : ''}`}
              data-afilter={tab.id}
              data-i18n={tab.text}
              onClick={() => setActiveTab(tab.id)}
            >
              {lt(tab.text, tab.text)}
            </button>
          ))}
        </div>

        <div class="card-list" id="my-activity-list">
          {loading && events.length === 0 ? null : error && events.length === 0 ? (
            <div
              role="alert"
              style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center"
            >
              <div>{t('events.manage.loadError')}</div>
              <button
                type="button"
                class="outline-btn"
                style="margin-top:.65rem"
                onClick={() => {
                  void loadAll(activeTab, true);
                }}
              >
                {t('events.manage.retry')}
              </button>
            </div>
          ) : sortedFiltered.length === 0 ? (
            <div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">
              此分類沒有活動
            </div>
          ) : (
            <>
              {visibleEvents.map((e, idx) => {
                const cardKey = e.id ?? e._docId ?? e.docId ?? `idx-${idx}`;
                const creatorUid = getEventCreatorUid(e);
                return (
                  <MyActivityCard
                    key={cardKey}
                    event={e}
                    nowMs={nowMs}
                    operateCtx={operateCtx}
                    creatorRole={roles[creatorUid]}
                    onEdit={(evDoc) => setEditingEvent(evDoc)}
                    onLifecycle={(kind, evDoc) => {
                      void handleLifecycle(kind, evDoc);
                    }}
                    onDelete={() => {
                      void handleDeleteInLegacy();
                    }}
                    onPin={handleUnavailable}
                    onUnavailable={handleUnavailable}
                    showFeeSummary={isSuperAdmin}
                    onNavigate={(href) => location.route(href)}
                  />
                );
              })}

              {showLoadMore && (
                <div class="my-activity-load-more">
                  <div class="my-activity-load-more-note">
                    {`已顯示 ${displayedCount} / ${totalLabel}`}
                  </div>
                  <button
                    type="button"
                    class="outline-btn my-activity-load-more-btn"
                    disabled={loadingMore}
                    onClick={() => {
                      void handleLoadMore();
                    }}
                  >
                    {loadingMore ? '讀取中...' : '查看更多'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* 查看名單彈窗 */}
        <MyActivityDetailModal
          event={detailEvent}
          isSuperAdmin={isSuperAdmin}
          nowMs={nowMs}
          onClose={() => setDetailEvent(null)}
        />

        {/* 活動統計彈窗 */}
        <MyActivityStatsModal
          open={statsModalOpen}
          isAdmin={isAdmin}
          events={allManageableEvents}
          nowMs={nowMs}
          onClose={() => setStatsModalOpen(false)}
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
    </div>
  );
}
