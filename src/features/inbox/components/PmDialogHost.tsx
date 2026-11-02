import type { JSX } from 'preact';
import { Suspense, lazy } from 'preact/compat';

import type { MessageViewer } from '../admin/data/admin-message-model';

import { usePmDialogTarget } from './pm-dialog-store';

const PmDialogOverlay = lazy(() => import('./PmDialogOverlay'));
// 站內信排程執行器（站長 2026-11-02 Q3）：本元件登入後全站常駐，借它掛載；只有管理員角色才下載。
const ScheduledMessageRunner = lazy(() => import('../admin/ScheduledMessageRunner'));

export interface PmDialogHostProps {
  /**
   * 登入者（App 既有 routeAccess 傳入，本元件不另讀 Firestore）。
   * 角色是 admin／super_admin 才掛排程執行器；其他身分不下載、不讀。
   */
  viewer?: MessageViewer | null;
}

/**
 * 卡 3A：全站私訊浮層外框。
 * 只有 store 有 target 時才載入浮層本體，避免首屏靜態載入 firestore 與浮層。
 */
export function PmDialogHost({ viewer = null }: PmDialogHostProps): JSX.Element | null {
  const target = usePmDialogTarget();
  const isAdminRole = viewer?.role === 'admin' || viewer?.role === 'super_admin';
  if (!target && !isAdminRole) return null;
  return (
    <>
      {isAdminRole && viewer ? (
        <Suspense fallback={null}>
          <ScheduledMessageRunner viewer={viewer} />
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
