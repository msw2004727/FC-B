import { cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryActionLog } from './data/action-log';
import { applyPlanLocal } from './data/batch';
import type { ScoringBackend } from './data/live-repo';
import { memorySidStore } from './data/sid';
import type { BatchPlan, ScoringPort, ServerEvent, ServerMatch } from './data/types';
import { useScoring, type ScoringDeps } from './useScoring';

const CID = 'c1';
const MT = 'm1';
const UID = 'user-1';
const SID = 'hook-local-sid-00000001';

function match(): ServerMatch {
  return {
    id: MT,
    status: 'live',
    rev: 0,
    resetRev: 0,
    score: { home: 0, away: 0 },
    lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'h1' },
    finishedAt: null,
    home: { teamId: 'en_h', name: '主', logo: null },
    away: { teamId: 'en_a', name: '客', logo: null },
    divisionId: 'dv',
  };
}

function backend(): ScoringBackend {
  const state = { match: match() };
  const events: ServerEvent[] = [];
  const port: ScoringPort = {
    async commit(plan: BatchPlan) {
      applyPlanLocal(state.match, events, plan, 10);
    },
    async loadServer() {
      return {
        match: { ...state.match, score: { ...state.match.score }, clockBase: { ...state.match.clockBase } },
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
    port,
    async open() {
      return {
        match: state.match,
        control: { uid: UID, sid: SID, takenAt: 1 },
        events: [],
        home: [],
        away: [],
        staffRoles: ['scorer'],
        setVisible() {},
        stop() {},
      };
    },
  };
}

afterEach(() => cleanup());

describe('useScoring', () => {
  it('注入依賴後可以記一球，而且不在載入時連正式後端', async () => {
    const sids = memorySidStore();
    await sids.set(CID, MT, UID, SID);
    const deps: ScoringDeps = {
      uid: UID,
      backend: backend(),
      log: new MemoryActionLog(),
      sids,
      locks: null,
      channel: null,
      wakeRequest: null,
      tick: false,
      watchOnline: () => () => {},
      watchVisible: () => () => {},
    };
    let home = -1;
    let loading = true;
    const box = {
      go: (): Promise<void> => Promise.resolve(),
    };
    function Probe() {
      const view = useScoring(CID, MT, deps);
      home = view.score.home;
      loading = view.loading;
      box.go = () => view.actions.goal({ side: 'home' }).then(() => undefined);
      return <p>{loading ? 'load' : home}</p>;
    }
    render(<Probe />);
    await waitFor(() => expect(loading).toBe(false));
    await box.go();
    await waitFor(() => expect(home).toBe(1));
  });
});
