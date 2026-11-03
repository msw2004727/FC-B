import { describe, expect, it } from 'vitest';
import type { UserNoShowStats } from '@/data/user-roles';
import type { UserTagProps } from '@/ui/UserTag';
import {
  NO_SHOW_FEATURE_ENABLED,
  attendanceFill,
  buildEndedRegCountByUid,
  buildLastNoShowSet,
  buildNoShowCountByUid,
  participantNoShowCount,
  type NoShowParticipant,
} from './noshow-roster';

function stats(noShowCount = 0, endedRegCount = 0, lastEventWasNoShow = false): UserNoShowStats {
  return { noShowCount, endedRegCount, lastEventWasNoShow };
}

function person(overrides: Partial<NoShowParticipant> = {}): NoShowParticipant {
  return { uid: 'u1', isCompanion: false, proxyOnly: false, ...overrides };
}

describe('buildNoShowCountByUid（A 補正語意）', () => {
  it('raw 2 補正 -1 得 1；raw 1 補正 -3 歸零，不修改來源', () => {
    const users = { u1: stats(2), u2: stats(1) };
    const adjustments = new Map([['u1', -1], ['u2', -3]]);
    expect(buildNoShowCountByUid(users, adjustments)).toEqual(new Map([['u1', 1], ['u2', 0]]));
    expect(users).toEqual({ u1: stats(2), u2: stats(1) });
    expect(adjustments).toEqual(new Map([['u1', -1], ['u2', -3]]));
  });

  it('只收正數 raw，0／負數／NaN 不建立項目；raw 小數不自行取整', () => {
    expect(buildNoShowCountByUid({
      zero: stats(), negative: stats(-2), invalid: stats(NaN), fractional: stats(1.5), '': stats(3),
    })).toEqual(new Map([['fractional', 1.5]]));
  });

  it('補正數字字串向零取整，沒有 raw 的 UID 也能加補正', () => {
    expect(buildNoShowCountByUid({ u1: stats(4) }, new Map<string, unknown>([
      ['u1', '-1.9'], ['u2', '2.9'], ['u3', -4], ['u4', 0.9], ['', 4],
    ]))).toEqual(new Map([['u1', 3], ['u2', 2], ['u3', 0], ['u4', 0]]));
  });

  it.each([undefined, null, '', 0, '0', NaN, Infinity, -Infinity, 'invalid'])(
    '略過零值及非有限補正 %s',
    (adjustment) => {
      const users = { u1: stats(2) };
      expect(buildNoShowCountByUid(users, new Map([['u1', adjustment], ['missing', adjustment]])))
        .toEqual(new Map([['u1', 2]]));
    },
  );

  it('只按 key 的 UID 匹配，不採用使用者資料內的 uid 或 lineUserId', () => {
    const users = { real: { ...stats(2), uid: 'wrong', lineUserId: 'other' } };
    expect(buildNoShowCountByUid(users, new Map([['real', -1]]))).toEqual(new Map([['real', 1]]));
  });
});

describe('participantNoShowCount（精確 UID）', () => {
  it('以 UID 查找，修剪外圍空白；找不到或空 Map 回 0', () => {
    const counts = new Map([['u1', 2]]);
    expect(participantNoShowCount(person({ uid: ' u1 ' }), counts)).toBe(2);
    expect(participantNoShowCount(person({ uid: 'other' }), counts)).toBe(0);
    expect(participantNoShowCount(person(), new Map())).toBe(0);
  });

  it.each([
    { isCompanion: true },
    { proxyOnly: true },
    { isProxyOnly: true },
    { isTeamPlaceholder: true },
    { isTeamHeader: true },
    { isTeamGeneralSeparator: true },
    { uid: '' },
    { uid: '   ' },
  ] satisfies Partial<NoShowParticipant>[])('不適用列回 null：%o', (overrides) => {
    expect(participantNoShowCount(person(overrides), new Map([['u1', 8]]))).toBeNull();
  });

  it.each(['owner_同行者', 'comp_123'])('同行者 UID %s 即使在 map 也不算本人', (uid) => {
    expect(participantNoShowCount(person({ uid, isCompanion: true }), new Map([[uid, 9]]))).toBeNull();
  });

  it('沒有 person 或 Map 回 null', () => {
    expect(participantNoShowCount(null, new Map())).toBeNull();
    expect(participantNoShowCount(undefined, new Map())).toBeNull();
    expect(participantNoShowCount(person(), null)).toBeNull();
    expect(participantNoShowCount(person(), undefined)).toBeNull();
  });

  it('不依名字補 UID；即使名字恰好是別人的 UID，也只看 person.uid', () => {
    const named = { ...person({ uid: 'u2' }), name: 'u1' };
    expect(participantNoShowCount(named, new Map([['u1', 9], ['u2', 2]]))).toBe(2);
    expect(participantNoShowCount({ ...named, uid: '' }, new Map([['u1', 9]]))).toBeNull();
    expect(participantNoShowCount({ ...named, uid: 'u1' }, new Map([['u1', 9]]))).toBe(9);
  });
});

describe('分母、染色與最近放鴿子泡泡', () => {
  it('分母只收正數；泡泡只看 lastEventWasNoShow，獨立於補正後次數', () => {
    const users = {
      u1: stats(2, 3, true), u2: stats(1, 0), u3: stats(0, -1, true), u4: stats(0, NaN), '': stats(1, 3, true),
    };
    expect(buildEndedRegCountByUid(users)).toEqual(new Map([['u1', 3]]));
    expect(buildNoShowCountByUid(users, new Map([['u1', -2]])).get('u1')).toBe(0);
    expect(buildLastNoShowSet(users)).toEqual(new Set(['u1', 'u3']));
  });

  it.each([
    [2, 2, null, null],
    [3, 2, 67, 'rgba(220,38,38,.55)'],
    [10, 3, 30, 'rgba(239,68,68,.45)'],
    [10, 1, 10, 'rgba(251,146,60,.45)'],
    [10, 5, 50, 'rgba(220,38,38,.55)'],
    [10, 2, 20, 'rgba(239,68,68,.45)'],
    [3, 5, 100, 'rgba(220,38,38,.55)'],
    [3, 0, null, null],
    [3, -1, null, null],
    [0, 2, null, null],
  ] as const)('%i 場／%i 次 → %s%%', (ended, noShow, pct, color) => {
    const result = attendanceFill('u1', new Map([['u1', noShow]]), new Map([['u1', ended]]));
    expect(result).toEqual(pct === null ? null : { pct, color, ended, noShow });
    // 靜態型別檢查：不必改 UserTag 即可傳入既有 prop。
    const compatible: UserTagProps['attendanceFill'] = result ?? undefined;
    expect(compatible).toEqual(result ?? undefined);
  });

  it('缺 UID、分母或次數均不染色；只按精確 UID，允許修剪空白', () => {
    const counts = new Map([['u1', 2]]);
    const ended = new Map([['u1', 3]]);
    expect(attendanceFill('', counts, ended)).toBeNull();
    expect(attendanceFill(' ', counts, ended)).toBeNull();
    expect(attendanceFill('u2', counts, ended)).toBeNull();
    expect(attendanceFill('u1', counts, new Map())).toBeNull();
    expect(attendanceFill('u1', new Map(), ended)).toBeNull();
    expect(attendanceFill(' u1 ', counts, ended)?.pct).toBe(67);
  });

  it('染色採用補正後次數，補正到零即不染色', () => {
    const users = { u1: stats(2, 3) };
    const ended = buildEndedRegCountByUid(users);
    expect(attendanceFill('u1', buildNoShowCountByUid(users, new Map([['u1', -1]])), ended))
      .toEqual({ pct: 33, color: 'rgba(239,68,68,.45)', ended: 3, noShow: 1 });
    expect(attendanceFill('u1', buildNoShowCountByUid(users, new Map([['u1', -3]])), ended)).toBeNull();
  });
});

describe('放鴿子旗標', () => {
  it('預設與 A 一致為 true；關閉時所有純函式回空或 null', () => {
    expect(NO_SHOW_FEATURE_ENABLED).toBe(true);
    const users = { u1: stats(2, 3, true) };
    const counts = new Map([['u1', 2]]);
    const ended = new Map([['u1', 3]]);
    expect(buildNoShowCountByUid(users, new Map([['u1', 3]]), false)).toEqual(new Map());
    expect(buildEndedRegCountByUid(users, false)).toEqual(new Map());
    expect(buildLastNoShowSet(users, false)).toEqual(new Set());
    expect(participantNoShowCount(person(), counts, false)).toBeNull();
    expect(attendanceFill('u1', counts, ended, false)).toBeNull();
  });
});
