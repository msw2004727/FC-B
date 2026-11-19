// 記分預覽的正式型別。假資料只匯入這裡，不再讓 live 元件依賴 testing。

import type { MatchSideName } from '../data/types';

export type GoalKind = 'normal' | 'penalty' | 'own';
export type CardType = 'yellow' | 'second_yellow' | 'red';

interface EventBase {
  seq: number;
  /** 本機比賽時鐘秒數 0～10800（發生時間）。 */
  matchSecond: number;
  /** 伺服器時間（送達時間），毫秒。 */
  createdAt: number;
}

export type TimelineEvent =
  | (EventBase & { type: 'goal'; side: MatchSideName; plId?: string; goalKind: GoalKind })
  | (EventBase & {
    type: 'card';
    side: MatchSideName;
    plId: string;
    cardType: CardType;
    /** 只有第二張黃牌帶。指向被它引用的那張黃牌 seq。 */
    refSeq?: number;
  })
  | (EventBase & { type: 'sub'; side: MatchSideName; inPlId: string; outPlId: string })
  | (EventBase & { type: 'kickoff' | 'halftime' | 'resume' | 'fulltime' | 'undoFinish' })
  | (EventBase & { type: 'void'; targetSeq: number });

/** voids/{targetSeq}，公開、不含 uid。 */
export interface VoidMark {
  targetSeq: number;
  seq: number;
  createdAt: number;
}

/** 本機待送日誌裡的一張牌。第二黃判斷會把未作廢、未被引用的黃牌算進去。 */
export interface PendingCard {
  plId: string;
  cardType: CardType;
  seq: number;
  refSeq?: number;
}

/** 本機動作日誌（U1）一筆的預覽形狀。 */
export interface ActionLogEntry {
  id: string;
  intent: string;
  state: 'pending' | 'applied' | 'rejected';
  rejectReason?: string;
  at: number;
  card?: PendingCard;
}

/** 公開榜用的人。 */
export interface PublicPerson {
  plId: string;
  displayName: string;
  teamName: string;
  isMinor: boolean;
}

/** 已確認場次，射手榜與紅黃牌從事件推。 */
export interface ConfirmedMatch {
  id: string;
  events: readonly TimelineEvent[];
  voids: readonly VoidMark[];
}
