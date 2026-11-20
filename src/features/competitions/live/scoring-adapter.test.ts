import { describe, expect, it, vi } from 'vitest';
import { loadingView, type ScoringView } from './data/session';
import type { ServerEvent, ServerMatch } from './data/types';
import { pkCanStart, shootoutOffered } from './present';
import { LIVE_COPY, offlineChip } from './copy';
import { scorePadPropsFrom, timeoutUsesFrom, timeoutViewFrom } from './scoring-adapter';

const NOW = 1_763_510_400_000;

function serverMatch(partial: Partial<ServerMatch> = {}): ServerMatch {
  return {
    id: 'mt-1',
    status: 'live',
    rev: 2,
    resetRev: 0,
    score: { home: 1, away: 0 },
    lock: { locked: false },
    clockBase: { startedAt: NOW, pausedSec: 120, running: true, period: 'h1' },
    finishedAt: null,
    home: { teamId: 'en_h', name: '雷霆隊', logo: null },
    away: { teamId: 'en_a', name: '海風隊', logo: null },
    divisionId: 'dv1',
    penaltyScore: null,
    ...partial,
  };
}

function view(partial: Partial<ScoringView> = {}): ScoringView {
  const base = loadingView();
  return {
    ...base,
    loading: false,
    match: serverMatch(),
    clock: { elapsedSec: 120, holdSec: null, period: 'h1' },
    score: { home: 2, away: 1, pendingCount: 2, server: { home: 1, away: 0 } },
    budget: { ...base.budget, used: 4, pauseUses: 1, pauseLeft: 19 },
    roster: {
      home: [{ id: 'pl_th9', enId: 'en_h', displayName: '劉冠廷', number: 9, position: 'FW', positionText: null, isMinor: false }],
      away: [],
    },
    ...partial,
    actions: { ...base.actions, ...partial.actions },
  };
}

describe('scorePadPropsFrom', () => {
  it('逐欄接到記分板，而且比分以畫面疊加為準', () => {
    const goal = vi.fn(async () => ({ status: 'applied' as const }));
    const card = vi.fn(async () => ({ status: 'applied' as const }));
    const pk = vi.fn(async () => ({ status: 'applied' as const }));
    const voidEvent = vi.fn(async () => ({ status: 'applied' as const }));
    const pauseClock = vi.fn(async () => ({ status: 'applied' as const }));
    const resumeClock = vi.fn(async () => ({ status: 'applied' as const }));
    const kickoff = vi.fn(async () => ({ status: 'applied' as const }));
    const halftime = vi.fn(async () => ({ status: 'applied' as const }));
    const resume = vi.fn(async () => ({ status: 'applied' as const }));
    const fulltime = vi.fn(async () => ({ status: 'applied' as const }));
    const undoFinish = vi.fn(async () => ({ status: 'applied' as const }));
    const pkStart = vi.fn(async () => ({ status: 'applied' as const }));
    const timeout = vi.fn(async () => ({ status: 'applied' as const }));
    const reapply = vi.fn(async () => ({ status: 'applied' as const }));
    const discard = vi.fn(async () => ({ status: 'applied' as const }));
    const takeover = vi.fn(async () => ({ status: 'applied' as const }));
    const sub = vi.fn(async () => ({ status: 'applied' as const }));
    const correctClock = vi.fn(async () => ({ status: 'applied' as const }));
    const amend = vi.fn(async () => ({ status: 'applied' as const }));
    const undoFirstYellow = vi.fn(async () => ({ status: 'applied' as const }));
    const goalEvent: ServerEvent = {
      seq: 1, type: 'goal', op: 'goal-op-000000000001', sid: 'sid', side: 'home', plId: 'pl_th9',
      goalKind: 'normal', matchSecond: 60, createdAt: NOW,
    };
    const current = view({
      events: [goalEvent],
      unapplied: [{
        op: 'pend-goal-0000000001',
        kind: 'goal',
        state: 'pending',
        createdAt: NOW + 1,
        intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 90 },
        summary: '客隊 進球',
      }, {
        op: 'rej-goal-00000000001',
        kind: 'goal',
        state: 'rejected',
        rejectReason: 'rules',
        createdAt: NOW,
        intent: { kind: 'goal', side: 'home', goalKind: 'normal', matchSecond: 30 },
        summary: '主隊 進球',
      }],
      control: { uid: 'u', sid: 's', localSid: 's', needsTakeover: true, takeoverSelf: false },
      connection: { online: false, wakeLock: 'held' },
      pk: { started: false, score: null, canStart: true },
      actions: {
        goal, card, pk, voidEvent, pauseClock, resumeClock, kickoff, halftime, resume,
        fulltime, undoFinish, pkStart, timeout, reapply, discard, takeover,
        sub, correctClock, amend, undoFirstYellow,
      },
    });
    const props = scorePadPropsFrom(current, NOW);
    expect(props.match.id).toBe('mt-1');
    expect(props.match.status).toBe('live');
    expect(props.match.score).toEqual({ home: 2, away: 1 });
    expect(props.match.penaltyScore).toBeNull();
    expect(props.match.result).toBeNull();
    expect(props.match.clockBase.period).toBe('h1');
    expect(props.homeRoster).toHaveLength(1);
    expect(props.awayRoster).toEqual([]);
    expect(props.events.filter((event) => event.type === 'goal')).toHaveLength(1);
    expect(props.voids).toEqual([]);
    expect(props.actionLog.map((row) => row.id)).toEqual(['rej-goal-00000000001']);
    expect(props.eventCount).toBe(4);
    expect(props.pauseUses).toBe(1);
    expect(props.crests).toEqual([]);
    expect(props.link).toEqual({ online: false, pendingCount: 2, storageUnavailable: false, wakeLock: true });
    expect(offlineChip(props.link.pendingCount)).toBe('離線・2 筆待送');
    expect(props.clock).toEqual({ elapsedSec: 120, period: 'h1', addedMin: null });
    expect(props.nowMs).toBe(NOW);
    expect(props.takeoverOffered).toBe(true);
    expect(props.takeoverSelf).toBe(false);
    expect(props.timeoutView).toBeUndefined();
    expect(props.scoringDisabled).toBe(false);
    expect(props.topBanner).toBeNull();
    expect(props.storageBanner).toBe(false);
    expect(props.clockControlled).toBe(true);
    expect(props.timeoutControlled).toBe(true);
    expect(props.confirmPk).toBe(true);
    expect(props.lockRegularGoals).toBe(false);
    expect(props.pkCanStart).toBe(true);
    expect(props.pkDigits).toBeNull();
    expect(props.timeoutRule).toEqual(current.timeoutRule);
    expect(props.feed?.[0]).toMatchObject({ key: 'pend-goal-0000000001', pending: true });
    expect(props.feed?.[1]).toMatchObject({ key: 'goal-op-000000000001', pending: false, seq: 1 });
    expect(props.feed?.some((row) => row.key === 'rej-goal-00000000001')).toBe(false);

    expect(props.onRecord?.({ side: 'home', action: 'goal', plId: null, goalKind: 'normal', minute: 3 })).toBe(true);
    expect(goal).toHaveBeenCalledWith({ side: 'home', goalKind: 'normal' });
    expect(props.onRecord?.({ side: 'away', action: 'yellow', plId: null, goalKind: null, minute: 4 })).toBe(true);
    expect(card).not.toHaveBeenCalled();
    expect(props.onRecord?.({ side: 'away', action: 'red', plId: 'pl_hf4', goalKind: null, minute: 4 })).toBe(true);
    expect(card).toHaveBeenCalledWith({ side: 'away', plId: 'pl_hf4', cardType: 'red' });
    expect(props.onRecord?.({ side: 'home', action: 'pk-in', plId: 'pl_th9', goalKind: null, minute: 9 })).toBe(true);
    expect(pk).toHaveBeenCalledWith({ side: 'home', scored: true, plId: 'pl_th9' });
    expect(props.onUndo?.(1)).toBe(true);
    expect(voidEvent).toHaveBeenCalledWith({ seq: 1 });
    props.onClock?.({ running: false, period: 'h1', pausedSec: 10, startedAt: NOW });
    expect(pauseClock).toHaveBeenCalledTimes(1);
    props.onClock?.({ running: true, period: 'h1', pausedSec: 10, startedAt: NOW });
    expect(resumeClock).toHaveBeenCalledTimes(1);
    props.onKickoff?.();
    props.onHalftime?.();
    props.onResume?.();
    props.onFulltime?.();
    props.onUndoFulltime?.();
    props.onStartPk?.();
    props.onTimeout?.('home');
    props.onReapply?.('op');
    props.onDiscard?.('op');
    props.onTakeover?.();
    expect(kickoff).toHaveBeenCalledTimes(1);
    expect(halftime).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(fulltime).toHaveBeenCalledTimes(1);
    expect(undoFinish).toHaveBeenCalledTimes(1);
    expect(pkStart).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith({ side: 'home' });
    expect(reapply).toHaveBeenCalledWith('op');
    expect(discard).toHaveBeenCalledWith('op');
    expect(takeover).toHaveBeenCalledTimes(1);
  });

  it('讀分頁停用全部記分，儲存不可用時打開既有警告', () => {
    const props = scorePadPropsFrom(view({
      tab: 'reader',
      tabHint: '這場已在另一個分頁記分',
      storage: 'unavailable',
      storageHint: LIVE_COPY.offlineUnstored,
      connection: { online: true, wakeLock: 'unsupported' },
      pk: { started: true, score: { home: 3, away: 2 }, canStart: false },
    }), NOW);
    expect(props.scoringDisabled).toBe(true);
    expect(props.topBanner).toBe('這場已在另一個分頁記分');
    expect(props.storageBanner).toBe(true);
    expect(props.link.storageUnavailable).toBe(true);
    expect(props.link.wakeLock).toBe(false);
    expect(props.lockRegularGoals).toBe(true);
    expect(props.pkDigits).toEqual({ home: 3, away: 2 });
    expect(props.pkCanStart).toBe(false);
  });

  it('半場只數最近一次開賽或半場之後的暫停，整場則全數', () => {
    const events: ServerEvent[] = [
      { seq: 1, type: 'kickoff', op: 'kick', sid: 's', matchSecond: 0, createdAt: 1 },
      { seq: 2, type: 'timeout', op: 'to1', sid: 's', side: 'home', matchSecond: 10, createdAt: 2 },
      { seq: 3, type: 'halftime', op: 'ht', sid: 's', matchSecond: 20, createdAt: 3 },
      { seq: 4, type: 'timeout', op: 'to2', sid: 's', side: 'home', matchSecond: 30, createdAt: 4 },
    ];
    const half = timeoutUsesFrom(view({
      events,
      timeoutRule: { enabled: true, per: 'half', count: 1, seconds: 60, stopsClock: true },
      unapplied: [{
        op: 'to-pend',
        kind: 'timeout',
        state: 'sending',
        createdAt: 5,
        intent: { kind: 'timeout', side: 'away', matchSecond: 40 },
        summary: '客隊 暫停',
      }],
    }));
    expect(half).toEqual({ home: 1, away: 1 });
    const whole = timeoutUsesFrom(view({
      events,
      timeoutRule: { enabled: true, per: 'match', count: 2, seconds: 60, stopsClock: false },
    }));
    expect(whole).toEqual({ home: 2, away: 0 });
  });

  it('暫停倒數由最新事件與規則秒數推出', () => {
    const rule60 = { enabled: true, per: 'half' as const, count: 1, seconds: 60, stopsClock: true };
    const running = timeoutEvent({ createdAt: NOW - 13_000 });
    const props = scorePadPropsFrom(view({ events: [running], timeoutRule: rule60 }), NOW);
    expect(props.timeoutView).toEqual({ side: 'home', leftSec: 47, startedAt: NOW - 13_000 });
    expect(timeoutViewFrom(view({
      events: [timeoutEvent({ createdAt: NOW - 60_000 })],
      timeoutRule: rule60,
    }), NOW)).toEqual({ side: 'home', leftSec: 0, startedAt: NOW - 60_000 });
    expect(timeoutViewFrom(view({
      events: [timeoutEvent({ createdAt: NOW - 120_000 })],
      timeoutRule: rule60,
    }), NOW)).toBeUndefined();
    expect(timeoutViewFrom(view({
      events: [timeoutEvent({ createdAt: NOW + 5_000 })],
      timeoutRule: rule60,
    }), NOW)).toEqual({ side: 'home', leftSec: 60, startedAt: NOW + 5_000 });
    const rule90 = { enabled: true, per: 'match' as const, count: 2, seconds: 90, stopsClock: false };
    expect(timeoutViewFrom(view({
      events: [
        timeoutEvent({ seq: 2, side: 'away', createdAt: NOW - 50_000 }),
        timeoutEvent({ seq: 5, side: 'home', createdAt: NOW - 43_000, op: 'timeout-op-00000005' }),
      ],
      timeoutRule: rule90,
    }), NOW)).toEqual({ side: 'home', leftSec: 47, startedAt: NOW - 43_000 });
  });

  it('待送暫停較新才蓋過伺服器，重置前的不算', () => {
    const rule60 = { enabled: true, per: 'half' as const, count: 1, seconds: 60, stopsClock: true };
    const server = timeoutEvent({ seq: 4, createdAt: NOW - 10_000 });
    const newer = timeoutViewFrom(view({
      events: [server],
      timeoutRule: rule60,
      unapplied: [{
        op: 'pend-to-new',
        kind: 'timeout',
        state: 'pending',
        createdAt: NOW - 4_000,
        intent: { kind: 'timeout', side: 'away', matchSecond: 40 },
        summary: '客隊 暫停',
      }],
    }), NOW);
    expect(newer).toEqual({ side: 'away', leftSec: 56, startedAt: NOW - 4_000 });
    const older = timeoutViewFrom(view({
      events: [server],
      timeoutRule: rule60,
      unapplied: [{
        op: 'pend-to-old',
        kind: 'timeout',
        state: 'sending',
        createdAt: NOW - 30_000,
        intent: { kind: 'timeout', side: 'away', matchSecond: 20 },
        summary: '客隊 暫停',
      }],
    }), NOW);
    expect(older).toEqual({ side: 'home', leftSec: 50, startedAt: NOW - 10_000 });
    expect(timeoutViewFrom(view({
      match: serverMatch({ resetRev: 4 }),
      events: [
        timeoutEvent({ seq: 4, createdAt: NOW - 5_000, side: 'away' }),
        timeoutEvent({ seq: 5, createdAt: NOW - 13_000, op: 'timeout-op-00000005' }),
      ],
      timeoutRule: rule60,
    }), NOW)).toEqual({ side: 'home', leftSec: 47, startedAt: NOW - 13_000 });
  });
});

function timeoutEvent(partial: Partial<ServerEvent> = {}): ServerEvent {
  return {
    seq: 2,
    type: 'timeout',
    op: 'timeout-op-00000001',
    sid: 's',
    side: 'home',
    matchSecond: 600,
    createdAt: NOW - 13_000,
    ...partial,
  };
}

describe('pkCanStart 與 shootoutOffered', () => {
  const periods = ['h1', 'ht', 'h2', 'et', 'et1', 'et2', 'pk', 'ft'];
  const statuses = ['live', 'halftime', 'scheduled', 'finished'];

  it('沒有 PK 比分、也沒有待送 pkStart 時，兩者相同', () => {
    for (const period of periods) {
      for (const running of [true, false]) {
        for (const status of statuses) {
          for (const tied of [true, false]) {
            const home = 1;
            const away = tied ? 1 : 0;
            const offered = shootoutOffered({ live: status === 'live', running, period, home, away });
            const can = pkCanStart({
              status, running, period, home, away, penalty: null, pendingPkStart: false,
            });
            expect(can).toBe(offered);
          }
        }
      }
    }
  });

  it('已有 PK 比分或待送 pkStart 時不能再開始', () => {
    const base = {
      status: 'live', running: false, period: 'h2', home: 1, away: 1, pendingPkStart: false,
    };
    expect(shootoutOffered({ live: true, running: false, period: 'h2', home: 1, away: 1 })).toBe(true);
    expect(pkCanStart({ ...base, penalty: { home: 0, away: 0 } })).toBe(false);
    expect(pkCanStart({ ...base, penalty: null, pendingPkStart: true })).toBe(false);
  });
});

describe('P1-A 中場改判鎖', () => {
  it('疊加狀態是中場才把進球鎖成只能復原', () => {
    expect(scorePadPropsFrom(view({ liveStatus: 'halftime' }), NOW).halftimeGoalUndoOnly).toBe(true);
    expect(scorePadPropsFrom(view({ liveStatus: 'live' }), NOW).halftimeGoalUndoOnly).toBe(false);
    expect(scorePadPropsFrom(view({ liveStatus: null }), NOW).halftimeGoalUndoOnly).toBe(false);
  });
});
