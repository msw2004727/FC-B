import { describe, expect, it } from 'vitest';
import { taipeiMs } from '../format';
import {
  assignPeople,
  assignStaffFields,
  canRemoveStaffRow,
  groupByCompetitionDay,
  showScoreEntry,
  staffDisplayNames,
  SCORE_FINISH_WINDOW_MS,
  type StaffViewerKind,
} from './staff-assign';
import type { StaffAssignmentRole } from './types';

const ROLES: StaffAssignmentRole[] = ['host', 'coHost', 'scorer', 'referee'];
const VIEWERS: StaffViewerKind[] = ['host', 'coHost'];

describe('指派規則', () => {
  it('移除鈕：主辦列不顯示，共同主辦列只有主辦看得到，記分員與裁判都顯示', () => {
    for (const viewer of VIEWERS) {
      for (const role of ROLES) {
        const shown = canRemoveStaffRow(viewer, role);
        if (role === 'host') expect(shown, `${viewer} ${role}`).toBe(false);
        else if (role === 'coHost') expect(shown, `${viewer} ${role}`).toBe(viewer === 'host');
        else expect(shown, `${viewer} ${role}`).toBe(true);
      }
    }
  });

  it('自己顯示我自己；同角色依 uid 編號，自己不占號', () => {
    const rows = [
      { uid: 'uid_self', roles: ['host', 'scorer'] },
      { uid: 'uid_b', roles: ['scorer'] },
      { uid: 'uid_a', roles: ['scorer'] },
      { uid: 'uid_ref', roles: ['referee'] },
    ];
    const names = staffDisplayNames(rows, 'uid_self');
    expect(names.get('uid_self')).toBe('我自己');
    expect(names.get('uid_a')).toBe('成員 1');
    expect(names.get('uid_b')).toBe('成員 2');
    expect(names.get('uid_ref')).toBe('成員');

    const alone = staffDisplayNames([{ uid: 'uid_x', roles: ['coHost'] }], 'uid_self');
    expect(alone.get('uid_x')).toBe('成員');

    expect(assignPeople(rows, 'uid_self').map((row) => row.name)).toEqual([
      '我自己',
      '成員 1',
      '成員 2',
      '成員',
    ]);
    expect(assignPeople([{ uid: 'uid_self', roles: ['scorer'] }], 'uid_self')).toEqual([
      { uid: 'uid_self', name: '我自己' },
    ]);
  });

  it('指派 payload 是單一角色，不帶 expiresAt', () => {
    const fields = assignStaffFields({
      cid: 'cid_1',
      uid: 'uid_1',
      role: 'scorer',
      matchIds: ['mt_b', 'mt_a'],
    });
    expect(fields).toEqual({
      cid: 'cid_1',
      uid: 'uid_1',
      roles: ['scorer'],
      matchIds: ['mt_b', 'mt_a'],
    });
    expect(fields).not.toHaveProperty('expiresAt');
  });

  it('進入記分：未開賽、進行中、中場，以及已結束 180 秒內', () => {
    const now = 1_000_000;
    expect(showScoreEntry('scheduled', null, now)).toBe(true);
    expect(showScoreEntry('live', null, now)).toBe(true);
    expect(showScoreEntry('halftime', null, now)).toBe(true);
    expect(showScoreEntry('finished', now - SCORE_FINISH_WINDOW_MS + 1, now)).toBe(true);
    expect(showScoreEntry('finished', now - SCORE_FINISH_WINDOW_MS, now)).toBe(false);
    expect(showScoreEntry('finished', null, now)).toBe(false);
    expect(showScoreEntry('confirmed', now, now)).toBe(false);
    expect(showScoreEntry('cancelled', now, now)).toBe(false);
    expect(showScoreEntry('postponed', now, now)).toBe(false);
    expect(showScoreEntry('walkover', now, now)).toBe(false);
  });

  it('比賽日 05:00 前算前一天，沒有開賽時間的不進任何一天', () => {
    const before = taipeiMs(2027, 1, 10, 4, 59);
    const atFive = taipeiMs(2027, 1, 10, 5, 0);
    const grouped = groupByCompetitionDay([
      { id: 'late', kickoffAt: before },
      { id: 'five', kickoffAt: atFive },
      { id: 'tbd', kickoffAt: null },
    ]);
    expect(grouped.days.map((day) => day.key)).toEqual(['2027-01-09', '2027-01-10']);
    expect(grouped.days[0]?.items.map((item) => item.id)).toEqual(['late']);
    expect(grouped.days[1]?.items.map((item) => item.id)).toEqual(['five']);
    expect(grouped.undated.map((item) => item.id)).toEqual(['tbd']);
  });
});
