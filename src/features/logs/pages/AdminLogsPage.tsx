import './admin-logs.css';
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useUserRoles } from '@/data/user-roles';
import { useViewer } from '@/features/profile/data/viewer';
import { useT } from '@/i18n/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';
import { UserTag } from '@/ui/UserTag';
import {
  OPLOG_TYPE_GROUPS,
  filterOperationLogsList,
  findOperationLogByDocId,
  getAvailableAdminLogTabs,
  normalizeAdminLogTab,
  paginateOperationLogs,
  type AdminLogTabKey,
} from '../data/log-center-model';
import {
  buildOperationLogDiagnosticText,
  copyDiagnosticTextToClipboard,
  fetchOperationLogs,
  formatOperationLogCreatedAt,
  getOperationLogDocId,
  getOperationLogToneClass,
  type OperationLogDoc,
} from '../data/operation-logs';

const LEGACY_SITE_URL = 'https://toosterx.com/';

/**
 * 後台「日誌中心」頁面（路由 `/admin/logs`）。
 * - 權限：需要 `admin.logs.entry`。
 * - 不實作 A 頁首的「一鍵清除」（`clearAllData`，刪資料屬站長專屬授權）。
 * - 本批只實作「操作日誌」分頁；稽核日誌、錯誤日誌、用戶提示、聊天室稽核將於下一批補齊。
 */
export default function AdminLogsPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const location = useLocation();

  const canAccessPage = viewer.hasPermission('admin.logs.entry');

  const availableTabs = useMemo(
    () => getAvailableAdminLogTabs(viewer.role),
    [viewer.role],
  );

  const [activeTab, setActiveTab] = useState<AdminLogTabKey>('operation');
  const safeActiveTab = useMemo(
    () => normalizeAdminLogTab(activeTab, viewer.role),
    [activeTab, viewer.role],
  );

  const [allLogs, setAllLogs] = useState<OperationLogDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [infoModalOpen, setInfoModalOpen] = useState(false);

  const loadSeqRef = useRef(0);
  const refreshingRef = useRef(false);

  const loadOperationLogs = useCallback(
    async (isManualRefresh: boolean): Promise<void> => {
      if (isManualRefresh) {
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const seq = ++loadSeqRef.current;
      try {
        const docs = await fetchOperationLogs();
        if (seq !== loadSeqRef.current) return;
        setAllLogs(docs);
        if (isManualRefresh) {
          setPage(1);
          toast.show({ message: t('logs.operation.refreshSuccess'), tone: 'success' });
        }
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[refreshOperationLogs]', err);
        if (seq !== loadSeqRef.current) return;
        if (isManualRefresh) {
          toast.show({ message: t('logs.operation.refreshError'), tone: 'error' });
        }
      } finally {
        if (seq === loadSeqRef.current) {
          setLoading(false);
        }
        if (isManualRefresh) {
          refreshingRef.current = false;
          setRefreshing(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    if (!canAccessPage) return;
    loadOperationLogs(false).catch(() => {
      // loadOperationLogs 內部已捕捉錯誤。
    });
  }, [canAccessPage, loadOperationLogs]);

  const filteredLogs = useMemo(
    () => filterOperationLogsList(allLogs, { keyword, typeFilter }),
    [allLogs, keyword, typeFilter],
  );

  const paginated = useMemo(
    () => paginateOperationLogs(filteredLogs, page),
    [filteredLogs, page],
  );

  // R-ID-002：僅對有 actorUid 的日誌以 UID 查詢使用者角色，不用 operator 名字反查。
  const pageActorUids = useMemo(
    () =>
      canAccessPage
        ? paginated.pageItems
            .map((l) => String(l.actorUid || '').trim())
            .filter(Boolean)
        : [],
    [canAccessPage, paginated.pageItems],
  );
  const roles = useUserRoles(pageActorUids);

  const activeTabInfo = useMemo(() => {
    const found = availableTabs.find((item) => item.key === safeActiveTab) ?? availableTabs[0];
    return {
      title: found ? t(found.titleKey) : t('logs.tabs.operation.title'),
      desc: found ? t(found.descKey) : t('logs.tabs.operation.desc'),
    };
  }, [availableTabs, safeActiveTab, t]);

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

  function handleRefreshActiveTab(): void {
    if (safeActiveTab === 'operation') {
      loadOperationLogs(true).catch(() => {
        // 已於 loadOperationLogs 內處理
      });
    }
  }

  if (!canAccessPage) {
    return (
      <section class="page admin-logs-page" id="page-admin-logs">
        <EmptyState
          title={t('logs.permissionDenied')}
          body={t('logs.permissionDeniedBody')}
        />
      </section>
    );
  }

  return (
    <section class="page admin-logs-page" id="page-admin-logs" data-log-center-ready="1">
      <div class="page-header admin-logs-header">
        <button
          type="button"
          class="back-btn admin-logs-back-btn"
          aria-label={t('logs.back')}
          onClick={() => location.route('/profile')}
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
        <Text as="h2" class="admin-logs-heading">
          {t('logs.centerTitle')}
        </Text>
      </div>

      <div class="tab-bar admin-log-tabs" id="admin-log-tabs" role="tablist" aria-label={t('logs.centerTitle')}>
        {availableTabs.map((tab) => {
          const isActive = tab.key === safeActiveTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              class={`tab${isActive ? ' active' : ''}`}
              data-admin-log-tab={tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              <Text>{t(tab.titleKey)}</Text>
            </button>
          );
        })}
        <button
          type="button"
          class="admin-log-info-btn"
          id="admin-log-refresh-btn"
          title={t('logs.actions.refresh')}
          aria-label={t('logs.actions.refresh')}
          disabled={refreshing}
          onClick={handleRefreshActiveTab}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
        <button
          type="button"
          class="admin-log-info-btn"
          id="admin-log-info-btn"
          title={t('logs.actions.info')}
          aria-label={t('logs.actions.info')}
          onClick={() => setInfoModalOpen(true)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
      </div>

      <div class="admin-log-panels">
        {/* 操作日誌分頁 */}
        <section
          class="admin-log-panel"
          data-admin-log-panel="operation"
          hidden={safeActiveTab !== 'operation'}
        >
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
              {/* 原生 <option> 與 <optgroup> 不允許放入 <Text> 的 span/wbr（L-28 例外） */}
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
            {loading && allLogs.length === 0 ? (
              <div class="operation-log-empty" role="status">
                <Text>{t('logs.operation.loading')}</Text>
              </div>
            ) : paginated.totalCount === 0 ? (
              <div class="operation-log-empty">
                <Text>{t('logs.operation.empty')}</Text>
              </div>
            ) : (
              <>
                {paginated.pageItems.map((l, idx) => {
                  const tone = getOperationLogToneClass(l.type);
                  const docId = getOperationLogDocId(l);
                  const unmarked = t('logs.operation.unmarked');
                  const createdLabel = formatOperationLogCreatedAt(l, unmarked);
                  const actorUid = String(l.actorUid || '').trim();
                  const eventId = String(l.eventId || '').trim();
                  const type = String(l.type || '').trim();
                  const typeName = String(
                    l.typeName || type || t('logs.operation.uncategorized'),
                  ).trim();
                  const operator = String(l.operator || unmarked).trim();
                  const content = String(l.content || unmarked).trim();
                  const itemKey = docId || `oplog-${idx}`;

                  return (
                    <div
                      key={itemKey}
                      class={`log-item operation-log-item oplog-row-${tone}`}
                    >
                      <div class="operation-log-main">
                        <span class="log-time">
                          <Text>{l.time || createdLabel}</Text>
                        </span>
                        <span class="log-content">
                          <span class={`log-type ${tone}`}>
                            <Text>{typeName}</Text>
                          </span>
                          <span class="operation-log-action-text">
                            <Text>{`${operator}：${content}`}</Text>
                          </span>
                        </span>
                      </div>

                      <div class="operation-log-meta">
                        <span class="operation-log-operator-meta">
                          <Text>{`${t('logs.operation.meta.operator')}：`}</Text>
                          {actorUid ? (
                            <UserTag
                              uid={actorUid}
                              name={operator}
                              role={roles[actorUid]}
                              onOpenProfile={(uid) => {
                                if (uid) location.route(`/profile/${encodeURIComponent(uid)}`);
                              }}
                            />
                          ) : (
                            <Text>{operator}</Text>
                          )}
                        </span>
                        <span>
                          <Text>{`${t('logs.operation.meta.uid')}：${actorUid || unmarked}`}</Text>
                        </span>
                        <span>
                          <Text>{`${t('logs.operation.meta.type')}：${type || unmarked}`}</Text>
                        </span>
                        {eventId && (
                          <span>
                            <Text>{`${t('logs.operation.meta.event')}：${eventId}`}</Text>
                          </span>
                        )}
                        {docId && (
                          <span>
                            <Text>{`${t('logs.operation.meta.doc')}：${docId}`}</Text>
                          </span>
                        )}
                      </div>

                      <details class="operation-log-details">
                        <summary>
                          <Text>{t('logs.operation.viewDetails')}</Text>
                        </summary>
                        <div class="operation-log-detail-grid">
                          <div class="operation-log-detail-row">
                            <span>
                              <Text>{t('logs.operation.detail.time')}</Text>
                            </span>
                            <pre>
                              <Text>{createdLabel}</Text>
                            </pre>
                          </div>
                          <div class="operation-log-detail-row">
                            <span>
                              <Text>{t('logs.operation.detail.type')}</Text>
                            </span>
                            <pre>
                              <Text>{`${typeName}${type ? `（${type}）` : ''}`}</Text>
                            </pre>
                          </div>
                          <div class="operation-log-detail-row">
                            <span>
                              <Text>{t('logs.operation.detail.content')}</Text>
                            </span>
                            <pre>
                              <Text>{content}</Text>
                            </pre>
                          </div>
                          <div class="operation-log-detail-row">
                            <span>
                              <Text>{t('logs.operation.detail.operator')}</Text>
                            </span>
                            <pre>
                              <Text>{`${operator} / ${actorUid || unmarked}`}</Text>
                            </pre>
                          </div>
                          <div class="operation-log-detail-row">
                            <span>
                              <Text>{t('logs.operation.detail.eventId')}</Text>
                            </span>
                            <pre class="is-mono">
                              <Text>{eventId || t('logs.operation.none')}</Text>
                            </pre>
                          </div>
                          {docId && (
                            <div class="operation-log-detail-row">
                              <span>
                                <Text>{t('logs.operation.detail.docId')}</Text>
                              </span>
                              <pre class="is-mono">
                                <Text>{docId}</Text>
                              </pre>
                            </div>
                          )}
                        </div>
                        {docId && (
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
                            <Text>{t('logs.operation.copyDiagnostic')}</Text>
                          </button>
                        )}
                      </details>
                    </div>
                  );
                })}

                {paginated.totalPages > 1 && (
                  <div class="operation-log-pagination">
                    <button
                      type="button"
                      class="outline-btn operation-log-page-btn"
                      disabled={paginated.safePage <= 1}
                      onClick={() => setPage(paginated.safePage - 1)}
                    >
                      <Text>{t('logs.operation.prevPage')}</Text>
                    </button>
                    <span class="operation-log-page-info">
                      <Text>
                        {t('logs.operation.pageSummary', {
                          page: paginated.safePage,
                          totalPages: paginated.totalPages,
                          total: paginated.totalCount,
                        })}
                      </Text>
                    </span>
                    <button
                      type="button"
                      class="outline-btn operation-log-page-btn"
                      disabled={paginated.safePage >= paginated.totalPages}
                      onClick={() => setPage(paginated.safePage + 1)}
                    >
                      <Text>{t('logs.operation.nextPage')}</Text>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* 其餘四個分頁（audit / error / prompt / chat）下一批補實作，本批顯示說明與前往舊版連結 */}
        {availableTabs
          .filter((tab) => tab.key !== 'operation')
          .map((tab) => (
            <section
              key={tab.key}
              class="admin-log-panel"
              data-admin-log-panel={tab.key}
              hidden={safeActiveTab !== tab.key}
            >
              <div class="admin-log-legacy-placeholder">
                <Text as="p" class="admin-log-legacy-desc">
                  {t(tab.descKey)}
                </Text>
                <Text as="p" class="admin-log-legacy-note">
                  {t('logs.legacyFallback.body')}
                </Text>
                <a
                  href={LEGACY_SITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="outline-btn admin-log-legacy-link"
                >
                  <Text>{t('logs.legacyFallback.linkLabel')}</Text>
                </a>
              </div>
            </section>
          ))}
      </div>

      {/* 說明 Modal（照 A showAdminLogInfo） */}
      {infoModalOpen && (
        <div
          class="admin-log-info-overlay open"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-log-info-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInfoModalOpen(false);
          }}
        >
          <div class="admin-log-info-modal open">
            <div class="modal-header">
              <h3 id="admin-log-info-title" class="admin-log-info-title">
                <Text>{activeTabInfo.title}</Text>
              </h3>
              <button
                type="button"
                class="modal-close"
                aria-label={t('logs.actions.closeInfo')}
                onClick={() => setInfoModalOpen(false)}
              >
                &times;
              </button>
            </div>
            <div class="modal-body">
              <p class="admin-log-info-desc">
                <Text>{activeTabInfo.desc}</Text>
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
