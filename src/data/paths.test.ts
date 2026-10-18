import { describe, expect, it } from 'vitest';

import {
  activityRecords,
  attendanceRecords,
  coursePlanEnrollments,
  coursePlans,
  coursePlanSessions,
  eventDoc,
  events,
  filterSubcollectionDocs,
  isSubcollectionDoc,
  registrations,
  teams,
  userInbox,
  users,
} from './paths';

describe('path helpers', () => {
  it('集合常數', () => {
    expect(events).toBe('events');
    expect(users).toBe('users');
    expect(teams).toBe('teams');
  });

  it('活動與三種子集合', () => {
    expect(eventDoc('abc')).toBe('events/abc');
    expect(registrations('abc')).toBe('events/abc/registrations');
    expect(attendanceRecords('abc')).toBe('events/abc/attendanceRecords');
    expect(activityRecords('abc')).toBe('events/abc/activityRecords');
  });

  it('users / teams / coursePlans', () => {
    expect(userInbox('u1')).toBe('users/u1/inbox');
    expect(coursePlans('t1')).toBe('teams/t1/coursePlans');
    expect(coursePlanSessions('t1', 'p1')).toBe('teams/t1/coursePlans/p1/sessions');
    expect(coursePlanEnrollments('t1', 'p1')).toBe('teams/t1/coursePlans/p1/enrollments');
  });
});

describe('isSubcollectionDoc（R-REG-014）', () => {
  it('root 文件（parent.parent === null）回傳 false', () => {
    expect(isSubcollectionDoc({ parent: { parent: null } })).toBe(false);
  });

  it('子集合文件（parent.parent !== null）回傳 true', () => {
    expect(isSubcollectionDoc({ parent: { parent: { id: 'parentDoc' } } })).toBe(true);
  });
});

describe('filterSubcollectionDocs', () => {
  it('只保留子集合文件', () => {
    const root = { id: 'root', ref: { parent: { parent: null } } };
    const sub = { id: 'sub', ref: { parent: { parent: { id: 'p' } } } };
    const filtered = filterSubcollectionDocs([root, sub]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toBe(sub);
  });

  it('空陣列回傳空陣列', () => {
    expect(filterSubcollectionDocs([])).toEqual([]);
  });

  it('回傳一般陣列而非 QuerySnapshot', () => {
    const result = filterSubcollectionDocs([]);
    expect(Array.isArray(result)).toBe(true);
    // 不應具有 QuerySnapshot API
    expect('forEach' in Object(result)).toBe(true); // Array.prototype.forEach
    expect('docs' in Object(result)).toBe(false);
  });
});
