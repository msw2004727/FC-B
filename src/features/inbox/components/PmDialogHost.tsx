import type { JSX } from 'preact';
import { Suspense, lazy } from 'preact/compat';

import { usePmDialogTarget } from './pm-dialog-store';

const PmDialogOverlay = lazy(() => import('./PmDialogOverlay'));

/**
 * 卡 3A：全站私訊浮層外框。
 * 只有 store 有 target 時才載入浮層本體，避免首屏靜態載入 firestore 與浮層。
 */
export function PmDialogHost(): JSX.Element | null {
  const target = usePmDialogTarget();
  if (!target) return null;
  return (
    <Suspense fallback={null}>
      <PmDialogOverlay />
    </Suspense>
  );
}
