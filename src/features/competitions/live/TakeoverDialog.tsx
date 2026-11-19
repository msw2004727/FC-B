import type { JSX } from 'preact';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { LIVE_COPY } from './copy';

export function TakeoverDialog({
  open,
  onTakeover,
  onClose,
}: {
  open: boolean;
  onTakeover: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal
      open={open}
      class="s4-dialog"
      title={LIVE_COPY.takeoverTitle}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onTakeover}>{LIVE_COPY.takeoverAction}</Button>
          <Button variant="secondary" onClick={onClose}>{LIVE_COPY.takeoverLater}</Button>
        </>
      )}
    >
      <p class="s4-note">{LIVE_COPY.takeoverNote}</p>
    </Modal>
  );
}
