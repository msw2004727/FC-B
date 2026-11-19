// 賽事第 4 步預覽（U0）假資料。人名、隊名都是示範，不是真實帳號。
// 事件型別在 live/types.ts。這裡只組畫面要用的假資料。

import { FIREBASE_CONFIG } from '@/data/firebase-config';
import { taipeiMs } from '../format';
import type { LiveClock, LiveLink } from '../live/clock';
import type {
  ActionLogEntry,
  ConfirmedMatch,
  PublicPerson,
  TimelineEvent,
  VoidMark,
} from '../live/types';
import type { EntryDoc, MatchDoc, RosterPositionCode, RosterPublicDoc } from '../data/types';

export type { ActionLogEntry, CardType, ConfirmedMatch, GoalKind, PublicPerson, TimelineEvent, VoidMark } from '../live/types';
export type S4Person = PublicPerson;
export type S4ConfirmedMatch = ConfirmedMatch;

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
  'score-paused',
  'score-amend',
  'score-cap',
  'score-undo-half',
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
  { seq: 7, type: 'card', side: 'away', plId: 'pl_hf4', cardType: 'second_yellow', refSeq: 3, matchSecond: 31 * 60 + 2, createdAt: at(1862) },
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
  { id: 'a3', intent: '雷霆 5 號 34\' 黃牌', state: 'pending', at: S4_NOW - 30_000, card: { plId: 'pl_th5', cardType: 'yellow', seq: 8 } },
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

/** 回傳違規說明（空陣列＝一致）：第二黃的 refSeq 必須指向同人未作廢的黃牌。 */
export function cardIssues(events: TimelineEvent[], voids: VoidMark[]): string[] {
  const voided = new Set(voids.map((v) => v.targetSeq));
  const issues: string[] = [];
  for (const ev of events) {
    if (ev.type !== 'card' || ev.cardType !== 'second_yellow' || voided.has(ev.seq)) continue;
    const first = events.find((item) => item.seq === ev.refSeq);
    const ok = first
      && first.type === 'card'
      && first.cardType === 'yellow'
      && first.plId === ev.plId
      && !voided.has(first.seq);
    if (!ok) issues.push(`e${ev.seq} ${ev.plId} 的 refSeq 沒有對上未作廢的第一張黃牌`);
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

// ── 各畫面假資料（只加，不改上面的匯出）──────────────────────────
export interface S4ScoreScene {
  match: MatchDoc;
  homeRoster: readonly RosterPublicDoc[];
  awayRoster: readonly RosterPublicDoc[];
  events: readonly TimelineEvent[];
  voids: readonly VoidMark[];
  actionLog: readonly ActionLogEntry[];
  /** 有傳就優先於 rev − resetRev。上限畫面用。 */
  eventCount?: number;
  crests: readonly EntryDoc[];
  clock: LiveClock;
  link: LiveLink;
  nowMs: number;
  takeoverOffered: boolean;
}

/** 雷霆隊有通過專案 Storage 檢查的隊徽網址；海風隊沒有，顯示首字。 */
export const S4_CREST_URL = `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_CONFIG.storageBucket}/o/crest.png?alt=media`;

function crestEntry(id: string, teamId: string, name: string, teamLogo: string | null): EntryDoc {
  return {
    id,
    dvId: 'dv_adult',
    teamId,
    name,
    status: 'approved',
    rosterCount: 8,
    rosterConfirmed: true,
    teamLogo,
  };
}

export const S4_CRESTS: readonly EntryDoc[] = [
  crestEntry(S4_HOME.teamId, 'club_thunder', S4_HOME.name, S4_CREST_URL),
  crestEntry(S4_AWAY.teamId, 'club_wind', S4_AWAY.name, null),
];

const S4_LINK_ON: LiveLink = { online: true, pendingCount: 0, storageUnavailable: false, wakeLock: true };
const S4_CLOCK_LIVE: LiveClock = { elapsedSec: 34 * 60, period: 'h1', addedMin: null };

export const S4_SCENE_PRE: S4ScoreScene = {
  match: s4Match({
    id: 'mt_pre0000000000000001',
    status: 'scheduled',
    score: { home: 0, away: 0 },
    rev: 0,
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'h1' },
    finishedAt: null,
    updatedAt: S4_KICKOFF,
  }),
  homeRoster: S4_ROSTER_HOME,
  awayRoster: S4_ROSTER_AWAY,
  events: [],
  voids: [],
  actionLog: [],
  crests: S4_CRESTS,
  clock: { elapsedSec: 0, period: 'h1', addedMin: null },
  link: S4_LINK_ON,
  nowMs: S4_NOW,
  takeoverOffered: false,
};

/** score-live、背號選擇、兩張亮牌共用這份進行中資料。 */
export const S4_SCENE_LIVE: S4ScoreScene = {
  match: s4Match(),
  homeRoster: S4_ROSTER_HOME,
  awayRoster: S4_ROSTER_AWAY,
  events: S4_LIVE_EVENTS,
  voids: S4_LIVE_VOIDS,
  actionLog: [],
  crests: S4_CRESTS,
  clock: S4_CLOCK_LIVE,
  link: S4_LINK_ON,
  nowMs: S4_NOW,
  takeoverOffered: false,
};

export const S4_SCENE_HT: S4ScoreScene = {
  ...S4_SCENE_LIVE,
  match: s4Match({
    status: 'halftime',
    clockBase: { startedAt: S4_NOW - 8 * 60 * 1000, pausedSec: 45 * 60, running: false, period: 'ht' },
  }),
  clock: { elapsedSec: 45 * 60, period: 'ht', addedMin: null },
};

/** 終場在現在之前 19 秒，3 分鐘撤回窗剩下 2:41。 */
export const S4_FT_AT = S4_NOW - 19_000;
export const S4_FT_EVENTS: TimelineEvent[] = [
  ...S4_LIVE_EVENTS,
  { seq: 8, type: 'fulltime', matchSecond: 90 * 60, createdAt: S4_FT_AT },
];
export const S4_SCENE_FT: S4ScoreScene = {
  ...S4_SCENE_LIVE,
  match: s4Match({
    status: 'finished',
    rev: 8,
    finishedAt: S4_FT_AT,
    clockBase: { startedAt: S4_FT_AT, pausedSec: 90 * 60, running: false, period: 'h2' },
    updatedAt: S4_FT_AT,
  }),
  events: S4_FT_EVENTS,
  clock: { elapsedSec: 90 * 60, period: 'h2', addedMin: null },
};

/** 既有日誌再補兩種被拒，畫面上才看得到三種被拒狀態。 */
export const S4_UNAPPLIED_LOG: ActionLogEntry[] = [
  ...S4_ACTION_LOG,
  { id: 'a5', intent: "海風 10 號 33' 進球", state: 'rejected', rejectReason: 'conflict', at: S4_NOW - 10_000 },
  { id: 'a6', intent: "雷霆 8 號 33' 黃牌", state: 'rejected', rejectReason: 'locked', at: S4_NOW - 5_000 },
];
export const S4_SCENE_UNAPPLIED: S4ScoreScene = {
  ...S4_SCENE_LIVE,
  actionLog: S4_UNAPPLIED_LOG,
};

export const S4_SCENE_TAKEOVER: S4ScoreScene = {
  ...S4_SCENE_LIVE,
  takeoverOffered: true,
};

export const S4_SCENE_OFFLINE: S4ScoreScene = {
  ...S4_SCENE_LIVE,
  actionLog: S4_ACTION_LOG,
  link: { online: false, pendingCount: 2, storageUnavailable: true, wakeLock: false },
};

/** 進行中但時鐘已暫停 83 秒。主時鐘停在 34:00，旁邊是已暫停 01:23。 */
export const S4_SCENE_PAUSED: S4ScoreScene = {
  ...S4_SCENE_LIVE,
  match: s4Match({
    clockBase: { startedAt: S4_NOW - 83_000, pausedSec: 34 * 60, running: false, period: 'h1' },
  }),
  clock: { elapsedSec: 34 * 60, period: 'h1', addedMin: null },
};

/** 96 筆：已過 95，進球／牌／換人／修正時鐘停用，比賽控制還在。 */
export const S4_SCENE_CAP: S4ScoreScene = {
  ...S4_SCENE_LIVE,
  match: s4Match({ rev: 96, resetRev: 0 }),
  eventCount: 96,
};

export const S4_SCORE_SCENES = {
  'score-pre': S4_SCENE_PRE,
  'score-live': S4_SCENE_LIVE,
  'score-pick-player': S4_SCENE_LIVE,
  'score-card-yellow': S4_SCENE_LIVE,
  'score-card-red-auto': S4_SCENE_LIVE,
  'score-halftime': S4_SCENE_HT,
  'score-fulltime-undo': S4_SCENE_FT,
  'score-unapplied': S4_SCENE_UNAPPLIED,
  'score-takeover': S4_SCENE_TAKEOVER,
  'score-offline': S4_SCENE_OFFLINE,
  'score-paused': S4_SCENE_PAUSED,
  'score-amend': S4_SCENE_LIVE,
  'score-cap': S4_SCENE_CAP,
  'score-undo-half': S4_SCENE_LIVE,
} as const;

/** 詳情頁：兩場進行中、一場比分已更正。長隊名用來確認省略號仍看得出開頭。 */
export const S4_DETAIL_ROWS = [
  { id: 'd1', when: '09:00', home: '雷霆隊', away: '海風隊', score: '1:1', live: true, corrected: false },
  { id: 'd2', when: '09:00', home: '山貓隊', away: '銀河隊', score: '0:2', live: true, corrected: false },
  { id: 'd3', when: '08:00', home: '藍鯨隊', away: '一二三四五六七八九十示範隊', score: '2:1', live: false, corrected: true },
] as const;

/** U0a 再加上暫停、改判、上限、復原半成功。名稱對齊 harness 與截圖腳本。 */
export const S4A_SCREENS = [
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
  'score-paused',
  'score-amend',
  'score-cap',
  'score-undo-half',
  'live-detail',
  'live-match',
  'live-scorers',
] as const;

// ── 已確認場次（射手榜／紅黃牌的數字從這裡推）────────────────
const sec = (n: number) => n * 60;
export const S4_PEOPLE: readonly S4Person[] = [
  { plId: 'pl_th9', displayName: '劉冠廷', teamName: '雷霆隊', isMinor: false },
  { plId: 'pl_th10', displayName: '蔡明哲', teamName: '雷霆隊', isMinor: false },
  { plId: 'pl_th5', displayName: '黃柏翰', teamName: '雷霆隊', isMinor: false },
  { plId: 'pl_hf10', displayName: '謝東霖', teamName: '海風隊', isMinor: false },
  { plId: 'pl_hf11', displayName: '郭建宏', teamName: '海風隊', isMinor: false },
  { plId: 'pl_hf4', displayName: '周子維', teamName: '海風隊', isMinor: false },
  { plId: 'pl_hf6', displayName: '鄭凱文', teamName: '海風隊', isMinor: false },
  { plId: 'pl_cat7', displayName: '林小山', teamName: '山貓隊', isMinor: false },
  // 公開榜只顯示姓氏。displayName 故意放全名，讓推出的結果證明有遮。
  { plId: 'pl_cat15', displayName: '陳小弟', teamName: '山貓隊', isMinor: true },
];

export const S4_CONFIRMED: readonly S4ConfirmedMatch[] = [
  {
    id: 'mt_c1000000000000001',
    voids: [],
    events: [
      { seq: 1, type: 'goal', side: 'home', plId: 'pl_th9', goalKind: 'normal', matchSecond: sec(5), createdAt: sec(5) },
      { seq: 2, type: 'goal', side: 'home', plId: 'pl_th9', goalKind: 'normal', matchSecond: sec(20), createdAt: sec(20) },
      { seq: 3, type: 'goal', side: 'away', plId: 'pl_hf10', goalKind: 'normal', matchSecond: sec(30), createdAt: sec(30) },
      { seq: 4, type: 'goal', side: 'home', plId: 'pl_th10', goalKind: 'normal', matchSecond: sec(40), createdAt: sec(40) },
      { seq: 5, type: 'card', side: 'away', plId: 'pl_hf4', cardType: 'yellow', matchSecond: sec(50), createdAt: sec(50) },
      { seq: 6, type: 'card', side: 'away', plId: 'pl_hf4', cardType: 'second_yellow', refSeq: 5, matchSecond: sec(55), createdAt: sec(55) },
    ],
  },
  {
    id: 'mt_c2000000000000002',
    voids: [{ targetSeq: 2, seq: 3, createdAt: sec(12) }],
    events: [
      { seq: 1, type: 'goal', side: 'home', plId: 'pl_th9', goalKind: 'normal', matchSecond: sec(8), createdAt: sec(8) },
      { seq: 2, type: 'goal', side: 'away', plId: 'pl_cat7', goalKind: 'normal', matchSecond: sec(11), createdAt: sec(11) },
      { seq: 3, type: 'void', targetSeq: 2, matchSecond: sec(12), createdAt: sec(12) },
      { seq: 4, type: 'goal', side: 'away', plId: 'pl_cat15', goalKind: 'normal', matchSecond: sec(22), createdAt: sec(22) },
      { seq: 5, type: 'card', side: 'home', plId: 'pl_th5', cardType: 'yellow', matchSecond: sec(33), createdAt: sec(33) },
      { seq: 6, type: 'card', side: 'away', plId: 'pl_cat15', cardType: 'red', matchSecond: sec(40), createdAt: sec(40) },
      { seq: 7, type: 'goal', side: 'home', plId: 'pl_th10', goalKind: 'normal', matchSecond: sec(44), createdAt: sec(44) },
    ],
  },
  {
    id: 'mt_c3000000000000003',
    voids: [],
    events: [
      { seq: 1, type: 'goal', side: 'home', plId: 'pl_hf10', goalKind: 'normal', matchSecond: sec(6), createdAt: sec(6) },
      { seq: 2, type: 'goal', side: 'home', plId: 'pl_hf11', goalKind: 'normal', matchSecond: sec(18), createdAt: sec(18) },
      // 林小山烏龍算海風的進球，不算他自己的射手。
      { seq: 3, type: 'goal', side: 'home', plId: 'pl_cat7', goalKind: 'own', matchSecond: sec(27), createdAt: sec(27) },
      { seq: 4, type: 'card', side: 'home', plId: 'pl_hf6', cardType: 'yellow', matchSecond: sec(36), createdAt: sec(36) },
    ],
  },
];
