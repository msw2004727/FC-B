import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getCurrentLocale } from '@/i18n/i18n';
import { scoreAccess } from '../live/access';
import { MemoryActionLog, type ActionLog } from '../live/data/action-log';
import { applyPlanLocal } from '../live/data/batch';
import type { ScoringBackend } from '../live/data/live-repo';
import { memorySidStore } from '../live/data/sid';
import { createScoringSession, type ScoringView } from '../live/data/session';
import type { BatchPlan, ScoringPort, ServerEvent, ServerMatch } from '../live/data/types';
import type { LockManager } from '../live/data/tab-lock';
import { RELEASE_WAIT_MS, useScoring, type ScoringDeps } from '../live/useScoring';
import { LIVE_COPY, pauseRemain, teamAction } from '../live/copy';
import { loadCompetitionsDict } from '../i18n';
import { SCORE_FULLSCREEN_CLASS, ScoringScreen } from './ScoringPage';

const CID = 'comp-u2';
const MT = 'mt-u2';
const UID = 'scorer-u2';
const SID = 'u2-local-sid-00000000001';
const NOW = 1_763_510_400_000;

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
  await loadCompetitionsDict(getCurrentLocale());
});

afterEach(() => cleanup());

function serverMatch(partial: Partial<ServerMatch> = {}): ServerMatch {
  return {
    id: MT,
    status: 'scheduled',
    rev: 0,
    resetRev: 0,
    score: { home: 0, away: 0 },
    lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' },
    finishedAt: null,
    home: { teamId: 'en_h', name: '雷霆隊', logo: null },
    away: { teamId: 'en_a', name: '海風隊', logo: null },
    divisionId: 'dv1',
    penaltyScore: null,
    ...partial,
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

function backend(options: {
  match?: Partial<ServerMatch>;
  events?: ServerEvent[];
  staffRoles?: string[];
  matchIds?: string[];
  expiresAt?: number | null;
  commit?: (plan: BatchPlan) => void;
} = {}): { backend: ScoringBackend; plans: BatchPlan[] } {
  const state = { match: serverMatch(options.match) };
  const events = [...(options.events ?? [])];
  const plans: BatchPlan[] = [];
  let listener: Parameters<ScoringBackend['open']>[0] | null = null;
  const port: ScoringPort = {
    async commit(plan) {
      plans.push(plan);
      options.commit?.(plan);
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
      return { events: events.filter((event) => event.seq >= minSeq), pending: false };
    },
    knownEvents: () => events,
    async takeover() {},
  };
  return {
    plans,
    backend: {
      port,
      async open(live) {
        listener = live;
        return {
          match: state.match,
          control: { uid: UID, sid: SID, takenAt: 1 },
          events: [...events],
          home: [{ id: 'pl_th9', enId: 'en_h', displayName: '劉冠廷', number: 9, position: 'FW', positionText: null, isMinor: false }],
          away: [],
          staffRoles: options.staffRoles ?? ['scorer'],
          matchIds: options.matchIds ?? [MT],
          expiresAt: options.expiresAt ?? null,
          setVisible() {},
          stop() { listener = null; },
        };
      },
    },
  };
}

async function deps(options: Parameters<typeof backend>[0] & {
  locks?: LockManager | null;
  online?: boolean;
  log?: ActionLog;
  /** false：本機沒有 sid，畫面要先接手。 */
  withSid?: boolean;
} = {}): Promise<{ deps: ScoringDeps; plans: BatchPlan[] }> {
  const made = backend(options);
  const sids = memorySidStore();
  if (options.withSid !== false) await sids.set(CID, MT, UID, SID);
  return {
    plans: made.plans,
    deps: {
      uid: UID,
      backend: made.backend,
      log: options.log ?? new MemoryActionLog(),
      sids,
      now: () => NOW,
      locks: options.locks === undefined ? null : options.locks,
      channel: null,
      wakeRequest: async () => ({ async release() {} }),
      tick: false,
      online: () => options.online !== false,
      watchOnline: () => () => {},
      watchVisible: () => () => {},
      visible: () => true,
    },
  };
}

function draw(screenDeps: ScoringDeps, clubRepCheck?: () => Promise<boolean>): void {
  render(
    <LocationProvider>
      <ScoringScreen cid={CID} mtId={MT} deps={screenDeps} nowMs={NOW} clubRepCheck={clubRepCheck} />
    </LocationProvider>,
  );
}

describe('正式記分頁權限', () => {
  it('陌生人只有空狀態，沒有指派說明', async () => {
    const made = await deps({ staffRoles: [], matchIds: [] });
    draw(made.deps);
    expect(await screen.findByText(LIVE_COPY.noScorePermission)).toBeTruthy();
    expect(screen.queryByText(LIVE_COPY.assignScorerHint)).toBeNull();
    expect(screen.queryByRole('button', { name: '開賽' })).toBeNull();
    expect(screen.getByRole('button', { name: LIVE_COPY.backToSchedule })).toBeTruthy();
    expect(document.querySelector('.cps-top')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '記分' })).toBeTruthy();
    // 沒有記分權限時保留 App 外框（顧問審 a7026243 P2-1）。
    expect(document.documentElement.classList.contains(SCORE_FULLSCREEN_CLASS)).toBe(false);
  });

  it('沒有指派的主辦看得到說明', async () => {
    const made = await deps({ staffRoles: ['host'], matchIds: [] });
    draw(made.deps);
    expect(await screen.findByText(LIVE_COPY.noScorePermission)).toBeTruthy();
    expect(screen.getByText(LIVE_COPY.assignScorerHint)).toBeTruthy();
  });

  it('俱樂部目前代表沒有主辦 staff 文件，也看得到說明；前代表與陌生人看不到', async () => {
    const rep = await deps({ staffRoles: [], matchIds: [] });
    const check = vi.fn(async () => true);
    draw(rep.deps, check);
    expect(await screen.findByText(LIVE_COPY.assignScorerHint)).toBeTruthy();
    expect(check).toHaveBeenCalledTimes(1);
    cleanup();

    const former = await deps({ staffRoles: [], matchIds: [] });
    draw(former.deps, async () => false);
    expect(await screen.findByText(LIVE_COPY.noScorePermission)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByText(LIVE_COPY.assignScorerHint)).toBeNull();
    cleanup();

    // 已有本場指派或 staff 已是主辦：不再問代表（不多讀）
    const assigned = await deps({ staffRoles: ['scorer'], matchIds: [MT] });
    const unused = vi.fn(async () => true);
    draw(assigned.deps, unused);
    expect(await screen.findByRole('button', { name: '開賽' })).toBeTruthy();
    cleanup();
    const host = await deps({ staffRoles: ['host'], matchIds: [] });
    draw(host.deps, unused);
    expect(await screen.findByText(LIVE_COPY.assignScorerHint)).toBeTruthy();
    expect(unused).not.toHaveBeenCalled();
  });

  it('指派過期不開記分板', async () => {
    const made = await deps({ staffRoles: ['scorer'], matchIds: [MT], expiresAt: NOW });
    draw(made.deps);
    expect(await screen.findByText(LIVE_COPY.noScorePermission)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '開賽' })).toBeNull();
    expect(document.documentElement.classList.contains(SCORE_FULLSCREEN_CLASS)).toBe(false);
  });

  it('記分員與已指派的主辦看得到記分板', async () => {
    const scorer = await deps({ staffRoles: ['scorer'], matchIds: [MT] });
    draw(scorer.deps);
    const kickoff = await screen.findByRole('button', { name: '開賽' }) as HTMLButtonElement;
    expect(kickoff.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: LIVE_COPY.takeoverAction })).toBeNull();
    expect(document.querySelector('.cps-top')).toBeNull();
    expect(document.querySelector('h1')).toBeNull();
    expect(document.title).toBe('記分');
    // 記分板出現才全幅；離開（卸載）就恢復 App 外框。
    await waitFor(() => expect(document.documentElement.classList.contains(SCORE_FULLSCREEN_CLASS)).toBe(true));
    cleanup();
    expect(document.documentElement.classList.contains(SCORE_FULLSCREEN_CLASS)).toBe(false);
    const host = await deps({ staffRoles: ['host', 'referee'], matchIds: [MT] });
    draw(host.deps);
    expect(await screen.findByRole('button', { name: '開賽' })).toBeTruthy();
    expect(screen.queryByText(LIVE_COPY.assignScorerHint)).toBeNull();
  });
});

describe('G-06 進場失敗不是沒有權限', () => {
  const LIVE_MATCH: Partial<ServerMatch> = {
    status: 'live',
    rev: 1,
    clockBase: { startedAt: NOW - 60_000, pausedSec: 0, running: true, period: 'h1' },
  };

  function offline(): Error {
    return Object.assign(new Error('Failed to get document because the client is offline.'), {
      code: 'unavailable',
      name: 'FirebaseError',
    });
  }

  function denied(): Error {
    return Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
      name: 'FirebaseError',
    });
  }

  function internal(): Error {
    return Object.assign(new Error('INTERNAL ASSERTION FAILED'), {
      code: 'internal',
      name: 'FirebaseError',
    });
  }

  /** 前 fails 次 open 丟 err，之後照常。gate 不為 null 時成功那次等 gate 放行。 */
  function flaky(target: ScoringDeps, fails: number, err: () => Error, gate: Promise<void> | null = null) {
    const real = target.backend!.open.bind(target.backend!);
    const open = vi.fn(async (...args: Parameters<ScoringBackend['open']>) => {
      if (open.mock.calls.length <= fails) throw err();
      if (gate) await gate;
      return real(...args);
    });
    target.backend!.open = open;
    return open;
  }

  /** 讓 promise 與 0 毫秒計時器跑完（假時鐘下不能用 findBy）。 */
  async function settle(ms = 0): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    }
  }

  function withWatchers(target: ScoringDeps, visible: { value: boolean }) {
    const fire: { online: Array<(next: boolean) => void>; visible: Array<() => void> } = { online: [], visible: [] };
    target.visible = () => visible.value;
    target.watchOnline = (cb) => {
      fire.online.push(cb);
      return () => { fire.online = fire.online.filter((item) => item !== cb); };
    };
    target.watchVisible = (cb) => {
      fire.visible.push(cb);
      return () => { fire.visible = fire.visible.filter((item) => item !== cb); };
    };
    return fire;
  }

  async function pendingLog(): Promise<MemoryActionLog> {
    const log = new MemoryActionLog();
    for (const [op, side] of [['g06-pend-goal-000001', 'away'], ['g06-pend-goal-000002', 'away']] as const) {
      await log.put({
        op, cid: CID, mtId: MT, uid: UID, sid: SID, kind: 'goal', state: 'pending',
        createdAt: NOW - 5_000, attempts: 0, baseResetRev: 0,
        intent: { kind: 'goal', side, goalKind: 'normal', matchSecond: 400 },
      });
    }
    return log;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('網路類失敗顯示讀取失敗與重試，不是沒有權限；5 秒後自動重試成功並送出佇列一次', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const log = await pendingLog();
    const made = await deps({ match: LIVE_MATCH, log });
    const open = flaky(made.deps, 1, offline);
    draw(made.deps);
    await settle();
    expect(screen.getByText(LIVE_COPY.loadFailedAuto)).toBeTruthy();
    expect(screen.getByRole('button', { name: LIVE_COPY.retry })).toBeTruthy();
    // 鈕的順序：回賽程在左、重試在右（顧問 §3.467）。
    const actions = [...document.querySelectorAll('.cps-actions button')].map((node) => node.textContent);
    expect(actions).toEqual([LIVE_COPY.backToSchedule, LIVE_COPY.retry]);
    expect(screen.queryByText(LIVE_COPY.noScorePermission)).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    expect(made.plans).toHaveLength(0);
    await settle(4_999);
    expect(open).toHaveBeenCalledTimes(1);
    await settle(1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(LIVE_COPY.loadFailedAuto)).toBeNull();
    expect(screen.queryByText(LIVE_COPY.noScorePermission)).toBeNull();
    expect(made.plans.map((plan) => plan.op)).toEqual(['g06-pend-goal-000001', 'g06-pend-goal-000002']);
    // 成功後不再進場。
    await settle(120_000);
    expect(open).toHaveBeenCalledTimes(2);
    expect(made.plans).toHaveLength(2);
  });

  it('退避 5／10／20 秒，之後每 30 秒', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const made = await deps({ match: LIVE_MATCH });
    const open = flaky(made.deps, 99, offline);
    draw(made.deps);
    await settle();
    const marks: number[] = [];
    for (const wait of [5_000, 10_000, 20_000, 30_000, 30_000]) {
      await settle(wait - 1);
      marks.push(open.mock.calls.length);
      await settle(1);
    }
    expect(marks).toEqual([1, 2, 3, 4, 5]);
    expect(open).toHaveBeenCalledTimes(6);
  });

  it('其他錯誤只給重試鈕，不自動重試；按重試才再進場', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const made = await deps({ match: LIVE_MATCH });
    const visible = { value: true };
    const fire = withWatchers(made.deps, visible);
    const open = flaky(made.deps, 1, internal);
    draw(made.deps);
    await settle();
    expect(screen.getByText(LIVE_COPY.loadFailed)).toBeTruthy();
    expect(screen.queryByText(LIVE_COPY.loadFailedAuto)).toBeNull();
    expect(screen.queryByText(LIVE_COPY.noScorePermission)).toBeNull();
    await settle(300_000);
    for (const cb of [...fire.online]) cb(true);
    for (const cb of [...fire.visible]) cb();
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.retry }));
    await settle();
    expect(open).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(LIVE_COPY.loadFailed)).toBeNull();
  });

  it('讀取成功但沒有指派：沒有記分權限，不重試', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const made = await deps({ match: LIVE_MATCH, staffRoles: [], matchIds: [] });
    const visible = { value: true };
    const fire = withWatchers(made.deps, visible);
    const open = flaky(made.deps, 0, offline);
    draw(made.deps);
    await settle();
    expect(screen.getByText(LIVE_COPY.noScorePermission)).toBeTruthy();
    expect(screen.queryByRole('button', { name: LIVE_COPY.retry })).toBeNull();
    for (const cb of [...fire.online]) cb(true);
    for (const cb of [...fire.visible]) cb();
    await settle(300_000);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('Rules 拒讀（沒有指派的人讀 control）：照舊沒有記分權限，沒有重試鈕，不自動重試', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const made = await deps({ match: LIVE_MATCH, staffRoles: [], matchIds: [] });
    const visible = { value: true };
    const fire = withWatchers(made.deps, visible);
    const open = flaky(made.deps, 99, denied);
    draw(made.deps);
    await settle();
    expect(screen.getByText(LIVE_COPY.noScorePermission)).toBeTruthy();
    expect(screen.queryByText(LIVE_COPY.loadFailed)).toBeNull();
    expect(screen.queryByText(LIVE_COPY.loadFailedAuto)).toBeNull();
    expect(screen.queryByRole('button', { name: LIVE_COPY.retry })).toBeNull();
    for (const cb of [...fire.online]) cb(true);
    for (const cb of [...fire.visible]) cb();
    await settle(300_000);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('顧問 §3.472 P3-a：進場期間按的重試，若這次結果是 Rules 拒讀（沒有權限），不再重進', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const made = await deps({ match: LIVE_MATCH, staffRoles: [], matchIds: [] });
    const visible = { value: true };
    withWatchers(made.deps, visible);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // 第 1 次：網路錯誤（出現讀取失敗＋重試）；第 2 次：卡在 gate 後被 Rules 拒讀；之後若再呼叫就成功（不該發生）。
    const real = made.deps.backend!.open.bind(made.deps.backend!);
    const open = vi.fn(async (...args: Parameters<ScoringBackend['open']>) => {
      const n = open.mock.calls.length;
      if (n === 1) throw offline();
      if (n === 2) {
        await gate;
        throw denied();
      }
      return real(...args);
    });
    made.deps.backend!.open = open;
    draw(made.deps);
    await settle();
    expect(screen.getByText(LIVE_COPY.loadFailedAuto)).toBeTruthy();
    const retry = screen.getByRole('button', { name: LIVE_COPY.retry });
    fireEvent.click(retry);
    await settle();
    expect(open).toHaveBeenCalledTimes(2);
    // 第 2 次進場還卡在 gate：舊錯誤畫面上的重試再按一次（會排隊）
    fireEvent.click(retry);
    release();
    await settle(5_000);
    expect(screen.getByText(LIVE_COPY.noScorePermission)).toBeTruthy();
    expect(screen.queryByRole('button', { name: LIVE_COPY.retry })).toBeNull();
    await settle(300_000);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('重試鈕、online、回到前景、計時器同時觸發，只進場一次、佇列只送一次', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const log = await pendingLog();
    const made = await deps({ match: LIVE_MATCH, log });
    const visible = { value: true };
    const fire = withWatchers(made.deps, visible);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const open = flaky(made.deps, 1, offline, gate);
    draw(made.deps);
    await settle();
    expect(screen.getByText(LIVE_COPY.loadFailedAuto)).toBeTruthy();
    // 第二次進場卡在 gate：期間其他來源一起觸發。
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.retry }));
    for (const cb of [...fire.online]) cb(true);
    for (const cb of [...fire.visible]) cb();
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.retry }));
    await settle(5_000);
    for (const cb of [...fire.online]) cb(true);
    await settle();
    expect(open).toHaveBeenCalledTimes(2);
    release();
    await settle();
    expect(open).toHaveBeenCalledTimes(2);
    expect(made.plans.map((plan) => plan.op)).toEqual(['g06-pend-goal-000001', 'g06-pend-goal-000002']);
    // 成功後監聽已解除。
    // 只剩工作階段自己掛的 online、visible 各一個（useScoring 的已解除）。
    expect(fire.online.length + fire.visible.length).toBe(2);
    for (const cb of [...fire.online]) cb(true);
    for (const cb of [...fire.visible]) cb();
    await settle(120_000);
    expect(open).toHaveBeenCalledTimes(2);
    expect(made.plans).toHaveLength(2);
  });

  it('頁面藏起來不排重試，回到前景才進場', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const made = await deps({ match: LIVE_MATCH });
    const visible = { value: false };
    const fire = withWatchers(made.deps, visible);
    const open = flaky(made.deps, 1, offline);
    draw(made.deps);
    await settle();
    expect(screen.getByText(LIVE_COPY.loadFailedAuto)).toBeTruthy();
    await settle(120_000);
    expect(open).toHaveBeenCalledTimes(1);
    for (const cb of [...fire.online]) cb(true);
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    visible.value = true;
    for (const cb of [...fire.visible]) cb();
    await settle();
    expect(open).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(LIVE_COPY.loadFailedAuto)).toBeNull();
  });

  /**
   * 假的 Web Locks：同名同時只給一個；ifAvailable 拿不到回 null。
   * release：'macrotask'＝callback 結束後下一個 macrotask 才真的放（瀏覽器實際行為）；
   * 'never'＝鎖放了但 request 的 promise 永遠不回（放鎖訊號遺失）。grant 不為 null 時先等它才給鎖。
   */
  function fakeLocks(release: 'macrotask' | 'never', grant: Promise<void> | null = null) {
    const state = { held: false, granted: 0, denied: 0 };
    const locks: LockManager = {
      async request(name, options, callback) {
        if (grant) await grant;
        if (state.held && options.ifAvailable) {
          state.denied += 1;
          await callback(null);
          return;
        }
        state.held = true;
        state.granted += 1;
        await callback({ name });
        if (release === 'never') {
          state.held = false;
          await new Promise<void>(() => {});
        }
        await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
        state.held = false;
      },
    };
    return { locks, state };
  }

  it('P2-1：Web Locks 下一個 macrotask 才放，進場失敗後立刻按重試，重進仍是 owner、佇列照送', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const log = await pendingLog();
    const fake = fakeLocks('macrotask');
    const made = await deps({ match: LIVE_MATCH, log, locks: fake.locks });
    const open = flaky(made.deps, 1, offline);
    draw(made.deps);
    // 只跑 promise，不推計時器：鎖還沒真的放掉。
    for (let index = 0; index < 60; index += 1) await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(LIVE_COPY.loadFailedAuto)).toBeTruthy();
    expect(fake.state.held).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.retry }));
    await settle(1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(fake.state.denied).toBe(0);
    expect(fake.state.granted).toBe(2);
    expect(made.plans.map((plan) => plan.op)).toEqual(['g06-pend-goal-000001', 'g06-pend-goal-000002']);
  });

  it('P2-1：放鎖訊號永遠不回來，約 1 秒後照樣打開進場門', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fake = fakeLocks('never');
    const made = await deps({ match: LIVE_MATCH, locks: fake.locks });
    const open = flaky(made.deps, 1, offline);
    draw(made.deps);
    await settle();
    expect(screen.getByText(LIVE_COPY.loadFailedAuto)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.retry }));
    await settle(RELEASE_WAIT_MS - 10);
    expect(open).toHaveBeenCalledTimes(1);
    await settle(10);
    expect(open).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(LIVE_COPY.loadFailedAuto)).toBeNull();
  });

  it('P3-1：還在等分頁鎖時就 stop，之後拿到的鎖會放掉', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let grant = () => {};
    const gate = new Promise<void>((resolve) => { grant = resolve; });
    const fake = fakeLocks('macrotask', gate);
    const made = await deps({ match: LIVE_MATCH, locks: fake.locks });
    const session = createScoringSession({
      cid: CID, mtId: MT, uid: UID, backend: made.deps.backend!, log: new MemoryActionLog(), sids: made.deps.sids,
      now: () => NOW, locks: fake.locks, channel: null, wakeRequest: null, tick: false,
      online: () => true, watchOnline: () => () => {}, visible: () => true, watchVisible: () => () => {},
    });
    const started = session.start();
    await settle();
    void session.stop();
    grant();
    await started;
    await settle(1);
    expect(fake.state.granted).toBe(1);
    expect(fake.state.held).toBe(false);
  });

  it('離開頁面清掉計時器與監聽', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const made = await deps({ match: LIVE_MATCH });
    const visible = { value: true };
    const fire = withWatchers(made.deps, visible);
    const open = flaky(made.deps, 99, offline);
    draw(made.deps);
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    cleanup();
    expect(fire.online).toHaveLength(0);
    expect(fire.visible).toHaveLength(0);
    await settle(300_000);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('正式記分頁走 useScoring', () => {
  it('中場不出現繼續計時', async () => {
    const made = await deps({
      match: {
        status: 'halftime',
        clockBase: { startedAt: NOW, pausedSec: 45 * 60, running: false, period: 'ht' },
      },
    });
    draw(made.deps);
    const resume = await screen.findByRole('button', { name: '下半場開始' }) as HTMLButtonElement;
    expect(resume.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: '繼續計時' })).toBeNull();
    expect(screen.queryByRole('button', { name: LIVE_COPY.takeoverAction })).toBeNull();
  });

  it('終場超過 180 秒不能復原也不能改判', async () => {
    const made = await deps({
      match: { status: 'finished', rev: 1, finishedAt: NOW - 200_000 },
      events: [{
        seq: 1, type: 'goal', op: 'goal-op-000000000001', sid: SID, side: 'home', plId: 'pl_th9',
        goalKind: 'normal', matchSecond: 300, createdAt: NOW - 200_000,
      }],
    });
    draw(made.deps);
    // 列上的可見文字與 sr-only 標籤都含球員名，不能用單一 findByText。
    expect((await screen.findAllByText(/劉冠廷/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /復原/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /改判/ })).toBeNull();
  });

  it('改判第一黃先作廢第二黃，兩步依序', async () => {
    const made = await deps({
      match: {
        status: 'live',
        clockBase: { startedAt: NOW, pausedSec: 600, running: true, period: 'h1' },
      },
    });
    let current: ScoringView | null = null;
    function Probe() {
      current = useScoring(CID, MT, made.deps);
      return <p>{current.loading ? 'load' : 'ready'}</p>;
    }
    render(<Probe />);
    await waitFor(() => expect(current?.loading).toBe(false));
    expect((await current!.actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' })).status).toBe('applied');
    expect((await current!.actions.card({ side: 'home', plId: 'pl_a', cardType: 'yellow' })).status).toBe('applied');
    const before = made.plans.length;
    const amended = await current!.actions.amend(
      { seq: 1 },
      { kind: 'card', side: 'home', plId: 'pl_a', cardType: 'red', matchSecond: 30 },
    );
    expect(amended.status).toBe('applied');
    const added = made.plans.slice(before);
    expect(added.map((plan) => plan.event.type)).toEqual(['void', 'void', 'card']);
    expect(added[0]?.event.targetSeq).toBe(2);
    expect(added[1]?.event.targetSeq).toBe(1);
  });

  it('另一個分頁全部記分按鈕停用', async () => {
    const made = await deps({
      locks: blockedLocks(),
      match: {
        status: 'live',
        clockBase: { startedAt: NOW, pausedSec: 20 * 60, running: true, period: 'h1' },
      },
    });
    draw(made.deps);
    expect(await screen.findByText('這場已在另一個分頁記分')).toBeTruthy();
    const buttons = [...(document.querySelector('.s4-root')?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
    const menu = buttons.filter((button) => (button.getAttribute('aria-label') || '') === LIVE_COPY.matchMenu);
    expect(menu).toHaveLength(1);
    expect(menu[0]?.disabled).toBe(false);
    const scoring = buttons.filter((button) => button !== menu[0]);
    expect(scoring.length).toBeGreaterThan(0);
    for (const button of scoring) expect(button.disabled).toBe(true);
  });

  it('全幅記分板的選單最後一項離開記分，回到賽程列表', async () => {
    const previous = `${window.location.pathname}${window.location.search}`;
    const made = await deps({ staffRoles: ['scorer'], matchIds: [MT] });
    draw(made.deps);
    fireEvent.click(await screen.findByRole('button', { name: LIVE_COPY.matchMenu }));
    const menu = document.getElementById('s4-clock-menu');
    const labels = [...(menu?.querySelectorAll('button') ?? [])].map((button) => (button.textContent || '').trim());
    expect(labels.at(-1)).toBe(LIVE_COPY.leaveScore);
    expect(document.querySelector('.cps-top')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.leaveScore }));
    await waitFor(() => expect(window.location.pathname).toBe(`/competitions/${CID}/matches`));
    window.history.pushState(null, '', previous || '/');
  });

  const liveMatch = {
    status: 'live' as const,
    score: { home: 0, away: 0 },
    clockBase: { startedAt: NOW, pausedSec: 15 * 60, running: true, period: 'h1' },
  };

  function expectScoringLocked(): void {
    const names = [
      teamAction('雷霆隊', LIVE_COPY.goal),
      teamAction('海風隊', LIVE_COPY.goal),
      teamAction('雷霆隊', LIVE_COPY.yellow),
      teamAction('海風隊', LIVE_COPY.yellow),
      teamAction('雷霆隊', LIVE_COPY.red),
      teamAction('海風隊', LIVE_COPY.red),
      LIVE_COPY.halftime,
      pauseRemain(20),
      LIVE_COPY.fulltime,
    ];
    for (const name of names) {
      const nodes = screen.getAllByRole('button', { name });
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        const button = node as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-disabled')).toBe('true');
      }
    }
    const take = screen.getByRole('button', { name: LIVE_COPY.takeoverAction }) as HTMLButtonElement;
    expect(take.disabled).toBe(false);
    expect(screen.queryByText(LIVE_COPY.takeoverEntry)).toBeNull();
    const menu = screen.getByRole('button', { name: LIVE_COPY.matchMenu }) as HTMLButtonElement;
    expect(menu.disabled).toBe(false);
  }

  async function confirmTakeover(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.takeoverAction }));
    const dialog = document.querySelector('.s4-dialog');
    expect(dialog).toBeTruthy();
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find((node) =>
      (node.textContent ?? '').includes(LIVE_COPY.takeoverAction),
    );
    expect(confirm).toBeTruthy();
    // 接手確認鈕打開後短暫停用（防連點），等它可按再按。
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false), { timeout: 2000 });
    fireEvent.click(confirm as HTMLButtonElement);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: LIVE_COPY.takeoverAction })).toBeNull();
      expect(screen.queryByText(LIVE_COPY.takeoverEntry)).toBeNull();
    });
  }

  async function scoreHomeGoal(): Promise<void> {
    const goal = screen.getByRole('button', { name: teamAction('雷霆隊', LIVE_COPY.goal) }) as HTMLButtonElement;
    expect(goal.disabled).toBe(false);
    fireEvent.click(goal);
    fireEvent.click(await screen.findByRole('button', { name: LIVE_COPY.unspecified }));
    await waitFor(() => {
      expect(document.querySelector('.s4-score')?.textContent).toBe('1:0');
    });
  }

  it('儲存不可用要先接手，記分按鈕停用', async () => {
    const made = await deps({ log: deadLog(), match: liveMatch });
    draw(made.deps);
    expect(await screen.findByText(LIVE_COPY.offlineUnstored)).toBeTruthy();
    expectScoringLocked();
    fireEvent.click(screen.getByRole('button', { name: teamAction('雷霆隊', LIVE_COPY.goal) }));
    expect(screen.queryByRole('button', { name: LIVE_COPY.unspecified })).toBeNull();
    expect(document.querySelector('.s4-score')?.textContent).toBe('0:0');
    expect(screen.queryByText(LIVE_COPY.pending)).toBeNull();
    await confirmTakeover();
    expect(screen.getByText(LIVE_COPY.offlineUnstored)).toBeTruthy();
    await scoreHomeGoal();
  });

  it('需要接手時按進球不產生日誌，接手後可以記', async () => {
    const log = new MemoryActionLog();
    const made = await deps({ log, withSid: false, match: liveMatch });
    draw(made.deps);
    expect(await screen.findByRole('button', { name: LIVE_COPY.takeoverAction })).toBeTruthy();
    expectScoringLocked();
    fireEvent.click(screen.getByRole('button', { name: teamAction('雷霆隊', LIVE_COPY.goal) }));
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.halftime }));
    fireEvent.click(screen.getByRole('button', { name: pauseRemain(20) }));
    fireEvent.click(screen.getByRole('button', { name: LIVE_COPY.fulltime }));
    expect(screen.queryByRole('button', { name: LIVE_COPY.unspecified })).toBeNull();
    expect(document.querySelector('.s4-score')?.textContent).toBe('0:0');
    expect(screen.queryByText(LIVE_COPY.pending)).toBeNull();
    expect(await log.list(CID, MT)).toEqual([]);
    await confirmTakeover();
    await scoreHomeGoal();
    const rows = await log.list(CID, MT);
    expect(rows.map((row) => row.kind)).toEqual(['goal']);
  });

  it('進行中的球隊暫停由事件推出，重整後仍在', async () => {
    const made = await deps({
      events: [{
        seq: 1,
        type: 'timeout',
        op: 'timeout-op-00000001',
        sid: SID,
        side: 'home',
        matchSecond: 600,
        createdAt: NOW - 13_000,
      }],
      match: {
        status: 'live',
        rev: 1,
        score: { home: 1, away: 0 },
        clockBase: { startedAt: NOW - 8_000, pausedSec: 600, running: false, period: 'h2' },
      },
    });
    draw(made.deps);
    expect(await screen.findByText('雷霆隊暫停 0:47')).toBeTruthy();
    cleanup();
    draw(made.deps);
    expect(await screen.findByText('雷霆隊暫停 0:47')).toBeTruthy();
  });

  it('暫停剛好走完顯示繼續計時', async () => {
    const made = await deps({
      events: [{
        seq: 1,
        type: 'timeout',
        op: 'timeout-op-00000001',
        sid: SID,
        side: 'home',
        matchSecond: 600,
        createdAt: NOW - 60_000,
      }],
      match: {
        status: 'live',
        rev: 1,
        score: { home: 1, away: 0 },
        clockBase: { startedAt: null, pausedSec: 600, running: false, period: 'h2' },
      },
    });
    draw(made.deps);
    await waitFor(() => {
      expect(document.querySelector('.s4-timeout__text')?.textContent).toBe(LIVE_COPY.resumeClock);
    });
  });
});

describe('scoreAccess', () => {
  const base = { matchIds: [] as string[], expiresAt: null, mtId: MT, nowMs: NOW };

  it('只認本場未過期的記分或裁判指派', () => {
    expect(scoreAccess({ ...base, roles: [] })).toEqual({ pad: false, hint: false });
    expect(scoreAccess({ ...base, roles: ['admin'] })).toEqual({ pad: false, hint: false });
    expect(scoreAccess({ ...base, roles: ['host'] })).toEqual({ pad: false, hint: true });
    expect(scoreAccess({ ...base, roles: ['coHost'] })).toEqual({ pad: false, hint: true });
    expect(scoreAccess({ ...base, roles: ['scorer'], matchIds: [MT] })).toEqual({ pad: true, hint: false });
    expect(scoreAccess({ ...base, roles: ['referee'], matchIds: [MT] })).toEqual({ pad: true, hint: false });
    expect(scoreAccess({ ...base, roles: ['scorer'], matchIds: ['other'] })).toEqual({ pad: false, hint: false });
    expect(scoreAccess({ ...base, roles: ['host', 'scorer'], matchIds: [MT] })).toEqual({ pad: true, hint: false });
    expect(scoreAccess({
      ...base, roles: ['scorer'], matchIds: [MT], expiresAt: NOW,
    })).toEqual({ pad: false, hint: false });
    expect(scoreAccess({
      ...base, roles: ['host', 'scorer'], matchIds: [MT], expiresAt: NOW - 1,
    })).toEqual({ pad: false, hint: true });
    // 俱樂部目前代表：沒有指派時看提示；代表指派自己記分後開記分板
    expect(scoreAccess({ ...base, roles: [], clubRep: true })).toEqual({ pad: false, hint: true });
    expect(scoreAccess({ ...base, roles: ['scorer'], matchIds: [MT], clubRep: true })).toEqual({ pad: true, hint: false });
  });
});
