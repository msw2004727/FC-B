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
  stalled = false,
  stalledLabel = LIVE_COPY.scorersStalled,
  empty = false,
  emptyLabel = LIVE_COPY.scorersEmpty,
  capNote = null,
  initialTab = 'goals',
}: {
  scorers: readonly ScorerRow[];
  cards: readonly CardStatRow[];
  /** 停更橫幅。沿用 s4-banner，次要色。 */
  stalled?: boolean;
  stalledLabel?: string;
  empty?: boolean;
  emptyLabel?: string;
  /** 超過 50 名時的底部一行。沒有就不畫。 */
  capNote?: string | null;
  /** 截圖要直接打開紅黃牌。預設仍是射手榜。 */
  initialTab?: 'goals' | 'cards';
}): JSX.Element {
  const [tab, setTab] = useState(initialTab);
  return (
    <section class="s4-page">
      {stalled ? <p class="s4-banner s4-banner--quiet">{stalledLabel}</p> : null}
      {empty ? <p class="s4-note">{emptyLabel}</p> : null}
      {empty ? null : <Tabs
        label={LIVE_COPY.tablistLabel}
        variant="segmented"
        value={tab}
        onValueChange={(id) => {
          if (id === 'goals' || id === 'cards') setTab(id);
        }}
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
      />}
      {capNote ? <p class="s4-note">{capNote}</p> : null}
    </section>
  );
}
