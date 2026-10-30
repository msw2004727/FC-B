import '@/styles/legacy/admin-logs.css';
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useGoBack } from '@/core/back-guard';
import { useViewer } from '@/features/profile/data/viewer';
import { useT } from '@/i18n/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { toast } from '@/ui/Toast';
import {
  OPLOG_TYPE_GROUPS,
  filterOperationLogsList,
  findOperationLogByDocId,
  paginateOperationLogs,
} from '../data/log-center-model';
import {
  buildOperationLogDiagnosticText,
  copyDiagnosticTextToClipboard,
  fetchOperationLogs,
  formatOperationLogCreatedAt,
  getOperationLogActorUid,
  getOperationLogDocId,
  getOperationLogToneClass,
  type OperationLogDoc,
} from '../data/operation-logs';

type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * 後台「操作日誌」頁面（路由 `/admin/logs`），DOM／class 照 A `pages/admin-system.html` 的
 * `#page-admin-logs` 與 `user-admin-exp.js#renderOperationLogs`。
 * - 權限：需要 `admin.logs.entry`。
 * - 不實作 A 頁首的「一鍵清除」（`clearAllData`；Rules 也不允許刪除，且屬不可逆大批量刪除）。
 * - 暫不顯示頁籤列（稽核日誌、錯誤日誌等補齊後，頁籤與重新整理、功能說明按鈕一併回來）。
 * - 讀取失敗時顯示錯誤與重試（A 沒有此畫面，本卡新增，D1）。
 */
export default function AdminLogsPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();

  const canAccessPage = viewer.hasPermission('admin.logs.entry');
  // 照 A `goBackFromAdminLogs`：沒有上一頁時回數據儀表板（能進才回），否則回首頁。
  const goBack = useGoBack(viewer.hasPermission('admin.dashboard.entry') ? '/admin/ops' : '/');

  const [allLogs, setAllLogs] = useState<OperationLogDoc[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  const loadSeqRef = useRef(0);

  const loadOperationLogs = useCallback(async (): Promise<void> => {
    const seq = ++loadSeqRef.current;
    setStatus('loading');
    try {
      const docs = await fetchOperationLogs();
      if (seq !== loadSeqRef.current) return;
      setAllLogs(docs);
      setStatus('ready');
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[loadOperationLogs]', err);
      if (seq !== loadSeqRef.current) return;
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!canAccessPage) return undefined;
    loadOperationLogs().catch(() => {
      // loadOperationLogs 內部已捕捉錯誤。
    });
    return () => {
      // 離開頁面或權限消失後，晚到的結果不再寫入狀態。
      loadSeqRef.current += 1;
    };
  }, [canAccessPage, loadOperationLogs]);

  const filteredLogs = useMemo(
    () => filterOperationLogsList(allLogs, { keyword, typeFilter }),
    [allLogs, keyword, typeFilter],
  );

  const paginated = useMemo(
    () => paginateOperationLogs(filteredLogs, page),
    [filteredLogs, page],
  );

  async function handleCopyDiagnostic(docId: string): Promise<void> {
    const log = findOperationLogByDocId(docId, filteredLogs, allLogs);
    if (!log) {
      toast.show({ message: t('logs.operation.copyNotFound'), tone: 'error' });
      return;
    }
    const text = buildOperationLogDiagnosticText(log, {
      header: t('logs.operation.diagnostic.header'),
      timeLabel: t('logs.operation.detail.time'),
      typeLabel: t('logs.operation.detail.type'),
      operatorLabel: t('logs.operation.detail.operator'),
      contentLabel: t('logs.operation.detail.content'),
      eventIdLabel: t('logs.operation.detail.eventId'),
      docIdLabel: t('logs.operation.detail.docId'),
      uncategorized: t('logs.operation.uncategorized'),
      unmarked: t('logs.operation.unmarked'),
      none: t('logs.operation.none'),
    });
    try {
      await copyDiagnosticTextToClipboard(text);
      toast.show({ message: t('logs.operation.copySuccess'), tone: 'success' });
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[copyOperationLogDiagnostic]', err);
      toast.show({ message: t('logs.operation.copyError'), tone: 'error' });
    }
  }

  if (!canAccessPage) {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-admin-logs">
          <EmptyState
            title={t('logs.permissionDenied')}
            body={t('logs.permissionDeniedBody')}
          />
        </section>
      </div>
    );
  }

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-admin-logs">
        <div class="page-header">
          <button type="button" class="back-btn" aria-label={t('logs.back')} onClick={goBack}>
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
          <h2>{t('logs.tabs.operation.title')}</h2>
        </div>

        <div class="admin-log-panels">
          <section class="admin-log-panel" data-admin-log-panel="operation">
            <div class="admin-search">
              <input
                type="text"
                id="oplog-search"
                value={keyword}
                placeholder={t('logs.operation.searchPlaceholder')}
                aria-label={t('logs.operation.searchPlaceholder')}
                onInput={(e) => {
                  setKeyword(e.currentTarget.value);
                  setPage(1);
                }}
              />
              <div class="admin-filters">
                <select
                  id="oplog-type-filter"
                  value={typeFilter}
                  aria-label={t('logs.operation.allTypes')}
                  onChange={(e) => {
                    setTypeFilter(e.currentTarget.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('logs.operation.allTypes')}</option>
                  {OPLOG_TYPE_GROUPS.map((group) => (
                    <optgroup key={group.groupKey} label={t(group.labelKey)}>
                      {group.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t(opt.labelKey)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>

            <div class="log-list" id="operation-log-list">
              {status === 'loading' ? (
                <div
                  role="status"
                  style="text-align:center;padding:2rem;color:var(--text-muted)"
                >
                  {t('logs.operation.loading')}
                </div>
              ) : status === 'error' ? (
                <div
                  role="alert"
                  style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem"
                >
                  <div>{t('logs.operation.loadError')}</div>
                  <button
                    type="button"
                    class="outline-btn"
                    style="margin-top:.65rem"
                    onClick={() => {
                      loadOperationLogs().catch(() => {
                        // loadOperationLogs 內部已捕捉錯誤。
                      });
                    }}
                  >
                    {t('logs.operation.retry')}
                  </button>
                </div>
              ) : paginated.totalCount === 0 ? (
                <div style="text-align:center;padding:2rem;color:var(--text-muted)">
                  {t('logs.operation.empty')}
                </div>
              ) : (
                <>
                  {paginated.pageItems.map((l, idx) => {
                    const tone = getOperationLogToneClass(l.type);
                    const docId = getOperationLogDocId(l);
                    const unmarked = t('logs.operation.unmarked');
                    const createdLabel = formatOperationLogCreatedAt(l, unmarked);
                    const actorUid = getOperationLogActorUid(l);
                    const eventId = String(l.eventId || '').trim();
                    const type = String(l.type || '').trim();
                    const typeName = String(
                      l.typeName || type || t('logs.operation.uncategorized'),
                    ).trim();
                    const operator = String(l.operator || unmarked).trim();
                    const content = String(l.content || unmarked).trim();

                    return (
                      <div
                        key={docId || `oplog-${idx}`}
                        class={`log-item operation-log-item oplog-row-${tone}`}
                      >
                        <div class="operation-log-main">
                          <span class="log-time">{l.time || createdLabel}</span>
                          <span class="log-content">
                            <span class={`log-type ${tone}`}>{typeName}</span>
                            <span class="operation-log-action-text">{`${operator}：${content}`}</span>
                          </span>
                        </div>
                        <div class="operation-log-meta">
                          <span>{`${t('logs.operation.meta.operator')}：${operator}`}</span>
                          <span>{`${t('logs.operation.meta.uid')}：${actorUid || unmarked}`}</span>
                          <span>{`${t('logs.operation.meta.type')}：${type || unmarked}`}</span>
                          {eventId ? (
                            <span>{`${t('logs.operation.meta.event')}：${eventId}`}</span>
                          ) : null}
                          {docId ? (
                            <span>{`${t('logs.operation.meta.doc')}：${docId}`}</span>
                          ) : null}
                        </div>
                        <details class="operation-log-details">
                          <summary>{t('logs.operation.viewDetails')}</summary>
                          <div class="operation-log-detail-grid">
                            <div class="operation-log-detail-row">
                              <span>{t('logs.operation.detail.time')}</span>
                              <pre>{createdLabel}</pre>
                            </div>
                            <div class="operation-log-detail-row">
                              <span>{t('logs.operation.detail.type')}</span>
                              <pre>{`${typeName}${type ? `（${type}）` : ''}`}</pre>
                            </div>
                            <div class="operation-log-detail-row">
                              <span>{t('logs.operation.detail.content')}</span>
                              <pre>{content}</pre>
                            </div>
                            <div class="operation-log-detail-row">
                              <span>{t('logs.operation.detail.operator')}</span>
                              <pre>{`${operator} / ${actorUid || unmarked}`}</pre>
                            </div>
                            <div class="operation-log-detail-row">
                              <span>{t('logs.operation.detail.eventId')}</span>
                              <pre class="is-mono">{eventId || t('logs.operation.none')}</pre>
                            </div>
                            {docId ? (
                              <div class="operation-log-detail-row">
                                <span>{t('logs.operation.detail.docId')}</span>
                                <pre class="is-mono">{docId}</pre>
                              </div>
                            ) : null}
                          </div>
                          {docId ? (
                            <button
                              type="button"
                              class="outline-btn operation-log-copy-btn"
                              data-operation-doc-id={docId}
                              onClick={() => {
                                handleCopyDiagnostic(docId).catch(() => {
                                  // 已於 handleCopyDiagnostic 內處理
                                });
                              }}
                            >
                              {t('logs.operation.copyDiagnostic')}
                            </button>
                          ) : null}
                        </details>
                      </div>
                    );
                  })}

                  {paginated.totalPages > 1 && (
                    <div style="display:flex;justify-content:center;align-items:center;gap:.5rem;padding:.8rem 0;font-size:.78rem">
                      <button
                        type="button"
                        class="outline-btn"
                        style="font-size:.72rem;padding:.25rem .6rem"
                        disabled={paginated.safePage <= 1}
                        onClick={() => setPage(paginated.safePage - 1)}
                      >
                        {t('logs.operation.prevPage')}
                      </button>
                      <span style="color:var(--text-muted)">
                        {t('logs.operation.pageSummary', {
                          page: paginated.safePage,
                          totalPages: paginated.totalPages,
                          total: paginated.totalCount,
                        })}
                      </span>
                      <button
                        type="button"
                        class="outline-btn"
                        style="font-size:.72rem;padding:.25rem .6rem"
                        disabled={paginated.safePage >= paginated.totalPages}
                        onClick={() => setPage(paginated.safePage + 1)}
                      >
                        {t('logs.operation.nextPage')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
