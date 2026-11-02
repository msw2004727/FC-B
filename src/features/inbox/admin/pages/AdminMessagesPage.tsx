/**
 * 站內信管理（路由 `/admin/messages`）。DOM／class／行內樣式／文案照 A `pages/admin-content.html#page-admin-messages`
 * 與 `message-admin-list.js`（renderMsgManage、viewMsgDetail、recallMsg、deleteMsg、cancelScheduleMsg、restoreScheduleMsg）。
 *
 * - 權限照 A：進頁 `admin.messages.entry`；發送／刪除按鈕與 handler 共用 admin-message-model 的同一判斷（R-IAM-011）。
 * - 讀取預算：進頁 `adminMessages orderBy createdAt desc limit 50`＋四個狀態 `count()`＝≤ 54；「載入更多」每次 ≤ 50；
 *   改狀態 0 讀 1 寫，畫面與計數就地更新（不重讀）。
 * - 與 A 差異：
 *   - A 一次讀 200 份（不排序）；B 依建立時間分頁，計數用 count() 聚合（數字是全部信件，不受分頁影響）。
 *   - 回收確認框不再宣稱「收件人信箱中的信件將被移除」：收件人副本目前不會被移除（伺服器修正另卡，站長 2026-11-02 Q4）。
 *   - 寫入都等結果，失敗提示且畫面不變（A 先改畫面、失敗無提示）。
 */
import '@/styles/legacy/message.css';
import '@/styles/legacy/manage-status.css';
import '../legacy/message-admin.css';

import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

import { useGoBack } from '@/core/back-guard';
import { getLastKnownAuthUid } from '@/data/auth';
import { useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { EmptyState } from '@/ui/EmptyState';
import { toast } from '@/ui/Toast';
import { isViewerPermissionsLoaded } from '@/features/admin-users/data/viewer-ready';
import { useViewer } from '@/features/profile/data/viewer';

import {
  MSG_TABS,
  canAccessMessagesPage,
  canComposeMessage,
  canDeleteMessage,
  cardActionsOf,
  filterMessagesForTab,
  formatScheduleText,
  shiftCounts,
  statusBadgeOf,
  targetLabelOf,
  type AdminMessage,
  type MsgCardAction,
  type MsgCounts,
  type MsgTab,
} from '../data/admin-message-model';
import {
  countAdminMessages,
  loadAdminMessagesPage,
  removeOwnInboxCopies,
  updateAdminMessageStatus,
} from '../data/admin-messages-repo';
import { subscribeScheduledChanges } from '../data/scheduled-runner';
import { MessageComposeModal } from '../components/MessageComposeModal';
import { MessageDetailModal } from '../components/MessageDetailModal';
import { TemplateEditorModal } from '../components/TemplateEditorModal';

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: AdminMessage[]; cursor: QueryDocumentSnapshot | null; hasMore: boolean };

type ModalState = { kind: 'none' } | { kind: 'detail'; docId: string } | { kind: 'compose' } | { kind: 'templates' };

const BTN_STYLE = 'font-size:.72rem;padding:.2rem .5rem';

const ACTION_STYLE: Readonly<Record<MsgCardAction, string>> = {
  view: BTN_STYLE,
  recall: `${BTN_STYLE};color:var(--danger)`,
  delete: `${BTN_STYLE};color:var(--danger)`,
  cancelSchedule: `${BTN_STYLE};color:var(--warning)`,
  restoreSchedule: `${BTN_STYLE};color:var(--success)`,
};

export default function AdminMessagesPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const goBack = useGoBack('/');

  // 完整 viewer 到位前顯示骨架，不閃「權限不足」、不讀資料（同俱樂部管理頁）。
  const waiting = !viewer.uid ? getLastKnownAuthUid() !== null : !isViewerPermissionsLoaded(viewer);
  const canAccess = !waiting && canAccessMessagesPage(viewer);
  const showCompose = canComposeMessage(viewer);

  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [counts, setCounts] = useState<MsgCounts | null>(null);
  const [tab, setTab] = useState<MsgTab>('sent');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [busy, setBusy] = useState<Record<string, true>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const busyRef = useRef<Set<string>>(new Set());
  const alive = useRef(true);
  const loadSeq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!canAccess) return undefined;
    const seq = ++loadSeq.current;
    setList({ status: 'loading' });
    loadAdminMessagesPage().then(
      (page) => {
        if (seq === loadSeq.current) setList({ status: 'ready', ...page });
      },
      (err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[renderMsgManage] load failed:', err);
        if (seq === loadSeq.current) setList({ status: 'error' });
      },
    );
    countAdminMessages().then(
      (value) => {
        if (seq === loadSeq.current) setCounts(value);
      },
      (err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[renderMsgManage] count failed:', err);
      },
    );
    return () => {
      loadSeq.current += 1;
    };
  }, [canAccess, attempt]);

  const listRef = useRef(list);
  listRef.current = list;

  const patchStatus = useCallback((docId: string, status: string): void => {
    const current = listRef.current;
    if (current.status !== 'ready') return;
    const target = current.items.find((m) => m._docId === docId);
    if (!target || target.status === status) return;
    const next: ListState = { ...current, items: current.items.map((m) => (m._docId === docId ? { ...m, status } : m)) };
    listRef.current = next;
    setList(next);
    setCounts((c) => (c ? shiftCounts(c, target.status, status) : c));
  }, []);

  // 排程執行器（全站，admin 以上）送出或退回時同步畫面。
  useEffect(() => subscribeScheduledChanges((change) => patchStatus(change.docId, change.status)), [patchStatus]);

  const visible = useMemo(
    () => (list.status === 'ready' ? filterMessagesForTab(list.items, tab) : []),
    [list, tab],
  );

  const detailMessage = modal.kind === 'detail' && list.status === 'ready'
    ? list.items.find((m) => m._docId === modal.docId) ?? null
    : null;

  async function runExclusive(docId: string, action: () => Promise<void>): Promise<void> {
    if (busyRef.current.has(docId)) return;
    busyRef.current.add(docId);
    setBusy((prev) => ({ ...prev, [docId]: true }));
    try {
      await action();
    } finally {
      busyRef.current.delete(docId);
      if (alive.current) {
        setBusy((prev) => {
          const next = { ...prev };
          delete next[docId];
          return next;
        });
      }
    }
  }

  async function changeStatus(m: AdminMessage, status: string, successKey: string): Promise<boolean> {
    try {
      await updateAdminMessageStatus(m._docId, status);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[updateAdminMessage]', err);
      toast.show({ message: t('inbox.admin.toast.actionFailed'), tone: 'error' });
      return false;
    }
    if (alive.current) patchStatus(m._docId, status);
    toast.show({ message: t(successKey), tone: 'success' });
    return true;
  }

  function onAction(action: MsgCardAction, m: AdminMessage): void {
    if (action === 'view') {
      setModal({ kind: 'detail', docId: m._docId });
      return;
    }
    void runExclusive(m._docId, async () => {
      if (action === 'recall') {
        if (!(await appConfirm(t('inbox.admin.confirm.recall')))) return;
        if (await changeStatus(m, 'recalled', 'inbox.admin.toast.recalled')) {
          // A：同時刪除自己信箱裡的副本（收件人副本不動）。
          await removeOwnInboxCopies(viewer.uid ?? '', m.id);
        }
        return;
      }
      if (action === 'delete') {
        if (!canDeleteMessage(viewer)) {
          toast.show({ message: t('inbox.admin.toast.noPermission'), tone: 'error' });
          return;
        }
        if (!(await appConfirm(t('inbox.admin.confirm.delete')))) return;
        await changeStatus(m, 'deleted', 'inbox.admin.toast.deleted');
        return;
      }
      if (action === 'cancelSchedule') {
        if (!(await appConfirm(t('inbox.admin.confirm.cancelSchedule')))) return;
        await changeStatus(m, 'cancelled', 'inbox.admin.toast.cancelled');
        return;
      }
      if (action === 'restoreSchedule') {
        await changeStatus(m, 'scheduled', 'inbox.admin.toast.restored');
      }
    });
  }

  async function loadMore(): Promise<void> {
    if (loadingMore || list.status !== 'ready' || !list.hasMore || !list.cursor) return;
    const seq = loadSeq.current;
    setLoadingMore(true);
    try {
      const page = await loadAdminMessagesPage(list.cursor);
      if (seq !== loadSeq.current) return;
      setList((prev) => {
        if (prev.status !== 'ready') return prev;
        const seen = new Set(prev.items.map((m) => m._docId));
        return {
          status: 'ready',
          items: [...prev.items, ...page.items.filter((m) => !seen.has(m._docId))],
          cursor: page.cursor ?? prev.cursor,
          hasMore: page.hasMore,
        };
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[renderMsgManage] load more failed:', err);
      toast.show({ message: t('inbox.admin.loadError'), tone: 'error' });
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  }

  function onSaved(record: AdminMessage): void {
    setModal({ kind: 'none' });
    setList((prev) => (prev.status === 'ready' ? { ...prev, items: [record, ...prev.items] } : prev));
    setCounts((c) => (c ? shiftCounts(c, null, record.status) : c));
    setTab(record.status === 'scheduled' ? 'scheduled' : 'sent');
  }

  if (waiting) {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-admin-messages">
          <div role="status" aria-busy="true" style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">
            {t('inbox.admin.loading')}
          </div>
        </section>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-admin-messages">
          <EmptyState title={t('inbox.admin.permissionDenied')} />
        </section>
      </div>
    );
  }

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-admin-messages">
        <div class="page-header">
          <button type="button" class="back-btn" aria-label={t('inbox.admin.back')} onClick={goBack}>
            <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <h2>{t('inbox.admin.title')}</h2>
          <button type="button" class="primary-btn small" style="background:#3b82f6" onClick={() => setModal({ kind: 'templates' })}>
            {t('inbox.admin.editTemplates')}
          </button>
          {showCompose ? (
            <button type="button" class="primary-btn small" onClick={() => setModal({ kind: 'compose' })}>
              {t('inbox.admin.compose.open')}
            </button>
          ) : null}
        </div>
        <div id="msg-sent-count" style="text-align:right;font-size:.75rem;color:var(--text-muted);padding:0 .5rem .3rem">
          {counts ? t('inbox.admin.countSummary', { ...counts }) : null}
        </div>
        <div class="tab-bar" id="msg-manage-tabs" role="tablist">
          {MSG_TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              class={`tab${tab === key ? ' active' : ''}`}
              data-mfilter={key}
              onClick={() => setTab(key)}
            >
              {t(`inbox.admin.tabs.${key}`)}
            </button>
          ))}
        </div>
        <div class="card-list" id="msg-manage-list">
          {list.status === 'loading' ? (
            <div role="status" style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">
              {t('inbox.admin.loading')}
            </div>
          ) : null}
          {list.status === 'error' ? (
            <div role="alert" style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">
              <div>{t('inbox.admin.loadError')}</div>
              <button type="button" class="outline-btn" style="margin-top:.6rem" onClick={() => setAttempt((n) => n + 1)}>
                {t('inbox.admin.retry')}
              </button>
            </div>
          ) : null}
          {list.status === 'ready' && visible.length === 0 ? (
            <div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">{t('inbox.admin.empty')}</div>
          ) : null}
          {visible.map((m) => (
            <MessageCard key={m._docId} message={m} busy={Boolean(busy[m._docId])} actions={cardActionsOf(m.status, viewer)} onAction={onAction} />
          ))}
          {list.status === 'ready' && list.hasMore ? (
            <div style="display:flex;justify-content:center;padding:.6rem 0">
              <button type="button" class="outline-btn" disabled={loadingMore} onClick={() => void loadMore()}>
                {t(loadingMore ? 'inbox.admin.loading' : 'inbox.admin.loadMore')}
              </button>
            </div>
          ) : null}
        </div>
        {detailMessage ? <MessageDetailModal message={detailMessage} onClose={() => setModal({ kind: 'none' })} /> : null}
        {modal.kind === 'compose' ? (
          <MessageComposeModal
            viewer={{ uid: viewer.uid, role: viewer.role, displayName: viewer.displayName, hasPermission: viewer.hasPermission }}
            onClose={() => setModal({ kind: 'none' })}
            onSaved={onSaved}
          />
        ) : null}
        {modal.kind === 'templates' ? <TemplateEditorModal onClose={() => setModal({ kind: 'none' })} /> : null}
      </section>
    </div>
  );
}

interface MessageCardProps {
  message: AdminMessage;
  busy: boolean;
  actions: MsgCardAction[];
  onAction: (action: MsgCardAction, m: AdminMessage) => void;
}

function MessageCard({ message: m, busy, actions, onAction }: MessageCardProps): JSX.Element {
  const t = useT();
  const badge = statusBadgeOf(m.status);
  const schedule = m.scheduledAt ? formatScheduleText(m.scheduledAt) : '';
  const meta = [
    `${m.categoryName ? `[${m.categoryName}] ` : ''}${t('inbox.admin.targetLine', { target: targetLabelOf(m) })}`,
    String(m.time ?? ''),
  ].join(' ・ ');

  let scheduleInfo: JSX.Element | null = null;
  if (schedule && m.status === 'scheduled') {
    scheduleInfo = (
      <div style="font-size:.72rem;margin-top:.2rem;padding:.2rem .5rem;background:rgba(59,130,246,.1);color:#3b82f6;border-radius:4px;display:inline-block">
        {`\u{1F553} ${t('inbox.admin.scheduleAt', { time: schedule })}`}
      </div>
    );
  } else if (schedule && m.status === 'processing') {
    scheduleInfo = (
      <div style="font-size:.72rem;margin-top:.2rem;padding:.2rem .5rem;background:rgba(245,158,11,.12);color:#b45309;border-radius:4px;display:inline-block">
        {`\u{1F551} ${t('inbox.admin.processingAt', { time: schedule })}`}
      </div>
    );
  } else if (schedule && m.status === 'cancelled') {
    scheduleInfo = (
      <div style="font-size:.72rem;margin-top:.2rem;padding:.2rem .5rem;background:rgba(156,163,175,.15);color:var(--text-muted);border-radius:4px;display:inline-block;text-decoration:line-through">
        {`\u{1F553} ${t('inbox.admin.originalSchedule', { time: schedule })}`}
      </div>
    );
  }

  return (
    <div class="msg-manage-card" style="margin-bottom:.5rem" data-msg-id={m._docId}>
      <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
        <span class="msg-manage-title" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{m.title}</span>
        <span class={`banner-manage-status status-${badge.cls}`}>
          {badge.known ? t(`inbox.admin.status.${m.status}`) : m.status}
        </span>
      </div>
      <div style="font-size:.75rem;color:var(--text-muted)">
        {meta}
        {m.senderName ? (
          <>
            {' ・ '}
            <span data-no-translate>{t('inbox.admin.sender', { name: m.senderName })}</span>
          </>
        ) : null}
      </div>
      <div style="font-size:.75rem;color:var(--text-secondary);margin-top:.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        {m.body}
      </div>
      {scheduleInfo}
      <div style="display:flex;gap:.3rem;margin-top:.3rem">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            class={action === 'view' ? 'primary-btn small' : 'outline-btn'}
            style={ACTION_STYLE[action]}
            disabled={busy && action !== 'view'}
            onClick={() => onAction(action, m)}
          >
            {t(`inbox.admin.actions.${action}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
