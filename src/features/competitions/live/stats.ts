import type { S4ConfirmedMatch, S4Person } from '../testing/step4-fixtures';
import { publicRosterName } from './public-name';

export interface ScorerRow {
  rank: number;
  plId: string;
  /** 已是公開名。元件仍會再套一次未成年姓氏規則。 */
  displayName: string;
  isMinor: boolean;
  teamName: string;
  goals: number;
}

export interface CardStatRow {
  plId: string;
  displayName: string;
  isMinor: boolean;
  teamName: string;
  yellow: number;
  red: number;
}

interface Tally {
  plId: string;
  rawName: string;
  isMinor: boolean;
  teamName: string;
  goals: number;
  yellow: number;
  red: number;
}

/**
 * 由已確認場次的事件推出射手榜與紅黃牌。
 * 進球：未作廢、有球員、不是烏龍。烏龍只算進隊伍比分，不算射手。
 * 牌：黃牌 +1 黃；第二張黃牌 +1 黃且 +1 紅；直紅 +1 紅。作廢的牌不計。
 * 同進球數同名次（下一名次跳號）。同名次的次序用 plId，不再分高下。
 */
export function derivePublicTable(
  matches: readonly S4ConfirmedMatch[],
  people: readonly S4Person[],
): { scorers: ScorerRow[]; cards: CardStatRow[] } {
  const byId = new Map<string, Tally>();
  for (const person of people) {
    byId.set(person.plId, {
      plId: person.plId,
      rawName: person.displayName,
      isMinor: person.isMinor,
      teamName: person.teamName,
      goals: 0,
      yellow: 0,
      red: 0,
    });
  }

  for (const match of matches) {
    const voided = new Set(match.voids.map((mark) => mark.targetSeq));
    for (const event of match.events) {
      if (voided.has(event.seq)) continue;
      if (event.type === 'goal') {
        if (!event.plId || event.goalKind === 'own') continue;
        const row = byId.get(event.plId);
        if (row) row.goals += 1;
        continue;
      }
      if (event.type !== 'card') continue;
      const row = byId.get(event.plId);
      if (!row) continue;
      if (event.cardType === 'yellow') row.yellow += 1;
      else if (event.cardType === 'second_yellow') {
        row.yellow += 1;
        row.red += 1;
      } else {
        row.red += 1;
      }
    }
  }

  const scorers = [...byId.values()]
    .filter((row) => row.goals > 0)
    .sort((a, b) => b.goals - a.goals || plIdOrder(a.plId, b.plId));
  const cards = [...byId.values()]
    .filter((row) => row.yellow > 0 || row.red > 0)
    .sort((a, b) => b.red - a.red || b.yellow - a.yellow || plIdOrder(a.plId, b.plId));

  let rank = 0;
  return {
    scorers: scorers.map((row, index) => {
      const prev = index > 0 ? scorers[index - 1] : undefined;
      if (!prev || prev.goals !== row.goals) rank = index + 1;
      return {
        rank,
        plId: row.plId,
        displayName: publicRosterName(row.rawName, row.isMinor),
        isMinor: row.isMinor,
        teamName: row.teamName,
        goals: row.goals,
      };
    }),
    cards: cards.map((row) => ({
      plId: row.plId,
      displayName: publicRosterName(row.rawName, row.isMinor),
      isMinor: row.isMinor,
      teamName: row.teamName,
      yellow: row.yellow,
      red: row.red,
    })),
  };
}

function plIdOrder(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
