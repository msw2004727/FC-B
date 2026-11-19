import type { JSX } from 'preact';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import type { ActionLogEntry } from '../testing/step4-fixtures';
import { LIVE_COPY } from './copy';
import { rejectText } from './present';

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
    <BottomSheet open={open} class="s4-sheet" title={LIVE_COPY.unappliedTitle} onClose={onClose}>
      <p class="s4-hint">{LIVE_COPY.unappliedHint}</p>
      <ul class="s4-events">
        {entries.map((entry) => (
          <li key={entry.id} class="s4-log">
            <span class="s4-log__intent">{entry.intent}</span>
            <span class="s4-log__st">{entry.state === 'pending' ? LIVE_COPY.pending : rejectText(entry.rejectReason)}</span>
            {entry.state === 'rejected' ? (
              <span class="s4-log__act">
                <Button onClick={() => onReapply(entry.id)}>{LIVE_COPY.reapply}</Button>
                <Button variant="ghost" onClick={() => onDiscard(entry.id)}>{LIVE_COPY.discard}</Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
