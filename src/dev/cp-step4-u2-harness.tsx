// 正式記分頁截圖。假 ScoringBackend 與記憶體日誌，不連 Firestore。
// ?screen= 與 ?theme=light|dark。畫完且錨點出現後設 window.__CPS_READY。
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/features/competitions/live/live.css';
import { setLocale } from '@/i18n/i18n';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import { ScoringScreen, SignedOut } from '@/features/competitions/pages/ScoringPage';
import { MemoryActionLog, type ActionLog } from '@/features/competitions/live/data/action-log';
import { applyPlanLocal } from '@/features/competitions/live/data/batch';
import type { ScoringBackend } from '@/features/competitions/live/data/live-repo';
import { memorySidStore } from '@/features/competitions/live/data/sid';
import type { LockManager } from '@/features/competitions/live/data/tab-lock';
import type { ScoringDeps } from '@/features/competitions/live/useScoring';
import type { BatchPlan, LogEntry, ScoringPort, ServerEvent, ServerMatch } from '@/features/competitions/live/data/types';
import type { RosterPublicDoc } from '@/features/competitions/data/types';

const CID = 'comp-u2';
const MT = 'mt-u2';
const UID = 'scorer-u2';
const SID = 'u2-local-sid-00000000001';
const NOW = 1_763_510_400_000;

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'u2-live';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);
// ?frame=shell：外面包正式 App 的內容容器與頂欄／底部導覽的替身（同 id），1280 截圖用；u2-fullscreen 一律包。
// 記分板出現時 ScoringPage 在 <html> 加 cp-score-full，score-fullscreen.css 把 #top-bar／#bottom-tabs 藏起來。
const framed = params.get('frame') === 'shell' || screenName === 'u2-fullscreen';

export const U2_SCREENS = [
  'u2-pre',
  'u2-live',
  'u2-pending',
  'u2-pk-confirm',
  'u2-pk-live',
  'u2-pk-goal-locked',
  'u2-timeout-stop',
  'u2-crowded',
  'u2-reader-tab',
  'u2-no-permission',
  'u2-storage-unavailable',
  'u2-long-name',
  // 第 4 步 A（顧問 11-20）：被拒擋住送出、階段動作被擋、不能復原的確認框、看這張牌。
  'a1-held',
  'a1-held-many',
  // 卡 2-7（顧問 §3.504）：兩位數筆數的紅色列，量 360 寬一行與列尾箭頭。
  'a1-held-12',
  'a1-held-sheet',
  'a1-blocked-ht',
  'a1-resumed',
  'a1-pk-confirm-wait',
  'a1-pk-confirm-armed',
  'a1-kickoff-confirm',
  'a1-takeover-confirm',
  'a1-takeover-free',
  'a1-showcard',
  'a1-undo-confirm',
  'a1-blocked-ht-before',
  'a1-pk-blocked',
  // 新外觀第 2 批卡 2-0（施工-第2批 3.27）：正式頁才有的組合、面板固定狀態、讀取失敗、長隊名各字數。
  'u2-fulltime-undo',
  'u2-fulltime-undo-blocked',
  'a1-held-offline',
  'a1-held-pause-reserved',
  'a1-held-timeout',
  'a1-held-timeout-collapsed',
  'u2-timeout-collapsed',
  'u2-near-cap',
  'u2-reader-cap',
  'u2-menu',
  'u2-timeout-sheet',
  'u2-amend-card',
  'a1-amend-confirm',
  'u2-no-permission-host',
  'u2-load-failed-network',
  'u2-load-failed-error',
  'u2-pre-wake-off',
  // 卡 2-3(c)（記分線問答第 12 點）：進行中、0 筆紀錄、不支援螢幕常亮——鎖定提醒唯一會出現的時候。
  'u2-live-wake-off',
  'u2-long-6',
  'u2-long-7',
  'u2-long-10',
  'u2-long-11',
  'u2-long-13',
  'u2-long-similar',
  // 設計總監 04:20（總收尾覆蓋率）：暫停倒數走完、選單含停用的列、開賽鈕停用、全螢幕記分（App 外框下）。
  'u2-timeout-done',
  // 設計總監 05:08：客隊喊暫停（暫停條左緣客隊色 s4-timeout--away）、客隊暫停收合。
  'u2-timeout-away',
  'u2-timeout-away-collapsed',
  // 設計總監 05:38（卡 2-4 面板新外觀）：暫停選隊時主隊次數用完（主隊鈕停用、客隊剩 1 次）、客隊選球員面板、PK 那一腳只有「復原」。
  'u2-timeout-picks-used',
  // 卡 2-7：未登入（卡 2-6 的版面），只畫 SignedOut。
  'u2-signed-out',
  'u2-pick-away',
  'u2-pk-kick-sheet',
  'u2-menu-disabled',
  'u2-pre-disabled',
  'u2-fullscreen',
] as const;

/** 長隊名示範：字數（主隊、客隊同字數）與兩隊名稱。卡 2-0：施工-第2批 3.5 的門檻。 */
export const U2_LONG_NAMES: Record<string, readonly [string, string]> = {
  'u2-long-6': ['信義青年聯隊', '前鎮海風球隊'],
  'u2-long-7': ['信義青年足球隊', '前鎮海風足球隊'],
  'u2-long-10': ['台北信義青年足球聯隊', '高雄市前鎮海風足球隊'],
  'u2-long-11': ['台北市信義青年足球聯隊', '高雄市前鎮區海風足球隊'],
  'u2-long-13': ['台北市信義區青年足球聯合隊', '高雄市前鎮區海風足球俱樂部'],
  // 兩個 12 字、只差最後一個字（原型 long-similar 是截圖腳本臨時換字）。
  'u2-long-similar': ['台北市信義區青年足球甲隊', '台北市信義區青年足球乙隊'],
};

const ANCHORS: Record<string, string> = {
  'u2-pre': '開賽',
  'u2-live': '34:00',
  'u2-pending': '待送',
  'u2-pk-confirm': '開始 PK 大戰？',
  'u2-pk-live': 'PK3:2', // 卡 2-2：PK 比分搬到板子下排、小標與數字分開節點
  'u2-pk-goal-locked': 'PK 期間不能復原或改判一般進球',
  'u2-timeout-stop': '暫停',
  'u2-crowded': '結束暫停',
  'u2-reader-tab': '這場已在另一個分頁記分',
  'u2-no-permission': '你沒有這場的記分權限',
  'u2-storage-unavailable': '離線紀錄無法保存',
  'u2-long-name': '34:00',
  'a1-held': '之後記的 2 筆先存在這支手機',
  'a1-held-many': '之後記的 2 筆先存在這支手機',
  'a1-held-sheet': '重新套用',
  'a1-blocked-ht': '先處理沒送出的紀錄，才能開始下半場',
  'a1-resumed': '終場',
  'a1-pk-confirm-wait': '開始 PK 大戰？',
  'a1-pk-confirm-armed': '開始 PK 大戰？',
  'a1-kickoff-confirm': '開始比賽？',
  'a1-takeover-confirm': '接手後，另一支裝置記的動作會送不出去',
  'a1-takeover-free': '這支裝置會成為這場的記分裝置',
  'a1-showcard': '點一下關閉',
  'a1-undo-confirm': '會一併復原第二張黃牌',
  'a1-blocked-ht-before': '前一筆沒送出，點這裡處理',
  'a1-held-12': '有 12 筆沒送出，點這裡處理',
  'a1-pk-blocked': '先處理沒送出的紀錄，才能開始 PK',
  'u2-fulltime-undo': '撤回終場',
  'u2-fulltime-undo-blocked': '先處理沒送出的紀錄，才能撤回終場',
  'a1-held-offline': '離線中，已存',
  'a1-held-pause-reserved': '目前不開放停錶',
  'a1-held-timeout': '結束暫停',
  'a1-held-timeout-collapsed': '前一筆沒送出',
  'u2-timeout-collapsed': '雷霆隊',
  'u2-near-cap': '本場紀錄接近上限',
  'u2-reader-cap': '紀錄已達上限，請由主辦在賽後登錄比分',
  'u2-menu': '離開記分',
  'u2-timeout-sheet': '每半場重新計算',
  'u2-amend-card': '看這張牌',
  'a1-amend-confirm': '確定改判',
  'u2-no-permission-host': '請先在指派頁把自己指派為記分員',
  'u2-load-failed-network': '讀取失敗，連線恢復後會自動重試',
  'u2-load-failed-error': '讀取失敗',
  // 開賽前螢幕喚醒還沒要求（data/wake-lock.ts 只在 play/ht 要求），所以正式頁開賽前不會出現「請關閉手機自動鎖定」；錨點只等開賽鈕。
  'u2-pre-wake-off': '開賽',
  'u2-live-wake-off': '請關閉手機自動鎖定',
  'u2-timeout-done': '繼續計時',
  'u2-timeout-away': '海風隊暫停 0:47',
  'u2-timeout-away-collapsed': '海風隊',
  'u2-timeout-picks-used': '每半場重新計算',
  'u2-signed-out': '請先登入再記分',
  'u2-pick-away': '不指定球員',
  'u2-pk-kick-sheet': '復原',
  'u2-menu-disabled': '球隊暫停',
  'u2-pre-disabled': '開賽',
  'u2-fullscreen': '34:00',
  'u2-long-6': '34:00',
  'u2-long-7': '34:00',
  'u2-long-10': '34:00',
  'u2-long-11': '34:00',
  'u2-long-13': '34:00',
  'u2-long-similar': '34:00',
};

const HOME: RosterPublicDoc[] = [
  { id: 'pl_th9', enId: 'en_c', displayName: '劉冠廷', number: 9, position: 'FW', positionText: null, isMinor: false },
];
const AWAY: RosterPublicDoc[] = [
  { id: 'pl_hf10', enId: 'en_h', displayName: '謝東霖', number: 10, position: 'FW', positionText: null, isMinor: false },
];

function clock(pausedSec: number, period: string, running: boolean, startedAt: number | null = running ? NOW : null): ServerMatch['clockBase'] {
  return { startedAt, pausedSec, running, period };
}

function match(partial: Partial<ServerMatch> = {}): ServerMatch {
  return {
    id: MT,
    status: 'live',
    rev: 0,
    resetRev: 0,
    score: { home: 0, away: 0 },
    lock: { locked: false },
    clockBase: clock(0, 'pre', false, null),
    finishedAt: null,
    home: { teamId: 'en_c', name: '雷霆隊', logo: null },
    away: { teamId: 'en_h', name: '海風隊', logo: null },
    divisionId: 'dv1',
    penaltyScore: null,
    ...partial,
  };
}

function goalAt(seq: number, side: 'home' | 'away', minute: number): ServerEvent {
  const home = side === 'home';
  return {
    seq,
    type: 'goal',
    op: `${home ? 'goal-home' : 'goal-away'}-${String(seq).padStart(4, '0')}`,
    sid: SID,
    side,
    plId: home ? 'pl_th9' : 'pl_hf10',
    goalKind: 'normal',
    matchSecond: minute * 60,
    createdAt: NOW - (90 - minute) * 1000,
  };
}

function pkKick(seq: number, side: 'home' | 'away', scored: boolean): ServerEvent {
  const home = side === 'home';
  return {
    seq,
    type: 'pk',
    op: `pk-${home ? 'home' : 'away'}-${String(seq).padStart(4, '0')}`,
    sid: SID,
    side,
    plId: home ? 'pl_th9' : 'pl_hf10',
    scored,
    matchSecond: 90 * 60,
    createdAt: NOW,
  };
}

function pendingGoal(op: string, side: 'home' | 'away', plId: string, at: number): LogEntry {
  return {
    op,
    cid: CID,
    mtId: MT,
    uid: UID,
    sid: SID,
    kind: 'goal',
    intent: { kind: 'goal', side, plId, goalKind: 'normal', matchSecond: 700 },
    state: 'pending',
    createdAt: at,
    attempts: 0,
    baseResetRev: 0,
  };
}

function rejectedEntry(op: string, intent: LogEntry['intent'], seq: number, reason: LogEntry['rejectReason'], at: number): LogEntry {
  return {
    op,
    cid: CID,
    mtId: MT,
    uid: UID,
    sid: SID,
    kind: intent.kind,
    intent,
    state: 'rejected',
    rejectReason: reason,
    seq,
    createdAt: at,
    attempts: 1,
    baseResetRev: 0,
  };
}

function secondYellowAt(seq: number, minute: number, refSeq: number): ServerEvent {
  return { ...cardAt(seq, minute), op: `card2-home-${String(seq).padStart(4, '0')}`, cardType: 'second_yellow', refSeq };
}

function cardAt(seq: number, minute: number): ServerEvent {
  return {
    seq,
    type: 'card',
    op: `card-home-${String(seq).padStart(4, '0')}`,
    sid: SID,
    side: 'home',
    plId: 'pl_th9',
    cardType: 'yellow',
    matchSecond: minute * 60,
    createdAt: NOW - (90 - minute) * 1000,
  };
}

function deadLog(): ActionLog {
  return {
    async probe() { return false; },
    async put() {},
    async get() { return null; },
    async list() { return []; },
    async patch() { return null; },
    async remove() {},
    async removeMatch() {},
    async purgeOlderThan() {},
  };
}

function blockedLocks(): LockManager {
  return {
    request(_name, _options, callback) {
      void callback(null);
      return Promise.resolve();
    },
  };
}

interface Seed {
  match: ServerMatch;
  events?: ServerEvent[];
  staffRoles?: string[];
  matchIds?: string[];
  online?: boolean;
  /** 沒有 Wake Lock，畫出「請關閉手機自動鎖定」。 */
  wakeOff?: boolean;
  reader?: boolean;
  pending?: LogEntry[];
  /** 控制權在別的裝置（同帳號另一個 sid）。 */
  otherDevice?: boolean;
  /** 沒有控制文件、本機也沒有 sid（第一次進記分頁，CP-PO-15a）。 */
  noControl?: boolean;
  /** 組別 rules.timeout 原始值（backend.open 的 timeoutRaw）。沒給就照舊不帶（預設：不限次數）。 */
  timeoutRaw?: unknown;
  /** 進場（backend.open）丟錯：network＝{ code: 'unavailable' }、error＝一般錯誤（G-06 讀取失敗畫面）。 */
  failOpen?: 'network' | 'error';
}

/** 一筆被拒的客隊進球＋之後兩筆待送（a1-held 的待送內容）。 */
function heldPending(): LogEntry[] {
  return [
    rejectedEntry('rej-goal-away-00001', { kind: 'goal', side: 'away', plId: 'pl_hf10', goalKind: 'normal', matchSecond: 1500 }, 2, 'conflict', NOW - 60_000),
    pendingGoal('pend-goal-home-00002', 'home', 'pl_th9', NOW - 30_000),
    pendingGoal('pend-goal-home-00003', 'home', 'pl_th9', NOW - 10_000),
  ];
}

function timeoutAt(seq: number, op: string): ServerEvent {
  return { seq, type: 'timeout', op, sid: SID, side: 'home', matchSecond: 600, createdAt: NOW - 13_000 };
}

/** 球隊暫停進行中（同 u2-timeout-stop）。 */
function timeoutSeed(op: string): Seed {
  return {
    match: match({ status: 'live', rev: 2, score: { home: 1, away: 0 }, clockBase: clock(10 * 60, 'h2', false, NOW - 8_000) }),
    events: [goalAt(1, 'home', 8), timeoutAt(2, op)],
  };
}

/** 終場已送出、還在撤回期（19 秒前）。正式頁多一顆「離開記分」。 */
function fulltimeSeed(): Seed {
  return {
    match: match({
      status: 'finished',
      rev: 3,
      score: { home: 2, away: 1 },
      clockBase: clock(90 * 60, 'h2', false, null),
      finishedAt: NOW - 19_000,
    }),
    events: [goalAt(1, 'home', 12), goalAt(2, 'away', 40), goalAt(3, 'home', 77)],
  };
}

function seedOf(name: string): Seed {
  if (name === 'u2-pre') {
    return { match: match({ status: 'scheduled', clockBase: clock(0, 'pre', false, null) }) };
  }
  if (name === 'u2-live') {
    return {
      match: match({
        status: 'live',
        rev: 2,
        score: { home: 1, away: 1 },
        clockBase: clock(34 * 60, 'h1', true),
      }),
      events: [goalAt(1, 'home', 12), goalAt(2, 'away', 28)],
    };
  }
  if (name === 'u2-long-name') {
    return {
      match: match({
        status: 'live',
        rev: 2,
        score: { home: 1, away: 1 },
        clockBase: clock(34 * 60, 'h1', true),
        home: { teamId: 'en_c', name: '台北市信義區青年足球聯隊', logo: null },
        away: { teamId: 'en_h', name: '高雄市前鎮區海風足球隊', logo: null },
      }),
      events: [goalAt(1, 'home', 12), goalAt(2, 'away', 28)],
    };
  }
  if (name === 'u2-pending') {
    return {
      match: match({ status: 'live', score: { home: 0, away: 0 }, clockBase: clock(12 * 60, 'h1', true) }),
      online: false,
      pending: [
        pendingGoal('pend-goal-home-00001', 'home', 'pl_th9', NOW - 20_000),
        pendingGoal('pend-goal-away-00001', 'away', 'pl_hf10', NOW - 10_000),
      ],
    };
  }
  if (name === 'u2-pk-confirm') {
    return {
      match: match({
        status: 'live',
        rev: 2,
        score: { home: 1, away: 1 },
        clockBase: clock(90 * 60, 'h2', false, null),
        penaltyScore: null,
      }),
      events: [goalAt(1, 'home', 24), goalAt(2, 'away', 81)],
    };
  }
  if (name === 'u2-pk-live') {
    return {
      match: match({
        status: 'live',
        rev: 7,
        score: { home: 1, away: 1 },
        clockBase: clock(0, 'pk', false, null),
        penaltyScore: { home: 3, away: 2 },
      }),
      events: [
        goalAt(1, 'home', 19),
        goalAt(2, 'away', 63),
        pkKick(3, 'home', true),
        pkKick(4, 'away', true),
        pkKick(5, 'home', true),
        pkKick(6, 'away', true),
        pkKick(7, 'home', true),
      ],
    };
  }
  if (name === 'u2-pk-goal-locked') {
    return {
      match: match({
        status: 'live',
        rev: 2,
        score: { home: 1, away: 1 },
        clockBase: clock(0, 'pk', false, null),
        penaltyScore: { home: 0, away: 0 },
      }),
      events: [goalAt(1, 'home', 12), goalAt(2, 'away', 48)],
    };
  }
  if (name === 'u2-timeout-stop') {
    return {
      match: match({
        status: 'live',
        rev: 2,
        score: { home: 1, away: 0 },
        clockBase: clock(10 * 60, 'h2', false, NOW - 8_000),
      }),
      events: [
        goalAt(1, 'home', 8),
        {
          seq: 2,
          type: 'timeout',
          op: 'timeout-op-00000001',
          sid: SID,
          side: 'home',
          matchSecond: 600,
          createdAt: NOW - 13_000,
        },
      ],
    };
  }
  if (name === 'u2-crowded') {
    return {
      match: match({
        status: 'live',
        rev: 2,
        score: { home: 1, away: 0 },
        clockBase: clock(10 * 60, 'h2', false, NOW - 8_000),
      }),
      events: [
        goalAt(1, 'home', 8),
        {
          seq: 2,
          type: 'timeout',
          op: 'timeout-op-00000002',
          sid: SID,
          side: 'home',
          matchSecond: 600,
          createdAt: NOW - 13_000,
        },
      ],
      online: false,
      wakeOff: true,
    };
  }
  if (name === 'u2-reader-tab') {
    return {
      match: match({ status: 'live', score: { home: 0, away: 0 }, clockBase: clock(20 * 60, 'h1', true) }),
      reader: true,
    };
  }
  if (name === 'a1-held-12') {
    return {
      ...seedOf('a1-held-many'),
      pending: Array.from({ length: 12 }, (_, i) => rejectedEntry(
        `rej-goal-away-${String(100 + i).padStart(5, '0')}`,
        { kind: 'goal', side: 'away', plId: 'pl_hf10', goalKind: 'normal', matchSecond: 1500 + i },
        5 + i,
        'conflict',
        NOW - 60_000 + i * 1000,
      )),
    };
  }
  if (name === 'a1-held-many') {
    // 顧問 §3.459 (a)：360×640 紀錄超過約 4 筆時「未套用的動作」鈕被擠出畫面；紅色那行可點的量測用。
    return {
      match: match({ status: 'live', rev: 4, score: { home: 3, away: 1 }, clockBase: clock(31 * 60, 'h1', true) }),
      events: [goalAt(1, 'home', 3), goalAt(2, 'away', 9), goalAt(3, 'home', 15), goalAt(4, 'home', 22)],
      pending: [
        rejectedEntry('rej-goal-away-00011', { kind: 'goal', side: 'away', plId: 'pl_hf10', goalKind: 'normal', matchSecond: 1500 }, 5, 'conflict', NOW - 60_000),
        pendingGoal('pend-goal-home-00012', 'home', 'pl_th9', NOW - 30_000),
        pendingGoal('pend-goal-home-00013', 'home', 'pl_th9', NOW - 10_000),
      ],
    };
  }
  if (name === 'a1-held' || name === 'a1-held-sheet') {
    return {
      match: match({ status: 'live', rev: 1, score: { home: 1, away: 0 }, clockBase: clock(31 * 60, 'h1', true) }),
      events: [goalAt(1, 'home', 12)],
      pending: heldPending(),
    };
  }
  if (name === 'a1-pk-blocked') {
    return {
      ...seedOf('u2-pk-confirm'),
      pending: [
        rejectedEntry('rej-goal-home-00009', { kind: 'goal', side: 'home', plId: 'pl_th9', goalKind: 'normal', matchSecond: 5300 }, 3, 'conflict', NOW - 30_000),
      ],
    };
  }
  if (name === 'a1-blocked-ht' || name === 'a1-resumed' || name === 'a1-blocked-ht-before') {
    return {
      match: match({ status: 'halftime', rev: 1, score: { home: 1, away: 0 }, clockBase: clock(45 * 60, 'ht', false, NOW - 120_000) }),
      events: [goalAt(1, 'home', 12)],
      pending: [
        rejectedEntry('rej-resume-00000001', {
          kind: 'resume',
          matchSecond: 2700,
          clock: { running: true, period: 'h2', pausedSec: 2700, startedAt: NOW - 60_000 },
        }, 2, 'takenOver', NOW - 60_000),
      ],
    };
  }
  if (name === 'a1-pk-confirm-wait' || name === 'a1-pk-confirm-armed') return seedOf('u2-pk-confirm');
  if (name === 'a1-kickoff-confirm') return seedOf('u2-pre');
  if (name === 'a1-takeover-free') return { ...seedOf('u2-pre'), noControl: true };
  if (name === 'a1-takeover-confirm') {
    return {
      match: match({ status: 'live', rev: 1, score: { home: 1, away: 0 }, clockBase: clock(20 * 60, 'h1', true) }),
      events: [goalAt(1, 'home', 12)],
      otherDevice: true,
    };
  }
  if (name === 'a1-showcard') {
    return {
      match: match({ status: 'live', rev: 2, score: { home: 1, away: 0 }, clockBase: clock(34 * 60, 'h1', true) }),
      events: [goalAt(1, 'home', 12), cardAt(2, 20)],
    };
  }
  if (name === 'a1-undo-confirm') {
    return {
      match: match({ status: 'live', rev: 2, score: { home: 0, away: 0 }, clockBase: clock(34 * 60, 'h1', true) }),
      events: [cardAt(1, 20), secondYellowAt(2, 30, 1)],
    };
  }
  if (name === 'u2-no-permission') {
    return {
      match: match({ status: 'scheduled', clockBase: clock(0, 'pre', false, null) }),
      staffRoles: [],
      matchIds: [],
    };
  }
  if (name === 'u2-no-permission-host') {
    // 主辦但沒有本場指派：多一句「請先在指派頁把自己指派為記分員」。
    return { ...seedOf('u2-no-permission'), staffRoles: ['host'] };
  }
  if (name === 'u2-load-failed-network') return { ...seedOf('u2-live'), failOpen: 'network' };
  if (name === 'u2-load-failed-error') return { ...seedOf('u2-live'), failOpen: 'error' };
  if (name === 'u2-pre-wake-off') return { ...seedOf('u2-pre'), wakeOff: true };
  if (name === 'u2-live-wake-off') {
    return {
      match: match({ status: 'live', score: { home: 0, away: 0 }, clockBase: clock(3 * 60, 'h1', true) }),
      events: [],
      wakeOff: true,
    };
  }
  if (name === 'u2-fulltime-undo') return fulltimeSeed();
  if (name === 'u2-fulltime-undo-blocked') {
    return {
      ...fulltimeSeed(),
      pending: [
        rejectedEntry('rej-goal-away-00021', { kind: 'goal', side: 'away', plId: 'pl_hf10', goalKind: 'normal', matchSecond: 5100 }, 4, 'conflict', NOW - 40_000),
      ],
    };
  }
  if (name === 'a1-held-offline') return { ...seedOf('a1-held'), online: false };
  if (name === 'a1-held-pause-reserved') {
    // 已用超過 130（rev 140）：停錶已停用，加上紅色列。
    const seed = seedOf('a1-held');
    return { ...seed, match: { ...seed.match, rev: 140 } };
  }
  if (name === 'a1-held-timeout' || name === 'a1-held-timeout-collapsed') {
    const seed = timeoutSeed('timeout-op-00000003');
    return {
      ...seed,
      pending: [
        rejectedEntry('rej-goal-away-00031', { kind: 'goal', side: 'away', plId: 'pl_hf10', goalKind: 'normal', matchSecond: 560 }, 3, 'conflict', NOW - 20_000),
      ],
    };
  }
  if (name === 'u2-timeout-collapsed') return timeoutSeed('timeout-op-00000004');
  if (name === 'u2-near-cap') {
    // 已用 182（180～189）：一般級「本場紀錄接近上限」。
    const seed = seedOf('u2-live');
    return { ...seed, match: { ...seed.match, rev: 182 } };
  }
  if (name === 'u2-reader-cap') {
    // 另一分頁在記＋紀錄達上限（施工-第2批 3.10：兩句同時）。
    return {
      match: match({ status: 'live', rev: 190, score: { home: 0, away: 0 }, clockBase: clock(20 * 60, 'h1', true) }),
      reader: true,
    };
  }
  if (name === 'u2-menu' || name === 'u2-timeout-sheet' || name === 'u2-fullscreen') return seedOf('u2-live');
  if (name === 'u2-timeout-away' || name === 'u2-timeout-away-collapsed') {
    // 同 u2-timeout-stop（13 秒前開始、剩 0:47），換成客隊（海風隊）喊暫停。
    const op = name === 'u2-timeout-away' ? 'timeout-op-00000011' : 'timeout-op-00000012';
    return {
      match: match({ status: 'live', rev: 2, score: { home: 1, away: 0 }, clockBase: clock(10 * 60, 'h2', false, NOW - 8_000) }),
      events: [goalAt(1, 'home', 8), { ...timeoutAt(2, op), side: 'away' }],
    };
  }
  if (name === 'u2-timeout-picks-used') {
    // 規則：每半場 1 次。上半場進行中、主隊已在 2 分鐘前喊過一次（已走完），客隊還沒用 → 主隊鈕停用、客隊「剩 1 次」。
    return {
      ...seedOf('u2-live'),
      events: [goalAt(1, 'home', 12), goalAt(2, 'away', 28), { seq: 3, type: 'timeout', op: 'timeout-op-00000021', sid: SID, side: 'home', matchSecond: 1900, createdAt: NOW - 120_000 }],
      timeoutRaw: { enabled: true, per: 'half', count: 1, seconds: 60, stopsClock: true },
    };
  }
  if (name === 'u2-pick-away' || name === 'u2-pk-kick-sheet') return seedOf(name === 'u2-pick-away' ? 'u2-live' : 'u2-pk-live');
  if (name === 'u2-timeout-done') {
    // 暫停在 60 秒前開始（規則預設 60 秒）：倒數剛好走完，橫幅留著，主鈕變「繼續計時」。
    return {
      match: match({ status: 'live', rev: 2, score: { home: 1, away: 0 }, clockBase: clock(10 * 60, 'h2', false, NOW - 55_000) }),
      events: [
        goalAt(1, 'home', 8),
        { seq: 2, type: 'timeout', op: 'timeout-op-00000009', sid: SID, side: 'home', matchSecond: 600, createdAt: NOW - 60_000 },
      ],
    };
  }
  // 另一個分頁在記這場（reader）：流程鈕全停用。進行中打開選單→「球隊暫停」停用；開賽前→開賽鈕停用。
  if (name === 'u2-menu-disabled') return { ...seedOf('u2-live'), reader: true };
  if (name === 'u2-pre-disabled') return { ...seedOf('u2-pre'), reader: true };
  if (name === 'u2-amend-card') return seedOf('a1-showcard');
  if (name === 'a1-amend-confirm') return seedOf('a1-undo-confirm');
  const long = U2_LONG_NAMES[name];
  if (long) {
    const seed = seedOf('u2-live');
    return {
      ...seed,
      match: {
        ...seed.match,
        home: { teamId: 'en_c', name: long[0], logo: null },
        away: { teamId: 'en_h', name: long[1], logo: null },
      },
    };
  }
  return {
    match: match({ status: 'live', score: { home: 0, away: 0 }, clockBase: clock(15 * 60, 'h1', true) }),
    staffRoles: ['scorer'],
  };
}

function makeBackend(seed: Seed, failCommit: boolean): ScoringBackend {
  const state = { match: { ...seed.match, score: { ...seed.match.score }, clockBase: { ...seed.match.clockBase } } };
  const control = seed.noControl ? null : { uid: UID, sid: seed.otherDevice ? 'u2-other-sid-0000000002' : SID, takenAt: 1 };
  const events = [...(seed.events ?? [])];
  let listener: Parameters<ScoringBackend['open']>[0] | null = null;
  const port: ScoringPort = {
    async commit(plan: BatchPlan) {
      if (failCommit) throw { code: 'unavailable' };
      applyPlanLocal(state.match, events, plan, NOW);
      listener?.onMatch({
        ...state.match,
        score: { ...state.match.score },
        clockBase: { ...state.match.clockBase },
      });
      listener?.onEvents([...events], 'replace');
    },
    async loadServer() {
      return {
        match: {
          ...state.match,
          score: { ...state.match.score },
          clockBase: { ...state.match.clockBase },
        },
        control: control ? { ...control } : null,
      };
    },
    async loadTimelineFrom(minSeq: number) {
      return { events: events.filter((event) => event.seq >= minSeq), pending: false };
    },
    knownEvents: () => events,
    async takeover() {},
  };
  return {
    port,
    async open(live) {
      if (seed.failOpen === 'network') throw { code: 'unavailable' };
      if (seed.failOpen === 'error') throw new Error('harness: open failed');
      listener = live;
      return {
        match: state.match,
        control: control ? { ...control } : null,
        events: [...events],
        home: HOME,
        away: AWAY,
        staffRoles: seed.staffRoles ?? ['scorer'],
        matchIds: seed.matchIds ?? [MT],
        ...(seed.timeoutRaw !== undefined ? { timeoutRaw: seed.timeoutRaw } : {}),
        expiresAt: null,
        setVisible() {},
        stop() { listener = null; },
      };
    },
  };
}

async function makeDeps(name: string): Promise<ScoringDeps> {
  const seed = seedOf(name);
  const log = name === 'u2-storage-unavailable' ? deadLog() : new MemoryActionLog();
  if (seed.pending) {
    for (const row of seed.pending) await log.put(row);
  }
  const sids = memorySidStore();
  if (!seed.noControl) await sids.set(CID, MT, UID, SID);
  return {
    uid: UID,
    backend: makeBackend(seed, name === 'u2-pending'),
    log,
    sids,
    now: () => NOW,
    locks: seed.reader ? blockedLocks() : null,
    channel: null,
    wakeRequest: seed.wakeOff ? null : async () => ({ async release() {} }),
    tick: false,
    online: () => seed.online !== false,
    watchOnline: () => () => {},
    watchVisible: () => () => {},
    visible: () => true,
  };
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim() === name);
}

function clickButton(name: string): void {
  const node = buttonsNamed(name)[0];
  if (!node) throw new Error(`找不到按鈕：${name}`);
  node.click();
}

function clickText(part: string): void {
  const node = [...document.querySelectorAll('button')].find((el) => (el.textContent ?? '').includes(part));
  if (!node) throw new Error(`找不到按鈕：${part}`);
  node.click();
}

function hasText(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

async function until(label: string, ready: () => boolean): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 4000) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`畫面未出現：${label}`);
}

const OPEN: Record<string, () => Promise<void>> = {
  'a1-held': async () => {
    await until('待送列', () => document.querySelectorAll('.s4-pending').length >= 2);
  },
  'a1-held-many': async () => {
    await until('待送列', () => document.querySelectorAll('.s4-pending').length >= 2);
  },
  'a1-held-sheet': async () => {
    // 卡 2-0：紅色列出現時（方案 B 之後）紀錄區那顆「未套用的動作」不畫，改點紅色列開面板。
    await until('紅色列', () => heldRow() != null);
    clickHeldRow();
  },
  'a1-blocked-ht-before': async () => {
    await until('下半場開始', () => buttonsNamed('下半場開始').length > 0);
  },
  'a1-pk-blocked': async () => {
    await until('PK 大戰', () => buttonsNamed('PK 大戰').length > 0);
    clickButton('PK 大戰');
  },
  'a1-blocked-ht': async () => {
    await until('下半場開始', () => buttonsNamed('下半場開始').length > 0);
    clickButton('下半場開始');
  },
  'a1-resumed': async () => {
    await until('紅色列', () => heldRow() != null && buttonsNamed('下半場開始').length > 0);
    clickButton('下半場開始');
    await until('被擋提示', () => hasText('先處理沒送出的紀錄'));
    clickHeldRow();
    await until('重新套用', () => buttonsNamed('重新套用').length > 0);
    clickButton('重新套用');
    await until('下半場', () => buttonsNamed('終場').length > 0 && !hasText('先處理沒送出的紀錄'));
    // 關掉未套用面板，看記分頁本身。
    const close = document.querySelector<HTMLButtonElement>('.s4-sheet .ui-modal__close, .s4-sheet button[aria-label="關閉"]');
    close?.click();
  },
  'a1-pk-confirm-wait': async () => {
    await until('PK 大戰', () => buttonsNamed('PK 大戰').length > 0);
    // 量 390 寬時「PK 大戰」與確認框「開始 PK」的位置，給回報用。
    const pk = buttonsNamed('PK 大戰')[0]?.getBoundingClientRect();
    clickButton('PK 大戰');
    await until('開始 PK 大戰？', () => hasText('開始 PK 大戰？'));
    const go = buttonsNamed('開始 PK')[0];
    const box = go?.getBoundingClientRect();
    (window as unknown as { __A1_RECTS?: unknown }).__A1_RECTS = {
      pkStart: pk ? { x: pk.x, y: pk.y, w: pk.width, h: pk.height } : null,
      confirm: box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null,
      confirmDisabled: go?.disabled ?? null,
    };
  },
  'a1-pk-confirm-armed': async () => {
    await until('PK 大戰', () => buttonsNamed('PK 大戰').length > 0);
    clickButton('PK 大戰');
    await until('確認可按', () => buttonsNamed('開始 PK')[0]?.disabled === false);
  },
  'a1-kickoff-confirm': async () => {
    await until('開賽', () => document.querySelector('.s4-kickoff') != null);
    document.querySelector<HTMLButtonElement>('.s4-kickoff')?.click();
    await until('開始比賽？', () => hasText('開始比賽？'));
  },
  'a1-takeover-free': async () => {
    await until('開始記分', () => buttonsNamed('開始記分').length > 0);
    clickButton('開始記分');
  },
  'a1-takeover-confirm': async () => {
    await until('其他裝置記分中', () => buttonsNamed('其他裝置記分中').length > 0);
    clickButton('其他裝置記分中');
  },
  'a1-undo-confirm': async () => {
    await until('黃牌列', () => hasText('劉冠廷'));
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.s4-ev button')].filter((el) => (el.textContent ?? '').includes("20'"));
    rows[0]?.click();
    await until('復原', () => [...document.querySelectorAll('button')].some((el) => (el.textContent ?? '').trim().startsWith('復原')));
    [...document.querySelectorAll<HTMLButtonElement>('.s4-sheet button')].find((el) => (el.textContent ?? '').trim().startsWith('復原'))?.click();
  },
  'a1-showcard': async () => {
    await until('黃牌列', () => hasText('劉冠廷'));
    const row = [...document.querySelectorAll('button')].find((el) => (el.textContent ?? '').includes('劉冠廷') && (el.getAttribute('aria-label') ?? el.textContent ?? '').includes('20'));
    (row ?? [...document.querySelectorAll<HTMLButtonElement>('.s4-ev button')].find((el) => (el.textContent ?? '').includes("20'")))?.click();
    await until('看這張牌', () => buttonsNamed('看這張牌').length > 0);
    clickButton('看這張牌');
  },
  'u2-pk-confirm': async () => {
    await until('PK 大戰', () => buttonsNamed('PK 大戰').length > 0);
    clickButton('PK 大戰');
    await until('開始 PK 大戰？', () => hasText('開始 PK 大戰？'));
  },
  'u2-pk-goal-locked': async () => {
    await until('進球列', () => hasText('劉冠廷'));
    clickText('劉冠廷');
    await until('一般進球鎖定', () => hasText('PK 期間不能復原或改判一般進球'));
  },
  'u2-pending': async () => {
    await until('兩筆待送', () => document.querySelectorAll('.s4-pending').length >= 2);
  },
  'u2-crowded': async () => {
    // 卡 2-0：行為調整②③之後「請關閉手機自動鎖定」「離線中，已存 0 筆」不再出現，只等暫停條。
    await until('暫停列', () => hasText('結束暫停'));
  },
  'u2-fulltime-undo': async () => {
    await until('撤回終場', () => buttonsNamed('撤回終場').length > 0 && buttonsNamed('離開記分').length > 0);
  },
  'u2-fulltime-undo-blocked': async () => {
    await until('撤回終場', () => buttonsNamed('撤回終場').length > 0 && heldRow() != null);
    clickButton('撤回終場');
    await until('撤回被擋', () => hasText('先處理沒送出的紀錄，才能撤回終場'));
  },
  'a1-held-offline': async () => {
    await until('紅色列＋離線', () => heldRow() != null && hasText('離線中，已存'));
  },
  'a1-held-pause-reserved': async () => {
    await until('紅色列＋停錶已停用', () => heldRow() != null && hasText('目前不開放停錶'));
  },
  'a1-held-timeout': async () => {
    await until('紅色列＋暫停條', () => heldRow() != null && hasText('結束暫停'));
  },
  'a1-held-timeout-collapsed': async () => {
    await until('紅色列＋暫停條', () => heldRow() != null && buttonsNamed('收合').length > 0);
    clickButton('收合');
    await until('收合條', () => buttonsNamed('收合').length === 0 && document.querySelector('.s4-timeout') != null);
  },
  'u2-timeout-picks-used': async () => {
    await until('選單', () => document.querySelector('.s4-menu-btn') != null);
    document.querySelector<HTMLButtonElement>('.s4-menu-btn')?.click();
    await until('選單項目', () => document.querySelector('.s4-menu') != null);
    const item = [...document.querySelectorAll<HTMLButtonElement>('.s4-menu button')].find((el) => (el.textContent ?? '').trim() === '球隊暫停');
    if (!item) throw new Error('找不到按鈕：球隊暫停');
    item.click();
    await until('選隊鈕一顆停用', () => [...document.querySelectorAll<HTMLButtonElement>('.s4-timeout-picks button')].some((el) => el.disabled));
  },
  'u2-pick-away': async () => {
    // 客隊進球鈕：底部兩顆「進球」的第二顆（s4-hit--away）。
    await until('客隊進球鈕', () => document.querySelector('.s4-hit--away') != null);
    const goal = [...document.querySelectorAll<HTMLButtonElement>('button.s4-hit--away')].find((el) => (el.textContent ?? '').includes('進球'));
    if (!goal) throw new Error('找不到客隊進球鈕');
    goal.click();
    await until('客隊選球員面板', () => document.querySelector('.s4-sheet--away') != null && hasText('不指定球員'));
  },
  'u2-pk-kick-sheet': async () => {
    // 點最近一腳 PK 的紀錄列，事件面板只有「復原」（PK 不改判）。
    // PK 列文字是「第N輪 隊名 背號 姓名 進／未進」，取最上面（最近）那一列。
    const isKick = (el: Element) => /^第\d+輪/.test((el.textContent ?? '').trim());
    await until('PK 紀錄列', () => [...document.querySelectorAll('.s4-ev button')].some(isKick));
    const row = [...document.querySelectorAll<HTMLButtonElement>('.s4-ev button')].find(isKick);
    row?.click();
    await until('只有復原', () => !!document.querySelector('.ui-modal') && !hasText('改判'));
  },
  'u2-timeout-away': () => until('客隊暫停條', () => document.querySelector('.s4-timeout.s4-timeout--away') != null),
  'u2-timeout-away-collapsed': async () => {
    await until('客隊暫停條', () => buttonsNamed('收合').length > 0 && document.querySelector('.s4-timeout--away') != null);
    clickButton('收合');
    await until('客隊收合條', () => buttonsNamed('收合').length === 0 && document.querySelector('.s4-timeout--mini.s4-timeout--away') != null);
  },
  'u2-timeout-collapsed': async () => {
    await until('暫停條', () => buttonsNamed('收合').length > 0);
    clickButton('收合');
    await until('收合條', () => buttonsNamed('收合').length === 0 && document.querySelector('.s4-timeout') != null);
  },
  'u2-reader-cap': async () => {
    await until('兩句同時', () => hasText('這場已在另一個分頁記分') && hasText('紀錄已達上限'));
  },
  'u2-menu': async () => {
    await until('選單', () => document.querySelector('.s4-menu-btn') != null);
    document.querySelector<HTMLButtonElement>('.s4-menu-btn')?.click();
    await until('選單項目', () => document.querySelector('.s4-menu') != null);
  },
  'u2-menu-disabled': async () => {
    await until('選單', () => document.querySelector('.s4-menu-btn') != null);
    document.querySelector<HTMLButtonElement>('.s4-menu-btn')?.click();
    await until('選單項目', () => [...document.querySelectorAll<HTMLButtonElement>('.s4-menu button')].some((el) => el.disabled));
  },
  'u2-pre-disabled': () => until('開賽鈕停用', () => document.querySelector<HTMLButtonElement>('.s4-kickoff')?.disabled === true),
  'u2-fullscreen': () => until('全幅', () => document.documentElement.classList.contains('cp-score-full')),
  'u2-timeout-sheet': async () => {
    await until('選單', () => document.querySelector('.s4-menu-btn') != null);
    document.querySelector<HTMLButtonElement>('.s4-menu-btn')?.click();
    await until('選單項目', () => document.querySelector('.s4-menu') != null);
    const item = [...document.querySelectorAll<HTMLButtonElement>('.s4-menu button')].find((el) => (el.textContent ?? '').trim() === '球隊暫停');
    if (!item) throw new Error('找不到按鈕：球隊暫停');
    item.click();
    await until('暫停選隊', () => document.querySelector('.s4-timeout-picks') != null);
  },
  'u2-amend-card': async () => {
    await until('黃牌列', () => hasText('劉冠廷'));
    const row = [...document.querySelectorAll<HTMLButtonElement>('.s4-ev button')].find((el) => (el.textContent ?? '').includes("20'"));
    if (!row) throw new Error('找不到黃牌列');
    row.click();
    await until('牌的事件面板', () => buttonsNamed('看這張牌').length > 0);
  },
  'a1-amend-confirm': async () => {
    await until('黃牌列', () => hasText('劉冠廷'));
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.s4-ev button')].filter((el) => (el.textContent ?? '').includes("20'"));
    rows[0]?.click();
    await until('改判', () => [...document.querySelectorAll('.s4-sheet button')].some((el) => (el.textContent ?? '').trim().startsWith('改判')));
    [...document.querySelectorAll<HTMLButtonElement>('.s4-sheet button')].find((el) => (el.textContent ?? '').trim().startsWith('改判'))?.click();
  },
  'u2-pre-wake-off': async () => {
    await until('開賽', () => document.querySelector('.s4-kickoff') != null);
  },
};

/** 紅色可點列（`.s4-banner__tap`，記分小批 §3.459 (a)）。 */
function heldRow(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.s4-banner__tap');
}

function clickHeldRow(): void {
  const node = heldRow();
  if (!node) throw new Error('找不到紅色列');
  node.click();
}

void start();

async function start(): Promise<void> {
  await setLocale('zh-TW');
  await loadCompetitionsDict('zh-TW');
  const root = document.getElementById('app');
  const win = window as unknown as { __CPS_READY: boolean; __CPS_ERROR?: string };
  if (!root) return;
  try {
    if (!(U2_SCREENS as readonly string[]).includes(screenName)) {
      throw new Error(`沒有這個 screen：${screenName}`);
    }
    const screenDeps = await makeDeps(screenName);
    if (framed) await import('@/ui/app-shell.css');
    const pad = screenName === 'u2-signed-out'
      ? <SignedOut cid={CID} />
      : <ScoringScreen cid={CID} mtId={MT} deps={screenDeps} nowMs={NOW} />;
    render(
      <LocationProvider>
        {framed ? (
          <div class="app-shell ui-app-shell">
            {/* 頂欄與底部導覽的替身：只為驗證全幅時被藏起來（正式元件要登入與路由，不在這裡畫）。 */}
            <header id="top-bar" style="position:fixed;top:0;left:0;right:0;height:56px;display:flex;align-items:center;justify-content:center;background:#334155;color:#fff;z-index:50">App 頂欄（全幅時應隱藏）</header>
            <main class="app-main">{pad}</main>
            <nav id="bottom-tabs" style="position:fixed;bottom:0;left:0;right:0;height:64px;display:flex;align-items:center;justify-content:center;background:#334155;color:#fff;z-index:50">App 底部導覽（全幅時應隱藏）</nav>
          </div>
        ) : pad}
      </LocationProvider>,
      root,
    );
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await OPEN[screenName]?.();
    const anchor = ANCHORS[screenName];
    if (anchor) await until(anchor, () => hasText(anchor));
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
