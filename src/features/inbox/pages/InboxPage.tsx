import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import { useViewer } from '@/features/profile/data/viewer';
import {
  ensureMessageAction,
  type MessageActionEntry,
  type MessageActionHandler,
} from '@/core/action-registry';
import {
  applyInboxView,
  clearAll,
  countUnread,
  deleteMessage,
  isUnread,
  markAllRead,
  markRead,
  subscribeInbox,
  type InboxMessage,
} from '../data/inbox-repo';
import {
  editPrivateMessage,
  markConversationRead,
  PM_MAX_BODY_LENGTH,
  recallPrivateMessage,
  sendPrivateMessage,
  subscribeConversation,
  subscribeThreads,
  type PmMessage,
  type PmThread,
} from '../data/pm-repo';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Modal } from '@/ui/Modal';
import { UserTag } from '@/ui/UserTag';
import '../inbox.css';

const STORAGE_TOTAL = 50;

type InboxTabKey = 'all' | 'system' | 'activity' | 'tournament' | 'pm-conversation';

interface ActionUiState {
  status: 'idle' | 'checking' | 'ready';
  canAct: boolean;
  actions: MessageActionEntry[];
  runningKey: string | null;
  error: boolean;
  failedAction: MessageActionEntry | null;
  success: boolean;
}

function formatPmTime(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    return new Date(value).toISOString().slice(0, 16).replace('T', ' ');
  }
  if (typeof value === 'object' && value !== null) {
    const maybeToDate = (value as { toDate?: () => Date }).toDate;
    if (typeof maybeToDate === 'function') {
      try {
        return maybeToDate().toISOString().slice(0, 16).replace('T', ' ');
      } catch {
        return '';
      }
    }
  }
  return '';
}

function splitUrlTrailingPunctuation(raw: string): { urlText: string; suffix: string } {
  let urlText = String(raw || '');
  let suffix = '';
  while (
    urlText &&
    /[.,!?;:\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a)\]\}]/.test(urlText.slice(-1))
  ) {
    suffix = urlText.slice(-1) + suffix;
    urlText = urlText.slice(0, -1);
  }
  return { urlText, suffix };
}

function normalizeExternalHttpsUrl(value: string): string {
  try {
    const raw = String(value || '').trim();
    if (!raw || !/^https:\/\//i.test(raw)) return '';
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function renderPmMessageBody(body: string): {
  nodes: (string | JSX.Element)[];
  hasExternalLink: boolean;
} {
  const text = String(body || '');
  const urlPattern = /https:\/\/[^\s<>"'`]+/gi;
  const nodes: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let hasExternalLink = false;
  let keySeq = 0;

  for (const match of text.matchAll(urlPattern)) {
    const rawUrl = match[0] || '';
    const offset = Number(match.index || 0);
    const { urlText, suffix } = splitUrlTrailingPunctuation(rawUrl);
    const href = normalizeExternalHttpsUrl(urlText);
    if (!href) continue;

    if (offset > lastIndex) {
      nodes.push(text.slice(lastIndex, offset));
    }
    nodes.push(
      <a
        key={`link-${++keySeq}`}
        class="pm-message-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
      >
        <Text>{urlText}</Text>
      </a>,
    );
    if (suffix) nodes.push(suffix);
    lastIndex = offset + rawUrl.length;
    hasExternalLink = true;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  if (nodes.length === 0) {
    nodes.push(text);
  }
  return { nodes, hasExternalLink };
}

export default function InboxPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const location = useLocation();
  const uid = viewer.uid;

  // Inbox subscription states
  const [inboxStatus, setInboxStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [inboxAttempt, setInboxAttempt] = useState(0);
  const [messages, setMessages] = useState<InboxMessage[]>([]);

  // Filter & Tab states
  const [activeTab, setActiveTab] = useState<InboxTabKey>('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterDate, setFilterDate] = useState('');

  // Feedback banner
  const [banner, setBanner] = useState<{ tone: 'info' | 'success' | 'error'; text: string } | null>(
    null,
  );

  // Selected message detail modal & delete/clear confirm modals
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InboxMessage | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [busyToolbar, setBusyToolbar] = useState(false);

  // Actionable message state for currently opened detail message
  const [actionUi, setActionUi] = useState<ActionUiState>({
    status: 'idle',
    canAct: false,
    actions: [],
    runningKey: null,
    error: false,
    failedAction: null,
    success: false,
  });

  // Private messages states
  const [threadsStatus, setThreadsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [threadsAttempt, setThreadsAttempt] = useState(0);
  const [threads, setThreads] = useState<PmThread[]>([]);
  const [activeThread, setActiveThread] = useState<PmThread | null>(null);
  const [convStatus, setConvStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [convAttempt, setConvAttempt] = useState(0);
  const [convMessages, setConvMessages] = useState<PmMessage[]>([]);
  const [pmSearchKeyword, setPmSearchKeyword] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sendingPm, setSendingPm] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [pmBusyMessageId, setPmBusyMessageId] = useState<string | null>(null);
  const [pmErrorText, setPmErrorText] = useState<string | null>(null);

  const openProfile = (targetUid: string): void => {
    const cleanUid = String(targetUid ?? '').trim();
    if (!cleanUid) return;
    if (location && typeof location.route === 'function') {
      location.route(`/profile/${encodeURIComponent(cleanUid)}`);
    } else {
      window.history.pushState({}, '', `/profile/${encodeURIComponent(cleanUid)}`);
    }
  };

  // Subscribe Inbox when logged in
  useEffect(() => {
    if (!uid) {
      setMessages([]);
      setInboxStatus('loading');
      return;
    }
    setInboxStatus('loading');
    const unsub = subscribeInbox(
      uid,
      (nextMessages) => {
        setMessages(nextMessages);
        setInboxStatus('ready');
      },
      () => {
        setInboxStatus('error');
      },
    );
    return () => {
      unsub();
    };
  }, [uid, inboxAttempt]);

  // Subscribe PM Threads when logged in
  useEffect(() => {
    if (!uid) {
      setThreads([]);
      setThreadsStatus('loading');
      return;
    }
    setThreadsStatus('loading');
    const unsub = subscribeThreads(
      uid,
      (nextThreads) => {
        setThreads(nextThreads);
        setThreadsStatus('ready');
      },
      () => {
        setThreadsStatus('error');
      },
    );
    return () => {
      unsub();
    };
  }, [uid, threadsAttempt]);

  // Subscribe active PM Conversation & markConversationRead loop
  const markReadSeqRef = useRef(0);
  useEffect(() => {
    const cId = String(activeThread?.conversationId || activeThread?.id || '').trim();
    if (!uid || !cId) {
      setConvMessages([]);
      setConvStatus('idle');
      return;
    }

    const currentSeq = ++markReadSeqRef.current;
    let disposed = false;
    let markInFlight = false;

    const runMarkReadLoop = async (): Promise<void> => {
      if (markInFlight || disposed || markReadSeqRef.current !== currentSeq) return;
      markInFlight = true;
      try {
        while (!disposed && markReadSeqRef.current === currentSeq) {
          const res = await markConversationRead(cId);
          if (disposed || markReadSeqRef.current !== currentSeq) break;
          if (!res.hasMore || res.readCount <= 0) break;
        }
      } catch {
        // 忽略標記已讀失敗，避免打斷對話閱讀
      } finally {
        markInFlight = false;
      }
    };

    setConvStatus('loading');
    void runMarkReadLoop();

    const unsub = subscribeConversation(
      uid,
      cId,
      (nextMsgs) => {
        if (disposed) return;
        setConvMessages(nextMsgs);
        setConvStatus('ready');
        const hasUnreadIncoming = nextMsgs.some(
          (m) => m.direction === 'in' && m.read === false,
        );
        if (hasUnreadIncoming) {
          void runMarkReadLoop();
        }
      },
      () => {
        if (disposed) return;
        setConvStatus('error');
      },
    );

    return () => {
      disposed = true;
      unsub();
    };
  }, [uid, activeThread?.conversationId, activeThread?.id, convAttempt]);

  const selectedMessage = useMemo(
    () => messages.find((m) => m.id === selectedMsgId) ?? null,
    [messages, selectedMsgId],
  );

  // Evaluate actionable message handler & canAct when selectedMessage changes
  const actionCheckSeq = useRef(0);
  useEffect(() => {
    const seq = ++actionCheckSeq.current;
    if (!selectedMessage || !selectedMessage.actionType || !uid) {
      setActionUi({
        status: 'idle',
        canAct: false,
        actions: [],
        runningKey: null,
        error: false,
        failedAction: null,
        success: false,
      });
      return;
    }

    const status = String(selectedMessage.actionStatus ?? '').trim().toLowerCase();
    if (status && status !== 'pending') {
      setActionUi({
        status: 'ready',
        canAct: false,
        actions: [],
        runningKey: null,
        error: false,
        failedAction: null,
        success: false,
      });
      return;
    }

    let cancelled = false;
    setActionUi({
      status: 'checking',
      canAct: false,
      actions: [],
      runningKey: null,
      error: false,
      failedAction: null,
      success: false,
    });

    ensureMessageAction(selectedMessage.actionType)
      .then(async (handler: MessageActionHandler | null) => {
        if (cancelled || actionCheckSeq.current !== seq) return;
        if (!handler) {
          setActionUi({
            status: 'ready',
            canAct: false,
            actions: [],
            runningKey: null,
            error: false,
            failedAction: null,
            success: false,
          });
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
          error: false,
          failedAction: null,
          success: false,
        });
      })
      .catch(() => {
        if (cancelled || actionCheckSeq.current !== seq) return;
        setActionUi({
          status: 'ready',
          canAct: false,
          actions: [],
          runningKey: null,
          error: false,
          failedAction: null,
          success: false,
        });
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

  // Filtered and sorted inbox list
  const visibleMessages = useMemo(() => {
    if (activeTab === 'pm-conversation') return [];
    let list = applyInboxView(messages, activeTab);
    const kw = searchKeyword.trim().toLowerCase();
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
  }, [messages, activeTab, searchKeyword, filterDate]);

  const unreadInboxCount = useMemo(
    () => countUnread(messages, uid ?? undefined),
    [messages, uid],
  );

  const pmUnreadTotal = useMemo(
    () =>
      threads.reduce((acc, item) => {
        const c = Number(item.unreadCount ?? 0);
        return acc + (Number.isFinite(c) && c > 0 ? c : 0);
      }, 0),
    [threads],
  );

  const remainingCapacity = Math.max(0, STORAGE_TOTAL - messages.length);

  if (!uid) {
    return (
      <section class="inbox-page">
        <header class="inbox-page-header">
          <a class="inbox-back-btn" href="/" aria-label={t('inbox.back')}>
            <svg class="inbox-back-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M15 6l-6 6 6 6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </a>
          <Text as="h1" class="inbox-page-title">
            {t('inbox.title')}
          </Text>
        </header>
        <EmptyState
          title={t('inbox.loginRequiredTitle')}
          body={t('inbox.loginRequiredBody')}
        />
      </section>
    );
  }

  const handleOpenMessage = (msg: InboxMessage): void => {
    setSelectedMsgId(msg.id);
    if (isUnread(msg, uid) && msg._docId) {
      markRead(uid, msg).catch(() => {
        // 忽略單次標記已讀失敗，保留閱讀彈窗
      });
    }
  };

  const handleMarkAllRead = async (): Promise<void> => {
    if (busyToolbar) return;
    setBusyToolbar(true);
    setBanner(null);
    try {
      await markAllRead(uid, messages);
      setBanner({ tone: 'success', text: t('inbox.markAllReadDone') });
    } catch {
      setBanner({ tone: 'error', text: t('inbox.action.error') });
    } finally {
      setBusyToolbar(false);
    }
  };

  const handleConfirmDeleteSingle = async (): Promise<void> => {
    if (!deleteTarget || busyToolbar) return;
    setBusyToolbar(true);
    setBanner(null);
    try {
      await deleteMessage(uid, deleteTarget);
      if (selectedMsgId === deleteTarget.id) {
        setSelectedMsgId(null);
      }
      setDeleteTarget(null);
      setBanner({ tone: 'success', text: t('inbox.deleteDone') });
    } catch {
      setBanner({ tone: 'error', text: t('inbox.action.error') });
    } finally {
      setBusyToolbar(false);
    }
  };

  const handleConfirmClearAll = async (): Promise<void> => {
    if (busyToolbar) return;
    setBusyToolbar(true);
    setBanner(null);
    try {
      const deletedCount = await clearAll(uid, messages);
      setClearConfirmOpen(false);
      setSelectedMsgId(null);
      setBanner({
        tone: 'success',
        text: t('inbox.clearDone', { count: deletedCount }),
      });
    } catch {
      setBanner({ tone: 'error', text: t('inbox.action.error') });
    } finally {
      setBusyToolbar(false);
    }
  };

  const handleRunMessageAction = async (entry: MessageActionEntry): Promise<void> => {
    if (!selectedMessage || actionUi.runningKey) return;
    setActionUi((prev) => ({
      ...prev,
      runningKey: entry.key,
      error: false,
      failedAction: null,
      success: false,
    }));
    try {
      await entry.run(selectedMessage, {
        uid,
        role: viewer.role,
        displayName: viewer.displayName ?? undefined,
        hasPermission: viewer.hasPermission,
      });
      setActionUi((prev) => ({
        ...prev,
        runningKey: null,
        error: false,
        failedAction: null,
        success: true,
      }));
      setBanner({ tone: 'success', text: t('inbox.action.success') });
    } catch {
      setActionUi((prev) => ({
        ...prev,
        runningKey: null,
        error: true,
        failedAction: entry,
        success: false,
      }));
    }
  };

  const resolveTypeLabel = (msg: InboxMessage): string => {
    if (msg.typeName) return String(msg.typeName);
    const rawType = String(msg.type ?? 'system').trim();
    if (
      rawType === 'system' ||
      rawType === 'activity' ||
      rawType === 'tournament' ||
      rawType === 'trade' ||
      rawType === 'private'
    ) {
      return t(`inbox.type.${rawType}`);
    }
    return rawType;
  };

  const renderActionStatusBadge = (msg: InboxMessage): JSX.Element | null => {
    const rawStatus = String(msg.actionStatus ?? '').trim().toLowerCase();
    if (!rawStatus || rawStatus === 'pending') return null;

    let label = rawStatus;
    if (
      rawStatus === 'approved' ||
      rawStatus === 'rejected' ||
      rawStatus === 'ignored' ||
      rawStatus === 'opened'
    ) {
      label = t(`inbox.action.status.${rawStatus}`);
    }
    const reviewer = String((msg as { reviewerName?: unknown }).reviewerName ?? '').trim();
    const display = reviewer
      ? t('inbox.action.statusWithReviewer', { status: label, reviewer })
      : label;

    return (
      <div class={`msg-action-status msg-action-status--${rawStatus}`}>
        <Text>{display}</Text>
      </div>
    );
  };

  // PM compose & actions
  const trimmedCompose = composeBody.trim();
  const remainingChars = PM_MAX_BODY_LENGTH - composeBody.length;
  const isOverLimit = remainingChars < 0;
  const canSubmitPm =
    !sendingPm && trimmedCompose.length > 0 && composeBody.length <= PM_MAX_BODY_LENGTH;

  const handleSendPm = async (e: JSX.TargetedEvent<HTMLFormElement, Event>): Promise<void> => {
    e.preventDefault();
    if (!activeThread || !canSubmitPm) return;
    const targetUid = String(activeThread.peerUid ?? '').trim();
    if (!targetUid) return;

    setSendingPm(true);
    setPmErrorText(null);
    try {
      await sendPrivateMessage(targetUid, composeBody);
      setComposeBody('');
    } catch {
      setPmErrorText(t('inbox.pm.sendFailed'));
    } finally {
      setSendingPm(false);
    }
  };

  const handleStartEditPm = (msg: PmMessage): void => {
    const msgId = String(msg.messageId || msg.id || '').trim();
    if (!msgId) return;
    setEditingMessageId(msgId);
    setEditingBody(String(msg.body ?? ''));
    setPmErrorText(null);
  };

  const handleSaveEditPm = async (msg: PmMessage): Promise<void> => {
    if (!activeThread) return;
    const cId = String(activeThread.conversationId || activeThread.id || '').trim();
    const msgId = String(msg.messageId || msg.id || '').trim();
    const trimmed = editingBody.trim();
    if (!cId || !msgId || !trimmed || editingBody.length > PM_MAX_BODY_LENGTH) return;

    setPmBusyMessageId(msgId);
    setPmErrorText(null);
    try {
      await editPrivateMessage(cId, msgId, editingBody);
      setEditingMessageId(null);
      setEditingBody('');
    } catch {
      setPmErrorText(t('inbox.pm.editFailed'));
    } finally {
      setPmBusyMessageId(null);
    }
  };

  const handleRecallPm = async (msg: PmMessage): Promise<void> => {
    if (!activeThread) return;
    const cId = String(activeThread.conversationId || activeThread.id || '').trim();
    const msgId = String(msg.messageId || msg.id || '').trim();
    if (!cId || !msgId) return;

    setPmBusyMessageId(msgId);
    setPmErrorText(null);
    try {
      await recallPrivateMessage(cId, msgId);
    } catch {
      setPmErrorText(t('inbox.pm.recallFailed'));
    } finally {
      setPmBusyMessageId(null);
    }
  };

  const filteredConvMessages = useMemo(() => {
    const kw = pmSearchKeyword.trim().toLowerCase();
    if (!kw) return convMessages;
    return convMessages.filter(
      (m) =>
        String(m.body ?? '').toLowerCase().includes(kw) ||
        String(m.senderName ?? '').toLowerCase().includes(kw),
    );
  }, [convMessages, pmSearchKeyword]);

  return (
    <section class="inbox-page" id="page-messages">
      <header class="inbox-page-header">
        <a class="inbox-back-btn" href="/" aria-label={t('inbox.back')}>
          <svg class="inbox-back-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </a>
        <Text as="h1" class="inbox-page-title">
          {t('inbox.title')}
        </Text>
      </header>

      {banner && (
        <div
          role={banner.tone === 'error' ? 'alert' : 'status'}
          class={`inbox-feedback inbox-feedback--${banner.tone}`}
        >
          <Text>{banner.text}</Text>
        </div>
      )}

      {/* Toolbar Row */}
      <div id="msg-toolbar-row" class="msg-toolbar-row">
        <button
          type="button"
          class="msg-toolbar-btn msg-toolbar-btn--primary"
          disabled={busyToolbar || unreadInboxCount === 0}
          onClick={() => {
            void handleMarkAllRead();
          }}
        >
          <Text>{t('inbox.markAllRead')}</Text>
        </button>
        <button
          type="button"
          class="msg-toolbar-btn msg-toolbar-btn--danger"
          disabled={busyToolbar || messages.length === 0}
          onClick={() => setClearConfirmOpen(true)}
        >
          <Text>{t('inbox.clearAll')}</Text>
        </button>
        <span id="storage-bar" class="msg-storage-bar">
          <Text>
            {t('inbox.storageRemaining', {
              remaining: remainingCapacity,
              total: STORAGE_TOTAL,
            })}
          </Text>
        </span>
        <span class="msg-unread-pill">
          <Text>{t('inbox.unreadTotal', { count: unreadInboxCount + pmUnreadTotal })}</Text>
        </span>
      </div>

      {/* Category Tabs */}
      <div
        class="msg-inbox-tabs"
        id="msg-inbox-tabs"
        role="tablist"
        aria-label={t('inbox.tabs.label')}
      >
        {(
          [
            { key: 'all', label: t('inbox.tabs.all') },
            { key: 'system', label: t('inbox.tabs.system') },
            { key: 'activity', label: t('inbox.tabs.activity') },
            { key: 'tournament', label: t('inbox.tabs.tournament') },
            { key: 'pm-conversation', label: t('inbox.tabs.pm') },
          ] as const
        ).map((tab) => {
          const isPm = tab.key === 'pm-conversation';
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-msgtype={tab.key}
              class={`msg-tab${isActive ? ' active' : ''}${
                isPm && pmUnreadTotal > 0 ? ' has-pm-unread' : ''
              }`}
              onClick={() => {
                setActiveTab(tab.key);
                if (!isPm) setActiveThread(null);
              }}
            >
              <Text>{tab.label}</Text>
            </button>
          );
        })}
      </div>

      {/* Inbox Tab View */}
      {activeTab !== 'pm-conversation' && (
        <>
          <div id="msg-filter-row" class="msg-filter-row">
            <input
              type="text"
              id="msg-search-keyword"
              class="msg-filter-input"
              aria-label={t('inbox.search.keywordLabel')}
              placeholder={t('inbox.search.keywordPlaceholder')}
              value={searchKeyword}
              onInput={(e) => setSearchKeyword(e.currentTarget.value)}
            />
            <input
              type="date"
              id="msg-filter-date"
              class="msg-filter-date"
              aria-label={t('inbox.search.dateLabel')}
              value={filterDate}
              onChange={(e) => setFilterDate(e.currentTarget.value)}
            />
            <button
              type="button"
              class="msg-filter-clear"
              onClick={() => {
                setSearchKeyword('');
                setFilterDate('');
              }}
            >
              <Text>{t('inbox.search.clear')}</Text>
            </button>
          </div>

          {inboxStatus === 'loading' && (
            <div role="status" class="inbox-feedback">
              <Text>{t('inbox.loading')}</Text>
            </div>
          )}

          {inboxStatus === 'error' && (
            <div role="alert" class="inbox-feedback inbox-feedback--error">
              <Text>{t('inbox.loadError')}</Text>
              <Button onClick={() => setInboxAttempt((v) => v + 1)}>
                {t('inbox.retry')}
              </Button>
            </div>
          )}

          {inboxStatus === 'ready' && (
            <div class="msg-card-list" id="message-list">
              {visibleMessages.length > 0 ? (
                visibleMessages.map((msg) => {
                  const unread = isUnread(msg, uid);
                  const isPending =
                    !!msg.actionType &&
                    String(msg.actionStatus ?? '').trim().toLowerCase() === 'pending';
                  return (
                    <button
                      key={msg.id}
                      type="button"
                      class={`msg-card${unread ? ' msg-unread' : ''}`}
                      onClick={() => handleOpenMessage(msg)}
                    >
                      {msg.actionType && (
                        <div
                          class={`msg-ribbon ${
                            isPending ? 'msg-ribbon-pending' : 'msg-ribbon-reviewed'
                          }`}
                        >
                          <Text>
                            {isPending
                              ? t('inbox.ribbon.pending')
                              : t('inbox.ribbon.reviewed')}
                          </Text>
                        </div>
                      )}
                      <div class="msg-card-header">
                        <span
                          class={`msg-dot ${unread ? 'unread' : 'read'}`}
                          aria-hidden="true"
                        />
                        <span class={`msg-type msg-type-${String(msg.type ?? 'system')}`}>
                          <Text>{resolveTypeLabel(msg)}</Text>
                        </span>
                        <span class="msg-title">
                          <Text>{String(msg.title ?? '')}</Text>
                        </span>
                      </div>
                      <div class="msg-preview">
                        <Text>{String(msg.preview ?? '')}</Text>
                      </div>
                      <div class="msg-time">
                        <Text>{String(msg.time ?? '')}</Text>
                      </div>
                    </button>
                  );
                })
              ) : (
                <EmptyState
                  title={t('inbox.emptyTitle')}
                  body={t('inbox.emptyBody')}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Private Messages View */}
      {activeTab === 'pm-conversation' && (
        <div class="pm-section">
          {!activeThread ? (
            <>
              {threadsStatus === 'loading' && (
                <div role="status" class="inbox-feedback">
                  <Text>{t('inbox.loading')}</Text>
                </div>
              )}
              {threadsStatus === 'error' && (
                <div role="alert" class="inbox-feedback inbox-feedback--error">
                  <Text>{t('inbox.pm.threadLoadError')}</Text>
                  <Button onClick={() => setThreadsAttempt((v) => v + 1)}>
                    {t('inbox.retry')}
                  </Button>
                </div>
              )}
              {threadsStatus === 'ready' && (
                <div class="pm-thread-list">
                  {threads.length > 0 ? (
                    threads.map((thread) => {
                      const unreadCount = Math.max(0, Number(thread.unreadCount ?? 0));
                      const peerUid = String(thread.peerUid ?? '').trim();
                      const peerName = String(thread.peerName || peerUid || '?');
                      return (
                        <div
                          key={thread.id}
                          class={`pm-thread-card${unreadCount > 0 ? ' is-unread' : ''}`}
                          onClick={() => {
                            setActiveThread(thread);
                            setPmSearchKeyword('');
                            setPmErrorText(null);
                          }}
                        >
                          <span class="pm-thread-avatar" aria-hidden="true">
                            {thread.peerAvatar ? (
                              <img
                                class="pm-thread-avatar-img"
                                src={String(thread.peerAvatar)}
                                alt=""
                              />
                            ) : (
                              <Text>{peerName.slice(0, 1)}</Text>
                            )}
                          </span>
                          <div class="pm-thread-main">
                            <div
                              class="pm-thread-top"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <UserTag
                                uid={peerUid}
                                name={peerName}
                                onOpenProfile={openProfile}
                              />
                              <span class="pm-thread-time">
                                <Text>{formatPmTime(thread.lastMessageAt)}</Text>
                              </span>
                            </div>
                            <div class="pm-thread-preview">
                              <Text>{String(thread.lastMessageBody ?? '')}</Text>
                            </div>
                          </div>
                          {unreadCount > 0 && (
                            <span class="pm-thread-badge">
                              <Text>{unreadCount > 99 ? '99+' : String(unreadCount)}</Text>
                            </span>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <EmptyState
                      title={t('inbox.pm.emptyTitle')}
                      body={t('inbox.pm.emptyBody')}
                    />
                  )}
                </div>
              )}
            </>
          ) : (
            <section class="pm-dialog" aria-label={t('inbox.pm.dialogTitle')}>
              <header class="pm-dialog-header">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setActiveThread(null);
                    setEditingMessageId(null);
                    setPmErrorText(null);
                  }}
                >
                  {t('inbox.pm.backToThreads')}
                </Button>
                <div class="pm-dialog-title">
                  <UserTag
                    uid={String(activeThread.peerUid ?? '')}
                    name={String(activeThread.peerName || activeThread.peerUid || '')}
                    onOpenProfile={openProfile}
                  />
                </div>
                <input
                  type="search"
                  class="pm-dialog-search"
                  aria-label={t('inbox.pm.searchLabel')}
                  placeholder={t('inbox.pm.searchPlaceholder')}
                  value={pmSearchKeyword}
                  onInput={(e) => setPmSearchKeyword(e.currentTarget.value)}
                />
              </header>

              {pmErrorText && (
                <div role="alert" class="inbox-feedback inbox-feedback--error">
                  <Text>{pmErrorText}</Text>
                </div>
              )}

              <div class="pm-dialog-messages">
                {convStatus === 'loading' && (
                  <div role="status">
                    <Text>{t('inbox.loading')}</Text>
                  </div>
                )}
                {convStatus === 'error' && (
                  <div role="alert" class="inbox-feedback inbox-feedback--error">
                    <Text>{t('inbox.pm.conversationLoadError')}</Text>
                    <Button onClick={() => setConvAttempt((v) => v + 1)}>
                      {t('inbox.retry')}
                    </Button>
                  </div>
                )}
                {convStatus === 'ready' &&
                  (filteredConvMessages.length > 0 ? (
                    filteredConvMessages.map((m) => {
                      const own = m.fromUid === uid || m.direction === 'out';
                      const status = String(m.status || 'active');
                      const recalled = status === 'recalled';
                      const peerRead = own && m.peerRead === true;
                      const msgId = String(m.messageId || m.id || '');
                      const isBusy = pmBusyMessageId === msgId;
                      // 照 A pm-dialog.js：只對自己的訊息顯示編輯/撤回，且未撤回、對方未讀、非處理中
                      const canEditOrRecall = own && !recalled && !peerRead && !isBusy;
                      const bodyText = recalled
                        ? t('inbox.pm.recalledText')
                        : String(m.body ?? '');
                      const rendered = renderPmMessageBody(bodyText);
                      const isEditingThis = editingMessageId === msgId;

                      const metaParts: string[] = [];
                      const timeStr = formatPmTime(m.createdAt);
                      if (timeStr) metaParts.push(timeStr);
                      if (status === 'edited') metaParts.push(t('inbox.pm.editedTag'));
                      if (peerRead) metaParts.push(t('inbox.pm.peerReadTag'));

                      return (
                        <article
                          key={msgId}
                          class={`pm-message ${own ? 'is-own' : 'is-peer'}${
                            recalled ? ' is-recalled' : ''
                          }`}
                        >
                          {isEditingThis ? (
                            <div class="pm-edit-box">
                              <textarea
                                class="pm-dialog-input"
                                aria-label={t('inbox.pm.inputLabel')}
                                value={editingBody}
                                onInput={(e) => setEditingBody(e.currentTarget.value)}
                              />
                              <div class="pm-message-actions">
                                <button
                                  type="button"
                                  class="pm-message-action-btn"
                                  disabled={
                                    isBusy ||
                                    editingBody.trim().length === 0 ||
                                    editingBody.length > PM_MAX_BODY_LENGTH
                                  }
                                  onClick={() => {
                                    void handleSaveEditPm(m);
                                  }}
                                >
                                  <Text>{t('inbox.pm.saveEdit')}</Text>
                                </button>
                                <button
                                  type="button"
                                  class="pm-message-action-btn"
                                  onClick={() => {
                                    setEditingMessageId(null);
                                    setEditingBody('');
                                  }}
                                >
                                  <Text>{t('inbox.pm.cancelEdit')}</Text>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div class="pm-message-bubble">
                              {rendered.nodes.map((node, idx) =>
                                typeof node === 'string' ? (
                                  <Text key={idx}>{node}</Text>
                                ) : (
                                  node
                                ),
                              )}
                            </div>
                          )}

                          {!recalled && rendered.hasExternalLink && (
                            <div class="pm-message-link-safety" role="note">
                              <Text>{t('inbox.pm.safetyNotice')}</Text>
                            </div>
                          )}

                          <div class="pm-message-meta">
                            {metaParts.length > 0 && <Text>{metaParts.join(' · ')}</Text>}
                            {canEditOrRecall && !isEditingThis && (
                              <span class="pm-message-actions">
                                <button
                                  type="button"
                                  class="pm-message-action-btn"
                                  data-pm-action="edit"
                                  onClick={() => handleStartEditPm(m)}
                                >
                                  <Text>{t('inbox.pm.edit')}</Text>
                                </button>
                                <button
                                  type="button"
                                  class="pm-message-action-btn"
                                  data-pm-action="recall"
                                  onClick={() => {
                                    void handleRecallPm(m);
                                  }}
                                >
                                  <Text>{t('inbox.pm.recall')}</Text>
                                </button>
                              </span>
                            )}
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <EmptyState title={t('inbox.pm.emptyMessages')} />
                  ))}
              </div>

              <form class="pm-dialog-compose" onSubmit={(e) => void handleSendPm(e)}>
                <div class="pm-dialog-compose-row">
                  <textarea
                    class="pm-dialog-input"
                    rows={1}
                    aria-label={t('inbox.pm.inputLabel')}
                    placeholder={t('inbox.pm.inputPlaceholder', {
                      max: PM_MAX_BODY_LENGTH,
                    })}
                    value={composeBody}
                    onInput={(e) => setComposeBody(e.currentTarget.value)}
                  />
                  <button
                    type="submit"
                    class="pm-dialog-send"
                    disabled={!canSubmitPm}
                  >
                    <Text>
                      {sendingPm ? t('inbox.pm.sending') : t('inbox.pm.send')}
                    </Text>
                  </button>
                </div>
                <div class="pm-compose-footer">
                  <span
                    class={isOverLimit ? 'pm-compose-counter--over' : undefined}
                  >
                    <Text>
                      {isOverLimit
                        ? t('inbox.pm.overLimit', { remaining: remainingChars })
                        : t('inbox.pm.remainingChars', { remaining: remainingChars })}
                    </Text>
                  </span>
                </div>
              </form>
            </section>
          )}
        </div>
      )}

      {/* Detail Modal */}
      <Modal
        open={!!selectedMessage}
        title={selectedMessage?.title ? String(selectedMessage.title) : t('inbox.detailTitle')}
        onClose={() => setSelectedMsgId(null)}
      >
        {selectedMessage && (
          <div>
            <div class="msg-detail-meta">
              <span
                class={`msg-type msg-type-${String(selectedMessage.type ?? 'system')}`}
              >
                <Text>{resolveTypeLabel(selectedMessage)}</Text>
              </span>
              {selectedMessage.time && (
                <span>
                  <Text>{String(selectedMessage.time)}</Text>
                </span>
              )}
              {selectedMessage.senderName && (
                <span>
                  <Text>
                    {t('inbox.fromSender', {
                      sender: String(selectedMessage.senderName),
                    })}
                  </Text>
                </span>
              )}
            </div>

            <div class="msg-detail-body">
              <Text>{String(selectedMessage.body ?? selectedMessage.preview ?? '')}</Text>
            </div>

            {/* Actionable message buttons or processed status */}
            {selectedMessage.actionType && (
              <>
                {String(selectedMessage.actionStatus ?? '').trim().toLowerCase() ===
                'pending' ? (
                  <>
                    {actionUi.canAct && actionUi.actions.length > 0 && (
                      <div class="msg-action-btns">
                        {actionUi.actions.map((act) => {
                          const isApprove = act.key === 'approve';
                          const isReject = act.key === 'reject';
                          const btnClass = isApprove
                            ? 'msg-action-btn msg-action-approve'
                            : isReject
                            ? 'msg-action-btn msg-action-reject'
                            : 'msg-action-btn msg-action-ignore';
                          return (
                            <button
                              key={act.key}
                              type="button"
                              class={btnClass}
                              disabled={!!actionUi.runningKey}
                              onClick={() => {
                                void handleRunMessageAction(act);
                              }}
                            >
                              <Text>
                                {actionUi.runningKey === act.key
                                  ? t('inbox.action.running')
                                  : t(act.labelKey)}
                              </Text>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {actionUi.error && actionUi.failedAction && (
                      <div
                        role="alert"
                        class="inbox-feedback inbox-feedback--error"
                        style={{ marginTop: 'var(--space-2)' }}
                      >
                        <Text>{t('inbox.action.error')}</Text>
                        <Button
                          onClick={() => {
                            if (actionUi.failedAction) {
                              void handleRunMessageAction(actionUi.failedAction);
                            }
                          }}
                        >
                          {t('inbox.action.retry')}
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  renderActionStatusBadge(selectedMessage)
                )}
              </>
            )}

            <div class="msg-detail-remove-row">
              <button
                type="button"
                class="msg-detail-remove-btn"
                onClick={() => setDeleteTarget(selectedMessage)}
              >
                <Text>{t('inbox.removeFromInbox')}</Text>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Single Message Delete Confirm Modal */}
      <Modal
        open={!!deleteTarget}
        title={t('inbox.deleteConfirmTitle')}
        onClose={() => setDeleteTarget(null)}
        footer={
          <div class="msg-action-btns">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              {t('inbox.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={busyToolbar}
              onClick={() => {
                void handleConfirmDeleteSingle();
              }}
            >
              {t('inbox.confirm')}
            </Button>
          </div>
        }
      >
        <Text>
          {t('inbox.deleteConfirmBody', {
            title: String(deleteTarget?.title ?? ''),
          })}
        </Text>
      </Modal>

      {/* Clear All Confirm Modal */}
      <Modal
        open={clearConfirmOpen}
        title={t('inbox.clearConfirmTitle')}
        onClose={() => setClearConfirmOpen(false)}
        footer={
          <div class="msg-action-btns">
            <Button variant="ghost" onClick={() => setClearConfirmOpen(false)}>
              {t('inbox.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={busyToolbar}
              onClick={() => {
                void handleConfirmClearAll();
              }}
            >
              {t('inbox.confirm')}
            </Button>
          </div>
        }
      >
        <Text>{t('inbox.clearConfirmBody')}</Text>
      </Modal>
    </section>
  );
}
