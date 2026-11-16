/**
 * 日誌中心「聊天室稽核」頁籤（2026-11-16 改版，站長：log 要 UID＋暱稱、點了直接看對話、時間區間與每頁筆數；顧問 §3.195 案 A）。
 * - 只限 super_admin（頁籤本身只對 super_admin 顯示；資料全走既有 super_admin Callable，權限不放寬）。
 * - Log 為主列表：每列暱稱＋UID 短碼，可點列直接開唯讀對話抽屜；點暱稱篩「操作者」或「對象」（一次一個鍵）。
 * - 時間區間（日／週／月）與每頁筆數（10／20／30／無限）見 usePmAuditPages。
 * - 「隱藏稽核查詢紀錄」只在前端藏管理員自查紀錄；藏完不足一頁也不自動抓下一頁。
 * - 私訊設定收進齒輪抽屜，打開時才讀；看完對話不自動重載 log。
 * - 暱稱查詢見 `pm-audit-names.ts`（只放記憶體）；完整 UID 只在抽屜內複製，不進網址／console。
 */
import '@/styles/legacy/message.css';
import '@/styles/legacy/reg-loading.css';
import './pm-audit.css';

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';

import { rangeContaining, type LogRange, type PageSizeOption } from '../data/log-range';
import {
  listPmThreads,
  loadPmConversation,
  searchPmUsers,
  type PmAuditLog,
  type PmAuditThread,
  type PmAuditUser,
} from '../data/pm-audit';
import { PM_AUDIT_FILTER_ACTIONS } from '../data/pm-audit-actions';
import { resolvePmUserNames, type NameResolver } from '../data/pm-audit-names';
import { collectLogUids, isSelfAudit, shortUid, splitTargetUids, type PmAuditFilter } from '../data/pm-audit-view';
import { InfiniteSentinel } from './InfiniteSentinel';
import { LogPager, LogRangeBar } from './LogRangeBar';
import { PmAuditFinder, type FinderBox } from './PmAuditFinder';
import { PmAuditLogList } from './PmAuditLogList';
import { PmAuditSettingsControl } from './PmAuditSettingsControl';
import { PmConversationSheet, type ConversationBox } from './PmConversationSheet';
import { usePmAuditPages } from './usePmAuditPages';

export interface PmAuditPanelProps {
  /** 測試／harness 注入；預設查 Firestore `users`。 */
  resolveNames?: NameResolver;
  /** 測試／harness 注入「現在」。 */
  nowMs?: number;
}

export function PmAuditPanel(props: PmAuditPanelProps): JSX.Element {
  const t = useT();
  const resolveNames = props.resolveNames ?? resolvePmUserNames;
  const nowMs = props.nowMs ?? Date.now();
  const [filter, setFilter] = useState<PmAuditFilter>({ kind: 'all' });
  const [range, setRange] = useState<LogRange>(() => rangeContaining('week', nowMs));
  const [pageSize, setPageSize] = useState<PageSizeOption>(10);
  const [pageIdx, setPageIdx] = useState(0);
  const [hideSelf, setHideSelf] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const [convo, setConvo] = useState<ConversationBox>({ status: 'closed' });
  const [users, setUsers] = useState<FinderBox<PmAuditUser>>({ status: 'idle' });
  const [threads, setThreads] = useState<FinderBox<PmAuditThread>>({ status: 'idle' });

  const alive = useRef(true);
  const convoSeq = useRef(0);
  const finderSeq = useRef(0);
  const openingRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function addNames(logs: PmAuditLog[]): void {
    const uids = collectLogUids(logs);
    if (uids.length === 0) return;
    resolveNames(uids)
      .then((found) => {
        if (alive.current) setNames((prev) => ({ ...prev, ...found }));
      })
      .catch(() => undefined); // 查不到暱稱不影響 log；不把 UID 印進 console
  }

  const pages = usePmAuditPages(filter, range, pageSize, addNames);
  const { state } = pages;

  function applyFilter(next: PmAuditFilter): void {
    setPageIdx(0);
    setFilter(next);
  }

  async function openConversation(conversationId: string, uids: string[]): Promise<void> {
    if (openingRef.current) return; // 防連點：每次呼叫後端都會寫一筆稽核
    openingRef.current = true;
    const mySeq = ++convoSeq.current;
    setConvo({ status: 'loading', uids });
    try {
      const data = await loadPmConversation(conversationId);
      if (alive.current && mySeq === convoSeq.current) setConvo({ status: 'ready', uids, data });
    } catch {
      if (alive.current && mySeq === convoSeq.current) setConvo({ status: 'error', uids });
    } finally {
      openingRef.current = false;
    }
  }

  function openFromLog(log: PmAuditLog): void {
    const targets = splitTargetUids(log);
    const uids = log.action === 'audit_view_conversation' ? targets : [log.actorUid, ...targets].filter(Boolean);
    openConversation(log.conversationId, uids).catch(() => undefined);
  }

  async function searchUsers(q: string): Promise<void> {
    const mySeq = ++finderSeq.current;
    setUsers({ status: 'loading' });
    setThreads({ status: 'idle' });
    try {
      const found = await searchPmUsers(q);
      if (alive.current && mySeq === finderSeq.current) setUsers({ status: 'ready', items: found });
    } catch {
      if (alive.current && mySeq === finderSeq.current) setUsers({ status: 'error' });
    }
  }

  async function showThreads(uid: string): Promise<void> {
    const mySeq = ++finderSeq.current;
    setThreads({ status: 'loading' });
    try {
      const list = await listPmThreads(uid);
      if (alive.current && mySeq === finderSeq.current) setThreads({ status: 'ready', items: list });
    } catch {
      if (alive.current && mySeq === finderSeq.current) setThreads({ status: 'error' });
    }
  }

  const infinite = pageSize === 'infinite';
  const byAction = filter.kind === 'action';
  const raw = infinite ? state.chunks.flat() : (state.chunks[pageIdx] ?? []);
  const visible = hideSelf && !byAction ? raw.filter((log) => !isSelfAudit(log, false)) : raw;
  const hiddenCount = raw.length - visible.length;
  const lastChunk = state.chunks[state.chunks.length - 1] ?? [];
  const lastChunkVisible = hideSelf && !byAction ? lastChunk.some((log) => !isSelfAudit(log, false)) : lastChunk.length > 0;
  const hasNextPage = pageIdx + 1 < state.chunks.length || !state.done;
  const personUid = filter.kind === 'actor' || filter.kind === 'target' ? filter.uid : '';
  const personLabel = personUid ? `${names[personUid] || t('logs.chat.unknownUser')} ${shortUid(personUid)}` : '';

  async function nextPage(): Promise<void> {
    const target = pageIdx + 1;
    if (target < state.chunks.length) {
      setPageIdx(target);
      return;
    }
    if (state.done) return;
    // 抓成功才換頁；失敗留在原頁（顧問 §3.196：原型先換頁、失敗會頁碼錯位）。
    if (await pages.more()) setPageIdx(target);
  }

  function loadMore(): void {
    pages.more().catch(() => undefined);
  }

  return (
    <div class="pma-layout">
      <div class="pma-toolbar">
        <PmAuditFinder
          users={users}
          threads={threads}
          onSearch={(q) => { searchUsers(q).catch(() => undefined); }}
          onPickUser={(uid) => { showThreads(uid).catch(() => undefined); }}
          onPickThread={(thread) => { openConversation(thread.id, thread.participants).catch(() => undefined); }}
          onClear={() => {
            finderSeq.current += 1;
            setUsers({ status: 'idle' });
            setThreads({ status: 'idle' });
          }}
        />
        <PmAuditSettingsControl />
      </div>

      <div class="pma-filters">
        <select
          id="pm-audit-action"
          class="pma-select"
          value={byAction ? filter.action : ''}
          aria-label={t('logs.chat.allActions')}
          onChange={(e) => {
            const v = e.currentTarget.value;
            applyFilter(v ? { kind: 'action', action: v } : { kind: 'all' });
          }}
        >
          <option value="">{t('logs.chat.allActions')}</option>
          {PM_AUDIT_FILTER_ACTIONS.map((key) => (
            <option key={key} value={key}>{t(`logs.chat.actions.${key}`)}</option>
          ))}
        </select>
        <label class={`pma-chip pma-toggle${hideSelf && !byAction ? ' is-on' : ''}${byAction ? ' is-disabled' : ''}`}>
          <input type="checkbox" checked={hideSelf && !byAction} disabled={byAction} onChange={(e) => setHideSelf(e.currentTarget.checked)} />
          <span>{t('logs.chat.hideSelfAudit')}</span>
        </label>
        <button type="button" class="pma-icon-btn" aria-label={t('logs.chat.refresh')} onClick={() => { setPageIdx(0); pages.reload(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>

      <LogRangeBar
        range={range}
        pageSize={pageSize}
        nowMs={nowMs}
        onRange={(next) => { setPageIdx(0); setRange(next); }}
        onPageSize={(next) => { setPageIdx(0); setPageSize(next); }}
      />

      {personUid ? (
        <div class="pma-active-filter">
          <span class="pma-chip is-active" data-no-translate>
            {t(filter.kind === 'actor' ? 'logs.chat.filterActorChip' : 'logs.chat.filterTargetChip', { name: personLabel })}
          </span>
          <button type="button" class="pma-chip-clear" onClick={() => applyFilter({ kind: 'all' })}>{t('logs.chat.clearFilter')}</button>
        </div>
      ) : null}

      {state.status === 'loading' || (state.loadingMore && !infinite && raw.length === 0) ? (
        <div class="reg-loading" role="status">{t('logs.chat.loading')}</div>
      ) : null}
      {state.status === 'error' ? (
        <div class="pma-note" role="alert">
          <span>{t('logs.chat.logsFailed')}</span>
          <button type="button" class="pma-chip-clear" onClick={pages.reload}>{t('logs.chat.retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' && visible.length === 0 && !state.loadingMore ? <div class="pma-note">{t('logs.chat.logsEmpty')}</div> : null}
      {state.status === 'ready' && visible.length > 0 ? (
        <PmAuditLogList
          logs={visible}
          names={names}
          onFilterActor={(uid) => applyFilter({ kind: 'actor', uid })}
          onFilterTarget={(uid) => applyFilter({ kind: 'target', uid })}
          onOpenConversation={openFromLog}
        />
      ) : null}
      {state.status === 'ready' && hiddenCount > 0 ? <div class="pma-note">{t('logs.chat.hiddenCount', { count: hiddenCount })}</div> : null}

      {state.status === 'ready' && infinite && !state.done ? (
        <>
          <InfiniteSentinel enabled={!state.loadingMore && lastChunkVisible} onReach={loadMore} />
          <div class="pm-audit-load-more-row">
            <button type="button" class="pma-more" disabled={state.loadingMore} onClick={loadMore}>
              {state.loadingMore ? t('logs.chat.loading') : t('logs.chat.loadMore')}
            </button>
          </div>
        </>
      ) : null}
      {state.status === 'ready' && !infinite ? (
        <LogPager
          page={pageIdx + 1}
          hasPrev={pageIdx > 0}
          hasNext={hasNextPage}
          busy={state.loadingMore}
          onPrev={() => setPageIdx(Math.max(0, pageIdx - 1))}
          onNext={() => { nextPage().catch(() => undefined); }}
        />
      ) : null}
      {state.status === 'ready' && state.truncated ? <div class="pma-note lc-warn">{t('logs.range.truncated')}</div> : null}
      {state.status === 'ready' && infinite && state.done && !state.truncated && visible.length > 0 ? <div class="pma-note">{t('logs.chat.logsEnd')}</div> : null}

      <PmConversationSheet
        box={convo}
        names={names}
        onClose={() => {
          convoSeq.current += 1;
          setConvo({ status: 'closed' });
        }}
      />
    </div>
  );
}
