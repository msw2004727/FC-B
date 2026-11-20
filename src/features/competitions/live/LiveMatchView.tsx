import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import type { EntryDoc, MatchDoc, RosterPublicDoc } from '../data/types';
import { LiveScoreBadge } from './LiveScoreBadge';
import { type LiveClock, formatMatchClock, stageLabel } from './clock';
import { LIVE_COPY, pkKickLine } from './copy';
import { linesIfOpen, type EventLine } from './present';
import { TeamLockup } from './TeamLockup';
import type { TimelineEvent, VoidMark } from './types';
import './live.css';

/**
 * 單場即時頁。事件預設收起，按「比賽紀錄」才展開、才計算事件列。
 * 預設隱藏作廢。觀眾頁傳 showVoided 才劃線，並顯示 PK 輪次。
 */
function lineText(line: EventLine): string {
  if (line.pkRound != null) {
    const who = line.number == null ? LIVE_COPY.unspecified : `${line.number} ${line.name}`;
    return pkKickLine(line.pkRound, line.team, who, line.pkScored === true);
  }
  return line.number == null
    ? `${line.minute} ${line.team}`
    : `${line.minute} ${line.team} ${line.number} ${line.name}`;
}

function Mark({ line }: { line: EventLine }): JSX.Element {
  if (line.kind === 'pk') {
    return <i class={line.pkScored ? 's4-mark s4-mark--goal' : 's4-mark s4-mark--miss'} aria-hidden="true" />;
  }
  const tone = line.kind === 'goal' ? 'goal' : line.secondYellow || line.kind === 'red' ? 'red' : 'yellow';
  return <i class={`s4-mark s4-mark--${tone}`} aria-hidden="true" />;
}

export function LiveMatchView({
  match,
  clock,
  events,
  voids,
  homeRoster,
  awayRoster,
  crests = [],
  pk = null,
  corrected = false,
  preface = null,
  showVoided = false,
  startOpen = false,
  onLog,
}: {
  match: MatchDoc;
  clock: LiveClock;
  events: readonly TimelineEvent[];
  voids: readonly VoidMark[];
  homeRoster: readonly RosterPublicDoc[];
  awayRoster: readonly RosterPublicDoc[];
  crests?: readonly EntryDoc[];
  /** 有值才在比分後加 PK。省略時比分格與 v4 相同。 */
  pk?: string | null;
  corrected?: boolean;
  /** 未開賽時取代時鐘列，只顯示賽前資訊。 */
  preface?: string | null;
  /** 觀眾單場頁才劃線顯示作廢。預覽維持隱藏。 */
  showVoided?: boolean;
  startOpen?: boolean;
  /** 展開或收合時通知。收合後呼叫端不再讀。 */
  onLog?: (open: boolean) => void;
}): JSX.Element {
  const [open, setOpen] = useState(startOpen);
  const lines = linesIfOpen(open, {
    events,
    voids,
    homeName: match.home.name,
    awayName: match.away.name,
    homeRoster,
    awayRoster,
    hideVoided: !showVoided,
    order: 'timeline',
  });

  function toggle(): void {
    setOpen((value) => {
      const next = !value;
      onLog?.(next);
      return next;
    });
  }

  return (
    <section class="s4-page">
      <div class="s4-board">
        <TeamLockup entryId={match.home.teamId} name={match.home.name} crests={crests} align="home" place="board" />
        {pk ? (
          <span class="s4-scoreline">
            <span class="s4-score">{match.score.home}:{match.score.away}</span>
            <span class="s4-pk">{pk}</span>
          </span>
        ) : (
          <span class="s4-score">{match.score.home}:{match.score.away}</span>
        )}
        <TeamLockup entryId={match.away.teamId} name={match.away.name} crests={crests} align="away" place="board" />
      </div>
      {preface ? (
        <div class="s4-clockrow">
          <span class="s4-stage">{preface}</span>
        </div>
      ) : (
        <div class="s4-clockrow">
          <span class="s4-clock">{formatMatchClock(clock.elapsedSec)}</span>
          <span class="s4-stage">{stageLabel(clock)}</span>
          {corrected ? <LiveScoreBadge kind="corrected" /> : null}
        </div>
      )}
      <Button class="s4-fold" variant="secondary" aria-expanded={open} onClick={toggle}>
        {LIVE_COPY.matchLog}
      </Button>
      {open ? (
        <ul class="s4-events">
          {lines.map((line) => (
            <li key={line.seq} class={line.voided ? 's4-ev s4-ev--void' : 's4-ev'}>
              <Mark line={line} />
              <div class="s4-ev__main">{lineText(line)}</div>
              <span class="s4-sr">{line.label}</span>
              {line.voided ? <span class="s4-ev__tag">{LIVE_COPY.undone}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
