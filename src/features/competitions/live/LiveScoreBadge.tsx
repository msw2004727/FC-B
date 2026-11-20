import type { JSX } from 'preact';
import { Badge } from '@/ui/Badge';
import { LIVE_COPY } from './copy';
import './live.css';

/** 詳情頁進行中場次的小標。圓點慢速呼吸；系統要求減少動態時停住。 */
export function LiveScoreBadge({ kind }: { kind: 'live' | 'corrected' }): JSX.Element {
  if (kind === 'corrected') {
    return (
      <span class="s4-live">
        <Badge size="sm" tone="warning" label={LIVE_COPY.correctedBadge} />
      </span>
    );
  }
  return (
    <span class="s4-live">
      <i class="s4-dot" aria-hidden="true" />
      <Badge size="sm" tone="danger" variant="solid" label={LIVE_COPY.liveBadge} />
    </span>
  );
}
