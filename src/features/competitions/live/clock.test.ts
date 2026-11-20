import { describe, expect, it } from 'vitest';
import type { MatchClock } from '../data/types';
import { addedBaseMin, clockFromBase, formatMatchClock, stageLabel } from './clock';

describe('clockFromBase', () => {
  it('開始、跑 5 分、暫停 83 秒、繼續再跑 1 分', () => {
    const t0 = 1_700_000_000_000;
    const start: MatchClock = { startedAt: t0, pausedSec: 0, running: true, period: 'h1' };
    expect(clockFromBase(start, t0)).toEqual({ elapsedSec: 0, holdSec: null, period: 'h1' });

    const ran = clockFromBase(start, t0 + 5 * 60 * 1000);
    expect(ran.elapsedSec).toBe(5 * 60);
    expect(ran.holdSec).toBeNull();

    const pauseAt = t0 + 5 * 60 * 1000;
    const paused: MatchClock = { startedAt: pauseAt, pausedSec: 5 * 60, running: false, period: 'h1' };
    const held = clockFromBase(paused, pauseAt + 83 * 1000);
    expect(held.elapsedSec).toBe(5 * 60);
    expect(held.holdSec).toBe(83);
    expect(formatMatchClock(held.holdSec ?? 0)).toBe('01:23');

    const resumeAt = pauseAt + 83 * 1000;
    const resumed: MatchClock = { startedAt: resumeAt, pausedSec: 5 * 60, running: true, period: 'h1' };
    const more = clockFromBase(resumed, resumeAt + 60 * 1000);
    expect(more.elapsedSec).toBe(6 * 60);
    expect(more.holdSec).toBeNull();
  });

  it('中場用同一套：已進行凍結，holdSec 是已休息秒數', () => {
    const t0 = 1_700_000_000_000;
    const ht: MatchClock = { startedAt: t0, pausedSec: 45 * 60, running: false, period: 'ht' };
    expect(clockFromBase(ht, t0 + 8 * 60 * 1000)).toEqual({
      elapsedSec: 45 * 60,
      holdSec: 8 * 60,
      period: 'ht',
    });
  });

  it('補時基準固定，不跟目前秒數走', () => {
    const early = { elapsedSec: 20 * 60, period: 'h1' as const, addedMin: 2 };
    const later = { elapsedSec: 46 * 60 + 10, period: 'h1' as const, addedMin: 2 };
    expect(addedBaseMin(early)).toBe(45);
    expect(addedBaseMin(later)).toBe(45);
    expect(stageLabel(early)).toBe("45+2'");
    expect(stageLabel(later)).toBe("45+2'");
    expect(addedBaseMin({ elapsedSec: 91 * 60, period: 'h2', addedMin: 4 })).toBe(90);
    expect(stageLabel({ elapsedSec: 91 * 60, period: 'h2', addedMin: 4 })).toBe("90+4'");
    expect(stageLabel({ elapsedSec: 20 * 60 + 30, period: 'h1', addedMin: 2, periodBaseMin: 20 })).toBe("20+2'");
    expect(stageLabel({ elapsedSec: 47 * 60, period: 'h1', addedMin: 2, periodBaseMin: 20 })).toBe("20+2'");
  });
});
