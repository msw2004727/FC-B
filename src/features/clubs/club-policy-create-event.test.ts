import { describe, expect, it } from 'vitest';
import { canCreateClubEvent, type ClubCreateEventViewer } from './club-policy';
import type { TeamDoc } from './data/types';

const team: TeamDoc = {
  id: 'test-club-create',
  name: '測試俱樂部',
  active: true,
  captainUid: 'test-staff',
};

function makeViewer(
  overrides: Partial<ClubCreateEventViewer> = {},
  permissions: readonly string[] = [],
): ClubCreateEventViewer {
  return {
    uid: 'test-staff',
    teamIds: new Set<string>(),
    role: 'user',
    capabilities: [],
    hasPermission: (code) => permissions.includes(code),
    ...overrides,
  };
}

describe('canCreateClubEvent', () => {
  it('allows user with event.create, team.create_event and exact staff UID', () => {
    expect(canCreateClubEvent(
      makeViewer({}, ['event.create', 'team.create_event']),
      team,
    )).toBe(true);
  });

  it('rejects user staff without team.create_event', () => {
    expect(canCreateClubEvent(makeViewer({}, ['event.create']), team)).toBe(false);
  });

  it('allows user with addon, basic and event.edit_all outside staff scope', () => {
    expect(canCreateClubEvent(
      makeViewer({
        uid: 'test-outsider',
        capabilities: ['user.activity.addons_use', 'user.activity.basic_create'],
      }, ['event.edit_all']),
      team,
    )).toBe(true);
  });

  it('rejects user with addon and staff scope but no team.create_event', () => {
    expect(canCreateClubEvent(
      makeViewer({
        capabilities: ['user.activity.addons_use', 'user.activity.basic_create'],
      }, ['event.create']),
      team,
    )).toBe(false);
  });

  it('allows coach staff without explicit event permissions', () => {
    expect(canCreateClubEvent(makeViewer({ role: 'coach' }), team)).toBe(true);
  });

  it('rejects coach outside staff scope without event.edit_all', () => {
    expect(canCreateClubEvent(
      makeViewer({ role: 'coach', uid: 'test-outsider' }),
      team,
    )).toBe(false);
  });

  it('allows admin with event.edit_all outside staff scope', () => {
    expect(canCreateClubEvent(
      makeViewer({ role: 'admin', uid: 'test-outsider' }, ['event.edit_all']),
      team,
    )).toBe(true);
  });

  it('allows venue_owner staff', () => {
    expect(canCreateClubEvent(makeViewer({ role: 'venue_owner' }), team)).toBe(true);
  });

  it.each(['creatorUid', 'ownerUid', 'leaderUid'] as const)(
    'recognizes %s as exact staff scope',
    (key) => {
      expect(canCreateClubEvent(
        makeViewer({ role: 'coach' }),
        { ...team, captainUid: 'test-other-captain', [key]: 'test-staff' },
      )).toBe(true);
    },
  );

  it.each(['leaderUids', 'coachUids'] as const)(
    'recognizes trimmed UID in %s',
    (key) => {
      expect(canCreateClubEvent(
        makeViewer({ role: ' COACH ', uid: '  test-staff  ' }),
        {
          ...team,
          captainUid: 'test-other-captain',
          [key]: ['', '  ', ' test-staff '],
        },
      )).toBe(true);
    },
  );

  it('does not grant staff scope for matching display names', () => {
    const sameNameViewer = {
      ...makeViewer({ role: 'coach', uid: 'test-outsider' }),
      displayName: '同名職員',
    };
    expect(canCreateClubEvent(sameNameViewer, {
      ...team,
      captain: '同名職員',
      leader: '同名職員',
      leaders: ['同名職員'],
      coachNames: ['同名職員'],
    })).toBe(false);
  });

  it.each([null, '', '   '])('rejects guest UID %s', (uid) => {
    expect(canCreateClubEvent(
      makeViewer({ uid, role: 'super_admin' }, ['event.edit_all']),
      team,
    )).toBe(false);
  });

  it.each([null, undefined])('rejects missing viewer %s', (missing) => {
    expect(canCreateClubEvent(missing, team)).toBe(false);
  });

  it.each([null, undefined])('rejects missing team %s', (missing) => {
    expect(canCreateClubEvent(makeViewer({ role: 'super_admin' }), missing)).toBe(false);
  });

  it('normalizes an empty role to user', () => {
    expect(canCreateClubEvent(
      makeViewer({ role: '   ' }, ['event.create', 'team.create_event']),
      team,
    )).toBe(true);
  });

  it('allows super_admin outside staff scope', () => {
    expect(canCreateClubEvent(
      makeViewer({ uid: 'test-outsider', role: 'super_admin' }),
      team,
    )).toBe(true);
  });
});
