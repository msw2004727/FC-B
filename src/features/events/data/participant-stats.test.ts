import { describe, it, expect } from 'vitest';

import { getEventParticipantStats, isEventTrulyFull } from './participant-stats';
import type { EventDoc, RegistrationDoc } from './types';

function ev(overrides: Record<string, unknown> = {}): EventDoc {
  return { id: 'evt-1', title: 'X', status: 'open', ...overrides } as unknown as EventDoc;
}

/** A 依顯示名稱去重計數，所以測試報名預設帶 userId／userName（由 _docId 推出）。 */
function reg(overrides: Record<string, unknown> = {}): RegistrationDoc {
  const id = String(overrides._docId ?? 'r');
  return { status: 'confirmed', userId: `u-${id}`, userName: `名-${id}`, ...overrides } as unknown as RegistrationDoc;
}

describe('getEventParticipantStats', () => {
  it('counts confirmed registrations and computes remaining count', () => {
    const stats = getEventParticipantStats(ev({ max: 10 }), [
      reg({ _docId: 'r1' }),
      reg({ _docId: 'r2' }),
      reg({ _docId: 'r3' }),
    ]);
    expect(stats.confirmedCount).toBe(3);
    expect(stats.occupiedCount).toBe(3);
    expect(stats.waitlistCount).toBe(0);
    expect(stats.maxCount).toBe(10);
    expect(stats.remainingCount).toBe(7);
    expect(stats.isCapacityFull).toBe(false);
    expect(stats.showFullBadge).toBe(false);
  });

  it('counts waitlist registrations separately', () => {
    const stats = getEventParticipantStats(ev({ max: 2 }), [
      reg({ _docId: 'r1', status: 'confirmed' }),
      reg({ _docId: 'r2', status: 'confirmed' }),
      reg({ _docId: 'r3', status: 'waitlisted' }),
      reg({ _docId: 'r4', status: 'waitlisted' }),
    ]);
    expect(stats.confirmedCount).toBe(2);
    expect(stats.waitlistCount).toBe(2);
    expect(stats.isCapacityFull).toBe(true);
    expect(stats.showFullBadge).toBe(true);
  });

  it('counts companions (participantType=companion) as separate confirmed people', () => {
    const stats = getEventParticipantStats(ev({ max: 10 }), [
      reg({ _docId: 'r1', userId: 'u-1', userName: '主' }),
      reg({ _docId: 'r2', userId: 'u-1', userName: '主', participantType: 'companion', companionId: 'c-1', companionName: '同行甲' }),
      reg({ _docId: 'r3', userId: 'u-1', userName: '主', participantType: 'companion', companionId: 'c-2', companionName: '同行乙' }),
    ]);
    expect(stats.confirmedCount).toBe(3);
    expect(stats.occupiedCount).toBe(3);
  });

  it('A 規則：沒有名字的報名不計、同名只算一次', () => {
    const stats = getEventParticipantStats(ev({ max: 10 }), [
      reg({ _docId: 'r1', userName: '小明' }),
      reg({ _docId: 'r2', userName: '小明' }),
      reg({ _docId: 'r3', userName: '' }),
    ]);
    expect(stats.confirmedCount).toBe(1);
  });

  it('有正取報名但沒有候補報名時，候補沿用活動文件的 waitlist 欄位', () => {
    const stats = getEventParticipantStats(ev({ max: 10, waitlist: 4 }), [reg({ _docId: 'r1' })]);
    expect(stats.waitlistCount).toBe(4);
  });

  it('excludes cancelled and removed registrations from counts', () => {
    const stats = getEventParticipantStats(ev({ max: 10 }), [
      reg({ _docId: 'r1', status: 'confirmed' }),
      reg({ _docId: 'r2', status: 'cancelled' }),
      reg({ _docId: 'r3', status: 'removed' }),
      reg({ _docId: 'r4', status: 'cancelled' }),
    ]);
    expect(stats.confirmedCount).toBe(1);
    expect(stats.occupiedCount).toBe(1);
  });

  it('marks isCapacityFull and showFullBadge when occupied >= max', () => {
    const stats = getEventParticipantStats(ev({ max: 3 }), [
      reg({ _docId: 'r1' }),
      reg({ _docId: 'r2' }),
      reg({ _docId: 'r3' }),
    ]);
    expect(stats.isCapacityFull).toBe(true);
    expect(stats.showFullBadge).toBe(true);
    expect(stats.remainingCount).toBe(0);
  });

  it('suppresses full badge when event is ended or cancelled', () => {
    const stats = getEventParticipantStats(ev({ max: 2, status: 'ended' }), [
      reg({ _docId: 'r1' }),
      reg({ _docId: 'r2' }),
    ]);
    expect(stats.isCapacityFull).toBe(true);
    expect(stats.showFullBadge).toBe(false);
  });

  it('falls back to event fields when registrations are empty', () => {
    const stats = getEventParticipantStats(ev({ max: 10, current: 5, waitlist: 2 }), []);
    expect(stats.confirmedCount).toBe(5);
    expect(stats.waitlistCount).toBe(2);
    expect(stats.occupiedCount).toBe(5);
    expect(stats.remainingCount).toBe(5);
  });

  it('normalizes invalid max to 0 and never marks full', () => {
    const stats = getEventParticipantStats(ev({ max: -5 }), [reg({ _docId: 'r1' })]);
    expect(stats.maxCount).toBe(0);
    expect(stats.remainingCount).toBe(0);
    expect(stats.isCapacityFull).toBe(false);
  });

  it('groups team remaining slots into occupied count', () => {
    const stats = getEventParticipantStats(
      ev({
        max: 10,
        teamReservationSummaries: [
          { teamId: 't1', remainingSlots: 2 },
          { teamId: 't2', remainingSlots: 1 },
        ],
      }),
      [reg({ _docId: 'r1' }), reg({ _docId: 'r2' })],
    );
    expect(stats.reservedRemainingCount).toBe(3);
    expect(stats.confirmedCount).toBe(2);
    expect(stats.occupiedCount).toBe(5);
    expect(stats.remainingCount).toBe(5);
  });
});

describe('isEventTrulyFull', () => {
  it('returns true when occupied >= max', () => {
    const e = ev({ max: 2 });
    expect(
      isEventTrulyFull(e, [reg({ _docId: 'r1' }), reg({ _docId: 'r2' })]),
    ).toBe(true);
  });

  it('returns false when occupied < max', () => {
    const e = ev({ max: 5 });
    expect(isEventTrulyFull(e, [reg({ _docId: 'r1' })])).toBe(false);
  });

  it('returns false when max is 0', () => {
    expect(isEventTrulyFull(ev({ max: 0 }), [])).toBe(false);
  });
});
