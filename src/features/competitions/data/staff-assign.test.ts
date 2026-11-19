import { describe, expect, it } from 'vitest';
import { taipeiMs } from '../format';
import {
  assignPeople,
  assignStaffFields,
  canRemoveStaffRow,
  compareStaffOrder,
  groupByCompetitionDay,
  showScoreEntry,
  staffDisplayNames,
  SCORE_FINISH_WINDOW_MS,
  type StaffViewerKind,
} from './staff-assign';
const VIEWERS: StaffViewerKind[] = ['host', 'coHost'];

describe('指派規則', () => {
  it('移除鈕只給有記分角色、而且動得了的列', () => {
    for (const viewer of VIEWERS) {
      expect(canRemoveStaffRow(viewer, ['host']), viewer).toBe(false);
      expect(canRemoveStaffRow(viewer, ['coHost']), viewer).toBe(false);
      expect(canRemoveStaffRow(viewer, ['host', 'scorer'], true), viewer).toBe(false);
      expect(canRemoveStaffRow(viewer, ['scorer']), viewer).toBe(true);
      expect(canRemoveStaffRow(viewer, ['referee']), viewer).toBe(true);
    }
    expect(canRemoveStaffRow('host', ['coHost', 'scorer'])).toBe(true);
    expect(canRemoveStaffRow('coHost', ['coHost', 'scorer'], false)).toBe(false);
    expect(canRemoveStaffRow('coHost', ['coHost', 'referee'], true)).toBe(true);
    expect(canRemoveStaffRow('coHost', ['host', 'scorer'], false)).toBe(false);
  });

  it('編號用 memberNo；移除成員 2 後成員 3 仍是 3；缺號不帶號碼', () => {
    const rows = [
      { uid: 'uid_self', roles: ['host', 'scorer'], memberNo: 1 },
      { uid: 'uid_b', roles: ['scorer'], memberNo: 2 },
      { uid: 'uid_c', roles: ['referee'], memberNo: 3 },
      { uid: 'uid_old', roles: ['coHost'] },
      { uid: 'uid_zero', roles: ['scorer'], memberNo: 0 },
      { uid: 'uid_neg', roles: ['scorer'], memberNo: -2 },
      { uid: 'uid_frac', roles: ['scorer'], memberNo: 1.5 },
    ];
    const names = staffDisplayNames(rows, 'uid_self');
    expect(names.get('uid_self')).toBe('我自己');
    expect(names.get('uid_b')).toBe('成員 2');
    expect(names.get('uid_c')).toBe('成員 3');
    expect(names.get('uid_old')).toBe('成員');
    expect(names.get('uid_zero')).toBe('成員');
    expect(names.get('uid_neg')).toBe('成員');
    expect(names.get('uid_frac')).toBe('成員');

    const left = rows.filter((row) => row.uid !== 'uid_b');
    expect(staffDisplayNames(left, 'uid_self').get('uid_c')).toBe('成員 3');
    // 重新計算（重建畫面）仍是文件上的號碼，不依剩下的人數重編。
    expect(staffDisplayNames(left, 'uid_self').get('uid_c')).toBe('成員 3');
    expect(staffDisplayNames(left, 'uid_self').get('uid_self')).toBe('我自己');

    expect(assignPeople(rows, 'uid_self').map((row) => row.name)).toEqual([
      '我自己',
      '成員 2',
      '成員 3',
      '成員',
      '成員',
      '成員',
      '成員',
    ]);
    expect(assignPeople(rows, 'uid_self').map((row) => row.uid)).toEqual([
      'uid_self',
      'uid_b',
      'uid_c',
      'uid_frac',
      'uid_neg',
      'uid_old',
      'uid_zero',
    ]);
    expect(assignPeople([{ uid: 'uid_self', roles: ['scorer'], memberNo: 1 }], 'uid_self')).toEqual([
      { uid: 'uid_self', name: '我自己' },
    ]);
  });

  it('列表依 memberNo 由小到大，缺值排最後再依 uid', () => {
    const rows = [
      { uid: 'uid_z', memberNo: 3 },
      { uid: 'uid_b' },
      { uid: 'uid_a' },
      { uid: 'uid_m', memberNo: 1 },
      { uid: 'uid_n', memberNo: 1 },
      { uid: 'uid_bad', memberNo: 0 },
    ];
    expect([...rows].sort(compareStaffOrder).map((row) => row.uid)).toEqual([
      'uid_m',
      'uid_n',
      'uid_z',
      'uid_a',
      'uid_b',
      'uid_bad',
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
