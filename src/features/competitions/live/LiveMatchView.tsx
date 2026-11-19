import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import type { EntryDoc, MatchDoc, RosterPublicDoc } from '../data/types';
import { type LiveClock, formatMatchClock, stageLabel } from './clock';
import { LIVE_COPY } from './copy';
import { linesIfOpen } from './present';
import { TeamLockup } from './TeamLockup';
import type { TimelineEvent, VoidMark } from './types';
import './live.css';

/**
 * 單場即時頁。事件預設收起，按「比賽紀錄」才展開、才計算事件列。
 * 作廢的事件不顯示（裁判頁才留刪除線）。時間軸依比賽秒數，再依 seq。
 */
export function LiveMatchView({
  match,
  clock,
  events,
  voids,
  homeRoster,
  awayRoster,
  crests = [],
}: {
  match: MatchDoc;
  clock: LiveClock;
  events: readonly TimelineEvent[];
  voids: readonly VoidMark[];
  homeRoster: readonly RosterPublicDoc[];
  awayRoster: readonly RosterPublicDoc[];
  crests?: readonly EntryDoc[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const lines = linesIfOpen(open, {
    events,
    voids,
    homeName: match.home.name,
    awayName: match.away.name,
    homeRoster,
    awayRoster,
    hideVoided: true,
    order: 'timeline',
  });

  return (
    <section class="s4-page">
      <div class="s4-board">
        <TeamLockup entryId={match.home.teamId} name={match.home.name} crests={crests} align="home" place="board" />
        <span class="s4-score">{match.score.home}:{match.score.away}</span>
        <TeamLockup entryId={match.away.teamId} name={match.away.name} crests={crests} align="away" place="board" />
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
                <span class="s4-sr">{line.label}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
