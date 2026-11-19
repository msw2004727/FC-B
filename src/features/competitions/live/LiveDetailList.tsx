import type { JSX } from 'preact';
import type { EntryDoc } from '../data/types';
import { LiveScoreBadge } from './LiveScoreBadge';
import { TeamLockup } from './TeamLockup';
import './live.css';

export interface LiveDetailRow {
  id: string;
  when: string;
  home: string;
  away: string;
  score: string;
  live: boolean;
  corrected: boolean;
  /** 有值才在比分後畫 PK。文案用 pkScoreLabel。 */
  pk?: string | null;
  /** 有 id 才改用 TeamLockup。省略時維持原本的隊名，版面與 v4 相同。 */
  homeId?: string;
  awayId?: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  onOpen?: () => void;
}

function crest(id: string, name: string, logo: string | null | undefined): EntryDoc {
  return {
    id,
    dvId: '',
    teamId: id,
    name,
    status: 'approved',
    rosterCount: 0,
    rosterConfirmed: false,
    teamLogo: logo ?? null,
  };
}

function Team({
  id,
  name,
  logo,
  align,
}: {
  id?: string;
  name: string;
  logo?: string | null;
  align: 'home' | 'away';
}): JSX.Element {
  if (!id) {
    const cls = align === 'away' ? 's4-team s4-team--away' : 's4-team';
    return <span class={cls}>{name}</span>;
  }
  return (
    <TeamLockup
      entryId={id}
      name={name}
      crests={[crest(id, name, logo)]}
      align={align}
      place="column"
    />
  );
}

/** 詳情頁進行中場次的一截：即時小標，或比分已更正。 */
export function LiveDetailList({ rows }: { rows: readonly LiveDetailRow[] }): JSX.Element {
  return (
    <section class="s4-page">
      <ul class="s4-dlist">
        {rows.map((row) => (
          <li
            key={row.id}
            class="s4-dlist__li"
            onClick={row.onOpen}
          >
            <div class="s4-dlist__top">
              <span class="s4-dlist__when">{row.when}</span>
              {row.live ? <LiveScoreBadge kind="live" /> : null}
              {row.corrected ? <LiveScoreBadge kind="corrected" /> : null}
            </div>
            <div class="s4-vs">
              <Team id={row.homeId} name={row.home} logo={row.homeLogo} align="home" />
              <span class="s4-vs__score">
                {row.score}
                {row.pk ? <span class="s4-pk">{row.pk}</span> : null}
              </span>
              <Team id={row.awayId} name={row.away} logo={row.awayLogo} align="away" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
