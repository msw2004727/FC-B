import '@/styles/legacy/admin-logs.css';
import '../legacy/admin-log-tabs.css';
import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useGoBack } from '@/core/back-guard';
import { getLastKnownAuthUid } from '@/data/auth';
import { isViewerPermissionsLoaded } from '@/features/admin-users/data/viewer-ready';
import { useViewer } from '@/features/profile/data/viewer';
import { useT } from '@/i18n/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { PageSpinner } from '@/ui/PageSpinner';
// 為什麼：日誌中心五頁接線，稽核／錯誤／用戶提示面板（顧問 §3.200 第 6 項）。
import { AuditLogPanel } from '../components/AuditLogPanel';
import { ErrorLogPanel } from '../components/ErrorLogPanel';
import { OperationLogPanel } from '../components/OperationLogPanel';
import { PmAuditPanel } from '../components/PmAuditPanel';
import { UserPromptPanel } from '../components/UserPromptPanel';
import { getAvailableAdminLogTabs, type AdminLogTabKey } from '../data/log-center-model';

/** 為什麼：五個頁籤都已接線；稽核／錯誤／用戶提示依權限顯示（顧問 §3.200 第 6 項）。 */
const BUILT_LOG_TABS: readonly AdminLogTabKey[] = ['operation', 'audit', 'error', 'prompt', 'chat'];

/**
 * 後台「日誌中心」頁面（路由 `/admin/logs`），外框照 A `pages/admin-system.html` 的 `#page-admin-logs`。
 * - 權限：需要 `admin.logs.entry`。
 * - 不實作 A 頁首的「一鍵清除」（`clearAllData`；Rules 也不允許刪除，且屬不可逆大批量刪除）。
 * - 頁籤列（A `admin-log-tabs.js`）：目前只有「操作日誌」與「聊天室稽核」（後者只限 super_admin，站長 2026-11-02 Q5）。
 *   只有一個頁籤可用時不顯示頁籤列，標題維持「操作日誌」；有兩個以上時標題照 A 改為「日誌中心」。
 * - 2026-11-16 改版（站長）：兩個頁籤改一般後台風格、排緊、時間區間（日／週／月）與每頁筆數（10／20／30／無限），
 *   內容見 OperationLogPanel、PmAuditPanel。
 */
export default function AdminLogsPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();

  // L-43：最小 viewer 權限全 false。到位前先轉圈，不閃「權限不足」、不讀資料。
  const waiting = !viewer.uid ? getLastKnownAuthUid() !== null : !isViewerPermissionsLoaded(viewer);
  const canAccessPage = !waiting && viewer.hasPermission('admin.logs.entry');
  // 為什麼：稽核／錯誤／用戶提示頁籤依 Rules 權限顯示（顧問 §3.200 第 6 項）。
  const canReadAuditLogs = viewer.role === 'super_admin' || viewer.hasPermission('admin.logs.audit_read');
  const canReadErrorLogs = viewer.role === 'super_admin' || viewer.hasPermission('admin.logs.error_read');
  const tabs = useMemo(
    () => getAvailableAdminLogTabs(viewer.role).filter((tab) => BUILT_LOG_TABS.includes(tab.key)).filter((tab) => {
      if (tab.key === 'audit') return canReadAuditLogs;
      if (tab.key === 'error' || tab.key === 'prompt') return canReadErrorLogs;
      return true;
    }),
    [viewer.role, canReadAuditLogs, canReadErrorLogs],
  );
  const showTabs = tabs.length > 1;
  const [activeTab, setActiveTab] = useState<AdminLogTabKey>('operation');
  // 為什麼：新頁籤第一次點才掛載，切走用 hidden 保留（顧問 §3.200 第 6 項）。
  const [mountedTabs, setMountedTabs] = useState<ReadonlySet<AdminLogTabKey>>(() => new Set());
  const safeTab: AdminLogTabKey = tabs.some((tab) => tab.key === activeTab) ? activeTab : 'operation';
  // 照 A `goBackFromAdminLogs`：沒有上一頁時回數據儀表板（能進才回），否則回首頁。
  const goBack = useGoBack(viewer.hasPermission('admin.dashboard.entry') ? '/admin/ops' : '/');

  if (waiting) {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-admin-logs">
          <PageSpinner />
        </section>
      </div>
    );
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
          <h2>{showTabs ? t('logs.centerTitle') : t('logs.tabs.operation.title')}</h2>
        </div>

        {showTabs ? (
          <div class="tab-bar admin-log-tabs" id="admin-log-tabs" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={safeTab === tab.key}
                class={`tab${safeTab === tab.key ? ' active' : ''}`}
                data-admin-log-tab={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  // 為什麼：非操作日誌頁籤首次點擊才掛載（顧問 §3.200 第 6 項）。
                  if (tab.key !== 'operation') {
                    setMountedTabs((prev) => {
                      if (prev.has(tab.key)) return prev;
                      const next = new Set(prev);
                      next.add(tab.key);
                      return next;
                    });
                  }
                }}
              >
                {t(tab.titleKey)}
              </button>
            ))}
          </div>
        ) : null}

        <div class="admin-log-panels">
          <section class="admin-log-panel" data-admin-log-panel="operation" hidden={safeTab !== 'operation'}>
            <OperationLogPanel />
          </section>
          {showTabs && mountedTabs.has('audit') ? (
            <section class="admin-log-panel" data-admin-log-panel="audit" hidden={safeTab !== 'audit'}>
              <AuditLogPanel />
            </section>
          ) : null}
          {showTabs && mountedTabs.has('error') ? (
            <section class="admin-log-panel" data-admin-log-panel="error" hidden={safeTab !== 'error'}>
              <ErrorLogPanel />
            </section>
          ) : null}
          {showTabs && mountedTabs.has('prompt') ? (
            <section class="admin-log-panel" data-admin-log-panel="prompt" hidden={safeTab !== 'prompt'}>
              <UserPromptPanel />
            </section>
          ) : null}
          {showTabs && mountedTabs.has('chat') ? (
            <section class="admin-log-panel" data-admin-log-panel="chat" hidden={safeTab !== 'chat'}>
              <PmAuditPanel />
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}
