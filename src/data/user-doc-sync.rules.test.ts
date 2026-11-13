// @vitest-environment node
/**
 * 會員文件寫入 × 未修改的 Firestore Rules（emulator）。副機／主機有 emulator 時才跑，沿用 FC 的 @firebase/rules-unit-testing：
 * RUN_FIRESTORE_RULES_TESTS=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   node node_modules/vitest/vitest.mjs run src/data/user-doc-sync.rules.test.ts
 * 未明確啟用時整組 skip；啟用但缺少 emulator／依賴時必須失敗，不偽裝通過。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase/firestore';

import {
  buildLastLoginUpdate,
  buildLegacyMigration,
  buildLoginUpdate,
  buildNewUserDoc,
  type LineLoginProfile,
} from './user-doc-payload';

interface RulesContext { firestore(): Firestore }
interface RulesEnvironment {
  authenticatedContext(uid: string, claims?: Record<string, unknown>): RulesContext;
  withSecurityRulesDisabled(run: (context: RulesContext) => Promise<void>): Promise<void>;
  clearFirestore(): Promise<void>;
  cleanup(): Promise<void>;
}
interface RulesTesting {
  initializeTestEnvironment(config: {
    projectId: string; firestore: { host: string; port: number; rules: string };
  }): Promise<RulesEnvironment>;
  assertFails(promise: Promise<unknown>): Promise<unknown>;
  assertSucceeds<T>(promise: Promise<T>): Promise<T>;
}

const enabled = process.env.RUN_FIRESTORE_RULES_TESTS === '1';
const UID = 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
const profile: LineLoginProfile = { userId: UID, displayName: '小明', pictureUrl: 'https://p/1', email: null };

let env: RulesEnvironment;
let testing: RulesTesting;
let sdk: typeof import('firebase/firestore');

describe.skipIf(!enabled)('會員文件寫入 × 未修改的 Firestore Rules', () => {
  beforeAll(async () => {
    const address = process.env.FIRESTORE_EMULATOR_HOST || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address)) {
      throw new Error('FIRESTORE_EMULATOR_HOST must explicitly target localhost');
    }
    const [host, port] = address.split(':');
    const require = createRequire(resolve('package.json'));
    const modulePath = require.resolve('@firebase/rules-unit-testing', {
      paths: [process.cwd(), resolve('../FC')],
    });
    testing = require(modulePath) as RulesTesting;
    sdk = createRequire(modulePath)('firebase/firestore') as typeof sdk;
    env = await testing.initializeTestEnvironment({
      projectId: 'demo-user-doc-sync',
      firestore: { host: host!, port: Number(port), rules: readFileSync(resolve('emulator/firestore.rules'), 'utf8') },
    });
  });
  beforeEach(async () => { await env.clearFirestore(); });
  afterAll(async () => { await env?.cleanup(); });

  const ownDb = (): Firestore => env.authenticatedContext(UID, { role: 'user' }).firestore();

  it('本人建立新會員文件（A 新建欄位）：允許', async () => {
    const db = ownDb();
    await testing.assertSucceeds(sdk.setDoc(sdk.doc(db, 'users', UID), buildNewUserDoc(UID, profile, sdk.serverTimestamp())));
  });

  it('替別人建立：拒絕', async () => {
    const db = env.authenticatedContext('U-other', { role: 'user' }).firestore();
    await testing.assertFails(sdk.setDoc(sdk.doc(db, 'users', UID), buildNewUserDoc(UID, profile, sdk.serverTimestamp())));
  });

  it('legacy 遷移：無 createdAt 且未帶 teamId 的一般舊文件拒絕；帶舊 createdAt 或非 user 角色拒絕（與 payload 守門一致）', async () => {
    const db = ownDb();
    const ts = sdk.serverTimestamp();
    await testing.assertFails(sdk.setDoc(
      sdk.doc(db, 'users', UID),
      buildLegacyMigration({ lineUserId: UID, displayName: '舊', gender: '男' }, UID, profile, ts),
      { merge: true },
    ));
    await env.clearFirestore();
    await testing.assertFails(sdk.setDoc(
      sdk.doc(db, 'users', UID),
      buildLegacyMigration({ lineUserId: UID, role: 'coach', createdAt: sdk.Timestamp.fromMillis(1) }, UID, profile, ts),
      { merge: true },
    ));
  });

  it('已存在：登入更新（名稱／頭像／lastLogin）允許；只補 lastLogin 允許；夾帶 role 拒絕', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await sdk.setDoc(sdk.doc(context.firestore(), 'users', UID), {
        uid: UID, displayName: '舊名', role: 'admin', exp: 50, lastLogin: sdk.Timestamp.fromMillis(1),
      });
    });
    const db = ownDb();
    const ref = sdk.doc(db, 'users', UID);
    const existing = { lastLogin: { toMillis: () => 1 } };
    await testing.assertSucceeds(sdk.updateDoc(ref, buildLoginUpdate(existing, profile, Date.now(), sdk.serverTimestamp())));
    await testing.assertSucceeds(sdk.updateDoc(ref, buildLastLoginUpdate(existing, Date.now(), sdk.serverTimestamp())));
    await testing.assertFails(sdk.updateDoc(ref, { displayName: '小明', role: 'user' }));
    const saved = (await sdk.getDoc(ref)).data()!;
    expect(saved.role).toBe('admin');
    expect(saved.exp).toBe(50);
  });
});
