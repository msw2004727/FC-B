import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertUserRootCreate,
  buildLegacyMigration,
  buildNewUserDoc,
  findCreateTypeViolations,
  legacyHasTeam,
  USER_DOC_CREATE_FIELDS,
  USER_DOC_LOGIN_UPDATE_FIELDS,
  USER_ROOT_CREATE_RULES_FIELDS,
  type LineLoginProfile,
} from './user-doc-payload';

const profile: LineLoginProfile = { userId: 'U1', displayName: '小明', pictureUrl: null, email: null };

// 會員文件寫入欄位 × 同步 Rules（emulator/firestore.rules，來源 FC firestore.rules，hash 由 user-grant-parity.test.ts 核對）。
// Rules 不改（共用 lane）；這裡只確認 B 的白名單常數與 Rules 字面清單一致，Rules 一改就會失敗、要求重審。

const rules = readFileSync(resolve(__dirname, '../../emulator/firestore.rules'), 'utf8');

function usersBlock(): string {
  const start = rules.indexOf('match /users/{userId} {');
  const end = rules.indexOf('match /identityPrivate/{settingsId}', start);
  if (start < 0 || end < 0) throw new Error('找不到 users 區塊');
  return rules.slice(start, end);
}

/** 只解析純字串清單；清單裡出現字串以外的東西就丟錯（不默認為空）。 */
function stringList(body: string): string[] {
  const strings = [...body.matchAll(/'([^'\\]*)'/g)].map((m) => m[1]!);
  if (!strings.length || body.replace(/'([^'\\]*)'/g, '').replace(/[\s,]/g, '')) {
    throw new Error('清單必須只有字串');
  }
  return strings;
}

function functionReturnList(name: string): string[] {
  const m = new RegExp(`function\\s+${name}\\s*\\(\\s*\\)\\s*\\{\\s*return\\s*\\[([\\s\\S]*?)\\]\\s*;\\s*\\}`).exec(usersBlock());
  if (!m) throw new Error(`找不到 ${name}`);
  return stringList(m[1]!);
}

function hasOnlyListIn(fnName: string): string[] {
  const block = usersBlock();
  const start = block.indexOf(`function ${fnName}()`);
  if (start < 0) throw new Error(`找不到 ${fnName}`);
  const m = /changed\.hasOnly\(\[([\s\S]*?)\]\)/.exec(block.slice(start));
  if (!m) throw new Error(`${fnName} 沒有 hasOnly`);
  return stringList(m[1]!);
}

function hasAnyForbiddenIn(fnName: string): string[] {
  const block = usersBlock();
  const start = block.indexOf(`function ${fnName}()`);
  const m = /!changed\.hasAny\(\[([\s\S]*?)\]\)/.exec(block.slice(start));
  if (!m) throw new Error(`${fnName} 沒有禁止清單`);
  return stringList(m[1]!);
}

describe('會員文件欄位白名單 × Rules users 區塊', () => {
  it('USER_ROOT_CREATE_RULES_FIELDS 與 Rules userRootCreateAllowedKeys() 完全相同', () => {
    expect([...USER_ROOT_CREATE_RULES_FIELDS].sort()).toEqual(functionReturnList('userRootCreateAllowedKeys').sort());
  });

  it('A 新建欄位（USER_DOC_CREATE_FIELDS）全在 Rules 建立白名單內，且不含 Rules 禁止鍵', () => {
    const allowed = new Set(functionReturnList('userRootCreateAllowedKeys'));
    const forbidden = new Set(functionReturnList('forbiddenUserRootCreateKeys'));
    expect(USER_DOC_CREATE_FIELDS.filter((k) => !allowed.has(k))).toEqual([]);
    expect(USER_DOC_CREATE_FIELDS.filter((k) => forbidden.has(k))).toEqual([]);
  });

  it('登入更新欄位與 Rules isSafeLoginUpdate() 的 hasOnly 完全相同，且 Rules 有 owner＋isSafeLoginUpdate 的 update 路徑', () => {
    expect([...USER_DOC_LOGIN_UPDATE_FIELDS].sort()).toEqual(hasOnlyListIn('isSafeLoginUpdate').sort());
    expect(usersBlock()).toMatch(/\(isOwner\(userId\) && isSafeLoginUpdate\(\)\)/);
    expect(usersBlock()).toMatch(/allow create: if isSafeUserRootCreate\(\);/);
  });

  it('登入更新不碰自填資料更新禁止的欄位（uid、lineUserId、role、exp、level、createdAt…）', () => {
    const forbidden = hasAnyForbiddenIn('isSafeSelfProfileUpdate');
    expect(forbidden).toEqual(expect.arrayContaining(['role', 'exp', 'level', 'uid', 'lineUserId', 'createdAt']));
    expect(USER_DOC_LOGIN_UPDATE_FIELDS.filter((k) => forbidden.includes(k))).toEqual([]);
  });

  it('Rules 建立條件的值限制仍是 role==user、exp==0、level==1、時間欄位==request.time（payload 守門照此實作）', () => {
    const block = usersBlock();
    expect(block).toContain("request.resource.data.role == 'user'");
    expect(block).toContain('request.resource.data.exp == 0');
    expect(block).toContain('request.resource.data.level == 1');
    for (const key of ['createdAt', 'lastLogin', 'updatedAt']) {
      expect(block).toContain(`request.resource.data.${key} == request.time`);
    }
    expect(block).toContain('request.resource.data.uid == userId');
    expect(block).toContain('request.resource.data.lineUserId == userId');
  });

  it('型別守門涵蓋 Rules isSafeUserRootCreate 裡每個有型別條件的欄位（Flash 審查 P2-2）', () => {
    const block = usersBlock();
    const start = block.indexOf('function isSafeUserRootCreate()');
    const body = block.slice(start, block.indexOf('function existingSecondaryAvatarUrlMatches', start));
    const typed = [...body.matchAll(/request\.resource\.data\.(\w+) is (?:string|list|int|number|bool|map)/g)].map((m) => m[1]!);
    const typedSet = [...new Set(typed)].sort();
    const probe: Record<string, unknown> = {};
    for (const key of typedSet) probe[key] = Symbol('wrong-type');
    expect(findCreateTypeViolations(probe).sort()).toEqual(typedSet);
  });

  it('型別守門的允許／拒絕範例', () => {
    expect(findCreateTypeViolations({
      gender: null, sports: '足球', teamIds: [], totalGames: 3, attendanceRate: 0.5, profileCompleted: true,
      stealth: null, favorites: [], socialLinks: { line: 'x' }, lineNotify: null,
    })).toEqual([]);
    expect(findCreateTypeViolations({
      sports: ['足球'], teamIds: 'a', totalGames: 1.5, attendanceRate: '1', profileCompleted: null,
      socialLinks: [], lineNotify: new Date(0),
    }).sort()).toEqual(['attendanceRate', 'lineNotify', 'profileCompleted', 'socialLinks', 'sports', 'teamIds', 'totalGames']);
  });

  it('健檢 C1-03：Rules 建立條件 teamId 必須存在且為 null、teamIds 缺欄或空陣列（前端守門照此實作）', () => {
    const block = usersBlock();
    const start = block.indexOf('function isSafeUserRootCreate()');
    const body = block.slice(start, block.indexOf('function existingSecondaryAvatarUrlMatches', start));
    // teamId 沒有「缺欄放行」的前綴，缺欄就被拒。
    expect(body).toMatch(/&& request\.resource\.data\.teamId == null\r?\n/);
    expect(body).not.toContain("!('teamId' in request.resource.data)");
    expect(body).toContain("(!('teamIds' in request.resource.data) || request.resource.data.teamIds == [])");
  });

  it('健檢 C1-03 三案：帶 teamId 字串、缺 teamId、teamIds 非空', () => {
    const TS = Symbol('ts');
    const base = { lineUserId: 'U1', displayName: '舊', gender: '男' };
    const check = (legacy: Record<string, unknown>): void => {
      assertUserRootCreate(buildLegacyMigration(legacy, 'U1', profile, TS), 'U1', TS, USER_ROOT_CREATE_RULES_FIELDS);
    };
    // 缺 teamId（與 teamIds）：補 null／[] 後可遷移；null、空字串、空陣列一樣。
    const migrated = buildLegacyMigration(base, 'U1', profile, TS);
    expect(migrated).toMatchObject({ teamId: null, teamIds: [] });
    expect(legacyHasTeam(base)).toBe(false);
    expect(() => check(base)).not.toThrow();
    for (const empty of [{ teamId: null }, { teamId: '' }, { teamIds: null }, { teamId: null, teamIds: [] }]) {
      expect(legacyHasTeam({ ...base, ...empty })).toBe(false);
      expect(() => check({ ...base, ...empty })).not.toThrow();
    }
    // 帶 teamId 字串：判定帶俱樂部，且守門型別檢查也擋（不會丟掉俱樂部硬建）。
    const withTeamId = { ...base, teamId: 'club-1', teamName: '甲隊' };
    expect(legacyHasTeam(withTeamId)).toBe(true);
    expect(buildLegacyMigration(withTeamId, 'U1', profile, TS).teamId).toBe('club-1');
    expect(() => check(withTeamId)).toThrow(/create-types-not-allowed:teamId$/);
    // teamIds 非空：同上。
    const withTeamIds = { ...base, teamId: null, teamIds: ['club-1'], teamNames: ['甲隊'] };
    expect(legacyHasTeam(withTeamIds)).toBe(true);
    expect(buildLegacyMigration(withTeamIds, 'U1', profile, TS).teamIds).toEqual(['club-1']);
    expect(() => check(withTeamIds)).toThrow(/create-types-not-allowed:teamIds$/);
    // 守門本身：缺 teamId 的 payload 被擋（對照 Rules 直接取欄位）。
    const noTeamId = { ...buildNewUserDoc('U1', profile, TS) };
    delete noTeamId.teamId;
    expect(() => assertUserRootCreate(noTeamId, 'U1', TS, USER_DOC_CREATE_FIELDS)).toThrow(/create-values-not-allowed:teamId$/);
    expect(findCreateTypeViolations({ teamId: null, teamIds: [] })).toEqual([]);
    expect(findCreateTypeViolations({ teamId: 'x', teamIds: ['x'] }).sort()).toEqual(['teamId', 'teamIds']);
    expect(findCreateTypeViolations({ teamIds: null })).toEqual(['teamIds']);
  });

  it('parser 對非純字串清單拒絕，不默認空集合', () => {
    expect(stringList("'a', 'b'")).toEqual(['a', 'b']);
    expect(() => stringList('')).toThrow();
    expect(() => stringList("'a', other()")).toThrow();
  });
});
