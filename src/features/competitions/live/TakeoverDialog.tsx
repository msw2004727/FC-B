import type { JSX } from 'preact';
import { Modal } from '@/ui/Modal';
import { LIVE_COPY } from './copy';
import { ConfirmFooter, useConfirmArmed } from './score-states';

export function TakeoverDialog({
  open,
  onTakeover,
  onClose,
}: {
  open: boolean;
  onTakeover: () => void;
  onClose: () => void;
}): JSX.Element {
  const armed = useConfirmArmed(open);
  return (
    <Modal
      open={open}
      class="s4-dialog"
      title={LIVE_COPY.takeoverTitle}
      onClose={onClose}
      footer={(
        <ConfirmFooter
          armed={armed}
          confirmLabel={LIVE_COPY.takeoverAction}
          cancelLabel={LIVE_COPY.takeoverLater}
          onConfirm={onTakeover}
          onCancel={onClose}
        />
      )}
    >
      <p class="s4-note">{LIVE_COPY.takeoverNote}</p>
    </Modal>
  );
}
