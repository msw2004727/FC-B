import type { JSX } from 'preact';
import { Suspense, lazy } from 'preact/compat';

import { useViewer } from '@/features/profile/data/viewer';

import { usePmDialogTarget } from './pm-dialog-store';

const PmDialogOverlay = lazy(() => import('./PmDialogOverlay'));
// 站內信排程執行器（站長 2026-11-02 Q3）：本元件登入後全站常駐，借它掛載；只有管理員角色才下載。
const ScheduledMessageRunner = lazy(() => import('../admin/ScheduledMessageRunner'));

/**
 * 卡 3A：全站私訊浮層外框。
 * 只有 store 有 target 時才載入浮層本體，避免首屏靜態載入 firestore 與浮層。
 */
export function PmDialogHost(): JSX.Element | null {
  const target = usePmDialogTarget();
  const viewer = useViewer();
  const isAdminRole = viewer.role === 'admin' || viewer.role === 'super_admin';
  if (!target && !isAdminRole) return null;
  return (
    <>
      {isAdminRole ? (
        <Suspense fallback={null}>
          <ScheduledMessageRunner />
        </Suspense>
      ) : null}
      {target ? (
        <Suspense fallback={null}>
          <PmDialogOverlay />
        </Suspense>
      ) : null}
    </>
  );
}
