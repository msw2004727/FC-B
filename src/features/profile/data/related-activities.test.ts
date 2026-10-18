import { describe, expect, it } from 'vitest';

import {
  buildHostedActivities,
  buildRegisteredActivities,
  getEventEffectiveStatus,
  isProfileHostedActivity,
  loadRelatedActivities,
  type EventRecord,
  type RegistrationRecord,
} from './related-activities';

function evt(id: string, over: Partial<EventRecord> = {}): EventRecord {
  return { id, title: `T-${id}`, status: 'open', ...over };
}
function reg(over: Partial<RegistrationRecord> = {}): RegistrationRecord {
  return { status: 'confirmed', ...over };
}

describe('getEventEffectiveStatus', () => {
  it('null → open', () => {
    expect(getEventEffectiveStatus(null)).toBe('open');
  });

  it('status=cancelled 直通', () => {
    expect(getEventEffectiveStatus(evt('e', { status: 'cancelled' }))).toBe('cancelled');
  });

  it('無 endAt 的 open 仍為 open', () => {
    expect(getEventEffectiveStatus(evt('e'))).toBe('open');
  });

  it('endAt 已過 → ended', () => {
    const past = { seconds: Math.floor((Date.now() - 3600_000) / 1000) };
    expect(getEventEffectiveStatus(evt('e', { endAt: past }))).toBe('ended');
  });

  it('endAt 在未來仍 open', () => {
    const future = { seconds: Math.floor((Date.now() + 3600_000) / 1000) };
    expect(getEventEffectiveStatus(evt('e', { endAt: future }))).toBe('open');
  });
});

describe('isProfileHostedActivity（只比對 UID）', () => {
  const allowed = new Set(['u1']);
  it('creatorUid 命中', () => {
    expect(isProfileHostedActivity({ creatorUid: 'u1' }, allowed)).toBe(true);
  });
  it('hostUids 陣列命中', () => {
    expect(isProfileHostedActivity({ hostUids: ['x', 'u1'] }, allowed)).toBe(true);
  });
  it('creatorUids 陣列命中', () => {
    expect(isProfileHostedActivity({ creatorUids: ['u1'] }, allowed)).toBe(true);
  });
  it('未命中', () => {
    expect(isProfileHostedActivity({ creatorUid: 'other' }, allowed)).toBe(false);
  });
  it('名稱不應被用來比對（只認 UID 欄位）', () => {
    expect(
      isProfileHostedActivity({ creatorName: 'u1' } as EventRecord, allowed),
    ).toBe(false);
  });
});

describe('buildRegisteredActivities（A 邏輯）', () => {
  const uidSet = new Set(['u1']);

  it('略過 companion / companionId', () => {
    const events = new Map<string, EventRecord>([['e1', evt('e1')]]);
    const regs: RegistrationRecord[] = [
      reg({ eventId: 'e1', participantType: 'companion' }),
      reg({ eventId: 'e1', companionId: 'c1' }),
    ];
    expect(buildRegisteredActivities(regs, events, uidSet)).toHaveLength(0);
  });

  it('略過非 active 狀態', () => {
    const events = new Map<string, EventRecord>([['e1', evt('e1')]]);
    const regs: RegistrationRecord[] = [reg({ eventId: 'e1', status: 'cancelled' })];
    expect(buildRegisteredActivities(regs, events, uidSet)).toHaveLength(0);
  });

  it('略過 effectiveStatus=cancelled / ended 的活動', () => {
    const past = { seconds: Math.floor((Date.now() - 3600_000) / 1000) };
    const events = new Map<string, EventRecord>([
      ['e1', evt('e1', { status: 'cancelled' })],
      ['e2', evt('e2', { endAt: past })],
    ]);
    const regs: RegistrationRecord[] = [
      reg({ eventId: 'e1' }),
      reg({ eventId: 'e2' }),
    ];
    expect(buildRegisteredActivities(regs, events, uidSet)).toHaveLength(0);
  });

  it('同 event 多筆時保留最高 rank（confirmed > registered > waitlisted）', () => {
    const events = new Map<string, EventRecord>([['e1', evt('e1')]]);
    const regs: RegistrationRecord[] = [
      reg({ eventId: 'e1', status: 'waitlisted' }),
      reg({ eventId: 'e1', status: 'confirmed' }),
      reg({ eventId: 'e1', status: 'registered' }),
    ];
    const out = buildRegisteredActivities(regs, events, uidSet);
    expect(out).toHaveLength(1);
    expect(out[0]!.registrationStatus).toBe('confirmed');
  });

  it('依 event 日期升冪，同日期依 title', () => {
    const early = { seconds: 1_700_000_000 };
    const late = { seconds: 1_800_000_000 };
    const events = new Map<string, EventRecord>([
      ['e1', evt('e1', { startAt: late, title: 'B' })],
      ['e2', evt('e2', { startAt: early, title: 'A' })],
      ['e3', evt('e3', { startAt: early, title: 'Z' })],
    ]);
    const regs: RegistrationRecord[] = [
      reg({ eventId: 'e1' }),
      reg({ eventId: 'e2' }),
      reg({ eventId: 'e3' }),
    ];
    const out = buildRegisteredActivities(regs, events, uidSet);
    expect(out.map((x) => x.event.id)).toEqual(['e2', 'e3', 'e1']);
  });

  it('記錄 uid 不在 allowed set 時略過', () => {
    const events = new Map<string, EventRecord>([['e1', evt('e1')]]);
    const regs: RegistrationRecord[] = [reg({ eventId: 'e1', userId: 'other' })];
    expect(buildRegisteredActivities(regs, events, uidSet)).toHaveLength(0);
  });
});

describe('buildHostedActivities（A 邏輯）', () => {
  const uidSet = new Set(['u1']);
  it('只保留 status=open 且為本人主辦的活動', () => {
    const events = [
      evt('e1', { creatorUid: 'u1' }),
      evt('e2', { creatorUid: 'other' }),
      evt('e3', { creatorUid: 'u1', status: 'cancelled' }),
      evt('e4', { creatorUid: 'u1', status: 'closed' }),
    ];
    const out = buildHostedActivities(events, uidSet);
    expect(out.map((x) => x.event.id)).toEqual(['e1']);
  });

  it('未來優先（最近的最先），過去則依最近到最遠，最後比 title', () => {
    const now = 1_700_000_000_000;
    const futureNear = { seconds: Math.floor((now + 3600_000) / 1000) };
    const futureFar = { seconds: Math.floor((now + 7200_000) / 1000) };
    const pastRecent = { seconds: Math.floor((now - 3600_000) / 1000) };
    const pastOld = { seconds: Math.floor((now - 7200_000) / 1000) };

    const events: EventRecord[] = [
      evt('a-old', { creatorUid: 'u1', startAt: pastOld, title: 'A' }),
      evt('b-recent', { creatorUid: 'u1', startAt: pastRecent, title: 'B' }),
      evt('c-far', { creatorUid: 'u1', startAt: futureFar, title: 'C' }),
      evt('d-near', { creatorUid: 'u1', startAt: futureNear, title: 'D' }),
    ];
    const out = buildHostedActivities(events, uidSet, now);
    expect(out.map((x) => x.event.id)).toEqual(['d-near', 'c-far', 'b-recent', 'a-old']);
  });

  it('相同時間以 title 排序', () => {
    const ts = { seconds: Math.floor((Date.now() + 3600_000) / 1000) };
    const events: EventRecord[] = [
      evt('z', { creatorUid: 'u1', startAt: ts, title: 'Z' }),
      evt('a', { creatorUid: 'u1', startAt: ts, title: 'A' }),
    ];
    const out = buildHostedActivities(events, uidSet);
    expect(out.map((x) => x.event.id)).toEqual(['a', 'z']);
  });
});

describe('loadRelatedActivities', () => {
  it('空 uid → 空結果', async () => {
    const res = await loadRelatedActivities('');
    expect(res.registered).toEqual([]);
    expect(res.hosted).toEqual([]);
    expect(res.counts).toEqual({ registered: 0, hosted: 0 });
  });
});
