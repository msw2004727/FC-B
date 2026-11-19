// 正式記分頁的三個新狀態。只加在既有記分板之上，不改預覽版面。

import type { JSX } from 'preact';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { LIVE_COPY } from './copy';

export function PendingTag(): JSX.Element {
  return <span class="s4-pending">{LIVE_COPY.pending}</span>;
}

export function PkConfirmDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <Modal
      open
      class="s4-dialog"
      title={LIVE_COPY.pkConfirmTitle}
      onClose={onCancel}
      footer={(
        <>
          <Button onClick={onConfirm}>{LIVE_COPY.pkConfirmGo}</Button>
          <Button variant="secondary" onClick={onCancel}>{LIVE_COPY.pkConfirmCancel}</Button>
        </>
      )}
    >
      <p class="s4-note">{LIVE_COPY.pkConfirmLine1}</p>
      <p class="s4-note">{LIVE_COPY.pkConfirmLine2}</p>
    </Modal>
  );
}

export function PkGoalLock(): JSX.Element {
  return <p class="s4-goal-lock">{LIVE_COPY.pkGoalLocked}</p>;
}
