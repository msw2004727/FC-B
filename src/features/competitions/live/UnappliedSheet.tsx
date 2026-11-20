import type { JSX } from 'preact';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { LIVE_COPY, withEvent } from './copy';
import { canReapply, rejectText } from './present';
import type { ActionLogEntry } from './types';

export function UnappliedSheet({
  open,
  entries,
  onReapply,
  onDiscard,
  onClose,
}: {
  open: boolean;
  entries: readonly ActionLogEntry[];
  onReapply: (id: string) => void;
  onDiscard: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <BottomSheet open={open} class="s4-sheet d2-panel" title={LIVE_COPY.unappliedTitle} onClose={onClose}>
      <p class="s4-hint">{LIVE_COPY.unappliedHint}</p>
      <ul class="s4-events">
        {entries.map((entry) => (
          <li key={entry.id} class={entry.state === 'rejected' ? 's4-log s4-log--rejected' : 's4-log'}>
            <span class="s4-log__intent">{entry.intent}</span>
            <span class="s4-log__st">{entry.state === 'pending' ? LIVE_COPY.pending : rejectText(entry.rejectReason)}</span>
            {entry.state === 'rejected' ? (
              <span class="s4-log__act">
                {canReapply(entry) ? (
                  <Button
                    aria-label={withEvent(LIVE_COPY.reapply, entry.intent)}
                    onClick={() => onReapply(entry.id)}
                  >
                    {LIVE_COPY.reapply}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  aria-label={withEvent(LIVE_COPY.discard, entry.intent)}
                  onClick={() => onDiscard(entry.id)}
                >
                  {LIVE_COPY.discard}
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
