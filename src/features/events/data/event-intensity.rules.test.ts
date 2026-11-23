// @vitest-environment node
/**
 * 副機專用，主機不執行。沿用 FC 的 @firebase/rules-unit-testing，不新增依賴或修改 Rules。
 * 先在副機啟動 Firestore emulator，再於本 worktree 執行：
 * RUN_FIRESTORE_RULES_TESTS=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   node node_modules/vitest/vitest.mjs run src/features/events/data/event-intensity.rules.test.ts
 * 未明確啟用時整組 skip；啟用但缺少 emulator／依賴時必須失敗，不偽裝通過。
 *
 * 建立權限：authRole() == 'user' 時 canCreateEventRoot() 走 isUserActivityCapEventCreate()，
 * 非外部活動且未帶團隊範圍需要 roleActivityCapabilities/user 含 user.activity.basic_create
 * （eventCreateAddonsAllowed 在沒有 addons_use 時改要求完全沒有加值欄位，建立 payload 預設即如此）。
 * 擁有者改標題／人數走 isUserOwnerBasicUpdate()，需要 user.activity.own_edit_basic，
 * 且 updates 不得含 intensityLevel（buildEditEventUpdates 本來就不寫）。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  buildCreateEventPayload,
  buildEditEventUpdates,
  type CreateEventContext,
  type CreateEventForm,
  type EventForEdit,
} from './event-create';
import type { IntensityLevel } from './activity-categories';

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
const OWNER = 'owner';

let env: RulesEnvironment;
let sdk: typeof import('firebase/firestore');

function form(intensityLevel: IntensityLevel | ''): CreateEventForm {
  return {
    title: '週末練球',
    type: 'friendly',
    location: '台北市大安運動中心',
    dateVal: '2026-05-15',
    startTime: '15:00',
    endTime: '17:00',
    max: 20,
    minAge: 0,
    notes: '',
    sportTag: 'basketball',
    regOpenTime: null,
    image: 'https://example.com/cover.jpg',
    creatorName: '主辦人',
    delegates: [],
    regionEnabled: false,
    region: '',
    cities: [],
    feeEnabled: false,
    fee: 0,
    teamOnly: false,
    creatorTeamId: null,
    creatorTeamName: null,
    creatorTeamIds: [],
    creatorTeamNames: [],
    genderRestrictionEnabled: false,
    allowedGender: '',
    privateEvent: false,
    socialLinksEnabled: false,
    socialLinks: [],
    earlyBirdEnabled: false,
    earlyBirdCost: 0,
    earlyBirdPolicyVersion: null,
    teamReservationReleaseHours: 12,
    lateCancelHours: 2,
    intensityLevel,
  };
}

function ctx(): CreateEventContext {
  return {
    uid: OWNER,
    role: 'user',
    capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    rolePermissions: null,
    userGrants: null,
    customRoles: [],
    now: new Date('2026-05-01T00:00:00.000Z'),
    generateId: () => 'ce_intensity_unused',
  };
}

async function seedCaps(): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await sdk.setDoc(sdk.doc(db, 'users', OWNER), {
      uid: OWNER, role: 'user', name: OWNER, email: `${OWNER}@example.test`,
    });
    await sdk.setDoc(sdk.doc(db, 'rolePermissions', 'user'), { permissions: [] });
    await sdk.setDoc(sdk.doc(db, 'roleActivityCapabilities', 'user'), {
      catalogVersion: 1,
      capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    });
  });
}

describe.skipIf(!enabled)('活動分類 intensityLevel × 未修改的 Firestore Rules', () => {
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
    sdk = createRequire(modulePath)('firebase/firestore') as typeof sdk;
    env = await testing.initializeTestEnvironment({
      projectId: 'demo-intensity-level',
      firestore: { host: host!, port: Number(port), rules: readFileSync(resolve('emulator/firestore.rules'), 'utf8') },
    });
  });
  beforeEach(async () => { await env.clearFirestore(); });
  afterAll(async () => { await env?.cleanup(); });

  async function createWith(level: IntensityLevel, eventId: string): Promise<void> {
    await seedCaps();
    const db = env.authenticatedContext(OWNER, { role: 'user' }).firestore();
    const payload = buildCreateEventPayload(form(level), ctx(), eventId);
    expect(payload.intensityLevel).toBe(level);
    await sdk.setDoc(sdk.doc(db, 'events', eventId), payload);
    const saved = (await sdk.getDoc(sdk.doc(db, 'events', eventId))).data();
    expect(saved?.title).toBe('週末練球');
    expect(saved?.intensityLevel).toBe(level);
    expect(saved?.creatorUid).toBe(OWNER);
  }

  it('有建立權限的使用者可建立 beginner 活動', async () => {
    await createWith('beginner', 'ce_intensity_beginner');
  });

  it('有建立權限的使用者可建立 high-intensity 活動', async () => {
    await createWith('high-intensity', 'ce_intensity_high');
  });

  it('擁有者改標題與人數上限成功，intensityLevel 仍是原值', async () => {
    await seedCaps();
    const eventId = 'ce_intensity_existing';
    const stored: EventForEdit = {
      id: eventId,
      creatorUid: OWNER,
      privateEvent: false,
      delegateUids: [],
      status: 'open',
      current: 0,
      waitlist: 0,
      max: 20,
    };
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await sdk.setDoc(sdk.doc(db, 'events', eventId), {
        id: eventId,
        title: '原標題',
        creatorUid: OWNER,
        status: 'open',
        current: 0,
        waitlist: 0,
        max: 20,
        type: 'friendly',
        privateEvent: false,
        intensityLevel: 'high-intensity',
      });
    });

    const result = buildEditEventUpdates(
      stored,
      { ...form('beginner'), title: '只改標題', max: 24 },
      ctx(),
    );
    expect(result.updates.title).toBe('只改標題');
    expect(result.updates.max).toBe(24);
    expect(Object.hasOwn(result.updates, 'intensityLevel')).toBe(false);

    const db = env.authenticatedContext(OWNER, { role: 'user' }).firestore();
    await sdk.updateDoc(sdk.doc(db, 'events', eventId), {
      ...result.updates,
      updatedAt: sdk.serverTimestamp(),
    });
    const saved = (await sdk.getDoc(sdk.doc(db, 'events', eventId))).data();
    expect(saved?.title).toBe('只改標題');
    expect(saved?.max).toBe(24);
    expect(saved?.intensityLevel).toBe('high-intensity');
  });
});
