/**
 * `team-list-model` 純函式測試。
 *
 * 每個函式覆蓋 A 原始碼的每個分支：
 *   - getUserTeamIds / isUserInTeam
 *   - normalizeTeamCategory / isTeamTeachingTagged / getTeamCategoryMeta
 *   - filterTeams（關鍵字、region、sportTag、typeTab、hideInactive）
 *   - sortTeams（置頂 / pinOrder / 同分 name 次序）
 *   - getTeamRank（邊界）
 *   - getTeamCoverImageUrl（imageVariants 優先序）
 *   - getTeamThemeColor / normalizeTeamThemeColor
 */

import { describe, expect, it } from 'vitest';

import {
  filterTeams,
  getTeamCategoryMeta,
  getTeamCategoryOptions,
  getTeamCoverImageUrl,
  getTeamRank,
  getTeamThemeColor,
  getUserTeamIds,
  isTeamTeachingTagged,
  isUserInTeam,
  normalizeTeamCategory,
  normalizeTeamThemeColor,
  sortTeams,
} from './team-list-model';
import type { TeamDoc } from './types';

describe('getUserTeamIds / isUserInTeam', () => {
  it('合併 teamIds 陣列與 legacy teamId，trim 並去重', () => {
    const user = { teamIds: [' t1 ', 't2', 't1'], teamId: 't3' };
    expect(getUserTeamIds(user)).toEqual(['t1', 't2', 't3']);
  });

  it('null user 回空陣列', () => {
    expect(getUserTeamIds(null)).toEqual([]);
    expect(getUserTeamIds(undefined)).toEqual([]);
  });

  it('teamIds 非陣列時只取 teamId', () => {
    expect(getUserTeamIds({ teamIds: 'bad', teamId: 't1' })).toEqual(['t1']);
  });

  it('isUserInTeam：null teamId 一律 false', () => {
    expect(isUserInTeam({ teamIds: ['t1'] }, null)).toBe(false);
    expect(isUserInTeam({ teamIds: ['t1'] }, '')).toBe(false);
  });

  it('isUserInTeam：命中 teamIds 或 teamId', () => {
    expect(isUserInTeam({ teamIds: ['t1'] }, 't1')).toBe(true);
    expect(isUserInTeam({ teamId: 't2' }, 't2')).toBe(true);
    expect(isUserInTeam({ teamIds: ['t1'] }, 't3')).toBe(false);
  });
});

describe('normalizeTeamCategory', () => {
  it('別名集合', () => {
    expect(normalizeTeamCategory('none')).toBe('none');
    expect(normalizeTeamCategory('NO')).toBe('none');
    expect(normalizeTeamCategory('untagged')).toBe('none');
    expect(normalizeTeamCategory('education')).toBe('education');
    expect(normalizeTeamCategory('Teaching')).toBe('education');
    expect(normalizeTeamCategory('leisure')).toBe('leisure');
    expect(normalizeTeamCategory('casual')).toBe('leisure');
    expect(normalizeTeamCategory('recreational')).toBe('leisure');
    expect(normalizeTeamCategory('competitive')).toBe('competitive');
    expect(normalizeTeamCategory(null)).toBe('competitive');
    expect(normalizeTeamCategory(undefined)).toBe('competitive');
  });
});

describe('isTeamTeachingTagged', () => {
  it('teachingEnabled 為 true/false 優先於其他旗標', () => {
    expect(isTeamTeachingTagged({ teachingEnabled: true, type: 'competitive' })).toBe(true);
    expect(isTeamTeachingTagged({ teachingEnabled: false, type: 'education' })).toBe(false);
  });

  it('isTeaching / educationTag 開啟視為教學', () => {
    expect(isTeamTeachingTagged({ isTeaching: true })).toBe(true);
    expect(isTeamTeachingTagged({ educationTag: true })).toBe(true);
  });

  it('eduSettings.teachingEnabled 分支', () => {
    expect(isTeamTeachingTagged({ eduSettings: { teachingEnabled: true } })).toBe(true);
    expect(isTeamTeachingTagged({ eduSettings: { teachingEnabled: false } })).toBe(false);
  });

  it('fallback type === education', () => {
    expect(isTeamTeachingTagged({ type: 'education' })).toBe(true);
    expect(isTeamTeachingTagged({ type: 'leisure' })).toBe(false);
    expect(isTeamTeachingTagged(null)).toBe(false);
  });
});

describe('getTeamCategoryMeta', () => {
  it('teaching tag 開啟一律 education', () => {
    const meta = getTeamCategoryMeta({ type: 'competitive', teachingEnabled: true });
    expect(meta.key).toBe('education');
  });

  it('teachingEnabled === false 且 type 未設定 → competitive', () => {
    expect(getTeamCategoryMeta({ teachingEnabled: false }).key).toBe('competitive');
    expect(getTeamCategoryMeta({ teachingEnabled: false, type: 'education' }).key).toBe('competitive');
    expect(getTeamCategoryMeta({ eduSettings: { teachingEnabled: false } }).key).toBe('competitive');
  });

  it('type 為 none / leisure 時回對應分類', () => {
    expect(getTeamCategoryMeta({ type: 'none' }).key).toBe('none');
    expect(getTeamCategoryMeta({ type: 'leisure' }).key).toBe('leisure');
  });

  it('字串參數直接 normalize', () => {
    expect(getTeamCategoryMeta('education').key).toBe('education');
    expect(getTeamCategoryMeta('nothing').key).toBe('competitive');
  });
});

describe('getTeamCategoryOptions', () => {
  it('回傳四個分類、且 labelKey 使用 clubs.category.<key>', () => {
    const options = getTeamCategoryOptions();
    expect(options.map((o) => o.key)).toEqual(['none', 'competitive', 'education', 'leisure']);
    expect(options[0]?.labelKey).toBe('clubs.category.none');
    expect(options[2]?.labelKey).toBe('clubs.category.education');
  });
});

describe('filterTeams', () => {
  const teams: TeamDoc[] = [
    { id: 't1', name: 'Alpha', sportTag: 'basketball', region: 'taipei', active: true },
    { id: 't2', name: 'Beta', nameEn: 'Beta Squad', captain: 'Alice', sportTag: 'soccer', active: true },
    { id: 't3', name: 'Gamma', leader: 'Bob', sportTag: 'basketball', active: true },
    { id: 't4', name: 'Closed', sportTag: 'basketball', active: false },
    { id: 't5', name: 'Edu', type: 'education', sportTag: 'soccer', active: true },
    { id: 't6', name: 'NoFlag', sportTag: 'soccer' },
  ];

  it('預設只保留 active 為真（照 A getActiveTeams；缺 active 欄位也隱藏）', () => {
    const result = filterTeams(teams);
    expect(result.map((t) => t.id)).not.toContain('t4');
    expect(result.map((t) => t.id)).not.toContain('t6');
    expect(result).toHaveLength(4);
  });

  it('hideInactive = false 保留停用', () => {
    expect(filterTeams(teams, { hideInactive: false }).map((t) => t.id)).toContain('t4');
  });

  it('關鍵字比對 name/nameEn/captain/leader（大小寫不敏感）', () => {
    expect(filterTeams(teams, { query: 'alpha' }).map((t) => t.id)).toEqual(['t1']);
    expect(filterTeams(teams, { query: 'squad' }).map((t) => t.id)).toEqual(['t2']);
    expect(filterTeams(teams, { query: 'alice' }).map((t) => t.id)).toEqual(['t2']);
    expect(filterTeams(teams, { query: 'bob' }).map((t) => t.id)).toEqual(['t3']);
  });

  it('region 與 sportTag 精確比對', () => {
    expect(filterTeams(teams, { region: 'taipei' }).map((t) => t.id)).toEqual(['t1']);
    expect(filterTeams(teams, { sportTag: 'basketball' }).map((t) => t.id)).toEqual([
      't1',
      't3',
    ]);
  });

  it('typeTab 依 normalizeTeamCategory 比對 meta.key', () => {
    expect(filterTeams(teams, { typeTab: 'education' }).map((t) => t.id)).toEqual(['t5']);
    expect(filterTeams(teams, { typeTab: 'teaching' }).map((t) => t.id)).toEqual(['t5']);
  });
});

describe('sortTeams', () => {
  it('置頂在前、彼此依 pinOrder 升冪', () => {
    const teams: TeamDoc[] = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', pinned: true, pinOrder: 2 },
      { id: 'c', name: 'C', pinned: true, pinOrder: 1 },
    ];
    expect(sortTeams(teams).map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('皆未置頂時依 name localeCompare', () => {
    const teams: TeamDoc[] = [
      { id: 'b', name: 'Bravo' },
      { id: 'a', name: 'Alpha' },
      { id: 'c', name: 'Charlie' },
    ];
    expect(sortTeams(teams).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('置頂缺 pinOrder 視為 0', () => {
    const teams: TeamDoc[] = [
      { id: 'x', name: 'X', pinned: true, pinOrder: 5 },
      { id: 'y', name: 'Y', pinned: true },
    ];
    expect(sortTeams(teams).map((t) => t.id)).toEqual(['y', 'x']);
  });
});

describe('getTeamRank', () => {
  it('由尾端往前找第一個 exp >= min 的級別', () => {
    expect(getTeamRank(0)).toEqual({ rank: 'E', color: '#6b7280' });
    // 門檻與色碼照 A js/config.js TEAM_RANK_CONFIG
    expect(getTeamRank(999)).toEqual({ rank: 'E', color: '#6b7280' });
    expect(getTeamRank(1000)).toEqual({ rank: 'D', color: '#22c55e' });
    expect(getTeamRank(5999)).toEqual({ rank: 'A+', color: '#f97316' });
    expect(getTeamRank(7000)).toEqual({ rank: 'S', color: '#ec4899' });
    expect(getTeamRank(10000)).toEqual({ rank: 'SSS', color: '#dc2626' });
  });

  it('null/undefined 視為 0', () => {
    expect(getTeamRank(null)).toEqual({ rank: 'E', color: '#6b7280' });
    expect(getTeamRank(undefined)).toEqual({ rank: 'E', color: '#6b7280' });
  });
});

describe('getTeamCoverImageUrl', () => {
  it('imageVariants 優先於 image/coverImage', () => {
    const team: TeamDoc = {
      imageVariants: { cover: 'variant-cover', card: 'variant-card' },
      image: 'fallback-image',
      coverImage: 'legacy-cover',
    };
    expect(getTeamCoverImageUrl(team, 'cover')).toBe('variant-cover');
    expect(getTeamCoverImageUrl(team, 'card')).toBe('variant-card');
  });

  it('無 variant 時 fallback image → coverImage', () => {
    expect(getTeamCoverImageUrl({ image: 'img' })).toBe('img');
    expect(getTeamCoverImageUrl({ coverImage: 'cv' })).toBe('cv');
    expect(getTeamCoverImageUrl(null)).toBe('');
  });
});

describe('getTeamThemeColor / normalizeTeamThemeColor', () => {
  it('合法 #RRGGBB 才回傳', () => {
    expect(normalizeTeamThemeColor('#ff0000')).toBe('#ff0000');
    expect(normalizeTeamThemeColor('#FF0000')).toBe('#FF0000');
    expect(normalizeTeamThemeColor('red')).toBe('');
    expect(normalizeTeamThemeColor('#f00')).toBe('');
    expect(normalizeTeamThemeColor(null)).toBe('');
  });

  it('getTeamThemeColor 讀 team.themeColor', () => {
    expect(getTeamThemeColor({ themeColor: '#00ff00' })).toBe('#00ff00');
    expect(getTeamThemeColor({ themeColor: 'invalid' })).toBe('');
    expect(getTeamThemeColor(null)).toBe('');
  });
});
