// 正式記分頁截圖。假 ScoringBackend 與記憶體日誌，不連 Firestore。
// ?screen= 與 ?theme=light|dark。畫完且錨點出現後設 window.__CPS_READY。
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/features/competitions/live/live.css';
import { setLocale } from '@/i18n/i18n';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import { ScoringScreen } from '@/features/competitions/pages/ScoringPage';
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
  'a1-held-sheet',
  'a1-blocked-ht',
  'a1-resumed',
  'a1-pk-confirm-wait',
  'a1-pk-confirm-armed',
  'a1-kickoff-confirm',
  'a1-takeover-confirm',
  'a1-showcard',
] as const;

const ANCHORS: Record<string, string> = {
  'u2-pre': '開賽',
  'u2-live': '34:00',
  'u2-pending': '待送',
  'u2-pk-confirm': '開始 PK 大戰？',
  'u2-pk-live': 'PK 3:2',
  'u2-pk-goal-locked': 'PK 期間不能復原或改判一般進球',
  'u2-timeout-stop': '暫停',
  'u2-crowded': '結束暫停',
  'u2-reader-tab': '這場已在另一個分頁記分',
  'u2-no-permission': '你沒有這場的記分權限',
  'u2-storage-unavailable': '離線紀錄無法保存',
  'u2-long-name': '34:00',
  'a1-held': '之後記的 2 筆先存在這支手機',
  'a1-held-sheet': '重新套用',
  'a1-blocked-ht': '先處理沒送出的紀錄，才能開始下半場',
  'a1-resumed': '終場',
  'a1-pk-confirm-wait': '開始 PK 大戰？',
  'a1-pk-confirm-armed': '開始 PK 大戰？',
  'a1-kickoff-confirm': '開始比賽？',
  'a1-takeover-confirm': '接手後，另一支裝置記的動作會送不出去',
  'a1-showcard': '點一下關閉',
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
  if (name === 'a1-held' || name === 'a1-held-sheet') {
    return {
      match: match({ status: 'live', rev: 1, score: { home: 1, away: 0 }, clockBase: clock(31 * 60, 'h1', true) }),
      events: [goalAt(1, 'home', 12)],
      pending: [
        rejectedEntry('rej-goal-away-00001', { kind: 'goal', side: 'away', plId: 'pl_hf10', goalKind: 'normal', matchSecond: 1500 }, 2, 'conflict', NOW - 60_000),
        pendingGoal('pend-goal-home-00002', 'home', 'pl_th9', NOW - 30_000),
        pendingGoal('pend-goal-home-00003', 'home', 'pl_th9', NOW - 10_000),
      ],
    };
  }
  if (name === 'a1-blocked-ht' || name === 'a1-resumed') {
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
  if (name === 'u2-no-permission') {
    return {
      match: match({ status: 'scheduled', clockBase: clock(0, 'pre', false, null) }),
      staffRoles: [],
      matchIds: [],
    };
  }
  return {
    match: match({ status: 'live', score: { home: 0, away: 0 }, clockBase: clock(15 * 60, 'h1', true) }),
    staffRoles: ['scorer'],
  };
}

function makeBackend(seed: Seed, failCommit: boolean): ScoringBackend {
  const state = { match: { ...seed.match, score: { ...seed.match.score }, clockBase: { ...seed.match.clockBase } } };
  const control = { uid: UID, sid: seed.otherDevice ? 'u2-other-sid-0000000002' : SID, takenAt: 1 };
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
        control: { ...control },
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
      listener = live;
      return {
        match: state.match,
        control: { ...control },
        events: [...events],
        home: HOME,
        away: AWAY,
        staffRoles: seed.staffRoles ?? ['scorer'],
        matchIds: seed.matchIds ?? [MT],
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
  await sids.set(CID, MT, UID, SID);
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
  'a1-held-sheet': async () => {
    await until('未套用的動作', () => buttonsNamed('未套用的動作').length > 0);
    clickButton('未套用的動作');
  },
  'a1-blocked-ht': async () => {
    await until('下半場開始', () => buttonsNamed('下半場開始').length > 0);
    clickButton('下半場開始');
  },
  'a1-resumed': async () => {
    await until('未套用的動作', () => buttonsNamed('未套用的動作').length > 0);
    clickButton('下半場開始');
    await until('被擋提示', () => hasText('先處理沒送出的紀錄'));
    clickButton('未套用的動作');
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
  'a1-takeover-confirm': async () => {
    await until('其他裝置記分中', () => buttonsNamed('其他裝置記分中').length > 0);
    clickButton('其他裝置記分中');
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
    await until('暫停列與兩條提示', () => hasText('結束暫停') && hasText('請關閉手機自動鎖定') && hasText('離線中，已存'));
  },
};

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
    render(
      <LocationProvider>
        <ScoringScreen cid={CID} mtId={MT} deps={screenDeps} nowMs={NOW} />
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
