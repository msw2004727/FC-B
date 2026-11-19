import type { MatchSideName, RosterPublicDoc } from '../data/types';
import { LIVE_COPY, minuteMark } from './copy';
import type { ActionLogEntry, CardType, GoalKind, TimelineEvent, VoidMark } from './types';

/** 本場事件數（rev − resetRev）的三個門檻。 */
export const EVENT_WARN = 90;
export const EVENT_RESERVE = 95;
export const EVENT_MAX = 100;

export type RecordAction = 'goal' | 'yellow' | 'red';

export interface FlashCard {
  number: number | null;
  name: string;
  tone: 'yellow' | 'red';
  secondYellow: boolean;
  /** 新記的第二張黃牌要指回的那張黃牌。沒有就是 null。 */
  refSeq?: number | null;
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
  /** 含事件類型，給列與按鈕的無障礙名稱。 */
  label: string;
}

export interface CardSeen {
  seq: number;
  plId: string;
  cardType: CardType;
  refSeq?: number;
  voided: boolean;
}

export interface RecordPick {
  action: RecordAction;
  plId: string | null;
  goalKind: GoalKind | null;
  minute: number;
  refSeq?: number | null;
}

export function findPlayer(
  home: readonly RosterPublicDoc[],
  away: readonly RosterPublicDoc[],
  plId: string | undefined,
): RosterPublicDoc | undefined {
  if (!plId) return undefined;
  return home.find((player) => player.id === plId) ?? away.find((player) => player.id === plId);
}

/** 已套用的牌，加上本機待送日誌裡的牌。作廢的標 voided。 */
export function seenCards(
  events: readonly TimelineEvent[],
  voids: readonly VoidMark[],
  log: readonly ActionLogEntry[] = [],
): CardSeen[] {
  const voided = new Set(voids.map((mark) => mark.targetSeq));
  const cards: CardSeen[] = [];
  for (const event of events) {
    if (event.type !== 'card') continue;
    cards.push({
      seq: event.seq,
      plId: event.plId,
      cardType: event.cardType,
      refSeq: event.refSeq,
      voided: voided.has(event.seq),
    });
  }
  for (const entry of log) {
    if (entry.state !== 'pending' || !entry.card) continue;
    cards.push({
      seq: entry.card.seq,
      plId: entry.card.plId,
      cardType: entry.card.cardType,
      refSeq: entry.card.refSeq,
      voided: false,
    });
  }
  return cards;
}

/**
 * 同人未作廢、且沒有被另一張未作廢的第二黃用 refSeq 指到的黃牌。
 * 回傳 seq 最小的那張。ignoreSeq 用來排除正要改判的那一筆。
 */
export function openYellowSeq(
  cards: readonly CardSeen[],
  plId: string,
  ignoreSeq?: number,
): number | null {
  const live = cards.filter((card) => !card.voided && card.seq !== ignoreSeq);
  const referenced = new Set(
    live
      .filter((card) => card.cardType === 'second_yellow' && card.refSeq != null)
      .map((card) => card.refSeq as number),
  );
  const open = live
    .filter((card) => card.cardType === 'yellow' && card.plId === plId && !referenced.has(card.seq))
    .sort((a, b) => a.seq - b.seq);
  return open[0]?.seq ?? null;
}

/** 這張黃牌被哪一張未作廢的第二黃引用。沒有就是 null。 */
export function linkedSecondSeq(cards: readonly CardSeen[], yellowSeq: number): number | null {
  const hit = cards.find(
    (card) => !card.voided && card.cardType === 'second_yellow' && card.refSeq === yellowSeq,
  );
  return hit?.seq ?? null;
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
    refSeq: null,
  };
}

/**
 * 新記的黃牌：同人有未作廢且未被引用的黃牌（含待送日誌）才亮紅底第二張黃牌。
 * 直紅不走這條。refSeq 就是那張黃牌的 seq。
 */
export function flashForNewCard(
  action: 'yellow' | 'red',
  player: RosterPublicDoc | undefined,
  events: readonly TimelineEvent[],
  voids: readonly VoidMark[],
  log: readonly ActionLogEntry[] = [],
): FlashCard {
  const refSeq = action === 'yellow' && player
    ? openYellowSeq(seenCards(events, voids, log), player.id)
    : null;
  const second = refSeq != null;
  return {
    number: player?.number ?? null,
    name: player?.displayName ?? '',
    tone: action === 'red' || second ? 'red' : 'yellow',
    secondYellow: second,
    refSeq,
  };
}

function kindText(kind: 'goal' | 'yellow' | 'red', secondYellow: boolean): string {
  if (kind === 'goal') return LIVE_COPY.goal;
  if (secondYellow) return LIVE_COPY.secondYellowMark;
  return kind === 'yellow' ? LIVE_COPY.yellow : LIVE_COPY.red;
}

/**
 * 進球與牌。
 * recent：裁判最近事件，seq 新到舊。
 * timeline：觀眾時間軸，先 matchSecond 再 seq，都是由小到大。
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
  order?: 'recent' | 'timeline';
}): EventLine[] {
  const voided = new Set(options.voids.map((mark) => mark.targetSeq));
  const lines: EventLine[] = [];
  const ordered = [...options.events].sort((a, b) => (
    options.order === 'timeline'
      ? a.matchSecond - b.matchSecond || a.seq - b.seq
      : b.seq - a.seq
  ));
  for (const event of ordered) {
    if (event.type !== 'goal' && event.type !== 'card') continue;
    const kind = event.type === 'goal' ? 'goal' : event.cardType === 'yellow' ? 'yellow' : 'red';
    const isVoided = voided.has(event.seq);
    if (isVoided && options.hideVoided) continue;
    const side: MatchSideName = event.side;
    const plId = event.plId;
    const player = findPlayer(options.homeRoster, options.awayRoster, plId);
    const minute = minuteMark(Math.floor(event.matchSecond / 60));
    const secondYellow = event.type === 'card' && event.cardType === 'second_yellow';
    const number = player?.number ?? null;
    const name = player?.displayName ?? '';
    const team = side === 'home' ? options.homeName : options.awayName;
    const text = kindText(kind, secondYellow);
    const base = number == null
      ? `${minute} ${text} ${team}`
      : `${minute} ${text} ${team} ${number} ${name}`;
    lines.push({
      seq: event.seq,
      minute,
      kind,
      secondYellow,
      team,
      number,
      name,
      voided: isVoided,
      label: isVoided ? `${base} ${LIVE_COPY.undone}` : base,
    });
    if (options.limit != null && lines.length >= options.limit) break;
  }
  return lines;
}

/** 收起時不計算事件列。 */
export function linesIfOpen(
  open: boolean,
  options: Parameters<typeof eventLines>[0],
): EventLine[] {
  if (!open) return [];
  return eventLines(options);
}

export function unappliedEntries(log: readonly ActionLogEntry[]): ActionLogEntry[] {
  return log
    .filter((entry) => entry.state === 'pending' || entry.state === 'rejected')
    .sort((a, b) => b.at - a.at);
}

/** 場次已鎖只能捨棄，不能重新套用。 */
export function canReapply(entry: ActionLogEntry): boolean {
  return entry.state === 'rejected' && entry.rejectReason !== 'locked';
}

export function rejectText(reason: string | undefined): string {
  if (reason === 'conflict') return LIVE_COPY.rejectedConflict;
  if (reason === 'locked') return LIVE_COPY.rejectedLocked;
  if (reason === 'takenOver') return LIVE_COPY.rejectedTakenOver;
  return LIVE_COPY.rejected;
}

/** 未套用清單上的那一行字。 */
export function recordIntent(
  team: string,
  pick: RecordPick,
  player: { number: number } | undefined,
): string {
  const who = player ? `${player.number} 號` : LIVE_COPY.unspecified;
  const mark = minuteMark(pick.minute);
  if (pick.action === 'goal') {
    const kind = pick.goalKind === 'penalty'
      ? LIVE_COPY.goalPenalty
      : pick.goalKind === 'own'
        ? LIVE_COPY.goalOwn
        : LIVE_COPY.goal;
    return `${team} ${who} ${mark} ${kind}`;
  }
  const card = pick.refSeq != null
    ? LIVE_COPY.secondYellowMark
    : pick.action === 'yellow'
      ? LIVE_COPY.yellow
      : LIVE_COPY.red;
  return `${team} ${who} ${mark} ${card}`;
}
