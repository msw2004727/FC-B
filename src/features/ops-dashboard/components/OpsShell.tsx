import '../ops-dashboard.css';
import type { ComponentChildren, JSX } from 'preact';

import { useGoBack } from '@/core/back-guard';
import { getLastKnownAuthUid } from '@/data/auth';
import { isViewerPermissionsLoaded } from '@/features/admin-users/data/viewer-ready';
import { useViewer } from '@/features/profile/data/viewer';
import { EmptyState } from '@/ui/EmptyState';

import { useOpsT } from '../ops-strings';

/** 入口、儀表板、參與查詢（含分享網址）同一權限碼（字典 §6）；super_admin 經權限檢查器自動持有。 */
export const OPS_ENTRY_PERMISSION = 'admin.dashboard.entry';

export type OpsGate = 'waiting' | 'denied' | 'allowed';

/** 照 AdminInactivePage：權限沒載完不判定、不查任何資料；沒登入或沒權限顯示一般的無權限頁。 */
export function useOpsGate(): OpsGate {
  const viewer = useViewer();
  const waiting = !viewer.uid ? getLastKnownAuthUid() !== null : !isViewerPermissionsLoaded(viewer);
  if (waiting) return 'waiting';
  return viewer.hasPermission(OPS_ENTRY_PERMISSION) ? 'allowed' : 'denied';
}

export function StatusNote({ text, role }: { text: string; role?: 'status' | 'alert' }): JSX.Element {
  return <div class="od-note" role={role}>{text}</div>;
}

export function ReadFailed({ onRetry }: { onRetry?: () => void }): JSX.Element {
  const t = useOpsT();
  return (
    <div class="od-card od-failed" role="alert">
      <span>{t('readFailed')}</span>
      {onRetry && (
        <button type="button" class="od-btn" onClick={onRetry}>{t('retry')}</button>
      )}
    </div>
  );
}

interface OpsShellProps {
  id: string;
  title: string;
  backTo: string;
  gate: OpsGate;
  children: ComponentChildren;
}

export function OpsShell({ id, title, backTo, gate, children }: OpsShellProps): JSX.Element {
  const t = useOpsT();
  const goBack = useGoBack(backTo);
  let body: ComponentChildren;
  if (gate === 'waiting') body = <StatusNote role="status" text={t('loading')} />;
  else if (gate === 'denied') body = <EmptyState title={t('noPermission')} />;
  else body = children;
  return (
    <div class="legacy-ui">
      <section class="page active ops-dash" id={id}>
        <div class="page-header">
          <button type="button" class="back-btn" aria-label={t('back')} onClick={goBack}>
            <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <h2>{title}</h2>
        </div>
        {body}
      </section>
    </div>
  );
}
