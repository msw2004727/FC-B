import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Tabs } from '@/ui/Tabs';
import { LIVE_COPY } from './copy';
import { publicRosterName } from './public-name';
import type { CardStatRow, ScorerRow } from './stats';
import './live.css';

function shown(name: string, isMinor: boolean): string {
  return publicRosterName(name, isMinor);
}

/** 射手榜與紅黃牌。名次由呼叫端算好；這裡只顯示公開名。 */
export function ScorersTable({
  scorers,
  cards,
}: {
  scorers: readonly ScorerRow[];
  cards: readonly CardStatRow[];
}): JSX.Element {
  const [tab, setTab] = useState('goals');
  return (
    <section class="s4-page">
      <Tabs
        label={LIVE_COPY.tablistLabel}
        variant="segmented"
        value={tab}
        onValueChange={setTab}
        items={[
          {
            id: 'goals',
            label: LIVE_COPY.scorers,
            panel: (
              <table class="s4-table s4-table--scorers">
                <thead>
                  <tr>
                    <th>{LIVE_COPY.colRank}</th>
                    <th>{LIVE_COPY.colPlayer}</th>
                    <th>{LIVE_COPY.colTeam}</th>
                    <th>{LIVE_COPY.colGoals}</th>
                  </tr>
                </thead>
                <tbody>
                  {scorers.map((row) => (
                    <tr key={row.plId}>
                      <td>{row.rank}</td>
                      <td>{shown(row.displayName, row.isMinor)}</td>
                      <td>{row.teamName}</td>
                      <td>{row.goals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          },
          {
            id: 'cards',
            label: LIVE_COPY.cardsTab,
            panel: (
              <table class="s4-table s4-table--cards">
                <thead>
                  <tr>
                    <th>{LIVE_COPY.colPlayer}</th>
                    <th>{LIVE_COPY.colTeam}</th>
                    <th>{LIVE_COPY.colYellow}</th>
                    <th>{LIVE_COPY.colRed}</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((row) => (
                    <tr key={row.plId}>
                      <td>{shown(row.displayName, row.isMinor)}</td>
                      <td>{row.teamName}</td>
                      <td>{row.yellow}</td>
                      <td>{row.red}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          },
        ]}
      />
    </section>
  );
}
