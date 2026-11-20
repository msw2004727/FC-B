import type { JSX } from 'preact';
import { StatusTag } from '../ui/status-tag';
import { LIVE_COPY } from './copy';
import './live.css';

/** 詳情頁進行中場次的小標。「即時」是亮燈標籤，圓點慢速呼吸；系統要求減少動態時停住。 */
export function LiveScoreBadge({ kind }: { kind: 'live' | 'corrected' }): JSX.Element {
  if (kind === 'corrected') {
    return (
      <span class="s4-live">
        <StatusTag kind="neutral" label={LIVE_COPY.correctedBadge} />
      </span>
    );
  }
  return (
    <span class="s4-live">
      <StatusTag kind="live" label={LIVE_COPY.liveBadge} />
    </span>
  );
}
