import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { on } from '@/core/events';
import type { UidQrModalProps } from '@/features/profile/components/legacy/UidQrModal';

type ModalComponent = (props: UidQrModalProps) => JSX.Element | null;

/**
 * QR 彈窗的延遲載入外殼：QR 產生器與角色資料模組不放進首屏必經路徑，
 * 第一次收到 `qr:open` 才載入彈窗並直接開啟；之後由彈窗自己監聽 `qr:open`。
 */
export function LazyUidQrModal(props: Omit<UidQrModalProps, 'defaultOpen'>): JSX.Element | null {
  const [Modal, setModal] = useState<ModalComponent | null>(null);

  useEffect(() => {
    if (Modal) return undefined;
    let alive = true;
    const off = on('qr:open', () => {
      void import('@/features/profile/components/legacy/UidQrModal').then(({ UidQrModal }) => {
        if (alive) setModal(() => UidQrModal);
      }).catch((err: unknown) => {
        console.error('[qr] 載入 QR 彈窗失敗', err);
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, [Modal]);

  return Modal ? <Modal {...props} defaultOpen /> : null;
}
