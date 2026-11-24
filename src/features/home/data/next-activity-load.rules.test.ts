// @vitest-environment node
/**
 * 首頁下一場讀取段（批次 A 新查法）× 未修改的 Firestore Rules（emulator）。
 * 用真的 loadNextActivityInputs，只把 Firebase 換成 emulator 的登入情境；不連正式資料庫。
 * 執行：npm run test:rules（或先起 Firestore emulator，再
 *   RUN_FIRESTORE_RULES_TESTS=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node node_modules/vitest/vitest.mjs run src/features/home/data/next-activity-load.rules.test.ts）。
 * 未明確啟用時整組 skip；啟用但缺少 emulator／依賴時必須失敗，不偽裝通過。模擬器不檢查索引。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { EventDoc } from '@/features/events/data/types';

const enabled = process.env.RUN_FIRESTORE_RULES_TESTS === '1';

function rulesTestingPath(): string {
  const require = createRequire(resolve('package.json'));
  const paths = [process.cwd(), resolve('../FC'), process.env.FC_REPO_DIR ?? ''].filter(Boolean);
  return require.resolve('@firebase/rules-unit-testing', { paths });
}

// 讀取層要和 rules-unit-testing 用同一套 firebase/firestore（避免跨套件的 instanceof 不相容）。
vi.mock('firebase/firestore', async (importOriginal) => {
  if (process.env.RUN_FIRESTORE_RULES_TESTS !== '1') return importOriginal();
  return createRequire(rulesTestingPath())('firebase/firestore');
});
vi.mock('@/core/error-report', () => ({ reportClientError: vi.fn() }));

import { loadNextActivityInputs } from './next-activity-load';

interface RulesContext { firestore(): Firestore }
interface RulesEnvironment {
  authenticatedContext(uid: string): RulesContext;
  unauthenticatedContext(): RulesContext;
  withSecurityRulesDisabled(run: (context: RulesContext) => Promise<void>): Promise<void>;
  clearFirestore(): Promise<void>;
  cleanup(): Promise<void>;
}
interface RulesTesting {
  initializeTestEnvironment(config: {
    projectId: string; firestore: { host: string; port: number; rules: string };
  }): Promise<RulesEnvironment>;
  assertFails(promise: Promise<unknown>): Promise<unknown>;
}

let env: RulesEnvironment;
let testing: RulesTesting;
let sdk: typeof import('firebase/firestore');

const E1 = { id: 'e1', title: '活動', date: '2099/01/02 09:00~11:00', status: 'open' };
const REG = { userId: 'u1', eventId: 'e1', status: 'confirmed', participantType: 'self' };

async function seed(): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await sdk.setDoc(sdk.doc(db, 'events', 'e1'), E1);
    await sdk.setDoc(sdk.doc(db, 'events/e1/registrations/r1'), REG);
    // 舊格式根層報名（R-REG-014）：查得到也要被 filterSubcollectionDocs 擋掉。
    await sdk.setDoc(sdk.doc(db, 'registrations/r0'), REG);
  });
}

describe.skipIf(!enabled)('首頁下一場新查法 × 未修改的 Firestore Rules', () => {
  beforeAll(async () => {
    const address = process.env.FIRESTORE_EMULATOR_HOST || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address)) {
      throw new Error('FIRESTORE_EMULATOR_HOST must explicitly target localhost');
    }
    const [host, port] = address.split(':');
    const modulePath = rulesTestingPath();
    testing = createRequire(modulePath)(modulePath) as RulesTesting;
    sdk = createRequire(modulePath)('firebase/firestore') as typeof sdk;
    env = await testing.initializeTestEnvironment({
      projectId: 'demo-next-activity',
      firestore: { host: host!, port: Number(port), rules: readFileSync(resolve('emulator/firestore.rules'), 'utf8') },
    });
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await seed();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it('本人登入：userId＋eventId in 查詢被放行，只回子集合報名、沒有走退路', async () => {
    const db = env.authenticatedContext('u1').firestore();
    const warn = vi.fn();
    const active = [{ ...E1, _docId: 'e1', docId: 'e1' } as EventDoc];
    const inputs = await loadNextActivityInputs(
      { getFirebase: async () => ({ db }), logger: { warn }, activeEvents: active },
      'u1',
    );
    expect(inputs.registrations.map((r) => (r as { _docId?: string })._docId)).toEqual(['r1']);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('fallback'))).toBe(false);
  });

  it('未登入不能讀報名', async () => {
    const db = env.unauthenticatedContext().firestore();
    await testing.assertFails(sdk.getDocs(sdk.query(
      sdk.collectionGroup(db, 'registrations'),
      sdk.where('userId', '==', 'u1'),
      sdk.where('eventId', 'in', ['e1']),
    )));
  });
});
