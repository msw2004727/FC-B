// 賽事第 4 步預覽（U0）假資料骨架。人名、隊名都是示範，不是真實帳號。
// 只放「不受顧問 Q1～Q12 裁定影響」的形狀：事件、作廢標記、接手文件照現行 firestore.asia-main.rules。
// 尚未加入（等裁定）：事件 sid／op（Q1、對帳）、clock 事件（Q3）、作廢牌（Q2）、stats 文件正式形狀（Q6）。
// 正式型別在後端契約凍結後才搬進 data/types.ts；這裡的型別只給預覽與假資料一致性測試用。

import { taipeiMs } from '../format';
import type { MatchDoc, MatchSideName, RosterPositionCode, RosterPublicDoc } from '../data/types';

export const S4_NOW = taipeiMs(2027, 1, 9, 9, 34);
export const S4_KICKOFF = taipeiMs(2027, 1, 9, 9, 0);

/** 預覽要畫的畫面（plan §3）。名稱之後同步到 harness 的 SCREENS／OPEN 與 shots 腳本的 SCREENS／ANCHORS。 */
export const STEP4_SCREENS = [
  // 1 記分頁（裁判模式）
  'score-pre',
  'score-live',
  'score-pick-player',
  'score-card-yellow',
  'score-card-red-auto',
  'score-halftime',
  'score-fulltime-undo',
  'score-unapplied',
  'score-takeover',
  'score-offline',
  // 2 指派與邀請
  'staff-list',
  'staff-assign',
  'staff-invite',
  'invite-accept',
  'scorer-my-matches',
  // 3 觀眾
  'live-detail',
  'live-match',
  'live-scorers',
  // 4 登錄連結
  'link-rep',
  'link-join',
  'link-join-birthday',
  'claim',
  'addition-request',
  'addition-review',
  // 5 規則選單補預覽
  'rules-template',
  'rules-advanced',
  'rules-public',
  // 6 其他
  'checkin-print',
  'audit-log',
  'schedule-midnight',
] as const;
export type Step4Screen = (typeof STEP4_SCREENS)[number];

// ── 事件與作廢（照現行 Rules evShapeOk）─────────────────────────────
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
  | (EventBase & { type: 'card'; side: MatchSideName; plId: string; cardType: CardType })
  | (EventBase & { type: 'sub'; side: MatchSideName; inPlId: string; outPlId: string })
  | (EventBase & { type: 'kickoff' | 'halftime' | 'resume' | 'fulltime' | 'undoFinish' })
  | (EventBase & { type: 'void'; targetSeq: number });

/** voids/{targetSeq}，公開、不含 uid。 */
export interface VoidMark {
  targetSeq: number;
  seq: number;
  createdAt: number;
}

/** 本機動作日誌（U1，IndexedDB）一筆的預覽形狀。對帳欄位等 Q1 裁定後補。 */
export interface ActionLogEntry {
  id: string;
  intent: string;
  state: 'pending' | 'applied' | 'rejected';
  rejectReason?: 'conflict' | 'takenOver' | 'locked';
  at: number;
}

// ── 球員 ─────────────────────────────────────────────────────────
type P = [number, string, RosterPositionCode];
const HOME_PLAYERS: P[] = [
  [1, '陳守一', 'GK'], [4, '林志遠', 'DF'], [5, '黃柏翰', 'DF'], [7, '張宇軒', 'MF'],
  [8, '吳承恩', 'MF'], [9, '劉冠廷', 'FW'], [10, '蔡明哲', 'FW'], [12, '許家豪', 'MF'],
];
const AWAY_PLAYERS: P[] = [
  [1, '王大同', 'GK'], [3, '李俊傑', 'DF'], [4, '周子維', 'DF'], [6, '鄭凱文', 'MF'],
  [10, '謝東霖', 'FW'], [11, '郭建宏', 'FW'], [14, '洪立群', 'MF'], [17, '曾冠宇', 'DF'],
];
function roster(enId: string, prefix: string, list: P[]): RosterPublicDoc[] {
  return list.map(([number, displayName, position]) => ({
    id: `pl_${prefix}${number}`,
    enId,
    displayName,
    number,
    position,
    positionText: null,
    isMinor: false,
  }));
}
export const S4_HOME = { teamId: 'en_c', name: '雷霆隊' } as const;
export const S4_AWAY = { teamId: 'en_h', name: '海風隊' } as const;
export const S4_ROSTER_HOME = roster(S4_HOME.teamId, 'th', HOME_PLAYERS);
export const S4_ROSTER_AWAY = roster(S4_AWAY.teamId, 'hf', AWAY_PLAYERS);

// ── 進行中場次（score-live 等共用）─────────────────────────────────
const at = (sec: number) => S4_KICKOFF + sec * 1000 + 800;
/**
 * 進行中第 34 分：
 * e1 開賽；e2 雷霆 9 號進球（5'）；e3 海風 4 號黃牌（12'）；e4 海風 10 號進球（18'）；
 * e5 雷霆 7 號進球（25'）；e6 作廢 e5（記錯）；e7 海風 4 號第二張黃牌（31'，自動變紅）。
 * 有效比分 1:1，rev 7。
 */
export const S4_LIVE_EVENTS: TimelineEvent[] = [
  { seq: 1, type: 'kickoff', matchSecond: 0, createdAt: at(0) },
  { seq: 2, type: 'goal', side: 'home', plId: 'pl_th9', goalKind: 'normal', matchSecond: 5 * 60 + 12, createdAt: at(312) },
  { seq: 3, type: 'card', side: 'away', plId: 'pl_hf4', cardType: 'yellow', matchSecond: 12 * 60 + 40, createdAt: at(760) },
  { seq: 4, type: 'goal', side: 'away', plId: 'pl_hf10', goalKind: 'normal', matchSecond: 18 * 60 + 5, createdAt: at(1085) },
  { seq: 5, type: 'goal', side: 'home', plId: 'pl_th7', goalKind: 'normal', matchSecond: 25 * 60 + 30, createdAt: at(1530) },
  { seq: 6, type: 'void', targetSeq: 5, matchSecond: 25 * 60 + 58, createdAt: at(1558) },
  { seq: 7, type: 'card', side: 'away', plId: 'pl_hf4', cardType: 'second_yellow', matchSecond: 31 * 60 + 2, createdAt: at(1862) },
];
export const S4_LIVE_VOIDS: VoidMark[] = [{ targetSeq: 5, seq: 6, createdAt: at(1558) }];

export function s4Match(partial: Partial<MatchDoc> = {}): MatchDoc {
  return {
    id: 'mt_live000000000000001',
    divisionId: 'dv_adult',
    stageId: 'group',
    groupId: 'A',
    round: 2,
    matchNo: 3,
    label: null,
    matchKey: null,
    kickoffAt: S4_KICKOFF,
    venueIdx: 0,
    venueName: '1號場',
    home: { ...S4_HOME },
    away: { ...S4_AWAY },
    teamIds: [S4_HOME.teamId, S4_AWAY.teamId],
    score: { home: 1, away: 1 },
    penaltyScore: null,
    status: 'live',
    rev: 7,
    resetRev: 0,
    lock: { locked: false },
    clockBase: { startedAt: S4_KICKOFF, pausedSec: 0, running: true, period: 'h1' },
    finishedAt: null,
    confirmedAt: null,
    walkoverSide: null,
    result: null,
    resultSource: null,
    updatedAt: at(1862),
    cancelReason: null,
    cancelledAt: null,
    ...partial,
  };
}

/** 斷網時的本機日誌：一筆已套用、兩筆待送、一筆被拒（被接手）。 */
export const S4_ACTION_LOG: ActionLogEntry[] = [
  { id: 'a1', intent: '海風 4 號 31\' 第二張黃牌', state: 'applied', at: at(1862) },
  { id: 'a2', intent: '雷霆 10 號 33\' 進球', state: 'pending', at: at(1990) },
  { id: 'a3', intent: '雷霆 5 號 34\' 黃牌', state: 'pending', at: at(2040) },
  { id: 'a4', intent: '雷霆 9 號 32\' 進球', state: 'rejected', rejectReason: 'takenOver', at: at(1930) },
];

// ── 一致性（審查會抓：比分要等於有效進球、紅牌要有前一張黃牌）──────────
/** 有效進球：goal 事件扣掉有作廢標記者；只算 seq > resetRev。與後端 confirmMatchResult 對帳同規則。 */
export function deriveScore(events: TimelineEvent[], voids: VoidMark[], resetRev = 0): { home: number; away: number } {
  const voided = new Set(voids.map((v) => v.targetSeq));
  const out = { home: 0, away: 0 };
  for (const ev of events) {
    if (ev.seq <= resetRev || ev.type !== 'goal' || voided.has(ev.seq)) continue;
    out[ev.side] += 1;
  }
  return out;
}

/** 回傳違規說明（空陣列＝一致）：second_yellow 前必須同人已有一張未作廢黃牌。 */
export function cardIssues(events: TimelineEvent[], voids: VoidMark[]): string[] {
  const voided = new Set(voids.map((v) => v.targetSeq));
  const yellows = new Map<string, number>();
  const issues: string[] = [];
  for (const ev of events) {
    if (ev.type !== 'card' || voided.has(ev.seq)) continue;
    if (ev.cardType === 'yellow') yellows.set(ev.plId, (yellows.get(ev.plId) ?? 0) + 1);
    if (ev.cardType === 'second_yellow' && (yellows.get(ev.plId) ?? 0) < 1) issues.push(`e${ev.seq} ${ev.plId} 沒有前一張黃牌`);
  }
  return issues;
}

/** 事件 seq 連續 1..rev，作廢只指向更早的進球。 */
export function sequenceIssues(events: TimelineEvent[], rev: number): string[] {
  const issues: string[] = [];
  events.forEach((ev, i) => {
    if (ev.seq !== i + 1) issues.push(`第 ${i + 1} 筆 seq=${ev.seq}`);
    if (ev.type === 'void') {
      const target = events.find((e) => e.seq === ev.targetSeq);
      if (!target || target.type !== 'goal' || ev.targetSeq >= ev.seq) issues.push(`e${ev.seq} 作廢目標不合法`);
    }
  });
  if (events.length !== rev) issues.push(`事件數 ${events.length} ≠ rev ${rev}`);
  return issues;
}
