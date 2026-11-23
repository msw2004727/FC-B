// @vitest-environment node
/**
 * 區間統計讀取層 × 未修改的 Firestore Rules（emulator）。顧問 §3.601 條件 3：非管理員四個查詢要實測。
 * 用真的 loadRangeEvents／loadRangeRosters，只把 Firebase 換成 emulator 的登入情境；不連正式資料庫。
 * 執行：先起 Firestore emulator，再
 *   RUN_FIRESTORE_RULES_TESTS=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node node_modules/vitest/vitest.mjs run src/features/events/data/range-stats.rules.test.ts
 * （或 npm run test:rules）。@firebase/rules-unit-testing 取自 FC repo（同層 ../FC 或環境變數 FC_REPO_DIR）。
 * 未明確啟用時整組 skip；啟用但缺少 emulator／依賴時必須失敗，不偽裝通過。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { ViewerView } from '@/features/profile/data/viewer';

const enabled = process.env.RUN_FIRESTORE_RULES_TESTS === '1';

function rulesTestingPath(): string {
  const require = createRequire(resolve('package.json'));
  const paths = [process.cwd(), resolve('../FC'), process.env.FC_REPO_DIR ?? ''].filter(Boolean);
  return require.resolve('@firebase/rules-unit-testing', { paths });
}

// 讀取層要和 rules-unit-testing 用同一套 firebase/firestore（避免跨 FC／FC-B 套件的 instanceof 不相容）。
vi.mock('firebase/firestore', async (importOriginal) => {
  if (process.env.RUN_FIRESTORE_RULES_TESTS !== '1') return importOriginal();
  return createRequire(rulesTestingPath())('firebase/firestore');
});
const current = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/data/firebase', () => ({
  getFirebase: async () => {
    if (!current.db) throw new Error('Only emulator contexts are allowed');
    return { db: current.db };
  },
}));

import { loadRangeEvents, loadRangeRosters } from './range-stats';
import { computeRangeStats, periodRange } from './range-stats-model';

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
}

const NOW = Date.UTC(2026, 10, 23, 4);
const NOV = periodRange('month', NOW);
let env: RulesEnvironment;
let sdk: typeof import('firebase/firestore');

function viewerOf(uid: string): ViewerView {
  return {
    uid, teamIds: new Set<string>(), staffTeams: [], hasPermission: () => false, roleLevel: 0, role: 'user',
    displayName: null, pictureUrl: null, capabilities: [], isRestricted: false, permissionSources: {},
  } as unknown as ViewerView;
}

const baseEvent = {
  type: 'play', status: 'ended', title: '活動', location: '球場', max: 20, current: 0, waitlist: 0,
  privateEvent: false, teamOnly: false, creatorTeamId: '', creatorTeamIds: [], delegates: [],
};

async function seed(): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const events: Record<string, Record<string, unknown>> = {
      'e-creator': { id: 'e-creator', creatorUid: 'coach', date: '2026/11/05 19:00~21:00' },
      'e-owner': { id: 'e-owner', creatorUid: 'someone', ownerUid: 'coach', date: '2026/11/06 19:00~21:00' },
      'e-captain': { id: 'e-captain', creatorUid: 'someone', captainUid: 'coach', date: '2026/11/07 19:00~21:00' },
      'e-delegate': { id: 'e-delegate', creatorUid: 'someone', delegateUids: ['coach'], date: '2026/11/08 19:00~21:00' },
      'e-other': { id: 'e-other', creatorUid: 'someone', date: '2026/11/09 19:00~21:00' },
      'e-old': { id: 'e-old', creatorUid: 'coach', date: '2026/10/30 19:00~21:00' },
      // 舊活動 public id ≠ 文件 ID（R-ID-008）
      'rand-legacy': { id: 'legacy-public', creatorUid: 'coach', date: '2026/11/10 19:00~21:00' },
    };
    for (const [docId, data] of Object.entries(events)) {
      await sdk.setDoc(sdk.doc(db, 'events', docId), { ...baseEvent, ...data });
    }
    await sdk.setDoc(sdk.doc(db, 'events/rand-legacy/registrations/r1'), { eventId: 'legacy-public', userId: 'p1', status: 'confirmed', participantType: 'self' });
    await sdk.setDoc(sdk.doc(db, 'events/rand-legacy/registrations/r2'), { eventId: 'legacy-public', userId: 'p2', status: 'waitlisted', participantType: 'self' });
    await sdk.setDoc(sdk.doc(db, 'events/rand-legacy/attendanceRecords/a1'), { eventId: 'legacy-public', uid: 'p1', type: 'checkin', status: 'active' });
    await sdk.setDoc(sdk.doc(db, 'events/rand-legacy/attendanceRecords/a2'), { eventId: 'legacy-public', uid: 'p1', type: 'checkout', status: 'active' });
  });
}

describe.skipIf(!enabled)('區間統計讀取 × 未修改的 Firestore Rules', () => {
  beforeAll(async () => {
    const address = process.env.FIRESTORE_EMULATOR_HOST || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address)) {
      throw new Error('FIRESTORE_EMULATOR_HOST must explicitly target localhost');
    }
    const [host, port] = address.split(':');
    const modulePath = rulesTestingPath();
    const testing = createRequire(modulePath)(modulePath) as RulesTesting;
    sdk = createRequire(modulePath)('firebase/firestore') as typeof sdk;
    env = await testing.initializeTestEnvironment({
      projectId: 'demo-range-stats',
      firestore: { host: host!, port: Number(port), rules: readFileSync(resolve('emulator/firestore.rules'), 'utf8') },
    });
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await seed();
  });
  afterAll(async () => {
    current.db = null;
    await env?.cleanup();
  });

  it('一般用戶（非管理員）：四個單欄位查詢都被 Rules 放行，合併後只留區間內自己的活動', async () => {
    current.db = env.authenticatedContext('coach').firestore();
    const list = await loadRangeEvents(NOV, viewerOf('coach'), false);
    expect(list.map((e) => e._docId).sort()).toEqual(['e-captain', 'e-creator', 'e-delegate', 'e-owner', 'rand-legacy']);
  });

  it('管理員路徑的 date 範圍查詢也被 Rules 放行（events 公開可讀）', async () => {
    current.db = env.authenticatedContext('coach').firestore();
    const admin = { ...viewerOf('admin'), hasPermission: (c: string) => c === 'event.edit_all' } as ViewerView;
    const list = await loadRangeEvents(NOV, admin, true);
    expect(list.map((e) => e._docId).sort())
      .toEqual(['e-captain', 'e-creator', 'e-delegate', 'e-other', 'e-owner', 'rand-legacy']);
  });

  it('名單子集合用文件 ID 讀（id ≠ _docId 的舊活動），登入者可讀，口徑正確', async () => {
    current.db = env.authenticatedContext('coach').firestore();
    const events = await loadRangeEvents(NOV, viewerOf('coach'), false);
    const { rosters, failed } = await loadRangeRosters(events);
    expect(failed).toEqual([]);
    const stats = computeRangeStats(rosters, NOW);
    expect(stats.metrics.confirmed).toEqual({ times: 1, people: 1 });
    expect(stats.metrics.waitlisted).toEqual({ times: 1, people: 1 });
    expect(stats.metrics.checkedPair).toEqual({ times: 1, people: 1 });
  });
});
