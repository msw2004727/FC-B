/**
 * 日誌中心「聊天室稽核」頁籤（站長 2026-11-02 Q5：照舊站放日誌中心）。
 * DOM／class／文案照 A `js/modules/message/pm-audit.js#renderPmAuditPanel` 與 `css/message.css` 的 `.pm-audit-*`。
 * - 只限 super_admin（A `_isPmAuditAllowed`；頁籤本身也只對 super_admin 顯示）。
 * - 全部走既有 Callable，前端 Firestore 讀取 0。
 * - 設定卡說明段落照 A 保留（R-UI-026：照 A 搬的畫面文案仍照 A；站長 Q11 拿掉說明只針對小遊戲與頭像檢測）。
 * - 與 A 差異：頭像只接受 https 網址；晚到的回應不覆蓋較新的操作結果。
 */
import '@/styles/legacy/message.css';
// 四段查詢載入沿用 .reg-loading。不整檔引入 activity.css（.back-btn 等副作用）。
import '@/styles/legacy/reg-loading.css';

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import {
  PM_AUDIT_ACTIONS,
  listPmThreads,
  loadPmAuditLogs,
  loadPmConversation,
  loadPmSettings,
  pmAuditActionLabel,
  pmAuditShortUid,
  pmFormatTime,
  savePmSettings,
  searchPmUsers,
  type PmAuditLog,
  type PmAuditMessage,
  type PmAuditThread,
  type PmAuditUser,
} from '../data/pm-audit';

type Box<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: T[] };

interface LogState {
  status: 'loading' | 'error' | 'ready';
  items: PmAuditLog[];
  nextCursorMs: number | null;
  hasMore: boolean;
  loadingMore: boolean;
}

function safeAvatar(url: string): string | null {
  return /^https:\/\//i.test(url) ? url : null;
}

function loadingLine(text: string): JSX.Element {
  return (
    <>
      <div class="reg-loading" role="status" style="white-space:nowrap">{text}</div>
      <div class="reg-loading-skeleton" aria-hidden="true">
        <div class="reg-loading-skeleton-row" />
        <div class="reg-loading-skeleton-row" />
        <div class="reg-loading-skeleton-row" />
      </div>
    </>
  );
}

export function PmAuditPanel(): JSX.Element {
  const t = useT();
  const [allowPm, setAllowPm] = useState(false);
  const [settingStatus, setSettingStatus] = useState<'loading' | 'on' | 'off' | 'loadFailed' | 'saving' | 'saveFailed'>('loading');
  const [settingBusy, setSettingBusy] = useState(true);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<Box<PmAuditUser>>({ status: 'idle' });
  const [threads, setThreads] = useState<Box<PmAuditThread>>({ status: 'idle' });
  const [conversation, setConversation] = useState<Box<PmAuditMessage>>({ status: 'idle' });
  const [action, setAction] = useState('');
  const [logs, setLogs] = useState<LogState>({ status: 'loading', items: [], nextCursorMs: null, hasMore: false, loadingMore: false });

  const alive = useRef(true);
  const userSeq = useRef(0);
  const threadSeq = useRef(0);
  const convoSeq = useRef(0);
  const logSeq = useRef(0);
  const savingRef = useRef(false);
  const logsRef = useRef(logs);
  logsRef.current = logs;
  const actionRef = useRef(action);
  actionRef.current = action;

  async function reloadLogs(nextAction: string): Promise<void> {
    const seq = ++logSeq.current;
    setAction(nextAction);
    actionRef.current = nextAction;
    setLogs({ status: 'loading', items: [], nextCursorMs: null, hasMore: false, loadingMore: false });
    try {
      const page = await loadPmAuditLogs(nextAction, null);
      if (!alive.current || seq !== logSeq.current) return;
      setLogs({ status: 'ready', items: page.logs, nextCursorMs: page.nextCursorMs, hasMore: page.hasMore, loadingMore: false });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[loadPmAuditLogs]', err);
      if (alive.current && seq === logSeq.current) {
        setLogs({ status: 'error', items: [], nextCursorMs: null, hasMore: false, loadingMore: false });
      }
    }
  }

  async function loadMoreLogs(): Promise<void> {
    const current = logsRef.current;
    if (current.status !== 'ready' || !current.nextCursorMs || current.loadingMore) return;
    const seq = logSeq.current;
    setLogs({ ...current, loadingMore: true });
    try {
      const page = await loadPmAuditLogs(actionRef.current, current.nextCursorMs);
      if (!alive.current || seq !== logSeq.current) return;
      setLogs((prev) => ({
        status: 'ready',
        items: prev.items.concat(page.logs),
        nextCursorMs: page.nextCursorMs,
        hasMore: page.hasMore,
        loadingMore: false,
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[loadPmAuditLogs]', err);
      if (alive.current && seq === logSeq.current) setLogs((prev) => ({ ...prev, loadingMore: false }));
    }
  }

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const allow = await loadPmSettings();
        if (!alive.current) return;
        setAllowPm(allow);
        setSettingStatus(allow ? 'on' : 'off');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[loadPmAuditSettings]', err);
        if (alive.current) setSettingStatus('loadFailed');
      } finally {
        if (alive.current) setSettingBusy(false);
      }
    })().catch(() => {
      // 已於內部處理。
    });
    void reloadLogs('');
    return () => {
      alive.current = false;
    };
  }, []);

  async function saveSettings(next: boolean): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    setSettingBusy(true);
    setAllowPm(next);
    setSettingStatus('saving');
    try {
      const saved = await savePmSettings(next);
      if (!alive.current) return;
      setAllowPm(saved);
      setSettingStatus(saved ? 'on' : 'off');
      toast.show({ message: t('logs.chat.settingSaved'), tone: 'success' });
      void reloadLogs('settings_update');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[savePmAuditSettings]', err);
      if (alive.current) {
        setAllowPm(!next);
        setSettingStatus('saveFailed');
      }
      toast.show({ message: t('logs.chat.settingSaveToastFailed'), tone: 'error' });
    } finally {
      savingRef.current = false;
      if (alive.current) setSettingBusy(false);
    }
  }

  async function searchUsers(): Promise<void> {
    const q = query.trim();
    if (!q) {
      toast.show({ message: t('logs.chat.searchRequired'), tone: 'warning' });
      return;
    }
    const seq = ++userSeq.current;
    setUsers({ status: 'loading' });
    try {
      const found = await searchPmUsers(q);
      if (alive.current && seq === userSeq.current) setUsers({ status: 'ready', items: found });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[searchPmAuditUsers]', err);
      if (alive.current && seq === userSeq.current) setUsers({ status: 'error' });
    }
  }

  async function openThreads(uid: string): Promise<void> {
    const seq = ++threadSeq.current;
    convoSeq.current += 1;
    setThreads({ status: 'loading' });
    setConversation({ status: 'idle' });
    try {
      const list = await listPmThreads(uid);
      if (alive.current && seq === threadSeq.current) setThreads({ status: 'ready', items: list });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[loadPmAuditThreads]', err);
      if (alive.current && seq === threadSeq.current) setThreads({ status: 'error' });
    }
  }

  async function openConversation(conversationId: string): Promise<void> {
    const seq = ++convoSeq.current;
    setConversation({ status: 'loading' });
    try {
      const messages = await loadPmConversation(conversationId);
      if (!alive.current || seq !== convoSeq.current) return;
      setConversation({ status: 'ready', items: messages });
      void reloadLogs('audit_view_conversation');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[loadPmAuditConversation]', err);
      if (alive.current && seq === convoSeq.current) setConversation({ status: 'error' });
    }
  }

  const settingText: Record<typeof settingStatus, string> = {
    loading: t('logs.chat.settingLoading'),
    on: t('logs.chat.settingOn'),
    off: t('logs.chat.settingOff'),
    loadFailed: t('logs.chat.settingLoadFailed'),
    saving: t('logs.chat.settingSaving'),
    saveFailed: t('logs.chat.settingSaveFailed'),
  };

  const muted = (text: string): JSX.Element => <div class="muted">{text}</div>;

  return (
    <div class="pm-audit-layout">
      <section class="pm-audit-card pm-audit-settings-card">
        <div class="pm-audit-setting-row">
          <div class="pm-audit-setting-copy">
            <h3>{t('logs.chat.settingTitle')}</h3>
            <p>{t('logs.chat.settingDesc')}</p>
          </div>
          <label class="pm-audit-switch" aria-label={t('logs.chat.settingTitle')}>
            <input
              id="pm-user-pm-toggle"
              type="checkbox"
              checked={allowPm}
              disabled={settingBusy}
              onChange={(e) => {
                void saveSettings(e.currentTarget.checked);
              }}
            />
            <span />
          </label>
        </div>
        <div id="pm-audit-settings-status" class="pm-audit-setting-status muted">{settingText[settingStatus]}</div>
      </section>

      <section class="pm-audit-card">
        <h3>{t('logs.chat.searchTitle')}</h3>
        <div class="pm-audit-row">
          <input
            id="pm-audit-user-query"
            type="text"
            placeholder={t('logs.chat.searchPlaceholder')}
            aria-label={t('logs.chat.searchPlaceholder')}
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <button type="button" class="primary-btn small" onClick={() => void searchUsers()}>
            {t('logs.chat.search')}
          </button>
        </div>
        <div id="pm-audit-users" class="pm-audit-results">
          {users.status === 'loading' ? loadingLine(t('logs.chat.searching')) : null}
          {users.status === 'error' ? muted(t('logs.chat.searchFailed')) : null}
          {users.status === 'ready' && users.items.length === 0 ? muted(t('logs.chat.noUsers')) : null}
          {users.status === 'ready'
            ? users.items.map((u) => {
              const avatar = safeAvatar(u.pictureUrl);
              return (
                <button key={u.uid} type="button" class="pm-audit-user" data-uid={u.uid} onClick={() => void openThreads(u.uid)}>
                  {avatar ? <img src={avatar} alt="" /> : <span />}
                  <strong data-no-translate>{u.name || u.uid || t('logs.chat.unnamed')}</strong>
                  <small data-no-translate>{[u.uid, u.role || 'user'].filter(Boolean).join(' · ')}</small>
                </button>
              );
            })
            : null}
        </div>
      </section>

      <section class="pm-audit-card">
        <h3>{t('logs.chat.threadsTitle')}</h3>
        <div id="pm-audit-threads" class={`pm-audit-results${threads.status === 'idle' ? ' muted' : ''}`}>
          {threads.status === 'idle' ? t('logs.chat.threadsIdle') : null}
          {threads.status === 'loading' ? loadingLine(t('logs.chat.loading')) : null}
          {threads.status === 'error' ? muted(t('logs.chat.threadsFailed')) : null}
          {threads.status === 'ready' && threads.items.length === 0 ? muted(t('logs.chat.threadsEmpty')) : null}
          {threads.status === 'ready'
            ? threads.items.map((thread) => (
              <button key={thread.id} type="button" class="pm-audit-thread" data-cid={thread.id} onClick={() => void openConversation(thread.id)}>
                <strong data-no-translate>{thread.title}</strong>
                <span>{thread.lastMessageBody}</span>
                <small>{pmFormatTime(thread.lastMessageAt)}</small>
              </button>
            ))
            : null}
        </div>
      </section>

      <section class="pm-audit-card pm-audit-conversation-card">
        <h3>{t('logs.chat.conversationTitle')}</h3>
        <div id="pm-audit-conversation" class={`pm-audit-conversation${conversation.status === 'idle' ? ' muted' : ''}`}>
          {conversation.status === 'idle' ? t('logs.chat.conversationIdle') : null}
          {conversation.status === 'loading' ? loadingLine(t('logs.chat.loading')) : null}
          {conversation.status === 'error' ? muted(t('logs.chat.conversationFailed')) : null}
          {conversation.status === 'ready' && conversation.items.length === 0 ? muted(t('logs.chat.conversationEmpty')) : null}
          {conversation.status === 'ready'
            ? conversation.items.map((m) => (
              <article key={m.key} class="pm-audit-message">
                <div>
                  <strong data-no-translate>{m.senderLabel}</strong>
                  <small>{pmFormatTime(m.createdAt)}</small>
                </div>
                <p>{m.recalled ? t('logs.chat.recalled') : m.body}</p>
              </article>
            ))
            : null}
        </div>
      </section>

      <section class="pm-audit-card">
        <h3>{t('logs.chat.logTitle')}</h3>
        <div class="pm-audit-row">
          <select
            id="pm-audit-action"
            value={action}
            aria-label={t('logs.chat.allActions')}
            onChange={(e) => setAction(e.currentTarget.value)}
          >
            <option value="">{t('logs.chat.allActions')}</option>
            {PM_AUDIT_ACTIONS.map((key) => (
              <option key={key} value={key}>{t(`logs.chat.actions.${key}`)}</option>
            ))}
          </select>
          <button type="button" class="outline-btn small" onClick={() => void reloadLogs(actionRef.current)}>
            {t('logs.chat.refresh')}
          </button>
        </div>
        <div id="pm-audit-logs" class="pm-audit-results">
          {logs.status === 'loading' ? loadingLine(t('logs.chat.loading')) : null}
          {logs.status === 'error' ? muted(t('logs.chat.logsFailed')) : null}
          {logs.status === 'ready' && logs.items.length === 0 ? muted(t('logs.chat.logsEmpty')) : null}
          {logs.status === 'ready' && logs.items.length > 0 ? (
            <>
              {logs.items.map((log) => {
                const actor = pmAuditShortUid(log.actorUid);
                const target = pmAuditShortUid(log.targetUid);
                const route = target && target !== '-' ? `${actor} -> ${target}` : actor;
                const fullRoute = [log.actorUid, log.targetUid].filter(Boolean).join(' -> ');
                return (
                  <div key={log.key} class="pm-audit-log" title={fullRoute}>
                    <strong>{pmAuditActionLabel(log.action)}</strong>
                    <span data-no-translate>{route}</span>
                    <small>{pmFormatTime(log.createdAtIso) || pmFormatTime(log.createdAt)}</small>
                  </div>
                );
              })}
              {logs.hasMore || logs.loadingMore ? (
                <div class="pm-audit-load-more-row">
                  <button
                    type="button"
                    class="outline-btn small pm-audit-load-more"
                    disabled={logs.loadingMore}
                    onClick={() => void loadMoreLogs()}
                  >
                    {logs.loadingMore ? t('logs.chat.loading') : t('logs.chat.loadMore')}
                  </button>
                </div>
              ) : (
                <div class="pm-audit-log-end muted">{t('logs.chat.logsEnd')}</div>
              )}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
