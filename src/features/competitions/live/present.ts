import type { MatchSideName, RosterPublicDoc } from '../data/types';
import type { ActionLogEntry, CardType, TimelineEvent, VoidMark } from '../testing/step4-fixtures';
import { LIVE_COPY, minuteMark } from './copy';

export type RecordAction = 'goal' | 'yellow' | 'red';

export interface FlashCard {
  number: number | null;
  name: string;
  tone: 'yellow' | 'red';
  secondYellow: boolean;
}

export interface EventLine {
  seq: number;
  minute: string;
  kind: 'goal' | 'yellow' | 'red';
  secondYellow: boolean;
  team: string;
  number: number | null;
  name: string;
  voided: boolean;
  /** 給亮牌按鈕的無障礙名稱。只有牌才有。 */
  showLabel: string | null;
}

export function findPlayer(
  home: readonly RosterPublicDoc[],
  away: readonly RosterPublicDoc[],
  plId: string | undefined,
): RosterPublicDoc | undefined {
  if (!plId) return undefined;
  return home.find((player) => player.id === plId) ?? away.find((player) => player.id === plId);
}

export function activeYellowCount(
  events: readonly TimelineEvent[],
  voids: readonly VoidMark[],
  plId: string,
): number {
  const voided = new Set(voids.map((mark) => mark.targetSeq));
  let count = 0;
  for (const event of events) {
    if (event.type !== 'card' || event.cardType !== 'yellow' || event.plId !== plId) continue;
    if (voided.has(event.seq)) continue;
    count += 1;
  }
  return count;
}

function cardTone(cardType: CardType): Pick<FlashCard, 'tone' | 'secondYellow'> {
  if (cardType === 'yellow') return { tone: 'yellow', secondYellow: false };
  if (cardType === 'second_yellow') return { tone: 'red', secondYellow: true };
  return { tone: 'red', secondYellow: false };
}

export function flashFromCard(cardType: CardType, player: RosterPublicDoc | undefined): FlashCard {
  const tone = cardTone(cardType);
  return {
    number: player?.number ?? null,
    name: player?.displayName ?? '',
    tone: tone.tone,
    secondYellow: tone.secondYellow,
  };
}

/** 新記的一張黃牌：此人已有未作廢黃牌就變成第二張黃牌（紅底）。直紅不走這條。 */
export function flashForNewCard(
  action: 'yellow' | 'red',
  player: RosterPublicDoc | undefined,
  events: readonly TimelineEvent[],
  voids: readonly VoidMark[],
): FlashCard {
  const second = action === 'yellow' && player != null && activeYellowCount(events, voids, player.id) >= 1;
  return {
    number: player?.number ?? null,
    name: player?.displayName ?? '',
    tone: action === 'red' || second ? 'red' : 'yellow',
    secondYellow: second,
  };
}

function kindOf(event: TimelineEvent): 'goal' | 'yellow' | 'red' | null {
  if (event.type === 'goal') return 'goal';
  if (event.type !== 'card') return null;
  return event.cardType === 'yellow' ? 'yellow' : 'red';
}

/**
 * 進球與牌，新到舊。
 * 作廢的進球：裁判頁留著畫刪除線；觀眾頁整筆不顯示（hideVoided）。
 */
export function eventLines(options: {
  events: readonly TimelineEvent[];
  voids: readonly VoidMark[];
  homeName: string;
  awayName: string;
  homeRoster: readonly RosterPublicDoc[];
  awayRoster: readonly RosterPublicDoc[];
  hideVoided: boolean;
  limit?: number;
}): EventLine[] {
  const voided = new Set(options.voids.map((mark) => mark.targetSeq));
  const lines: EventLine[] = [];
  const ordered = [...options.events].sort((a, b) => b.seq - a.seq);
  for (const event of ordered) {
    const kind = kindOf(event);
    if (!kind) continue;
    const isVoided = voided.has(event.seq);
    if (isVoided && options.hideVoided) continue;
    const side: MatchSideName = event.type === 'goal' || event.type === 'card' ? event.side : 'home';
    const plId = event.type === 'goal' ? event.plId : event.type === 'card' ? event.plId : undefined;
    const player = findPlayer(options.homeRoster, options.awayRoster, plId);
    const minute = minuteMark(Math.floor(event.matchSecond / 60));
    const secondYellow = event.type === 'card' && event.cardType === 'second_yellow';
    const number = player?.number ?? null;
    const name = player?.displayName ?? '';
    const showKind = secondYellow ? LIVE_COPY.secondYellowMark : kind === 'yellow' ? LIVE_COPY.yellow : LIVE_COPY.red;
    lines.push({
      seq: event.seq,
      minute,
      kind,
      secondYellow,
      team: side === 'home' ? options.homeName : options.awayName,
      number,
      name,
      voided: isVoided,
      showLabel: event.type === 'card' && number != null
        ? `${minute} ${showKind} ${number} ${name}`
        : null,
    });
    if (options.limit != null && lines.length >= options.limit) break;
  }
  return lines;
}

export function unappliedEntries(log: readonly ActionLogEntry[]): ActionLogEntry[] {
  return log
    .filter((entry) => entry.state === 'pending' || entry.state === 'rejected')
    .sort((a, b) => b.at - a.at);
}

export function rejectText(reason: ActionLogEntry['rejectReason']): string {
  if (reason === 'conflict') return LIVE_COPY.rejectedConflict;
  if (reason === 'locked') return LIVE_COPY.rejectedLocked;
  return LIVE_COPY.rejectedTakenOver;
}
