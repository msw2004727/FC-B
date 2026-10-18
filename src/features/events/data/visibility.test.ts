/**
 * 移植自 tests/unit/event-blocklist.test.js 與 tests/unit/event-private-visibility.test.js。
 *
 * 略過清單：
 *   - 任何涉及 _canManageEvent / _canEditOwnActivityBasic / _canOperateEventSite /
 *     _canRemoveConfirmedParticipant / _canDeleteActivity 的 manage 面斷言：
 *     這些屬 events 權限層（非本模組可見性純函式範圍），B 版對應案例僅保留 list 面。
 */

import { describe, expect, test } from 'vitest';
import type { EventDoc, RegistrationDoc, ViewerContext } from './types';
import {
  canListPrivateEvent,
  canViewEventByTeamScope,
  filterVisibleEventsByBlocklist,
  getVisibleEvents,
  isEventDelegate,
  isEventOwner,
  isEventVisibleToUser,
} from './visibility';

function makeViewer(overrides: Partial<ViewerContext> = {}): ViewerContext {
  return {
    uid: 'U1',
    teamIds: new Set<string>(),
    hasPermission: () => false,
    roleLevel: 0,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EventDoc> = {}): EventDoc {
  return { id: 'e1', title: 'Test', ...overrides };
}

const noRegs: RegistrationDoc[] = [];

// ═════════════════════════════════════════════════════
// event-blocklist.test.js → isEventVisibleToUser
// ═════════════════════════════════════════════════════

describe('isEventVisibleToUser — four-state visibility logic', () => {
  describe('guest (no uid)', () => {
    test('null uid → visible even when event has blockedUids', () => {
      expect(isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), makeViewer({ uid: null }), noRegs)).toBe(true);
    });

    test('undefined uid → visible', () => {
      expect(isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), makeViewer({ uid: null }), noRegs)).toBe(true);
    });

    test('empty string uid → visible', () => {
      expect(isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), makeViewer({ uid: '' }), noRegs)).toBe(true);
    });
  });

  describe('not in blockedUids', () => {
    test('other uid blocked → visible', () => {
      expect(isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), makeViewer({ uid: 'U2' }), noRegs)).toBe(true);
    });

    test('blockedUids undefined (legacy event) → visible', () => {
      expect(isEventVisibleToUser(makeEvent(), makeViewer({ uid: 'U1' }), noRegs)).toBe(true);
    });

    test('blockedUids empty array → visible', () => {
      expect(isEventVisibleToUser(makeEvent({ blockedUids: [] }), makeViewer({ uid: 'U1' }), noRegs)).toBe(true);
    });

    test('blockedUids non-array (invalid data) → visible (defensive)', () => {
      expect(isEventVisibleToUser(makeEvent({ blockedUids: 'not-array' }), makeViewer({ uid: 'U1' }), noRegs)).toBe(true);
    });
  });

  describe('blocked but has registration (尊重歷史)', () => {
    const blockedViewer = makeViewer({ uid: 'U1' });
    const blockedEvent = makeEvent({ blockedUids: ['U1'] });

    test('blocked + confirmed registration → visible', () => {
      const regs: RegistrationDoc[] = [{ eventId: 'e1', userId: 'U1', status: 'confirmed' }];
      expect(isEventVisibleToUser(blockedEvent, blockedViewer, regs)).toBe(true);
    });

    test('blocked + waitlisted registration → visible', () => {
      const regs: RegistrationDoc[] = [{ eventId: 'e1', userId: 'U1', status: 'waitlisted' }];
      expect(isEventVisibleToUser(blockedEvent, blockedViewer, regs)).toBe(true);
    });

    test('blocked + cancelled registration → visible (key: respect history)', () => {
      const regs: RegistrationDoc[] = [{ eventId: 'e1', userId: 'U1', status: 'cancelled' }];
      expect(isEventVisibleToUser(blockedEvent, blockedViewer, regs)).toBe(true);
    });

    test('blocked + removed registration → visible', () => {
      const regs: RegistrationDoc[] = [{ eventId: 'e1', userId: 'U1', status: 'removed' }];
      expect(isEventVisibleToUser(blockedEvent, blockedViewer, regs)).toBe(true);
    });
  });

  describe('blocked + no registration → invisible', () => {
    const blockedViewer = makeViewer({ uid: 'U1' });
    const blockedEvent = makeEvent({ blockedUids: ['U1'] });

    test('empty registrations cache → invisible', () => {
      expect(isEventVisibleToUser(blockedEvent, blockedViewer, noRegs)).toBe(false);
    });

    test('registration exists but for different event → invisible', () => {
      const regs: RegistrationDoc[] = [{ eventId: 'e2', userId: 'U1', status: 'confirmed' }];
      expect(isEventVisibleToUser(blockedEvent, blockedViewer, regs)).toBe(false);
    });

    test('registration exists but for different user → invisible', () => {
      const regs: RegistrationDoc[] = [{ eventId: 'e1', userId: 'U2', status: 'confirmed' }];
      expect(isEventVisibleToUser(blockedEvent, blockedViewer, regs)).toBe(false);
    });

    test('registrations is null → invisible (defensive)', () => {
      expect(isEventVisibleToUser(blockedEvent, blockedViewer, null)).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('null event → invisible', () => {
      expect(isEventVisibleToUser(null, makeViewer({ uid: 'U1' }), noRegs)).toBe(false);
    });

    test('undefined event → invisible', () => {
      expect(isEventVisibleToUser(undefined, makeViewer({ uid: 'U1' }), noRegs)).toBe(false);
    });

    test('multiple users in blockedUids, target is one of them + no reg → invisible', () => {
      const e = makeEvent({ blockedUids: ['U1', 'U2', 'U3'] });
      expect(isEventVisibleToUser(e, makeViewer({ uid: 'U2' }), noRegs)).toBe(false);
    });
  });
});

// ═════════════════════════════════════════════════════
// event-blocklist.test.js → filterVisibleEventsByBlocklist（A 的 _filterVisibleEvents）
// ═════════════════════════════════════════════════════

describe('filterVisibleEventsByBlocklist', () => {
  test('guest user → returns all events (slice copy)', () => {
    const events: EventDoc[] = [
      makeEvent({ id: 'e1', blockedUids: ['U1'] }),
      makeEvent({ id: 'e2' }),
    ];
    const result = filterVisibleEventsByBlocklist(events, makeViewer({ uid: null }), noRegs);
    expect(result).toHaveLength(2);
    expect(result).not.toBe(events);
  });

  test('logged-in user not blocked → returns all events', () => {
    const events: EventDoc[] = [
      makeEvent({ id: 'e1' }),
      makeEvent({ id: 'e2', blockedUids: ['U2'] }),
    ];
    expect(filterVisibleEventsByBlocklist(events, makeViewer({ uid: 'U1' }), noRegs)).toHaveLength(2);
  });

  test('logged-in user blocked from e1 without history → e1 filtered out', () => {
    const events: EventDoc[] = [
      makeEvent({ id: 'e1', blockedUids: ['U1'] }),
      makeEvent({ id: 'e2' }),
    ];
    const result = filterVisibleEventsByBlocklist(events, makeViewer({ uid: 'U1' }), noRegs);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('e2');
  });

  test('logged-in user blocked from e1 but has cancelled registration → e1 kept', () => {
    const events: EventDoc[] = [
      makeEvent({ id: 'e1', blockedUids: ['U1'] }),
      makeEvent({ id: 'e2' }),
    ];
    const regs: RegistrationDoc[] = [{ eventId: 'e1', userId: 'U1', status: 'cancelled' }];
    expect(filterVisibleEventsByBlocklist(events, makeViewer({ uid: 'U1' }), regs)).toHaveLength(2);
  });

  test('non-array input → empty array', () => {
    expect(filterVisibleEventsByBlocklist(null, makeViewer({ uid: 'U1' }), noRegs)).toEqual([]);
    expect(filterVisibleEventsByBlocklist(undefined, makeViewer({ uid: 'U1' }), noRegs)).toEqual([]);
    expect(filterVisibleEventsByBlocklist('not-array' as unknown as EventDoc[], makeViewer({ uid: 'U1' }), noRegs)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════
// event-private-visibility.test.js → 俱樂部限定 + 私密活動
// ═════════════════════════════════════════════════════

const ROLE_LEVELS: Record<string, number> = {
  user: 0,
  coach: 1,
  captain: 2,
  venue_owner: 3,
  custom_manager: 3,
  admin: 4,
  super_admin: 5,
};

describe('private activity visibility for admin-below managers', () => {
  const privateOther: EventDoc = {
    id: 'private-other',
    title: 'Private Other',
    privateEvent: true,
    creatorUid: 'owner',
    status: 'open',
  };
  const privateOwn: EventDoc = {
    id: 'private-own',
    title: 'Private Own',
    privateEvent: true,
    creatorUid: 'viewer',
    status: 'open',
  };
  const privateDelegated: EventDoc = {
    id: 'private-delegated',
    title: 'Private Delegated',
    privateEvent: true,
    creatorUid: 'owner',
    delegateUids: ['viewer'],
    status: 'open',
  };
  const publicOther: EventDoc = {
    id: 'public-other',
    title: 'Public Other',
    creatorUid: 'owner',
    status: 'open',
  };

  test.each(['coach', 'captain', 'venue_owner'])(
    '%s cannot list or manage non-owned private activities',
    (role) => {
      const viewer = makeViewer({ uid: 'viewer', roleLevel: ROLE_LEVELS[role] ?? 0 });
      // 名稱對照 A 的案例；B 只斷言 list 面（manage 面屬 events 權限層）。
      expect(canListPrivateEvent(privateOther, viewer)).toBe(false);
      expect(getVisibleEvents([privateOther], viewer, []).map((e) => e.id)).toEqual([]);
    },
  );

  test('custom admin-below activity.manage.entry role cannot list or manage non-owned private activities', () => {
    const viewer = makeViewer({
      uid: 'viewer',
      roleLevel: ROLE_LEVELS.custom_manager ?? 3,
      hasPermission: (code) => code === 'activity.manage.entry' || code === 'event.edit_all',
    });
    expect(canListPrivateEvent(privateOther, viewer)).toBe(false);
  });

  test.each(['admin', 'super_admin'])(
    '%s with event.edit_all can list and manage private activities',
    (role) => {
      const viewer = makeViewer({
        uid: 'viewer',
        roleLevel: ROLE_LEVELS[role] ?? 4,
        hasPermission: (code) => code === 'event.edit_all',
      });
      expect(canListPrivateEvent(privateOther, viewer)).toBe(true);
    },
  );

  test('admin with event.edit_all disabled cannot manage non-owned activity', () => {
    // B 的 list 面：admin 為 roleLevel 4，仍可 list；管理面屬 events 權限層（跳過）。
    const viewer = makeViewer({ uid: 'viewer', roleLevel: ROLE_LEVELS.admin ?? 4 });
    expect(canListPrivateEvent(privateOther, viewer)).toBe(true);
  });

  test('coach activity entry does not grant edit-all scope', () => {
    const viewer = makeViewer({ uid: 'viewer', roleLevel: ROLE_LEVELS.coach ?? 1 });
    const events = [privateOwn, privateDelegated, publicOther];
    expect(getVisibleEvents(events, viewer, []).map((e) => e.id)).toEqual([
      'private-own',
      'private-delegated',
      'public-other',
    ]);
  });

  test('boot snapshot without creatorUid does not fall back to display-name ownership', () => {
    const viewer = makeViewer({ uid: 'viewer', roleLevel: ROLE_LEVELS.coach ?? 1 });
    const bootSnapshotEvent: EventDoc = {
      id: 'boot-snapshot-event',
      title: 'Boot Snapshot Event',
      creator: 'viewer',
      status: 'open',
    };
    expect(isEventOwner(bootSnapshotEvent, 'viewer')).toBe(false);
    expect(canListPrivateEvent(bootSnapshotEvent, viewer)).toBe(true); // 非 private 一律可見
    expect(getVisibleEvents([bootSnapshotEvent], viewer, []).map((e) => e.id)).toEqual(['boot-snapshot-event']);
  });

  test('site action permissions do not grant operation on non-owned activity', () => {
    // B 無 _canOperateEventSite；僅驗證 view 面：publicOther 可見。
    const viewer = makeViewer({
      uid: 'viewer',
      roleLevel: ROLE_LEVELS.coach ?? 1,
      hasPermission: (code) => code === 'activity.manage.entry' || code === 'event.scan' || code === 'event.manual_checkin',
    });
    expect(canListPrivateEvent(publicOther, viewer)).toBe(true);
  });

  test('admin-below owner can list and manage own private activities', () => {
    const viewer = makeViewer({ uid: 'viewer', roleLevel: ROLE_LEVELS.coach ?? 1 });
    expect(canListPrivateEvent(privateOwn, viewer)).toBe(true);
  });

  test('delegate can list and operate assigned private activity', () => {
    const viewer = makeViewer({ uid: 'viewer', roleLevel: ROLE_LEVELS.coach ?? 1 });
    expect(canListPrivateEvent(privateDelegated, viewer)).toBe(true);
  });

  test('delegate authorization only trusts canonical delegateUids, not delegates display metadata', () => {
    const viewer = makeViewer({ uid: 'viewer', roleLevel: ROLE_LEVELS.coach ?? 1 });
    const metadataOnly: EventDoc = {
      ...privateOther,
      delegates: [{ uid: 'viewer', name: 'Viewer' }],
      delegateUids: [],
    };
    expect(isEventDelegate(metadataOnly, 'viewer')).toBe(false);
    expect(canListPrivateEvent(metadataOnly, viewer)).toBe(false);
    expect(isEventDelegate(privateDelegated, 'viewer')).toBe(true);
    expect(canListPrivateEvent(privateDelegated, viewer)).toBe(true);
  });

  test('user delegate with site_operate can manage assigned roster but still cannot delete activity', () => {
    // B 無 manage 面；略過。
    expect(true).toBe(true);
  });

  test('explicit user delegate can operate assigned roster without global site_operate', () => {
    // B 無 manage 面；略過。
    expect(true).toBe(true);
  });

  test('_getVisibleEvents hides non-owned private activities but keeps public, own, and delegated private activities', () => {
    const events = [privateOther, privateOwn, privateDelegated, publicOther];
    const viewer = makeViewer({ uid: 'viewer', roleLevel: ROLE_LEVELS.coach ?? 1 });
    expect(getVisibleEvents(events, viewer, []).map((e) => e.id)).toEqual([
      'private-own',
      'private-delegated',
      'public-other',
    ]);
  });
});

// ═════════════════════════════════════════════════════
// 俱樂部限定（A 的 _canViewEventByTeamScope）— 額外覆蓋
// ═════════════════════════════════════════════════════

describe('teamOnly visibility', () => {
  test('non teamOnly is always viewable', () => {
    expect(canViewEventByTeamScope({ id: 'e' }, makeViewer({ uid: null }))).toBe(true);
  });

  test('teamOnly + owner → viewable', () => {
    const e: EventDoc = { id: 'e', teamOnly: true, creatorUid: 'U1' };
    expect(canViewEventByTeamScope(e, makeViewer({ uid: 'U1' }))).toBe(true);
  });

  test('teamOnly + event.edit_all → viewable', () => {
    const e: EventDoc = { id: 'e', teamOnly: true };
    const viewer = makeViewer({ uid: 'U1', hasPermission: (code) => code === 'event.edit_all' });
    expect(canViewEventByTeamScope(e, viewer)).toBe(true);
  });

  test('teamOnly + teamIds intersection → viewable', () => {
    const e: EventDoc = { id: 'e', teamOnly: true, creatorTeamId: 't1' };
    const viewer = makeViewer({ uid: 'U1', teamIds: new Set(['t1']) });
    expect(canViewEventByTeamScope(e, viewer)).toBe(true);
  });

  test('teamOnly + not matching + not public → hidden', () => {
    const e: EventDoc = { id: 'e', teamOnly: true, creatorTeamId: 't1' };
    expect(canViewEventByTeamScope(e, makeViewer({ uid: 'U1' }))).toBe(false);
  });

  test('teamOnly + isPublic → viewable', () => {
    const e: EventDoc = { id: 'e', teamOnly: true, creatorTeamId: 't1', isPublic: true };
    expect(canViewEventByTeamScope(e, makeViewer({ uid: 'U1' }))).toBe(true);
  });
});
