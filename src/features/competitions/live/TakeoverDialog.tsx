import type { JSX } from 'preact';
import { Modal } from '@/ui/Modal';
import { LIVE_COPY } from './copy';
import { ConfirmFooter, useConfirmArmed } from './score-states';

export function TakeoverDialog({
  open,
  free,
  onTakeover,
  onClose,
}: {
  open: boolean;
  free?: boolean;
  onTakeover: () => void;
  onClose: () => void;
}): JSX.Element {
  const armed = useConfirmArmed(open);
  return (
    <Modal
      open={open}
      class="s4-dialog d2-panel"
      title={free ? LIVE_COPY.takeoverFreeTitle : LIVE_COPY.takeoverTitle}
      onClose={onClose}
      footer={(
        <ConfirmFooter
          armed={armed}
          confirmLabel={free ? LIVE_COPY.takeoverFreeAction : LIVE_COPY.takeoverAction}
          cancelLabel={LIVE_COPY.takeoverLater}
          confirmVariant="danger"
          onConfirm={onTakeover}
          onCancel={onClose}
        />
      )}
    >
      <p class="s4-note">{free ? LIVE_COPY.takeoverFreeNote : LIVE_COPY.takeoverNote}</p>
    </Modal>
  );
}
