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
  'u2-reader-tab',
  'u2-no-permission',
  'u2-storage-unavailable',
] as const;

const ANCHORS: Record<string, string> = {
  'u2-pre': '開賽',
  'u2-live': '34:00',
  'u2-pending': '待送',
  'u2-pk-confirm': '開始 PK 大戰？',
  'u2-pk-live': 'PK 3:2',
  'u2-pk-goal-locked': 'PK 期間不能復原或改判一般進球',
  'u2-timeout-stop': '暫停',
  'u2-reader-tab': '這場已在另一個分頁記分',
  'u2-no-permission': '你沒有這場的記分權限',
  'u2-storage-unavailable': '離線紀錄無法保存',
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

function goalEvent(): ServerEvent {
  return {
    seq: 1,
    type: 'goal',
    op: 'goal-op-000000000001',
    sid: SID,
    side: 'home',
    plId: 'pl_th9',
    goalKind: 'normal',
    matchSecond: 12 * 60,
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
  reader?: boolean;
  pending?: LogEntry[];
}

function seedOf(name: string): Seed {
  if (name === 'u2-pre') {
    return { match: match({ status: 'scheduled', clockBase: clock(0, 'pre', false, null) }) };
  }
  if (name === 'u2-live') {
    return { match: match({ status: 'live', score: { home: 1, away: 1 }, clockBase: clock(34 * 60, 'h1', true) }) };
  }
  if (name === 'u2-pending') {
    return {
      match: match({ status: 'live', score: { home: 1, away: 0 }, clockBase: clock(12 * 60, 'h1', true) }),
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
        score: { home: 1, away: 1 },
        clockBase: clock(90 * 60, 'h2', false, null),
        penaltyScore: null,
      }),
    };
  }
  if (name === 'u2-pk-live') {
    return {
      match: match({
        status: 'live',
        score: { home: 1, away: 1 },
        clockBase: clock(0, 'pk', false, null),
        penaltyScore: { home: 3, away: 2 },
      }),
    };
  }
  if (name === 'u2-pk-goal-locked') {
    return {
      match: match({
        status: 'live',
        rev: 1,
        score: { home: 1, away: 1 },
        clockBase: clock(0, 'pk', false, null),
        penaltyScore: { home: 0, away: 0 },
      }),
      events: [goalEvent()],
    };
  }
  if (name === 'u2-timeout-stop') {
    return {
      match: match({
        status: 'live',
        rev: 1,
        score: { home: 1, away: 0 },
        clockBase: clock(10 * 60, 'h2', false, NOW - 8_000),
      }),
      events: [{
        seq: 1,
        type: 'timeout',
        op: 'timeout-op-00000001',
        sid: SID,
        side: 'home',
        matchSecond: 600,
        createdAt: NOW - 13_000,
      }],
    };
  }
  if (name === 'u2-reader-tab') {
    return {
      match: match({ status: 'live', score: { home: 0, away: 0 }, clockBase: clock(20 * 60, 'h1', true) }),
      reader: true,
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
        control: { uid: UID, sid: SID, takenAt: 1 },
      };
    },
    async loadTimelineFrom(minSeq: number) {
      return events.filter((event) => event.seq >= minSeq);
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
        control: { uid: UID, sid: SID, takenAt: 1 },
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
    wakeRequest: async () => ({ async release() {} }),
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
