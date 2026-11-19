import type { JSX } from 'preact';
import { LiveScoreBadge } from './LiveScoreBadge';
import './live.css';

export interface LiveDetailRow {
  id: string;
  when: string;
  home: string;
  away: string;
  score: string;
  live: boolean;
  corrected: boolean;
}

/** 詳情頁進行中場次的一截：即時小標，或比分已更正。 */
export function LiveDetailList({ rows }: { rows: readonly LiveDetailRow[] }): JSX.Element {
  return (
    <section class="s4-page">
      <ul class="s4-dlist">
        {rows.map((row) => (
          <li key={row.id} class="s4-dlist__li">
            <div class="s4-dlist__top">
              <span class="s4-dlist__when">{row.when}</span>
              {row.live ? <LiveScoreBadge kind="live" /> : null}
              {row.corrected ? <LiveScoreBadge kind="corrected" /> : null}
            </div>
            <div class="s4-vs">
              <span class="s4-team">{row.home}</span>
              <span class="s4-vs__score">{row.score}</span>
              <span class="s4-team s4-team--away">{row.away}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
