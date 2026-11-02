import '../legacy/admin-inactive.css';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import { useGoBack } from '@/core/back-guard';
import { getLastKnownAuthUid } from '@/data/auth';
import { isViewerPermissionsLoaded } from '@/features/admin-users/data/viewer-ready';
import { useViewer } from '@/features/profile/data/viewer';
import { useT } from '@/i18n/i18n';
import { EmptyState } from '@/ui/EmptyState';

import { CenterNote, InactiveEventsPanel, InactiveTeamsPanel } from '../components/InactiveLists';
import { UserStatusPanel } from '../components/UserStatusPanel';

/** 入口與頁面同一判斷（照 A `DRAWER_MENUS` `admin.inactive.entry`；super_admin 經權限檢查器自動持有全部權限碼）。 */
export const INACTIVE_ENTRY_PERMISSION = 'admin.inactive.entry';

type TabKey = 'teams' | 'events' | 'users';

// 照 A `pages/admin-system.html#page-admin-inactive` 的頁籤；「賽事」頁籤依站長 2026-11-02 裁定不做。
const TABS: readonly { key: TabKey; label: string }[] = [
  { key: 'teams', label: '俱樂部' },
  { key: 'events', label: '活動' },
  { key: 'users', label: '用戶狀態' },
];

/**
 * 後台「無效資料查詢」（路由 `/admin/inactive`），DOM／class 照 A `#page-admin-inactive`。
 * 只讀：沒有任何寫入或修復按鈕。每個頁籤第一次點開才讀，切回已開過的頁籤不重讀（隱藏而不卸載）。
 */
export default function AdminInactivePage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const goBack = useGoBack('/');
  const waiting = !viewer.uid ? getLastKnownAuthUid() !== null : !isViewerPermissionsLoaded(viewer);
  const canAccess = !waiting && viewer.hasPermission(INACTIVE_ENTRY_PERMISSION);
  const [tab, setTab] = useState<TabKey>('teams');
  const [opened, setOpened] = useState<ReadonlySet<TabKey>>(() => new Set<TabKey>(['teams']));

  function selectTab(key: TabKey): void {
    setTab(key);
    setOpened((prev) => (prev.has(key) ? prev : new Set([...prev, key])));
  }

  function panel(key: TabKey): JSX.Element | null {
    if (!opened.has(key)) return null;
    const content = key === 'teams' ? <InactiveTeamsPanel /> : key === 'events' ? <InactiveEventsPanel /> : <UserStatusPanel />;
    // display:contents：卡片仍是 .card-list 的直接排版子項，間距同 A。
    return <div key={key} data-inactive-panel={key} style={tab === key ? 'display:contents' : 'display:none'}>{content}</div>;
  }

  let body: JSX.Element;
  if (waiting) {
    body = <CenterNote role="status" text={t('admin-inactive.loading')} />;
  } else if (!canAccess) {
    body = <EmptyState title={t('admin-inactive.noPermission')} />;
  } else {
    body = (
      <>
        <div class="tab-bar" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              class={tab === item.key ? 'tab active' : 'tab'}
              onClick={() => selectTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div class="card-list" id="inactive-list">
          {TABS.map((item) => panel(item.key))}
        </div>
      </>
    );
  }

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-admin-inactive">
        <div class="page-header">
          <button type="button" class="back-btn" aria-label={t('admin-inactive.back')} onClick={goBack}>
            <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <h2>無效資料查詢</h2>
        </div>
        {body}
      </section>
    </div>
  );
}
