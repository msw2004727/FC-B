import { describe, it, expect } from 'vitest';

import type { EventDoc, RegistrationDoc, ViewerContext } from './types';
import {
  isEventOwner,
  isEventDelegate,
  isEventVisibleToUser,
  filterVisibleEventsByBlocklist,
  getVisibleEvents,
} from './visibility';

function viewer(
  uid: string | null,
  roleLevel = 0,
  permissions: readonly string[] = [],
  teamIds: readonly string[] = [],
): ViewerContext {
  return {
    uid,
    roleLevel,
    teamIds: new Set(teamIds),
    hasPermission: (code: string) => permissions.includes(code),
  };
}

function event(overrides: Partial<EventDoc> = {}): EventDoc {
  return {
    id: 'event-1',
    status: 'open',
    ...overrides,
  };
}

function reg(overrides: Partial<RegistrationDoc> = {}): RegistrationDoc {
  return {
    eventId: 'event-1',
    userId: 'u1',
    status: 'confirmed',
    ...overrides,
  };
}

describe('isEventOwner', () => {
  it('owner 判斷排除空值與 unknown UID', () => {
    const e = event({ creatorUid: 'u1', ownerUid: 'u2', captainUid: 'u3' });
    expect(isEventOwner(e, null)).toBe(false);
    expect(isEventOwner(e, '')).toBe(false);
    expect(isEventOwner(e, 'unknown')).toBe(false);
    expect(isEventOwner(e, '  unknown  ')).toBe(false);
  });

  it('owner 判斷比對 creatorUid / ownerUid / captainUid，且 trim 後比對', () => {
    const e = event({ creatorUid: 'u1', ownerUid: 'u2', captainUid: 'u3' });
    expect(isEventOwner(e, 'u1')).toBe(true);
    expect(isEventOwner(e, 'u2')).toBe(true);
    expect(isEventOwner(e, 'u3')).toBe(true);
    expect(isEventOwner(e, ' u3 ')).toBe(true);
    expect(isEventOwner(e, 'other')).toBe(false);
  });
});

describe('isEventDelegate', () => {
  it('delegate 不排除 unknown UID', () => {
    const e = event({ delegateUids: ['unknown'] });
    expect(isEventDelegate(e, 'unknown')).toBe(true);
  });

  it('delegate 以 trim 後 UID 嚴格比對 delegateUids', () => {
    const e = event({ delegateUids: ['u1', ' u2 '] });
    expect(isEventDelegate(e, 'u1')).toBe(true);
    expect(isEventDelegate(e, 'u2')).toBe(true);
    expect(isEventDelegate(e, 'u3')).toBe(false);
    expect(isEventDelegate(e, null)).toBe(false);
  });
});

describe('isEventVisibleToUser（黑名單四態）', () => {
  it('訪客可見', () => {
    const e = event({ blockedUids: ['u1'] });
    expect(isEventVisibleToUser(e, viewer(null), [])).toBe(true);
  });

  it('未封鎖可見', () => {
    const e = event({ blockedUids: ['other'] });
    expect(isEventVisibleToUser(e, viewer('u1'), [])).toBe(true);
  });

  it('被封鎖但曾有任一報名（含 cancelled / removed）可見', () => {
    const e = event({ blockedUids: ['u1'] });
    expect(isEventVisibleToUser(e, viewer('u1'), [reg({ status: 'cancelled' })])).toBe(true);
    expect(isEventVisibleToUser(e, viewer('u1'), [reg({ status: 'removed' })])).toBe(true);
  });

  it('被封鎖且無報名不可見', () => {
    const e = event({ blockedUids: ['u1'] });
    expect(isEventVisibleToUser(e, viewer('u1'), [])).toBe(false);
  });

  it('blockedUids 使用 strict includes(uid)，不 trim', () => {
    const e = event({ blockedUids: [' u1 '] });
    expect(isEventVisibleToUser(e, viewer('u1'), [])).toBe(true);
    expect(isEventVisibleToUser(e, viewer(' u1 '), [])).toBe(false);
  });

  it('UID unknown 不當訪客：被封鎖且無報名時不可見', () => {
    const e = event({ blockedUids: ['unknown'] });
    expect(isEventVisibleToUser(e, viewer('unknown'), [])).toBe(false);
  });

  it('缺 eventId 時報名歷史入口回 false（被封鎖者不可見）', () => {
    const e = event({ id: undefined, blockedUids: ['u1'] });
    expect(isEventVisibleToUser(e, viewer('u1'), [reg()])).toBe(false);
  });

  it('報名歷史以 canonical userId 比對 eventId', () => {
    const e = event({ blockedUids: ['u1'] });
    expect(isEventVisibleToUser(e, viewer('u1'), [reg({ userId: 'u2' })])).toBe(false);
    expect(isEventVisibleToUser(e, viewer('u1'), [reg({ userId: 'u1' })])).toBe(true);
  });
});

describe('filterVisibleEventsByBlocklist', () => {
  it('只做黑名單過濾；訪客回傳淺拷貝', () => {
    const events = [event({ id: 'e1' }), event({ id: 'e2', blockedUids: ['u1'] })];
    const guestResult = filterVisibleEventsByBlocklist(events, viewer(null), []);
    expect(guestResult).toHaveLength(2);
    expect(guestResult).not.toBe(events);

    const userResult = filterVisibleEventsByBlocklist(events, viewer('u1'), []);
    expect(userResult.map((e) => e.id)).toEqual(['e1']);
  });
});

describe('getVisibleEvents', () => {
  it('俱樂部限定：owner / event.edit_all / teamIds 交集 / isPublic', () => {
    const events = [
      event({ id: 'e1', teamOnly: true, creatorTeamIds: ['t1'] }),
      event({ id: 'e2', teamOnly: true, isPublic: true }),
      event({ id: 'e3', teamOnly: true, creatorUid: 'u1' }),
      event({ id: 'e4', teamOnly: true, creatorTeamIds: ['other'] }),
    ];

    const result = getVisibleEvents(events, viewer('u1', 0, [], ['t1']), []);
    expect(result.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('私密活動：admin / owner / delegate 可見', () => {
    const events = [
      event({ id: 'e1', privateEvent: true, creatorUid: 'u1' }),
      event({ id: 'e2', privateEvent: true, delegateUids: ['u1'] }),
      event({ id: 'e3', privateEvent: true, creatorUid: 'other' }),
    ];

    expect(getVisibleEvents(events, viewer('u1'), []).map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(getVisibleEvents(events, viewer('u1', 4), []).map((e) => e.id)).toEqual([
      'e1',
      'e2',
      'e3',
    ]);
  });
});
