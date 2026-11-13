// @vitest-environment node
/**
 * 健檢 B2-04：活動卡留言數改 count() 聚合後，用未修改的 Firestore Rules（emulator/firestore.rules）驗證：
 * 一般人的 or(公開, 自己寫的) 聚合查詢被允許、數字正確（扣掉已刪除）；主辦可數全部；
 * 一般人不帶條件數全部仍被擋（Rules 沒有被繞過）。不新增依賴、不改 Rules。
 * 副機執行：npm run test:rules（未設 RUN_FIRESTORE_RULES_TESTS 時整組 skip）。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { countVisibleComments } from './comment-badge';

vi.mock('@/data/firebase', () => ({ getFirebase: () => { throw new Error('Only emulator contexts are allowed'); } }));
interface RulesContext { firestore(): Firestore }
interface RulesEnvironment {
  authenticatedContext(uid: string, claims: Record<string, unknown>): RulesContext;
  withSecurityRulesDisabled(run: (context: RulesContext) => Promise<void>): Promise<void>;
  clearFirestore(): Promise<void>;
  cleanup(): Promise<void>;
}
interface RulesTesting {
  initializeTestEnvironment(config: {
    projectId: string; firestore: { host: string; port: number; rules: string };
  }): Promise<RulesEnvironment>;
}
const enabled = process.env.RUN_FIRESTORE_RULES_TESTS === '1';
let env: RulesEnvironment;
let sdk: typeof import('firebase/firestore');

// 公開 3（1 已刪、1 沒有 deleted 欄位）、u1 私密 2（1 已刪）、他人私密 1
const COMMENTS: Record<string, Record<string, unknown>> = {
  c1: { authorUid: 'a', visibility: 'public', deleted: false },
  c2: { authorUid: 'a', visibility: 'public', deleted: true },
  c3: { authorUid: 'u1', visibility: 'public' },
  c4: { authorUid: 'u1', visibility: 'private', deleted: false },
  c5: { authorUid: 'u1', visibility: 'private', deleted: true },
  c6: { authorUid: 'b', visibility: 'private', deleted: false },
};

async function seed(): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const uid of ['owner', 'u1', 'a', 'b']) {
      await sdk.setDoc(sdk.doc(db, 'users', uid), { uid, role: 'user', name: uid });
    }
    await sdk.setDoc(sdk.doc(db, 'events', 'ev1'), {
      id: 'ev1', title: '活動', status: 'open', creatorUid: 'owner', delegateUids: [], type: 'friendly',
    });
    for (const [id, data] of Object.entries(COMMENTS)) {
      await sdk.setDoc(sdk.doc(db, 'events', 'ev1', 'comments', id), {
        eventId: 'ev1', body: id, replyCount: 0, ...data,
      });
    }
  });
}

describe.skipIf(!enabled)('留言數聚合查詢 × 未修改的 Firestore Rules（B2-04）', () => {
  beforeAll(async () => {
    const address = process.env.FIRESTORE_EMULATOR_HOST || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address)) {
      throw new Error('FIRESTORE_EMULATOR_HOST must explicitly target localhost');
    }
    const [host, port] = address.split(':');
    const require = createRequire(resolve('package.json'));
    const modulePath = require.resolve('@firebase/rules-unit-testing', { paths: [process.cwd()] });
    const testing = require(modulePath) as RulesTesting;
    sdk = createRequire(modulePath)('firebase/firestore') as typeof sdk;
    env = await testing.initializeTestEnvironment({
      projectId: 'demo-b204-comment-count',
      firestore: { host: host!, port: Number(port), rules: readFileSync(resolve('emulator/firestore.rules'), 'utf8') },
    });
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await seed();
  });
  afterAll(async () => { await env?.cleanup(); });

  const comments = (uid: string) => sdk.collection(env.authenticatedContext(uid, { role: 'user' }).firestore(), 'events', 'ev1', 'comments');

  it('一般人：公開＋自己寫的、扣掉已刪除＝3（c1、c3、c4），Rules 允許', async () => {
    await expect(countVisibleComments(sdk, comments('u1'), 'u1', false)).resolves.toBe(3);
  });

  it('只寫過公開留言的人＝公開未刪除 2（自己的 c1 不重複算）；冒用他人 uid 查詢被擋', async () => {
    await expect(countVisibleComments(sdk, comments('a'), 'a', false)).resolves.toBe(2);
    await expect(countVisibleComments(sdk, comments('b'), 'a', false)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('主辦：全部扣掉已刪除＝4', async () => {
    await expect(countVisibleComments(sdk, comments('owner'), 'owner', true)).resolves.toBe(4);
  });

  it('一般人不帶條件數全部仍被 Rules 擋（不會看到他人私密留言的數量）', async () => {
    await expect(countVisibleComments(sdk, comments('u1'), 'u1', true)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
