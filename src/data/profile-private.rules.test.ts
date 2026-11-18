// @vitest-environment node
/**
 * 本人編輯私密子文件寫入 × 未修改的 Firestore Rules（emulator）。
 * 寫入形狀對應本模組 `addPrivateWrite`：setDoc(users/{uid}/profilePrivate/profile, payload, {merge:true})，
 * payload 為各私密欄位 + updatedAt（不含 createdAt / backfilledAt）。
 *
 * RUN_FIRESTORE_RULES_TESTS=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   node node_modules/vitest/vitest.mjs run src/data/profile-private.rules.test.ts
 *
 * 未明確啟用時整組 skip；啟用但缺少 emulator／依賴時必須失敗，不偽裝通過。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase/firestore';

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
const OTHER_UID = 'Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2';

let env: RulesEnvironment;
let testing: RulesTesting;
let sdk: typeof import('firebase/firestore');

describe.skipIf(!enabled)('本人私密子文件寫入 × 未修改的 Firestore Rules', () => {
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
      projectId: 'demo-profile-private',
      firestore: {
        host: host!,
        port: Number(port),
        rules: readFileSync(resolve('emulator/firestore.rules'), 'utf8'),
      },
    });
  });
  beforeEach(async () => { await env.clearFirestore(); });
  afterAll(async () => { await env?.cleanup(); });

  const ownDb = (): Firestore => env.authenticatedContext(UID, { role: 'user' }).firestore();

  // 對應 addPrivateWrite 產生的寫入形狀。
  const privateRef = (db: Firestore) =>
    sdk.doc(db, 'users', UID, 'profilePrivate', 'profile');

  it('本人在私密文件不存在時寫入：允許', async () => {
    const db = ownDb();
    await testing.assertSucceeds(sdk.setDoc(
      privateRef(db),
      { phone: '0912345678', updatedAt: sdk.serverTimestamp() },
      { merge: true },
    ));
  });

  it('本人對既有私密文件（含 backfilledAt）寫入：允許', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await sdk.setDoc(
        sdk.doc(context.firestore(), 'users', UID, 'profilePrivate', 'profile'),
        { phone: 'old', backfilledAt: sdk.Timestamp.fromMillis(1) },
      );
    });
    const db = ownDb();
    await testing.assertSucceeds(sdk.setDoc(
      privateRef(db),
      { phone: 'new', updatedAt: sdk.serverTimestamp() },
      { merge: true },
    ));
  });

  it('私密欄位寫 null 成功（清空語意）', async () => {
    const db = ownDb();
    await testing.assertSucceeds(sdk.setDoc(
      privateRef(db),
      { companions: null, updatedAt: sdk.serverTimestamp() },
      { merge: true },
    ));
  });

  it('他人寫本人私密文件失敗', async () => {
    const db = env.authenticatedContext(OTHER_UID, { role: 'user' }).firestore();
    await testing.assertFails(sdk.setDoc(
      sdk.doc(db, 'users', UID, 'profilePrivate', 'profile'),
      { phone: 'x', updatedAt: sdk.serverTimestamp() },
      { merge: true },
    ));
  });

  it('一般使用者讀他人私密文件失敗', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await sdk.setDoc(
        sdk.doc(context.firestore(), 'users', UID, 'profilePrivate', 'profile'),
        { phone: '0912345678' },
      );
    });
    const db = env.authenticatedContext(OTHER_UID, { role: 'user' }).firestore();
    await testing.assertFails(sdk.getDoc(
      sdk.doc(db, 'users', UID, 'profilePrivate', 'profile'),
    ));
  });
});
