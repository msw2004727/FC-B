import { describe, expect, it } from 'vitest';

import { isKnownNotificationSource, pickRelationKeys } from './notification-relation-keys';

describe('pickRelationKeys', () => {
  it('只留五個已知鍵的非空字串，並 trim', () => {
    expect(pickRelationKeys({
      eventId: ' e1 ',
      teamId: 't1',
      tournamentId: '  ',
      applicantUid: '',
      assignmentRole: 'coach',
    })).toEqual({
      eventId: 'e1',
      teamId: 't1',
      assignmentRole: 'coach',
    });
  });

  it('null、非物件、非字串都不帶，也不送空字串', () => {
    expect(pickRelationKeys(null)).toEqual({});
    expect(pickRelationKeys(undefined)).toEqual({});
    expect(pickRelationKeys({
      eventId: 1 as unknown as string,
      teamId: null as unknown as string,
    })).toEqual({});
  });
});

describe('isKnownNotificationSource', () => {
  it('已知精確值與樣式為真', () => {
    expect(isKnownNotificationSource('team_join_request')).toBe(true);
    expect(isKnownNotificationSource('template:event_changed')).toBe(true);
    expect(isKnownNotificationSource('template:event_changed:admins')).toBe(true);
    expect(isKnownNotificationSource('team_join_review:broadcast:approve')).toBe(true);
    expect(isKnownNotificationSource('team_role_assignment:member')).toBe(true);
    expect(isKnownNotificationSource('target:coach_up')).toBe(true);
    expect(isKnownNotificationSource('target:all')).toBe(true);
  });

  it('未知、空白、未 trim 的前後空白為假', () => {
    expect(isKnownNotificationSource('template:event_changed_override')).toBe(false);
    expect(isKnownNotificationSource(' target:all')).toBe(false);
    expect(isKnownNotificationSource('target:Coach')).toBe(false);
    expect(isKnownNotificationSource('')).toBe(false);
    expect(isKnownNotificationSource('   ')).toBe(false);
    expect(isKnownNotificationSource(null)).toBe(false);
  });
});
