import { describe, expect, it } from 'vitest';
import {
  attendanceStateFor,
  buildConfirmedRoster,
  buildWaitlistRoster,
  type RosterAttendanceRecordInput,
  type RosterEventInput,
  type RosterRegistrationInput,
} from './attendance-roster-model';

describe('buildConfirmedRoster', () => {
  it('orders confirmed registrations by registeredAt, promotionOrder, and docId, excluding cancelled/removed/waitlisted', () => {
    const event: RosterEventInput = { id: 'ev1', max: 10 };
    const regs: RosterRegistrationInput[] = [
      {
        _docId: 'reg-3',
        userId: 'u3',
        userName: 'User 3',
        status: 'confirmed',
        participantType: 'self',
        registeredAt: '2026-05-01T10:05:00Z',
      },
      {
        _docId: 'reg-2',
        userId: 'u2',
        userName: 'User 2',
        status: 'confirmed',
        participantType: 'self',
        registeredAt: '2026-05-01T10:00:00Z',
        promotionOrder: 2,
      },
      {
        _docId: 'reg-1',
        userId: 'u1',
        userName: 'User 1',
        status: 'confirmed',
        participantType: 'self',
        registeredAt: '2026-05-01T10:00:00Z',
        promotionOrder: 1,
      },
      {
        _docId: 'reg-cancel',
        userId: 'u4',
        userName: 'Cancelled',
        status: 'cancelled',
        participantType: 'self',
        registeredAt: '2026-05-01T09:00:00Z',
      },
      {
        _docId: 'reg-removed',
        userId: 'u5',
        userName: 'Removed',
        status: 'removed',
        participantType: 'self',
        registeredAt: '2026-05-01T09:00:00Z',
      },
      {
        _docId: 'reg-wl',
        userId: 'u6',
        userName: 'Waitlisted',
        status: 'waitlisted',
        participantType: 'self',
        registeredAt: '2026-05-01T09:00:00Z',
      },
    ];

    const result = buildConfirmedRoster(event, regs);
    expect(result.people.map((p) => p.uid)).toEqual(['u1', 'u2', 'u3']);
    expect(result.count).toBe(3);
  });

  it('groups companions under their owner and marks proxyOnly when owner has no self registration', () => {
    const event: RosterEventInput = { id: 'ev1', max: 10 };
    const regs: RosterRegistrationInput[] = [
      {
        _docId: 'r1',
        userId: 'u1',
        userName: 'Alice',
        status: 'confirmed',
        participantType: 'self',
        registeredAt: '2026-05-01T10:00:00Z',
      },
      {
        _docId: 'r2',
        userId: 'u1',
        userName: 'Alice',
        companionId: 'c1',
        companionName: 'Alice Jr',
        status: 'confirmed',
        participantType: 'companion',
        registeredAt: '2026-05-01T10:01:00Z',
      },
      {
        _docId: 'r3',
        userId: 'u2',
        userName: 'Bob',
        companionId: 'c2',
        companionName: 'Bob Jr',
        status: 'confirmed',
        participantType: 'companion',
        registeredAt: '2026-05-01T10:02:00Z',
      },
    ];

    const result = buildConfirmedRoster(event, regs);
    expect(result.people).toHaveLength(4);
    expect(result.people[0]).toMatchObject({
      uid: 'u1',
      displayName: 'Alice',
      isCompanion: false,
      hasSelfReg: true,
      proxyOnly: false,
    });
    expect(result.people[1]).toMatchObject({
      uid: 'c1',
      ownerUid: 'u1',
      displayName: 'Alice Jr',
      isCompanion: true,
    });
    expect(result.people[2]).toMatchObject({
      uid: 'u2',
      displayName: 'Bob',
      isCompanion: false,
      hasSelfReg: false,
      proxyOnly: true,
      isProxyOnly: true,
    });
    expect(result.people[3]).toMatchObject({
      uid: 'c2',
      ownerUid: 'u2',
      displayName: 'Bob Jr',
      isCompanion: true,
    });
    // proxyOnly row is not counted in renderedRosterCount
    expect(result.count).toBe(3);
  });

  it('strictly requires participantType === "self" for self registration (missing participantType becomes proxyOnly like A)', () => {
    const event: RosterEventInput = { id: 'ev1', max: 10 };
    const regs: RosterRegistrationInput[] = [
      {
        _docId: 'r-missing-type',
        userId: 'u1',
        userName: 'LegacyUser',
        status: 'confirmed',
        registeredAt: '2026-05-01T10:00:00Z',
      },
    ];

    const result = buildConfirmedRoster(event, regs);
    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({
      uid: 'u1',
      displayName: 'LegacyUser',
      hasSelfReg: false,
      proxyOnly: true,
      isProxyOnly: true,
    });
    expect(result.count).toBe(0);
  });

  it('enforces wuValid length guard on participantsWithUid fallback and enriches from cached confirmed registrations by UID', () => {
    // 1. wu.length !== expectedLen -> rejected by wuValid guard
    const mismatchEvent: RosterEventInput = {
      id: 'ev-mismatch',
      max: 10,
      current: 3,
      participantsWithUid: [{ uid: 'u1', name: 'Alice' }],
    };
    const mismatchResult = buildConfirmedRoster(mismatchEvent, []);
    expect(mismatchResult.people).toHaveLength(0);
    // hasCountSource is true because participantsWithUid.length > 0, so count is countablePeople.length (0)
    expect(mismatchResult.count).toBe(0);

    // 2. wu.length === expectedLen -> accepted and enriched by UID (when canUseRegistrationRows = false)
    const validEvent: RosterEventInput = {
      id: 'ev-valid',
      max: 10,
      current: 2,
      teamReservationSummaries: [
        { teamId: 't1', teamName: 'Alpha', reservedSlots: 1, usedSlots: 0, remainingSlots: 1 },
      ],
      // expectedLen = 2 - 1 = 1
      participantsWithUid: [{ uid: 'u1', name: 'Alice' }],
    };
    const cachedRegs: RosterRegistrationInput[] = [
      {
        _docId: 'reg-u1',
        userId: 'u1',
        userName: 'Alice',
        status: 'confirmed',
        participantType: 'self',
        teamKey: 'A',
        displayBadges: [{ name: 'MVP', image: 'https://example.com/mvp.png' }],
      },
    ];
    const validResult = buildConfirmedRoster(validEvent, cachedRegs, {
      canUseRegistrationRows: false,
    });
    const aliceRow = validResult.people.find((p) => p.uid === 'u1');
    expect(aliceRow).toMatchObject({
      uid: 'u1',
      displayName: 'Alice',
      regDocId: 'reg-u1',
      teamKey: 'A',
      displayBadges: [{ name: 'MVP', image: 'https://example.com/mvp.png' }],
    });
  });

  it('uses authoritative fallbackCount and Math.max(countablePeople.length, fallbackCount) when canUseRegistrationRows is false', () => {
    const event: RosterEventInput = {
      id: 'ev-count',
      max: 10,
      current: 5,
      realCurrent: 4,
      teamReservationSummaries: [
        { teamId: 't1', teamName: 'Alpha', reservedSlots: 2, usedSlots: 1, remainingSlots: 1 },
      ],
      participantsWithUid: [{ uid: 'u1', name: 'OnlyOneInCache' }],
    };

    // When canUseRegistrationRows is false, count = Math.max(countable (0 because wuValid is false), fallbackCount (4))
    const partialResult = buildConfirmedRoster(event, [], { canUseRegistrationRows: false });
    expect(partialResult.count).toBe(4);

    // PM 對照 A 修正：A 的 hasCountSource 用 orderedPeople（含俱樂部保留席位的標題／佔位列），
    // 有保留席位時就算有人數來源 → 用 countablePeople（0）。沒有任何人數來源時才用活動文件兜底。
    const reservedOnlyEvent: RosterEventInput = {
      id: 'ev-reserved-only',
      max: 10,
      current: 5,
      teamReservationSummaries: [
        { teamId: 't1', teamName: 'Alpha', reservedSlots: 2, usedSlots: 0, remainingSlots: 2 },
      ],
    };
    expect(buildConfirmedRoster(reservedOnlyEvent, []).count).toBe(0);

    const emptySourceEvent: RosterEventInput = { id: 'ev-empty-source', max: 10, current: 5 };
    expect(buildConfirmedRoster(emptySourceEvent, []).count).toBe(5);
  });

  it('builds team reservation headers, placeholders, and general separator', () => {
    const event: RosterEventInput = {
      id: 'ev1',
      max: 10,
      teamReservationSummaries: [
        {
          teamId: 't1',
          teamName: 'FC Alpha',
          reservedSlots: 3,
          usedSlots: 1,
          remainingSlots: 2,
        },
      ],
    };
    const regs: RosterRegistrationInput[] = [
      {
        _docId: 'r1',
        userId: 'u1',
        userName: 'Team Member',
        status: 'confirmed',
        participantType: 'self',
        teamReservationTeamId: 't1',
        teamReservationTeamName: 'FC Alpha',
        registeredAt: '2026-05-01T10:00:00Z',
      },
      {
        _docId: 'r2',
        userId: 'u2',
        userName: 'Normal Member',
        status: 'confirmed',
        participantType: 'self',
        registeredAt: '2026-05-01T10:01:00Z',
      },
    ];

    const result = buildConfirmedRoster(event, regs);
    expect(result.people.map((p) => ({
      uid: p.uid,
      header: Boolean(p.isTeamHeader),
      placeholder: Boolean(p.isTeamPlaceholder),
      sep: Boolean(p.isTeamGeneralSeparator),
    }))).toEqual([
      { uid: 'team-header-t1', header: true, placeholder: false, sep: false },
      { uid: 'u1', header: false, placeholder: false, sep: false },
      { uid: 'team-seat-t1-1', header: false, placeholder: true, sep: false },
      { uid: 'team-seat-t1-2', header: false, placeholder: true, sep: false },
      { uid: 'team-reservation-general-separator', header: false, placeholder: false, sep: true },
      { uid: 'u2', header: false, placeholder: false, sep: false },
    ]);
    // Count excludes header, placeholders, separator
    expect(result.count).toBe(2);
  });

  it('marks attendanceAmbiguous when same uid has both normal and course-linked confirmed registrations', () => {
    const event: RosterEventInput = { id: 'ev1', max: 10 };
    const regs: RosterRegistrationInput[] = [
      {
        _docId: 'r1',
        userId: 'u1',
        userName: 'Alice',
        status: 'confirmed',
        participantType: 'self',
        registeredAt: '2026-05-01T10:00:00Z',
      },
      {
        _docId: 'r2',
        userId: 'u1',
        userName: 'Alice (Student)',
        status: 'confirmed',
        participantType: 'self',
        courseLinkSource: 'eduCourseLesson',
        courseStudentId: 'stu-1',
        registeredAt: '2026-05-01T10:01:00Z',
      },
    ];

    const result = buildConfirmedRoster(event, regs);
    expect(result.people).toHaveLength(2);
    expect(result.people[0]?.attendanceAmbiguous).toBe(true);
    expect(result.people[1]?.attendanceAmbiguous).toBe(true);
  });
});

describe('attendanceStateFor', () => {
  it('matches checkin/checkout by UID (not name), ignores removed and cancelled records, and picks latest note', () => {
    const event: RosterEventInput = { id: 'ev1', max: 10 };
    const regs: RosterRegistrationInput[] = [
      {
        _docId: 'r1',
        userId: 'u1',
        userName: 'Alice',
        status: 'confirmed',
        participantType: 'self',
        registeredAt: '2026-05-01T10:00:00Z',
      },
      {
        _docId: 'r2',
        userId: 'u1',
        userName: 'Alice',
        companionId: 'c1',
        companionName: 'Alice Jr',
        status: 'confirmed',
        participantType: 'companion',
        registeredAt: '2026-05-01T10:01:00Z',
      },
    ];
    const { people } = buildConfirmedRoster(event, regs);
    const alice = people[0]!;
    const companion = people[1]!;

    const records: RosterAttendanceRecordInput[] = [
      // Same name but different UID -> must NOT match (R-ID-002)
      { _docId: 'a0', uid: 'other-uid', userName: 'Alice', type: 'checkin', status: 'active', time: '2026/05/01 10:00' },
      // Removed checkout -> must NOT count
      { _docId: 'a1', uid: 'u1', userName: 'Alice', type: 'checkout', status: 'removed', time: '2026/05/01 12:00' },
      // Cancelled checkout -> must NOT count (2a fix)
      { _docId: 'a1-cancel', uid: 'u1', userName: 'Alice', type: 'checkout', status: 'cancelled', time: '2026/05/01 12:30' },
      // Cancelled note -> must NOT count (2a fix)
      { _docId: 'a4-cancel', uid: 'u1', userName: 'Alice', type: 'note', note: 'Cancelled note', status: 'cancelled', time: '2026/05/01 12:40' },
      // Valid checkin for Alice
      { _docId: 'a2', uid: 'u1', userName: 'Alice', type: 'checkin', status: 'active', time: '2026/05/01 10:05' },
      // Older note
      { _docId: 'a3', uid: 'u1', userName: 'Alice', type: 'note', note: 'Old note', status: 'active', time: '2026/05/01 10:06' },
      // Newer note
      { _docId: 'a4', uid: 'u1', userName: 'Alice', type: 'note', note: 'New note', status: 'active', time: '2026/05/01 10:20' },
      // Companion checkin & checkout
      { _docId: 'a5', uid: 'u1', companionId: 'c1', companionName: 'Alice Jr', type: 'checkin', status: 'active', time: '2026/05/01 10:05' },
      { _docId: 'a6', uid: 'u1', companionId: 'c1', companionName: 'Alice Jr', type: 'checkout', status: 'active', time: '2026/05/01 11:05' },
    ];

    const aliceState = attendanceStateFor(alice, records);
    expect(aliceState).toEqual({
      hasCheckin: true,
      hasCheckout: false,
      noteText: 'New note',
      combinedNote: 'New note',
      attendanceBlocked: false,
      ambiguous: false,
    });

    const companionState = attendanceStateFor(companion, records);
    expect(companionState).toEqual({
      hasCheckin: true,
      hasCheckout: true,
      noteText: '',
      combinedNote: '',
      attendanceBlocked: false,
      ambiguous: false,
    });
  });

  it('blocks attendance for proxyOnly and placeholder rows', () => {
    const event: RosterEventInput = { id: 'ev1', max: 10 };
    const regs: RosterRegistrationInput[] = [
      {
        _docId: 'r1',
        userId: 'u2',
        userName: 'ProxyHost',
        companionId: 'c2',
        companionName: 'Comp',
        status: 'confirmed',
        participantType: 'companion',
        registeredAt: '2026-05-01T10:00:00Z',
      },
    ];
    const { people } = buildConfirmedRoster(event, regs);
    const proxyRow = people[0]!;
    const state = attendanceStateFor(proxyRow, [
      { _docId: 'a1', uid: 'u2', userName: 'ProxyHost', type: 'checkin', status: 'active' },
    ]);
    expect(state.attendanceBlocked).toBe(true);
    expect(state.hasCheckin).toBe(false);
    expect(state.combinedNote).toBe('僅代報');
  });
});

describe('buildWaitlistRoster', () => {
  it('orders waitlisted registrations by registeredAt, promotionOrder, docId, userName and groups by userId with orphanInfo', () => {
    const event: RosterEventInput = { id: 'ev1', max: 2 };
    const regs: RosterRegistrationInput[] = [
      // u1 self is confirmed, but u1's companion is waitlisted
      {
        _docId: 'r-u1-self',
        userId: 'u1',
        userName: 'Alice',
        status: 'confirmed',
        participantType: 'self',
        registeredAt: '2026-05-01T09:00:00Z',
      },
      // u3 and u2 have identical registeredAt, but u3 has lower promotionOrder
      {
        _docId: 'r-u2-self',
        userId: 'u2',
        userName: 'Bob',
        status: 'waitlisted',
        participantType: 'self',
        registeredAt: '2026-05-01T10:05:00Z',
        promotionOrder: 2,
      },
      {
        _docId: 'r-u3-self',
        userId: 'u3',
        userName: 'Charlie',
        status: 'waitlisted',
        participantType: 'self',
        courseLinkSource: 'eduCourseLesson',
        courseStudentId: 'stu-9',
        registeredAt: '2026-05-01T10:05:00Z',
        promotionOrder: 1,
      },
      {
        _docId: 'r-u1-comp',
        userId: 'u1',
        userName: 'Alice',
        companionId: 'c1',
        companionName: 'Alice Jr',
        status: 'waitlisted',
        participantType: 'companion',
        registeredAt: '2026-05-01T10:00:00Z',
      },
      {
        _docId: 'r-u2-comp',
        userId: 'u2',
        userName: 'Bob',
        companionId: 'c2',
        companionName: 'Bob Jr',
        status: 'waitlisted',
        participantType: 'companion',
        registeredAt: '2026-05-01T10:06:00Z',
      },
      // u3 also has a companion waitlisted -> grouped under u3 (not split by course key)
      {
        _docId: 'r-u3-comp',
        userId: 'u3',
        userName: 'Charlie',
        companionId: 'c3',
        companionName: 'Charlie Jr',
        status: 'waitlisted',
        participantType: 'companion',
        registeredAt: '2026-05-01T10:07:00Z',
      },
    ];

    const wl = buildWaitlistRoster(event, regs);
    expect(wl.items.map((it) => it.userId)).toEqual(['u1', 'u3', 'u2']);
    expect(wl.items[0]).toMatchObject({
      name: 'Alice',
      userId: 'u1',
      selfOrphanInfo: 'Alice',
      companions: [
        { name: 'Alice Jr', companionId: 'c1', orphanInfo: 'Alice' },
      ],
    });
    expect(wl.items[1]).toMatchObject({
      name: 'Charlie',
      userId: 'u3',
      selfOrphanInfo: null,
      companions: [
        { name: 'Charlie Jr', companionId: 'c3', orphanInfo: null },
      ],
    });
    expect(wl.items[2]).toMatchObject({
      name: 'Bob',
      userId: 'u2',
      selfOrphanInfo: null,
      companions: [
        { name: 'Bob Jr', companionId: 'c2', orphanInfo: null },
      ],
    });
    expect(wl.totalCount).toBe(6);
  });
});
