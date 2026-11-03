// @vitest-environment node
/**
 * 副機專用，主機不執行。沿用 FC 的 @firebase/rules-unit-testing，不新增依賴或修改 Rules。
 * 先在副機啟動 Firestore emulator，再於本 worktree 執行：
 * RUN_FIRESTORE_RULES_TESTS=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   node node_modules/vitest/vitest.mjs run src/features/events/data/external-event-edit.rules.test.ts
 * 未明確啟用時整組 skip；啟用但缺少 emulator／依賴時必須失敗，不偽裝通過。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { buildEventLocationValue, resetLocationDraft } from '../components/event-form/use-event-location';
import { buildExternalEventUpdates, externalEventEditForm } from './external-event-edit';
import type { EventDoc } from './types';

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
const mapFields = ['lat', 'lng', 'mapAddress', 'mapPlaceId', 'mapProvider', 'mapLocationConfirmed', 'mapLocationUpdatedAt'];
const point = {
  lat: 25, lng: 121, mapAddress: '球場地址', mapPlaceId: 'place', mapProvider: 'google',
  mapLocationConfirmed: true, mapLocationUpdatedAt: '2026-01-01T00:00:00.000Z',
};
const base: EventDoc & Record<string, unknown> = {
  id: 'external', type: 'external', status: 'ended', title: '原名稱',
  creatorUid: 'owner', creator: '主辦人', delegateUids: ['delegate'], delegates: [],
  location: '球場', date: '2026/01/05 09:00~11:00', externalUrl: 'https://example.test/activity',
  sportTag: 'football', image: 'https://example.test/cover', gradient: 'linear-gradient(135deg,#6b7280,#4b5563)',
  max: 20, current: 0, waitlist: 0, privateEvent: false, teamOnly: false,
  creatorTeamId: '', creatorTeamIds: [],
};
let env: RulesEnvironment;
let sdk: typeof import('firebase/firestore');
async function seed(event: Record<string, unknown>, addons = false): Promise<void> {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await sdk.setDoc(sdk.doc(db, 'rolePermissions', 'user'), { permissions: [] });
    await sdk.setDoc(sdk.doc(db, 'roleActivityCapabilities', 'user'), {
      catalogVersion: 1, capabilities: ['user.activity.own_edit_basic', ...(addons ? ['user.activity.addons_use'] : [])],
    });
    for (const uid of ['owner', 'delegate']) {
      await sdk.setDoc(sdk.doc(db, 'users', uid), { uid, role: 'user', name: uid, email: uid + '@example.test' });
    }
    await sdk.setDoc(sdk.doc(db, 'events', 'external'), event);
  });
}

describe.skipIf(!enabled)('外部活動基本編輯 × 未修改的 Firestore Rules', () => {
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
    const testing = require(modulePath) as RulesTesting;
    // 與 rules-unit-testing 使用同一套 Firebase，避免跨 FC／FC-B 套件的 instanceof 不相容。
    sdk = createRequire(modulePath)('firebase/firestore') as typeof sdk;
    env = await testing.initializeTestEnvironment({
      projectId: 'demo-t075-external-edit',
      firestore: { host: host!, port: Number(port), rules: readFileSync(resolve('emulator/firestore.rules'), 'utf8') },
    });
  });
  beforeEach(async () => { await env.clearFirestore(); });
  afterAll(async () => { await env?.cleanup(); });

  describe.each(['owner', 'delegate'])('%s 無 addons_use', actor => {
    describe.each([false, true])('旗標=%s', flag => {
      it.each([
        ['缺欄位', {}],
        ['既有座標', point],
        ['既有座標缺 metadata', { lat: 25, lng: 121, mapLocationConfirmed: true }],
        ['Firestore Timestamp', point],
      ])('%s：改名稱允許，地圖欄位保持原樣', async (_name, coordinates) => {
        await seed({ ...base, ...coordinates, ...(_name === 'Firestore Timestamp'
          ? { mapLocationUpdatedAt: sdk.Timestamp.fromMillis(1767225600000) } : {}) });
        const db = env.authenticatedContext(actor, { role: 'user' }).firestore();
        const ref = sdk.doc(db, 'events', 'external');
        const before = (await sdk.getDoc(ref)).data()!;
        const form = { ...externalEventEditForm(before), title: '只改名稱' };
        const location = buildEventLocationValue(resetLocationDraft(before, '球場'), '球場', true, flag, new Date());
        const updates = buildExternalEventUpdates(form, location, before);
        for (const field of mapFields) expect(updates).not.toHaveProperty(field);
        await sdk.updateDoc(ref, { ...updates, updatedAt: sdk.serverTimestamp() });
        const saved = (await sdk.getDoc(ref)).data()!;
        expect(saved.title).toBe('只改名稱');
        for (const field of mapFields) {
          expect(Object.hasOwn(saved, field)).toBe(Object.hasOwn(before, field));
          expect(saved[field]).toEqual(before[field]);
        }
      });
    });
  });

  it.each([
    ['owner', false, false], ['delegate', false, false],
    ['owner', true, true], ['delegate', true, false],
  ] as const)('%s addons=%s 真正修改座標，Rules 允許=%s', async (actor, addons, allowed) => {
    const target = { ...base, ...point };
    await seed(target, addons);
    const db = env.authenticatedContext(actor, { role: 'user' }).firestore();
    const location = buildEventLocationValue(resetLocationDraft(target, '球場'), '球場', true, true, new Date());
    const updates = buildExternalEventUpdates(externalEventEditForm(target), { ...location, lat: 24 }, target);
    expect(updates.lat).toBe(24);
    const write = sdk.updateDoc(sdk.doc(db, 'events', 'external'), { ...updates, updatedAt: sdk.serverTimestamp() });
    if (allowed) await write;
    else await expect(write).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await sdk.getDoc(sdk.doc(db, 'events', 'external'))).data()?.lat).toBe(allowed ? 24 : 25);
  });
});
