// @vitest-environment node
/**
 * DeepSeek 審查 P2：學員端查 eduAttendance（teamId＋coursePlanId＋studentId 等值，條件同 course-repo#attendanceQueryFilters）
 * 能否被 Rules 允許。要對兩份 Rules 各跑一次：
 *   - B 現行 emulator/firestore.rules（eduAttendance read＝isAuth）
 *   - FC PR #27「課程資料讀取權限收斂」（分支 course-read-scope-rules @9e1df5bd5，
 *     檔案 __fixtures__/firestore.pr27-course-read-scope.rules 為 `git show origin/course-read-scope-rules:firestore.rules` 原文）
 * 用 FIRESTORE_RULES_FILE 指定規則檔；檔名含 course-read-scope 時改用收斂後的預期（無關會員被擋）。
 * 副機專用（寫法同 student-create.rules.test.ts）；未設 RUN_FIRESTORE_RULES_TESTS=1 時整組 skip。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { attendanceQueryFilters, toCourseTeam } from './course-repo';

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
const rulesFile = process.env.FIRESTORE_RULES_FILE || 'emulator/firestore.rules';
const scoped = rulesFile.includes('course-read-scope');
let env: RulesEnvironment;
let testing: RulesTesting;
let sdk: typeof import('firebase/firestore');

const team = toCourseTeam({ id: 'tm_demo', _docId: 'tm_demo', name: '晨光' } as never);

describe.skipIf(!enabled)(`K1 出缺席讀取 × ${scoped ? 'PR #27 收斂後' : 'B 現行'} Rules`, () => {
  beforeAll(async () => {
    const address = process.env.FIRESTORE_EMULATOR_HOST || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address)) throw new Error('FIRESTORE_EMULATOR_HOST must explicitly target localhost');
    const [host, port] = address.split(':');
    const require = createRequire(resolve('package.json'));
    const modulePath = require.resolve('@firebase/rules-unit-testing', { paths: [process.cwd(), resolve('../FC'), resolve('../FCA')] });
    testing = require(modulePath) as RulesTesting;
    sdk = createRequire(modulePath)('firebase/firestore') as typeof sdk;
    env = await testing.initializeTestEnvironment({
      projectId: scoped ? 'demo-k1-att-scoped' : 'demo-k1-att-current',
      firestore: { host: host!, port: Number(port), rules: readFileSync(resolve(rulesFile), 'utf8') },
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
      const base = { teamId: 'tm_demo', groupId: '', coursePlanId: 'p1', sessionId: 's1', date: '2026-11-14', status: 'active' };
      // 學員自己請假（Callable 寫入，帶 selfUid／parentUid）與教練點名（舊寫法可能沒有 selfUid／parentUid）。
      await sdk.setDoc(sdk.doc(db, 'eduAttendance', 'a_self'), { ...base, id: 'a_self', studentId: 'stu_self', selfUid: 'self', parentUid: null, kind: 'leave' });
      await sdk.setDoc(sdk.doc(db, 'eduAttendance', 'a_kid'), { ...base, id: 'a_kid', studentId: 'stu_kid', kind: 'signin' });
    });
  }, 60_000);
  afterAll(async () => { await env?.cleanup(); });

  const query = (db: Firestore, studentId: string) =>
    sdk.getDocs(sdk.query(
      sdk.collection(db, 'eduAttendance'),
      ...attendanceQueryFilters(team, 'p1', studentId).map(([field, value]) => sdk.where(field, '==', value)),
    ));

  it('本人用 K1 的查詢讀得到自己學員的出缺席', async () => {
    const snap = (await testing.assertSucceeds(query(env.authenticatedContext('self').firestore(), 'stu_self'))) as { size: number };
    expect(snap.size).toBe(1);
  });

  it('家長讀得到孩子的出缺席（含沒有 selfUid／parentUid 的教練點名紀錄）', async () => {
    const snap = (await testing.assertSucceeds(query(env.authenticatedContext('parent').firestore(), 'stu_kid'))) as { size: number };
    expect(snap.size).toBe(1);
  });

  it(scoped ? '無關會員查別人學員被擋（PR #27 收斂）' : '無關會員查別人學員被擋（正本讀取已收斂）', async () => {
    const q = query(env.authenticatedContext('other').firestore(), 'stu_kid');
    await testing.assertFails(q);
  });

  it('未登入被擋', async () => {
    await testing.assertFails(query(env.unauthenticatedContext().firestore(), 'stu_self'));
  });
});
