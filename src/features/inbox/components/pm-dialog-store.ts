import { useEffect, useState } from 'preact/hooks';

export interface PmDialogTarget {
  uid: string;
  name?: string;
  pictureUrl?: string;
}

type Listener = (target: PmDialogTarget | null) => void;

let current: PmDialogTarget | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  const snapshot = Array.from(listeners);
  for (const listener of snapshot) {
    try {
      listener(current);
    } catch (err) {
      console.error('[pm-dialog-store] listener failed', err);
    }
  }
}

/** 照 A `_openPmDialogImpl`：全站共用同一個私訊浮層狀態。 */
export function openPmDialog(target: PmDialogTarget): void {
  const safeUid = String(target.uid ?? '').trim();
  if (!safeUid) return;
  current = {
    uid: safeUid,
    ...(target.name ? { name: String(target.name) } : {}),
    ...(target.pictureUrl ? { pictureUrl: String(target.pictureUrl) } : {}),
  };
  notify();
}

/** 照 A `_closePmDialog`：關閉浮層並通知所有訂閱者。 */
export function closePmDialog(): void {
  if (current === null) return;
  current = null;
  notify();
}

/** 訂閱私訊浮層狀態；回傳取消訂閱函式。 */
export function subscribePmDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 讀取目前私訊浮層目標（Preact hook）。照 L-04：effect 訂閱後補讀一次目前值。 */
export function usePmDialogTarget(): PmDialogTarget | null {
  const [target, setTarget] = useState<PmDialogTarget | null>(current);
  useEffect(() => {
    setTarget(current);
    return subscribePmDialog(setTarget);
  }, []);
  return target;
}
