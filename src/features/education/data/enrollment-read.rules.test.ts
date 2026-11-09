// @vitest-environment node
/**
 * 審查 P2-2：學員端直查 teams/{t}/coursePlans/{p}/enrollments where studentId == 某學員，
 * 能否被 Rules isCourseEnrollmentOwnedByAuth（第三分支：以 resource.data.studentId 組 get(students/…)）在查詢層證明。
 * 副機專用（寫法同 student-create.rules.test.ts）；B 工作區沒有 @firebase/rules-unit-testing，從 ../FC 或 ../FCA 取。
 * RUN_FIRESTORE_RULES_TESTS=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   node node_modules/vitest/vitest.mjs run src/features/education/data/enrollment-read.rules.test.ts
 * 未明確啟用時整組 skip；啟用但缺 emulator／依賴時必須失敗。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

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

const ENR = 'teams/tm_demo/coursePlans/p1/enrollments';

describe.skipIf(!enabled)('K1 我的報名直查 × 未修改的 Firestore Rules', () => {
  beforeAll(async () => {
    const address = process.env.FIRESTORE_EMULATOR_HOST || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address)) throw new Error('FIRESTORE_EMULATOR_HOST must explicitly target localhost');
    const [host, port] = address.split(':');
    const require = createRequire(resolve('package.json'));
    const modulePath = require.resolve('@firebase/rules-unit-testing', { paths: [process.cwd(), resolve('../FC'), resolve('../FCA')] });
    testing = require(modulePath) as RulesTesting;
    sdk = createRequire(modulePath)('firebase/firestore') as typeof sdk;
    env = await testing.initializeTestEnvironment({
      projectId: 'demo-k1-enrollment-read',
      firestore: { host: host!, port: Number(port), rules: readFileSync(resolve('emulator/firestore.rules'), 'utf8') },
    });
  }, 120_000);
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await sdk.setDoc(sdk.doc(db, 'teams', 'tm_demo'), { id: 'tm_demo', name: '晨光', teachingEnabled: true, captainUid: 'cap' });
      await sdk.setDoc(sdk.doc(db, 'teams/tm_demo/coursePlans', 'p1'), { name: '週六班', planType: 'weekly', active: true });
      for (const uid of ['self', 'parent', 'other']) await sdk.setDoc(sdk.doc(db, 'users', uid), { uid, role: 'user' });
      await sdk.setDoc(sdk.doc(db, 'teams/tm_demo/students', 'stu_self'), { id: 'stu_self', name: '王示範', selfUid: 'self', parentUid: null, enrollStatus: 'active' });
      await sdk.setDoc(sdk.doc(db, 'teams/tm_demo/students', 'stu_kid'), { id: 'stu_kid', name: '陳小安', selfUid: null, parentUid: 'parent', enrollStatus: 'active' });
      // Callable 建立的報名會複製 selfUid／parentUid；另放一筆缺這兩欄的舊資料，只能靠學員文件判斷。
      await sdk.setDoc(sdk.doc(db, ENR, 'e_self'), { id: 'e_self', studentId: 'stu_self', selfUid: 'self', parentUid: null, status: 'approved', paidAt: null });
      await sdk.setDoc(sdk.doc(db, ENR, 'e_kid'), { id: 'e_kid', studentId: 'stu_kid', status: 'pending' });
      await sdk.setDoc(sdk.doc(db, ENR, 'e_ghost'), { id: 'e_ghost', studentId: 'stu_ghost', selfUid: 'self', status: 'approved' });
    });
  }, 60_000);
  afterAll(async () => { await env?.cleanup(); });

  const query = (uid: string, studentId: string) => {
    const db = env.authenticatedContext(uid).firestore();
    return sdk.getDocs(sdk.query(sdk.collection(db, ENR), sdk.where('studentId', '==', studentId)));
  };

  it('本人可查自己學員的報名（studentId 等值查詢）', async () => {
    const snap = (await testing.assertSucceeds(query('self', 'stu_self'))) as { size: number };
    expect(snap.size).toBe(1);
  });

  it('家長可查孩子的報名（含缺 selfUid／parentUid 的舊報名）', async () => {
    const snap = (await testing.assertSucceeds(query('parent', 'stu_kid'))) as { size: number };
    expect(snap.size).toBe(1);
  });

  it('無關會員、未登入查別人學員的報名被擋', async () => {
    await testing.assertFails(query('other', 'stu_kid'));
    const anon = env.unauthenticatedContext().firestore();
    await testing.assertFails(sdk.getDocs(sdk.query(sdk.collection(anon, ENR), sdk.where('studentId', '==', 'stu_self'))));
  });

  it('學員文件不存在時被擋（即使報名上的 selfUid 是自己）', async () => {
    await testing.assertFails(query('self', 'stu_ghost'));
  });
});
