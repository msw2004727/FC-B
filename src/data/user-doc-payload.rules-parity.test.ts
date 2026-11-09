import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  USER_DOC_CREATE_FIELDS,
  USER_DOC_LOGIN_UPDATE_FIELDS,
  USER_ROOT_CREATE_RULES_FIELDS,
} from './user-doc-payload';

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

  it('parser 對非純字串清單拒絕，不默認空集合', () => {
    expect(stringList("'a', 'b'")).toEqual(['a', 'b']);
    expect(() => stringList('')).toThrow();
    expect(() => stringList("'a', other()")).toThrow();
  });
});
