// 正式記分頁的三個新狀態。只加在既有記分板之上，不改預覽版面。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { LIVE_COPY } from './copy';

/**
 * 不能復原的確認框：打開後這段時間確認鈕停用（看得出來是停用），時間到自動可按。
 * 防連點：觸發鈕和確認鈕位置重疊時，第二下不會直接確認（顧問 11-20，PK 大戰誤觸）。
 */
export const CONFIRM_ARM_MS = 600;

export function useConfirmArmed(open: boolean, ms: number = CONFIRM_ARM_MS): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    if (!open) return undefined;
    const id = window.setTimeout(() => setArmed(true), ms);
    return () => window.clearTimeout(id);
  }, [open, ms]);
  return armed;
}

/** 確認框底部：取消在左、確認在右；確認鈕在 useConfirmArmed 到時前停用。 */
export function ConfirmFooter({
  armed,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
}: {
  armed: boolean;
  confirmLabel: string;
  cancelLabel: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <>
      <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
      <Button
        variant={confirmVariant}
        disabled={!armed}
        data-confirm-armed={armed ? 'true' : 'false'}
        onClick={() => {
          if (armed) onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
    </>
  );
}

/** 紀錄列與事件面板原紀錄前的小圖示：進球圓點、牌色小方塊、PK 進／沒進。（從 ScorePad 搬來，EventSheet 也要用） */
export function Mark({
  kind,
  second,
  scored,
}: {
  kind: 'goal' | 'yellow' | 'red' | 'pk';
  second: boolean;
  scored?: boolean;
}): JSX.Element {
  if (kind === 'pk') {
    return <i class={scored ? 's4-mark s4-mark--goal' : 's4-mark s4-mark--miss'} aria-hidden="true" />;
  }
  const tone = kind === 'goal' ? 'goal' : second || kind === 'red' ? 'red' : 'yellow';
  return <i class={`s4-mark s4-mark--${tone}`} aria-hidden="true" />;
}

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
  const armed = useConfirmArmed(true);
  return (
    <Modal
      open
      class="s4-dialog d2-panel"
      title={LIVE_COPY.pkConfirmTitle}
      onClose={onCancel}
      footer={(
        <ConfirmFooter
          armed={armed}
          confirmLabel={LIVE_COPY.pkConfirmGo}
          cancelLabel={LIVE_COPY.pkConfirmCancel}
          confirmVariant="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )}
    >
      <p class="s4-note">{LIVE_COPY.pkConfirmLine1}</p>
      <p class="s4-note">{LIVE_COPY.pkConfirmLine2}</p>
    </Modal>
  );
}

/** 開賽不能由記分端撤回（誤按只能終場後由主辦取消再重置），所以先確認。 */
export function KickoffConfirmDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const armed = useConfirmArmed(true);
  return (
    <Modal
      open
      class="s4-dialog d2-panel"
      title={LIVE_COPY.kickoffConfirmTitle}
      onClose={onCancel}
      footer={(
        <ConfirmFooter
          armed={armed}
          confirmLabel={LIVE_COPY.kickoff}
          cancelLabel={LIVE_COPY.pkConfirmCancel}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )}
    >
      <p class="s4-note">{LIVE_COPY.kickoffConfirmLine}</p>
    </Modal>
  );
}

export function PkGoalLock(): JSX.Element {
  return <p class="s4-goal-lock">{LIVE_COPY.pkGoalLocked}</p>;
}
