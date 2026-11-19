import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import type { MatchDoc, RosterPublicDoc } from '../data/types';
import type { TimelineEvent, VoidMark } from '../testing/step4-fixtures';
import { type LiveClock, formatMatchClock, stageLabel } from './clock';
import { LIVE_COPY } from './copy';
import { eventLines } from './present';
import './live.css';

/**
 * 單場即時頁。事件預設收起，按「比賽紀錄」才展開。
 * 作廢的事件不顯示（裁判頁才留刪除線）。
 */
export function LiveMatchView({
  match,
  clock,
  events,
  voids,
  homeRoster,
  awayRoster,
}: {
  match: MatchDoc;
  clock: LiveClock;
  events: readonly TimelineEvent[];
  voids: readonly VoidMark[];
  homeRoster: readonly RosterPublicDoc[];
  awayRoster: readonly RosterPublicDoc[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const lines = eventLines({
    events,
    voids,
    homeName: match.home.name,
    awayName: match.away.name,
    homeRoster,
    awayRoster,
    hideVoided: true,
  });

  return (
    <section class="s4-page">
      <div class="s4-board">
        <span class="s4-team">{match.home.name}</span>
        <span class="s4-score">{match.score.home}:{match.score.away}</span>
        <span class="s4-team s4-team--away">{match.away.name}</span>
      </div>
      <div class="s4-clockrow">
        <span class="s4-clock">{formatMatchClock(clock.elapsedSec)}</span>
        <span class="s4-stage">{stageLabel(clock)}</span>
      </div>
      <Button class="s4-fold" variant="secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {LIVE_COPY.matchLog}
      </Button>
      {open ? (
        <ul class="s4-events">
          {lines.map((line) => {
            const who = line.number == null
              ? `${line.minute} ${line.team}`
              : `${line.minute} ${line.team} ${line.number} ${line.name}`;
            const tone = line.kind === 'goal' ? 'goal' : line.secondYellow || line.kind === 'red' ? 'red' : 'yellow';
            return (
              <li key={line.seq} class="s4-ev">
                <i class={`s4-mark s4-mark--${tone}`} aria-hidden="true" />
                <div class="s4-ev__main">{who}</div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
