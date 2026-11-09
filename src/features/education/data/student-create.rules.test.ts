// @vitest-environment node
/**
 * 副機專用，主機不執行（寫法同 events/data/external-event-edit.rules.test.ts）。沿用 FC 的 @firebase/rules-unit-testing，不改 Rules。
 * RUN_FIRESTORE_RULES_TESTS=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   node node_modules/vitest/vitest.mjs run src/features/education/data/student-create.rules.test.ts
 * 未明確啟用時整組 skip；啟用但缺 emulator／依賴時必須失敗，不偽裝通過。
 *
 * 驗證 K1 唯一的直寫：家長代報「新增孩子」與報名前自動建本人學員（teams/{t}/students，pending）。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { buildPendingStudentPayload } from './course-repo';

vi.mock('@/data/firebase', () => ({ getFirebase: () => { throw new Error('Only emulator contexts are allowed'); } }));
interface RulesContext { firestore(): Firestore }
interface RulesEnvironment {
  authenticatedContext(uid: string, claims?: Record<string, unknown>): RulesContext;
  unauthenticatedContext(): RulesContext;
  withSecurityRulesDisabled(run: (context: RulesContext) => Promise<void>): Promise<void>;
  clearFirestore(): Promise<void>;
  cleanup(): Promise<void>;
}
interface RulesTesting {
  initializeTestEnvironment(config: { projectId: string; firestore: { host: string; port: number; rules: string } }): Promise<RulesEnvironment>;
  assertSucceeds<T>(p: Promise<T>): Promise<T>;
  assertFails<T>(p: Promise<T>): Promise<unknown>;
}
const enabled = process.env.RUN_FIRESTORE_RULES_TESTS === '1';
let env: RulesEnvironment;
let testing: RulesTesting;
let sdk: typeof import('firebase/firestore');

describe.skipIf(!enabled)('K1 新增 pending 學員 × 未修改的 Firestore Rules', () => {
  beforeAll(async () => {
    const address = process.env.FIRESTORE_EMULATOR_HOST || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address)) throw new Error('FIRESTORE_EMULATOR_HOST must explicitly target localhost');
    const [host, port] = address.split(':');
    const require = createRequire(resolve('package.json'));
    const modulePath = require.resolve('@firebase/rules-unit-testing', { paths: [process.cwd(), resolve('../FC'), resolve('../FCA')] });
    testing = require(modulePath) as RulesTesting;
    sdk = createRequire(modulePath)('firebase/firestore') as typeof sdk;
    env = await testing.initializeTestEnvironment({
      projectId: 'demo-k1-student-create',
      firestore: { host: host!, port: Number(port), rules: readFileSync(resolve('emulator/firestore.rules'), 'utf8') },
    });
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await sdk.setDoc(sdk.doc(ctx.firestore(), 'teams', 'tm_demo'), { id: 'tm_demo', name: '晨光', teachingEnabled: true, captainUid: 'cap' });
      await sdk.setDoc(sdk.doc(ctx.firestore(), 'users', 'parent'), { uid: 'parent', role: 'user' });
    });
  });
  afterAll(async () => { await env?.cleanup(); });

  const write = (db: Firestore, id: string, data: Record<string, unknown>) =>
    sdk.setDoc(sdk.doc(db, 'teams/tm_demo/students', id), { ...data, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() });

  it('登入者可建 pending 孩子（parent）與本人（self）', async () => {
    const db = env.authenticatedContext('parent').firestore();
    await testing.assertSucceeds(write(db, 'stu_c', buildPendingStudentPayload({ id: 'stu_c', name: '陳小樂', uid: 'parent', relation: 'parent' })));
    await testing.assertSucceeds(write(db, 'stu_s', buildPendingStudentPayload({ id: 'stu_s', name: '王示範', uid: 'parent', relation: 'self' })));
  });

  it('非 pending、空姓名、未登入都被擋', async () => {
    const db = env.authenticatedContext('parent').firestore();
    const base = buildPendingStudentPayload({ id: 'x', name: '陳小樂', uid: 'parent', relation: 'parent' });
    await testing.assertFails(write(db, 'x1', { ...base, enrollStatus: 'active' }));
    await testing.assertFails(write(db, 'x2', { ...base, name: '' }));
    await testing.assertFails(write(env.unauthenticatedContext().firestore(), 'x3', base));
  });

  it('只帶 selfUid／parentUid 條件的查詢讀得到自己名下學員', async () => {
    const db = env.authenticatedContext('parent').firestore();
    await write(db, 'stu_c', buildPendingStudentPayload({ id: 'stu_c', name: '陳小樂', uid: 'parent', relation: 'parent' }));
    const snap = await testing.assertSucceeds(
      sdk.getDocs(sdk.query(sdk.collection(db, 'teams/tm_demo/students'), sdk.where('parentUid', '==', 'parent'))),
    );
    expect((snap as { size: number }).size).toBe(1);
  });
});
