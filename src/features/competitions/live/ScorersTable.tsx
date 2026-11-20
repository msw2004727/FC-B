import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Tabs } from '@/ui/Tabs';
import { LIVE_COPY } from './copy';
import { publicRosterName } from './public-name';
import type { CardStatRow, ScorerRow } from './stats';
import './live.css';

function shown(name: string, isMinor: boolean): string {
  return publicRosterName(name, isMinor);
}

/** 紅黃牌數字是 0 的格子淡掉（新外觀卡 3-4）。 */
function cardCell(n: number): JSX.Element {
  return <td class={n === 0 ? 'n cp-tbl__zero' : 'n'}>{n}</td>;
}

/**
 * 射手榜與紅黃牌。名次由呼叫端算好；這裡只顯示公開名。
 * 新外觀卡 3-4：由上到下 停更提示 → 切換列（左「射手榜｜紅黃牌」、右 aside＝組別切換，放不下時右邊整組掉到下一行）
 * → 表格卡（或空狀態卡）→ 名額附註。表格與積分榜共用 .cp-tbl。
 */
export function ScorersTable({
  scorers,
  cards,
  stalled = false,
  stalledLabel = LIVE_COPY.scorersStalled,
  empty = false,
  emptyLabel = LIVE_COPY.scorersEmpty,
  capNote = null,
  initialTab = 'goals',
  aside = null,
}: {
  scorers: readonly ScorerRow[];
  cards: readonly CardStatRow[];
  /** 停更提示：切換列上面自己一行的安靜小字。 */
  stalled?: boolean;
  stalledLabel?: string;
  empty?: boolean;
  emptyLabel?: string;
  /** 超過 50 名時的底部一行。沒有就不畫。 */
  capNote?: string | null;
  /** 截圖要直接打開紅黃牌。預設仍是射手榜。 */
  initialTab?: 'goals' | 'cards';
  /** 放在切換列右邊的東西（詳情頁的組別切換）。 */
  aside?: ComponentChildren;
}): JSX.Element {
  const [tab, setTab] = useState(initialTab);
  return (
    <section class="s4-page cp-sc">
      {stalled ? <p class="cp-sc__stall">{stalledLabel}</p> : null}
      <div class="cp-sc__bar">
        {empty ? null : <Tabs
          class="d2-seg-sm"
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
                <div class="cps-card cp-tblcard">
                  <table class="cp-tbl cp-tbl--goals">
                    <thead>
                      <tr>
                        <th scope="col" class="rk">{LIVE_COPY.colRank}</th>
                        <th scope="col" class="t">{LIVE_COPY.colPlayer}</th>
                        <th scope="col" class="tm">{LIVE_COPY.colTeam}</th>
                        <th scope="col" class="pt">{LIVE_COPY.colGoals}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scorers.map((row) => (
                        <tr key={row.plId}>
                          <td class="rk">{row.rank}</td>
                          <td class="t">{shown(row.displayName, row.isMinor)}</td>
                          <td class="tm">{row.teamName}</td>
                          <td class="pt">{row.goals}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ),
            },
            {
              id: 'cards',
              label: LIVE_COPY.cardsTab,
              panel: (
                <div class="cps-card cp-tblcard">
                  <table class="cp-tbl cp-tbl--cards">
                    <thead>
                      <tr>
                        <th scope="col" class="t">{LIVE_COPY.colPlayer}</th>
                        <th scope="col" class="tm">{LIVE_COPY.colTeam}</th>
                        <th scope="col"><i class="cp-cardic cp-cardic--y" aria-hidden="true" />{LIVE_COPY.colYellow}</th>
                        <th scope="col"><i class="cp-cardic" aria-hidden="true" />{LIVE_COPY.colRed}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cards.map((row) => (
                        <tr key={row.plId}>
                          <td class="t">{shown(row.displayName, row.isMinor)}</td>
                          <td class="tm">{row.teamName}</td>
                          {cardCell(row.yellow)}
                          {cardCell(row.red)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ),
            },
          ]}
        />}
        {aside}
        {empty ? <div class="cps-card cp-sc__empty">{emptyLabel}</div> : null}
      </div>
      {capNote ? <p class="cp-sc__cap">{capNote}</p> : null}
    </section>
  );
}
