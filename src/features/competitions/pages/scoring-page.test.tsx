import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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
import { LIVE_COPY } from '../live/copy';
import { loadCompetitionsDict } from '../i18n';
import { ScoringScreen } from './ScoringPage';

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
      return events.filter((event) => event.seq >= minSeq);
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
} = {}): Promise<{ deps: ScoringDeps; plans: BatchPlan[] }> {
  const made = backend(options);
  const sids = memorySidStore();
  await sids.set(CID, MT, UID, SID);
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

function draw(screenDeps: ScoringDeps): void {
  render(
    <LocationProvider>
      <ScoringScreen cid={CID} mtId={MT} deps={screenDeps} nowMs={NOW} />
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
  });

  it('沒有指派的主辦看得到說明', async () => {
    const made = await deps({ staffRoles: ['host'], matchIds: [] });
    draw(made.deps);
    expect(await screen.findByText(LIVE_COPY.noScorePermission)).toBeTruthy();
    expect(screen.getByText(LIVE_COPY.assignScorerHint)).toBeTruthy();
  });

  it('指派過期不開記分板', async () => {
    const made = await deps({ staffRoles: ['scorer'], matchIds: [MT], expiresAt: NOW });
    draw(made.deps);
    expect(await screen.findByText(LIVE_COPY.noScorePermission)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '開賽' })).toBeNull();
  });

  it('記分員與已指派的主辦看得到記分板', async () => {
    const scorer = await deps({ staffRoles: ['scorer'], matchIds: [MT] });
    draw(scorer.deps);
    expect(await screen.findByRole('button', { name: '開賽' })).toBeTruthy();
    cleanup();
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
    expect(await screen.findByRole('button', { name: '下半場開始' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '繼續計時' })).toBeNull();
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
    const buttons = [...(document.querySelector('.s4-root')?.querySelectorAll('button') ?? [])];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('儲存不可用仍可記分，並顯示既有警告', async () => {
    const made = await deps({
      log: deadLog(),
      match: {
        status: 'live',
        clockBase: { startedAt: NOW, pausedSec: 15 * 60, running: true, period: 'h1' },
      },
    });
    draw(made.deps);
    expect(await screen.findByText(LIVE_COPY.offlineUnstored)).toBeTruthy();
    expect(screen.getByRole('button', { name: '終場' })).toBeTruthy();
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
  });
});
