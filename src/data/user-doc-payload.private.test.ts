// 會員資料讀取強化：建檔／遷移 payload 不含四欄（私密子文件處理），白名單常數同步收斂。

import { describe, expect, it } from 'vitest';

import {
  buildLegacyMigration,
  buildNewUserDoc,
  USER_DOC_CREATE_FIELDS,
  USER_ROOT_CREATE_RULES_FIELDS,
  type LineLoginProfile,
} from './user-doc-payload';

const TS = { __sv: 'SERVER_TIMESTAMP' };

function lineProfile(overrides: Partial<LineLoginProfile> = {}): LineLoginProfile {
  return {
    userId: 'uid1',
    displayName: 'Alice',
    pictureUrl: 'https://example.com/a.png',
    email: 'a@example.com',
    ...overrides,
  };
}

describe('會員資料讀取強化：buildNewUserDoc 不含四欄', () => {
  it('建檔 payload 不含 email 與 phone', () => {
    const payload = buildNewUserDoc('uid1', lineProfile(), TS);
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('phone');
  });

  it('LINE 沒給 email 時同樣不含 email', () => {
    const payload = buildNewUserDoc('uid1', lineProfile({ email: null }), TS);
    expect(payload).not.toHaveProperty('email');
  });
});

describe('會員資料讀取強化：buildLegacyMigration 不含四欄', () => {
  it('舊文件帶四欄值時不寫回根文件', () => {
    const legacy = {
      phone: '0912345678',
      email: 'old@example.com',
      companions: [{ name: 'A' }],
      eduChildren: [{ name: 'K' }],
      displayName: '舊名稱',
    };
    const payload = buildLegacyMigration(legacy, 'uid1', lineProfile(), TS);
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('companions');
    expect(payload).not.toHaveProperty('eduChildren');
  });

  it('舊文件沒有四欄值時也不誤加', () => {
    const legacy = { displayName: '舊名稱' };
    const payload = buildLegacyMigration(legacy, 'uid1', lineProfile(), TS);
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('companions');
    expect(payload).not.toHaveProperty('eduChildren');
  });
});

describe('會員資料讀取強化：白名單常數已移除四欄', () => {
  it('USER_DOC_CREATE_FIELDS 不含 email 與 phone', () => {
    expect(USER_DOC_CREATE_FIELDS as readonly string[]).not.toContain('email');
    expect(USER_DOC_CREATE_FIELDS as readonly string[]).not.toContain('phone');
  });

  it('USER_ROOT_CREATE_RULES_FIELDS 不含四欄', () => {
    const keys = USER_ROOT_CREATE_RULES_FIELDS as readonly string[];
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('companions');
    expect(keys).not.toContain('eduChildren');
  });
});
