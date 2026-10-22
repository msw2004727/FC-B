import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLegacyT } from '@/i18n/i18n';
import { useViewer } from '@/features/profile/data/viewer';
import {
  ensureMessageAction,
  type MessageActionEntry,
  type MessageActionHandler,
} from '@/core/action-registry';
import {
  applyInboxView,
  clearAll,
  deleteMessage,
  isPendingActionMessage,
  isUnread,
  markAllRead,
  markRead,
  subscribeInbox,
  type InboxMessage,
} from '../data/inbox-repo';
import { subscribeThreads, type PmThread } from '../data/pm-repo';
import { openPmDialog } from '../components/pm-dialog-store';
import { formatPmTime } from '../components/pm-message-format';
import { appConfirm } from '@/ui/AppConfirm';
import { pushOverlay } from '@/core/overlay-back';
import { toast } from '@/ui/Toast';

const STORAGE_TOTAL = 50;
const SEARCH_DEBOUNCE_MS = 180;

/** 照 A `message-actions-team.js` 審核成功提示文字；其餘 key 不顯示（本單項目 2）。 */
const ACTION_SUCCESS_MESSAGE: Record<string, string> = {
  approve: '已同意加入申請',
  reject: '已拒絕加入申請',
  ignore: '已忽略此申請',
};

type InboxTabKey = 'all' | 'system' | 'activity' | 'tournament' | 'pm-conversation';

interface ActionUiState {
  status: 'idle' | 'checking' | 'ready';
  canAct: boolean;
  actions: MessageActionEntry[];
  runningKey: string | null;
}

// 照 A `message-render.js#133-273` team_join_request 分支的狀態樣式與標籤
const TEAM_JOIN_STATUS: Record<string, { style: string; label: string }> = {
  approved: { style: 'background:var(--success);color:#fff', label: '已同意' },
  rejected: { style: 'background:var(--danger);color:#fff', label: '已拒絕' },
  ignored: { style: 'background:var(--border);color:var(--text-secondary)', label: '已忽略' },
};

/** 照 A `_pmTimeMs`：取時間毫秒，用於私訊對話卡排序。 */
function pmTimeMs(value: unknown): number {
  if (value && typeof value === 'object') {
    const maybeToDate = (value as { toDate?: () => Date }).toDate;
    if (typeof maybeToDate === 'function') {
      try {
        return maybeToDate().getTime();
      } catch {
        return 0;
      }
    }
    const seconds = (value as { seconds?: number }).seconds;
    if (typeof seconds === 'number') return seconds * 1000;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === 'number') return value;
  return 0;
}

export default function InboxPage(): JSX.Element {
  const lt = useLegacyT();
  const viewer = useViewer();
  const uid = viewer.uid;

  // 收件匣狀態
  const [inboxStatus, setInboxStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [inboxAttempt, setInboxAttempt] = useState(0);
  const [messages, setMessages] = useState<InboxMessage[]>([]);

  // 篩選與頁籤
  const [activeTab, setActiveTab] = useState<InboxTabKey>('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [debouncedSearchKeyword, setDebouncedSearchKeyword] = useState('');
  const [filterDate, setFilterDate] = useState('');

  // 詳情彈窗
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);

  // 目前詳情訊息的可執行審核動作
  const [actionUi, setActionUi] = useState<ActionUiState>({
    status: 'idle',
    canAct: false,
    actions: [],
    runningKey: null,
  });

  // 私訊對話列表
  const [threadsStatus, setThreadsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [threadsAttempt, setThreadsAttempt] = useState(0);
  const [threads, setThreads] = useState<PmThread[]>([]);

  const mountedRef = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 訂閱收件匣
  useEffect(() => {
    if (!uid) {
      setMessages([]);
      setInboxStatus('loading');
      return;
    }
    setInboxStatus('loading');
    const unsub = subscribeInbox(
      uid,
      (next) => {
        if (!mountedRef.current) return;
        setMessages(next);
        setInboxStatus('ready');
      },
      () => {
        if (!mountedRef.current) return;
        setInboxStatus('error');
      },
    );
    return () => {
      unsub();
    };
  }, [uid, inboxAttempt]);

  // 訂閱私訊對話列表（A `startPmThreadListener` 也是進站即啟動）
  useEffect(() => {
    if (!uid) {
      setThreads([]);
      setThreadsStatus('loading');
      return;
    }
    setThreadsStatus('loading');
    const unsub = subscribeThreads(
      uid,
      (next) => {
        if (!mountedRef.current) return;
        setThreads(next);
        setThreadsStatus('ready');
      },
      () => {
        if (!mountedRef.current) return;
        setThreadsStatus('error');
      },
    );
    return () => {
      unsub();
    };
  }, [uid, threadsAttempt]);

  // U-043：搜尋 180ms 去抖；計時器卸載清掉
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchKeyword(searchKeyword);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [searchKeyword]);

  // 篩選後的收件匣列表（照 A renderMessageList 的篩選、排序）
  const visibleMessages = useMemo(() => {
    if (activeTab === 'pm-conversation') return [];
    let list = applyInboxView(messages, activeTab);
    const kw = debouncedSearchKeyword.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (m) =>
          String(m.title ?? '').toLowerCase().includes(kw) ||
          String(m.preview ?? '').toLowerCase().includes(kw) ||
          String(m.body ?? '').toLowerCase().includes(kw) ||
          String(m.senderName ?? '').toLowerCase().includes(kw),
      );
    }
    const df = filterDate.trim();
    if (df) {
      const parts = df.split('-');
      if (parts.length === 3) {
        const filterStr = `${parts[0]}/${parts[1]}/${parts[2]}`;
        list = list.filter((m) => String(m.time ?? '').startsWith(filterStr));
      }
    }
    return list;
  }, [messages, activeTab, debouncedSearchKeyword, filterDate]);

  // 私訊對話依 lastMessageAt 降冪（照 A renderPmThreadList）
  const sortedThreads = useMemo(() => {
    return [...threads].sort((a, b) => pmTimeMs(b.lastMessageAt) - pmTimeMs(a.lastMessageAt));
  }, [threads]);

  const pmUnreadTotal = useMemo(
    () =>
      threads.reduce((acc, item) => {
        const c = Number(item.unreadCount ?? 0);
        return acc + (Number.isFinite(c) && c > 0 ? c : 0);
      }, 0),
    [threads],
  );

  const selectedMessage = useMemo(
    () => messages.find((m) => m.id === selectedMsgId) ?? null,
    [messages, selectedMsgId],
  );

  // 檢查目前選取訊息的可執行動作（沿用既有 ensureMessageAction 呼叫與錯誤處理）
  const actionCheckSeq = useRef(0);
  useEffect(() => {
    const seq = ++actionCheckSeq.current;
    if (!selectedMessage || !selectedMessage.actionType || !uid) {
      setActionUi({ status: 'idle', canAct: false, actions: [], runningKey: null });
      return;
    }
    const status = String(selectedMessage.actionStatus ?? '').trim().toLowerCase();
    if (status && status !== 'pending') {
      setActionUi({ status: 'ready', canAct: false, actions: [], runningKey: null });
      return;
    }

    let cancelled = false;
    setActionUi({ status: 'checking', canAct: false, actions: [], runningKey: null });

    ensureMessageAction(selectedMessage.actionType)
      .then(async (handler: MessageActionHandler | null) => {
        if (cancelled || actionCheckSeq.current !== seq) return;
        if (!handler) {
          setActionUi({ status: 'ready', canAct: false, actions: [], runningKey: null });
          return;
        }
        const allowed = await handler.canAct(
          {
            uid,
            role: viewer.role,
            displayName: viewer.displayName ?? undefined,
            hasPermission: viewer.hasPermission,
          },
          selectedMessage,
        );
        if (cancelled || actionCheckSeq.current !== seq) return;
        setActionUi({
          status: 'ready',
          canAct: !!allowed,
          actions: allowed ? handler.actions : [],
          runningKey: null,
        });
      })
      .catch(() => {
        if (cancelled || actionCheckSeq.current !== seq) return;
        setActionUi({ status: 'ready', canAct: false, actions: [], runningKey: null });
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedMessage?.id,
    selectedMessage?.actionType,
    selectedMessage?.actionStatus,
    uid,
    viewer.role,
    viewer.displayName,
    viewer.hasPermission,
  ]);

  // U-045：詳情彈窗 Esc / Tab 循環 / 焦點返回 / pushOverlay 返回鍵
  useEffect(() => {
    if (!selectedMsgId) return;
    const previousActive = (typeof document !== 'undefined'
      ? document.activeElement
      : null) as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSelectedMsgId(null);
        return;
      }
      if (e.key === 'Tab') {
        const modal = document.getElementById('msg-inbox-detail-modal');
        if (!modal) return;
        const focusables = Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const releaseOverlay = pushOverlay(() => {
      setSelectedMsgId(null);
      return true;
    });
    document.addEventListener('keydown', onKeyDown);

    // 彈窗剛 render 完成，把焦點移到第一個可聚焦元素
    const modal = document.getElementById('msg-inbox-detail-modal');
    const firstFocusable = modal?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea',
    );
    firstFocusable?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      releaseOverlay();
      previousActive?.focus?.();
    };
  }, [selectedMsgId]);

  const handleOpenMessage = (msg: InboxMessage): void => {
    if (isUnread(msg, uid ?? undefined)) {
      if (msg._docId && uid) {
        markRead(uid, msg).catch(() => {
          // 照 A readMessage：單次標記已讀失敗不還原、不干擾閱讀
        });
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, read: true, unread: false } : m)),
      );
    }
    // 照 A readMessage：無 body 不開詳情彈窗
    if (msg.body) {
      setSelectedMsgId(msg.id);
    }
  };

  // M-138 + U-044：一鍵全讀，等 markAllRead 完成才 toast；失敗還原
  const handleMarkAllRead = async (): Promise<void> => {
    if (busyRef.current) return;
    if (!uid) {
      toast.show({ message: lt('Please login first', 'Please login first') });
      return;
    }
    const unreadMsgs = messages.filter((m) => isUnread(m, uid));
    if (unreadMsgs.length === 0) {
      toast.show({ message: lt('沒有未讀訊息', '沒有未讀訊息') });
      return;
    }

    busyRef.current = true;
    const snapshot = messages;
    setMessages((prev) =>
      prev.map((m) => (isUnread(m, uid) ? { ...m, read: true, unread: false } : m)),
    );
    try {
      await markAllRead(uid, unreadMsgs);
      if (!mountedRef.current) return;
      // 照 A `markAllRead`：已將 N 則訊息標為已讀。
      toast.show({
        message: lt('已將 {count} 則訊息標為已讀', '已將 {count} 則訊息標為已讀', {
          count: unreadMsgs.length,
        }),
      });
    } catch {
      if (!mountedRef.current) return;
      const snapshotMap = new Map(snapshot.map((m) => [m.id, m]));
      setMessages((prev) => prev.map((m) => snapshotMap.get(m.id) ?? m));
      // ASSUMPTION: A markAllRead 失敗僅 console.error 仍顯示成功；本單改良為 toast 失敗文字，
      // 用 A clearAllMessages「清空失敗，請重試」的失敗句型類推為「標記失敗，請重試」。
      toast.show({ message: lt('標記失敗，請重試', '標記失敗，請重試') });
    } finally {
      busyRef.current = false;
    }
  };

  // M-138：清空訊息照 A `clearAllMessages`（message-actions.js#1-90）
  const handleClearAll = async (): Promise<void> => {
    if (busyRef.current) return;
    if (!uid) {
      toast.show({ message: lt('Please login first', 'Please login first') });
      return;
    }
    if (messages.length === 0) {
      toast.show({ message: lt('沒有訊息可清空', '沒有訊息可清空') });
      return;
    }
    // deletable 條件逐字照 A `_isPendingActionMessage`（即 !isPendingActionMessage）。
    const deletable = messages.filter((m) => !isPendingActionMessage(m));
    if (deletable.length === 0) {
      toast.show({
        message: lt(
          '沒有可清空的訊息；待審核通知請開啟內容後單封移除。',
          '沒有可清空的訊息；待審核通知請開啟內容後單封移除。',
        ),
      });
      return;
    }
    let confirmed = false;
    try {
      confirmed = await appConfirm(
        lt('確定要清空 {count} 則訊息？此操作無法恢復。', '確定要清空 {count} 則訊息？此操作無法恢復。', {
          count: deletable.length,
        }),
      );
    } catch {
      return;
    }
    if (!confirmed) return;

    busyRef.current = true;
    try {
      // 照 A：只刪 deletable（clearAll 內部亦過濾；此處顯式傳遞以維持 A 語意）。
      await clearAll(uid, deletable);
      if (!mountedRef.current) return;
      setSelectedMsgId(null);
      toast.show({ message: lt('已清空所有訊息', '已清空所有訊息') });
    } catch {
      if (!mountedRef.current) return;
      toast.show({ message: lt('清空失敗，請重試', '清空失敗，請重試') });
    } finally {
      busyRef.current = false;
    }
  };

  // 從我的收件匣移除（單封，照 A message-actions.js 移除流程）
  const handleRemoveMessage = async (msg: InboxMessage): Promise<void> => {
    if (busyRef.current || !uid) return;
    const confirmText = isPendingActionMessage(msg)
      ? lt(
          '這只會將這封通知從你的收件匣移除，不會取消報名、不會通過或拒絕審核，也不會刪除賽事或俱樂部申請。確定要移除嗎？',
          '這只會將這封通知從你的收件匣移除，不會取消報名、不會通過或拒絕審核，也不會刪除賽事或俱樂部申請。確定要移除嗎？',
        )
      : lt('確定要將這封訊息從你的收件匣移除嗎？', '確定要將這封訊息從你的收件匣移除嗎？');
    let confirmed = false;
    try {
      confirmed = await appConfirm(confirmText);
    } catch {
      return;
    }
    if (!confirmed) return;

    busyRef.current = true;
    try {
      await deleteMessage(uid, msg);
      if (!mountedRef.current) return;
      if (selectedMsgId === msg.id) setSelectedMsgId(null);
    } catch {
      if (!mountedRef.current) return;
      // ASSUMPTION: A 段未附 removeInboxMessage 失敗 toast，沿用 A clearAll 失敗句型。
      toast.show({ message: lt('移除失敗，請重試', '移除失敗，請重試') });
    } finally {
      busyRef.current = false;
    }
  };

  const handleRunAction = async (entry: MessageActionEntry): Promise<void> => {
    if (!selectedMessage || !uid || actionUi.runningKey) return;
    setActionUi((prev) => ({ ...prev, runningKey: entry.key }));
    try {
      await entry.run(selectedMessage, {
        uid,
        role: viewer.role,
        displayName: viewer.displayName ?? undefined,
        hasPermission: viewer.hasPermission,
      });
      if (!mountedRef.current) return;
      // 照 A `message-actions-team.js`：成功後依動作 key 顯示對應文字；
      // 無對照的動作（其他 actionType/未知 key）不顯示。
      const successKey = ACTION_SUCCESS_MESSAGE[entry.key];
      if (successKey) {
        toast.show({ message: lt(successKey, successKey) });
      }
    } catch {
      // ASSUMPTION: A message-actions-*.js 未附至此，暫用 B/A 通用失敗文字
      toast.show({ message: lt('操作失敗，請重試。', '操作失敗，請重試。') });
    } finally {
      if (mountedRef.current) {
        setActionUi((prev) => ({ ...prev, runningKey: null }));
      }
    }
  };

  const resolveTypeLabel = (msg: InboxMessage): string => {
    if (msg.typeName) return String(msg.typeName);
    const rawType = String(msg.type ?? 'system').trim();
    const map: Record<string, string> = {
      system: lt('系統', '系統'),
      activity: lt('活動', '活動'),
      tournament: lt('賽事', '賽事'),
      trade: lt('交易', '交易'),
      private: lt('私訊', '私訊'),
    };
    return map[rawType] ?? rawType;
  };

  const renderActionSection = (msg: InboxMessage): JSX.Element | null => {
    const actionType = String(msg.actionType ?? '').trim();
    if (!actionType) return null;
    const status = String(msg.actionStatus ?? '').trim().toLowerCase();

    // 非 pending：顯示狀態標籤（照 A message-render.js#133-273 team_join 分支）
    if (status && status !== 'pending') {
      const entry = TEAM_JOIN_STATUS[status];
      if (!entry) return null;
      const reviewer = String((msg as { reviewerName?: unknown }).reviewerName ?? '').trim();
      return (
        <div class="msg-action-status" style={entry.style} data-no-translate>
          {lt(entry.label, entry.label)}
          {reviewer ? `（${reviewer}）` : ''}
        </div>
      );
    }

    // pending：只在有註冊 handler 且 canAct 時顯示按鈕
    if (actionUi.canAct && actionUi.actions.length > 0) {
      return (
        <div class="msg-action-btns">
          {actionUi.actions.map((act) => {
            const btnClass =
              act.key === 'approve'
                ? 'msg-action-approve'
                : act.key === 'reject'
                ? 'msg-action-reject'
                : 'msg-action-ignore';
            const label =
              act.key === 'approve'
                ? lt('同意', '同意')
                : act.key === 'reject'
                ? lt('拒絕', '拒絕')
                : act.key === 'ignore'
                ? lt('忽略', '忽略')
                : act.key;
            const running = actionUi.runningKey === act.key;
            return (
              <button
                key={act.key}
                type="button"
                class={btnClass}
                disabled={!!actionUi.runningKey}
                onClick={() => {
                  handleRunAction(act).catch(() => {
                    // 已於 handleRunAction 內 toast
                  });
                }}
              >
                {running ? lt('處理中...', '處理中...') : label}
              </button>
            );
          })}
        </div>
      );
    }

    return null;
  };

  const isPmTab = activeTab === 'pm-conversation';
  const remainingCapacity = Math.max(0, STORAGE_TOTAL - messages.length);

  const backButton = (
    <button
      class="back-btn"
      type="button"
      onClick={() => {
        if (typeof history !== 'undefined') history.back();
      }}
      aria-label={lt('返回', '返回')}
    >
      <svg
        class="back-btn-icon"
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
  );

  if (!uid) {
    return (
      <div class="legacy-ui">
        <section class="page" id="page-messages">
          <div class="page-header">
            {backButton}
            <h2 class="page-header-title">{lt('訊息', '訊息')}</h2>
          </div>
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {lt('請先登入以查看訊息', '請先登入以查看訊息')}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div class="legacy-ui">
      <section class="page" id="page-messages">
        <div class="page-header">
          {backButton}
          <h2 class="page-header-title">{lt('訊息', '訊息')}</h2>
        </div>

        {/* 工具列（私訊頁籤隱藏，照 A _togglePmConversationUI） */}
        <div
          id="msg-toolbar-row"
          style={{
            display: isPmTab ? 'none' : 'flex',
            alignItems: 'center',
            gap: '.4rem',
            padding: '0 .5rem .4rem',
            flexWrap: 'wrap',
          }}
        >
          <button
            class="primary-btn small"
            type="button"
            style={{ fontSize: '.75rem', padding: '.28rem .6rem' }}
            onClick={() => {
              handleMarkAllRead().catch(() => {
                // 已於 handleMarkAllRead 內處理
              });
            }}
          >
            {lt('一鍵全讀', '一鍵全讀')}
          </button>
          <button
            type="button"
            style={{
              fontSize: '.75rem',
              padding: '.28rem .6rem',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: '#ef4444',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={() => {
              handleClearAll().catch(() => {
                // 已於 handleClearAll 內處理
              });
            }}
          >
            {lt('清空訊息', '清空訊息')}
          </button>
          <span
            id="storage-bar"
            style={{
              fontSize: '.75rem',
              padding: '.28rem .6rem',
              borderRadius: 'var(--radius-sm)',
              background: '#fff',
              border: '1px solid var(--border)',
              color: '#3b82f6',
              fontWeight: 600,
            }}
          >
            {lt('剩餘容量：', '剩餘容量：')}
            <strong style={{ color: '#111' }}>{remainingCapacity}</strong>
            {`/${STORAGE_TOTAL}`}
          </span>
        </div>

        {/* 分類頁籤 */}
        <div class="tab-bar" id="msg-inbox-tabs">
          {(
            [
              { key: 'all', label: '全部' },
              { key: 'system', label: '系統' },
              { key: 'activity', label: '活動' },
              { key: 'tournament', label: '賽事' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              class={`tab${activeTab === tab.key ? ' active' : ''}`}
              data-msgtype={tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              {lt(tab.label, tab.label)}
            </button>
          ))}
          <button
            type="button"
            class={`tab${activeTab === 'pm-conversation' ? ' active' : ''}${
              pmUnreadTotal > 0 ? ' has-pm-unread' : ''
            }`}
            data-msgtype="pm-conversation"
            data-pm-unread={
              pmUnreadTotal > 0 ? (pmUnreadTotal > 99 ? '99+' : String(pmUnreadTotal)) : undefined
            }
            aria-label={
              pmUnreadTotal > 0
                ? lt('私訊對話，有 {count} 則未讀', '私訊對話，有 {count} 則未讀', {
                    count: pmUnreadTotal,
                  })
                : lt('私訊對話', '私訊對話')
            }
            onClick={() => setActiveTab('pm-conversation')}
          >
            {lt('私訊', '私訊')}
          </button>
        </div>

        {/* 搜尋 / 日期篩選列（私訊頁籤隱藏） */}
        <div
          id="msg-filter-row"
          style={{
            display: isPmTab ? 'none' : 'flex',
            gap: '.3rem',
            padding: '.3rem .5rem',
            flexWrap: 'nowrap',
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            id="msg-search-keyword"
            placeholder={lt('搜尋...', '搜尋...')}
            value={searchKeyword}
            onInput={(e) => setSearchKeyword(e.currentTarget.value)}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: '.78rem',
              padding: '.3rem .5rem',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
            }}
          />
          <input
            type="date"
            id="msg-filter-date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.currentTarget.value)}
            style={{
              maxWidth: '130px',
              fontSize: '.78rem',
              padding: '.3rem .4rem',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            class="outline-btn"
            type="button"
            style={{ fontSize: '.72rem', padding: '.28rem .5rem', flexShrink: 0 }}
            onClick={() => {
              setSearchKeyword('');
              setFilterDate('');
              setDebouncedSearchKeyword('');
            }}
          >
            {lt('清除', '清除')}
          </button>
        </div>

        {/* 訊息列表（照 A #message-list） */}
        <div
          class={`card-list${isPmTab ? ' pm-thread-list' : ''}`}
          id="message-list"
          role={isPmTab ? 'list' : undefined}
        >
          {isPmTab
            ? sortedThreads.map((thread) => {
                const conversationId = String(
                  thread.conversationId ?? thread.id ?? thread._docId ?? '',
                );
                const peerUid = String(thread.peerUid ?? '');
                const unreadCount = Math.max(0, Number(thread.unreadCount ?? 0));
                const peerName = String(thread.peerName || thread.peerUid || '');
                const statusText =
                  thread.lastMessageStatus === 'recalled'
                    ? lt('訊息已撤回', '訊息已撤回')
                    : String(thread.lastMessageBody ?? '');
                return (
                  <button
                    key={thread.id}
                    type="button"
                    role="listitem"
                    class={`pm-thread-card${unreadCount > 0 ? ' is-unread' : ''}`}
                    data-user-card="pm-thread"
                    data-peer-uid={peerUid}
                    data-conversation-id={conversationId}
                    aria-label={lt('開啟私訊對話', '開啟私訊對話')}
                    onClick={() => {
                      if (!peerUid) return;
                      openPmDialog({
                        uid: peerUid,
                        ...(peerName ? { name: peerName } : {}),
                        ...(thread.peerAvatar
                          ? { pictureUrl: String(thread.peerAvatar) }
                          : {}),
                      });
                    }}
                  >
                    <span class="pm-thread-avatar">
                      {thread.peerAvatar ? (
                        <img
                          src={String(thread.peerAvatar)}
                          alt=""
                          class="pm-thread-avatar-img"
                        />
                      ) : (
                        <span>{peerName.slice(0, 1)}</span>
                      )}
                    </span>
                    <span class="pm-thread-main">
                      <span class="pm-thread-top">
                        <span class="pm-thread-name" data-no-translate>
                          {peerName || lt('未知用戶', '未知用戶')}
                        </span>
                        <span class="pm-thread-time">
                          {formatPmTime(thread.lastMessageAt)}
                        </span>
                      </span>
                      <span class="pm-thread-preview">{statusText}</span>
                    </span>
                    {unreadCount > 0 && (
                      <span class="pm-thread-badge">
                        {unreadCount > 99 ? '99+' : String(unreadCount)}
                      </span>
                    )}
                  </button>
                );
              })
            : null}
          {isPmTab && threadsStatus === 'ready' && sortedThreads.length === 0 && (
            <div class="pm-empty">{lt('目前沒有私訊對話', '目前沒有私訊對話')}</div>
          )}

          {!isPmTab &&
            visibleMessages.map((msg) => {
              const unread = isUnread(msg, uid);
              const isPending =
                !!msg.actionType &&
                String(msg.actionStatus ?? '').trim().toLowerCase() === 'pending';
              return (
                <div
                  key={msg.id}
                  class={`msg-card${unread ? ' msg-unread' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpenMessage(msg)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenMessage(msg);
                    }
                  }}
                >
                  {msg.actionType && (
                    <div
                      class={`msg-ribbon ${
                        isPending ? 'msg-ribbon-pending' : 'msg-ribbon-reviewed'
                      }`}
                    >
                      {isPending ? lt('待審核', '待審核') : lt('已審核', '已審核')}
                    </div>
                  )}
                  <div class="msg-card-header">
                    <span class={`msg-dot ${unread ? 'unread' : 'read'}`} />
                    <span class={`msg-type msg-type-${String(msg.type ?? 'system')}`}>
                      {resolveTypeLabel(msg)}
                    </span>
                    <span class="msg-title">{String(msg.title ?? '')}</span>
                  </div>
                  <div class="msg-preview">{String(msg.preview ?? '')}</div>
                  <div class="msg-time">{String(msg.time ?? '')}</div>
                </div>
              );
            })}
          {!isPmTab && inboxStatus === 'ready' && visibleMessages.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '1.5rem',
                color: 'var(--text-muted)',
                fontSize: '.82rem',
              }}
            >
              {lt('此分類沒有訊息', '此分類沒有訊息')}
            </div>
          )}
          {!isPmTab && inboxStatus === 'error' && (
            <div
              style={{
                textAlign: 'center',
                padding: '1.5rem',
                color: 'var(--danger)',
                fontSize: '.82rem',
              }}
            >
              <div>{lt('載入訊息失敗，請重試。', '載入訊息失敗，請重試。')}</div>
              <button
                type="button"
                class="outline-btn"
                style={{ fontSize: '.72rem', padding: '.28rem .5rem', marginTop: '.4rem' }}
                onClick={() => setInboxAttempt((v) => v + 1)}
              >
                {lt('重試', '重試')}
              </button>
            </div>
          )}
          {isPmTab && threadsStatus === 'error' && (
            <div
              style={{
                textAlign: 'center',
                padding: '1.5rem',
                color: 'var(--danger)',
                fontSize: '.82rem',
              }}
            >
              <div>{lt('載入私訊列表失敗，請重試。', '載入私訊列表失敗，請重試。')}</div>
              <button
                type="button"
                class="outline-btn"
                style={{ fontSize: '.72rem', padding: '.28rem .5rem', marginTop: '.4rem' }}
                onClick={() => setThreadsAttempt((v) => v + 1)}
              >
                {lt('重試', '重試')}
              </button>
            </div>
          )}
        </div>

        {/* 詳情彈窗（照 A #msg-inbox-detail-modal） */}
        {selectedMessage && (
          <div
            id="msg-inbox-detail-modal"
            style={{
              display: 'flex',
              position: 'fixed',
              inset: 0,
              zIndex: 1200,
              background: 'rgba(0,0,0,.35)',
              WebkitBackdropFilter: 'blur(10px)',
              backdropFilter: 'blur(10px)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedMsgId(null);
            }}
          >
            <div
              style={{
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-lg)',
                maxWidth: '400px',
                width: '90%',
                maxHeight: '80vh',
                overflowY: 'auto',
                padding: '1.2rem',
                position: 'relative',
              }}
            >
              <button
                type="button"
                style={{
                  position: 'absolute',
                  top: '.6rem',
                  right: '.8rem',
                  background: 'none',
                  border: 'none',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                }}
                aria-label={lt('關閉', '關閉')}
                onClick={() => setSelectedMsgId(null)}
              >
                {'✕'}
              </button>
              <div id="msg-inbox-detail-content">
                <h3 style={{ margin: '0 0 .6rem', fontSize: '1rem' }}>
                  {String(selectedMessage.title ?? '')}
                </h3>
                <div
                  style={{
                    fontSize: '.75rem',
                    color: 'var(--text-muted)',
                    marginBottom: '.5rem',
                  }}
                >
                  <span
                    class={`msg-type msg-type-${String(selectedMessage.type ?? 'system')}`}
                  >
                    {resolveTypeLabel(selectedMessage)}
                  </span>
                  <span style={{ marginLeft: '.4rem' }}>
                    {String(selectedMessage.time ?? '')}
                  </span>
                  {selectedMessage.senderName && (
                    <span style={{ marginLeft: '.4rem' }} data-no-translate>
                      {`${lt('來自', '來自')} ${String(selectedMessage.senderName)}`}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '.85rem',
                    lineHeight: 1.7,
                    padding: '.6rem',
                    background: 'var(--bg-elevated)',
                    borderRadius: 'var(--radius-sm)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {String(selectedMessage.body ?? '')}
                </div>
                {renderActionSection(selectedMessage)}
                <div class="msg-detail-remove-row">
                  <button
                    type="button"
                    class="msg-detail-remove-btn"
                    onClick={() => {
                      handleRemoveMessage(selectedMessage).catch(() => {
                        // 已於 handleRemoveMessage 內處理
                      });
                    }}
                  >
                    {lt('從我的收件匣移除', '從我的收件匣移除')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </section>
    </div>
  );
}
