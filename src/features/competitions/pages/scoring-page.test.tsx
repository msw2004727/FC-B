import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getCurrentLocale } from '@/i18n/i18n';
import { scoreAccess } from '../live/access';
import { MemoryActionLog, type ActionLog } from '../live/data/action-log';
import { applyPlanLocal } from '../live/data/batch';
import type { ScoringBackend } from '../live/data/live-repo';
import { memorySidStore } from '../live/data/sid';
import type { ScoringView } from '../live/data/session';
import type { BatchPlan, ScoringPort, ServerEvent, ServerMatch } from '../live/data/types';
import type { LockManager } from '../live/data/tab-lock';
import { useScoring, type ScoringDeps } from '../live/useScoring';
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
