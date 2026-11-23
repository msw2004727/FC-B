// @vitest-environment node
/**
 * 健康檢查 2026-11-23 P2-13 重現（顧問 §3.611：先用模擬器重現再修）。
 * 情境：一般用戶是活動主辦，個別授權有 activity.manage.entry，前台能力關掉 own_edit_basic／own_cancel／delegate_assign。
 * 修正前新站前端（operate-permissions.ts）認為他可以編輯、取消、設委託人；Rules 的 scoped 路徑寫明 authRole() != 'user'，會拒絕。
 * 下半部的前端組合在一般 unit 也會跑。模擬器部分 2026-11-23 經 PM 同意在主機跑（SE 凍結期間主機給 FC 用）；工作樹不在 FC-B 旁時加 FC_REPO=<FC 主目錄>：
 * RUN_FIRESTORE_RULES_TESTS=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   node node_modules/vitest/vitest.mjs run src/features/events/data/user-entry-grant.rules.test.ts
 * 未明確啟用時整組 skip；啟用但缺少 emulator／依賴時必須失敗，不偽裝通過。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  canCancelOwnActivity, canEditOwnActivityBasic, canManageEventDelegates, type OperateContext,
} from './operate-permissions';

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
  assertFails(promise: Promise<unknown>): Promise<unknown>;
  assertSucceeds(promise: Promise<unknown>): Promise<unknown>;
}
const enabled = process.env.RUN_FIRESTORE_RULES_TESTS === '1';
const OWNER = 'owner_u';
const event = {
  id: 'ev1', type: 'play', status: 'open', title: '原名稱', creatorUid: OWNER, creator: '主辦',
  delegateUids: [], delegates: [], location: '球場', date: '2026/12/05 09:00~11:00',
  sportTag: 'football', max: 20, current: 0, waitlist: 0, privateEvent: false, teamOnly: false,
  creatorTeamId: '', creatorTeamIds: [],
};
let env: RulesEnvironment;
let rt: RulesTesting;
let sdk: typeof import('firebase/firestore');

describe.skipIf(!enabled)('P2-13：一般用戶＋入口個別授權＋能力關閉', () => {
  beforeAll(async () => {
    const address = process.env.FIRESTORE_EMULATOR_HOST || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address)) {
      throw new Error('FIRESTORE_EMULATOR_HOST must explicitly target localhost');
    }
    const [host, port] = address.split(':');
    // 與同資料夾其他 *.rules.test.ts 相同：沿用 FC 的 @firebase/rules-unit-testing；FC_REPO 可指定 FC 主目錄（工作樹不在 FC-B 旁邊時）。
    const require = createRequire(resolve('package.json'));
    const modulePath = require.resolve('@firebase/rules-unit-testing', {
      paths: [process.cwd(), resolve('../FC'), ...(process.env.FC_REPO ? [process.env.FC_REPO] : [])],
    });
    rt = require(modulePath) as RulesTesting;
    sdk = createRequire(modulePath)('firebase/firestore') as typeof sdk;
    env = await rt.initializeTestEnvironment({
      projectId: 'demo-fcb-p2-13',
      firestore: { host: host!, port: Number(port), rules: readFileSync(resolve('emulator/firestore.rules'), 'utf8') },
    });
  });
  afterAll(async () => { await env?.cleanup(); });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await sdk.setDoc(sdk.doc(db, 'roleActivityCapabilities', 'user'), { catalogVersion: 1, capabilities: ['user.activity.basic_create'] });
      await sdk.setDoc(sdk.doc(db, 'userPermissionGrants', OWNER), { uid: OWNER, permissions: ['activity.manage.entry'], enabled: true });
      await sdk.setDoc(sdk.doc(db, 'users', OWNER), { uid: OWNER, role: 'user', name: OWNER });
      await sdk.setDoc(sdk.doc(db, 'events', 'ev1'), event);
    });
  });

  it('對照組：同一人前台能力打開時，Rules 三個動作都放行（證明上面是因為能力關閉才被拒）', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await sdk.setDoc(sdk.doc(context.firestore(), 'roleActivityCapabilities', 'user'), {
        catalogVersion: 1,
        capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic', 'user.activity.own_cancel', 'user.activity.delegate_assign'],
      });
    });
    const db = env.authenticatedContext(OWNER, { role: 'user' }).firestore();
    const ref = sdk.doc(db, 'events', 'ev1');
    await rt.assertSucceeds(sdk.updateDoc(ref, { title: '新名稱' }));
    await rt.assertSucceeds(sdk.updateDoc(ref, { status: 'cancelled' }));
    await rt.assertSucceeds(sdk.updateDoc(ref, { delegateUids: ['someone'] }));
  });

  it('Rules：改標題、取消、設委託人全部拒絕', async () => {
    const db = env.authenticatedContext(OWNER, { role: 'user' }).firestore();
    const ref = sdk.doc(db, 'events', 'ev1');
    await rt.assertFails(sdk.updateDoc(ref, { title: '新名稱' }));
    await rt.assertFails(sdk.updateDoc(ref, { status: 'cancelled' }));
    await rt.assertFails(sdk.updateDoc(ref, { delegateUids: ['someone'] }));
  });

  // 註：owner＋event.edit_self（能力關閉）走 Rules owner＋edit_self 分支時，模擬器在 events update 撞 1000 運算式上限被拒
  // （2026-11-23 實測；既有 rules-budget 問題，另案回報）。前端此組合維持與 A oracle 一致（放行），不在這裡斷言 Rules 結果。
  it('課程連結活動：同一人（入口個別授權、能力關閉）Rules 仍允許管理者取消——前端這條不能一起關掉', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await sdk.setDoc(sdk.doc(context.firestore(), 'events', 'ev1'), { ...event, courseLinked: true });
    });
    const db = env.authenticatedContext(OWNER, { role: 'user' }).firestore();
    await rt.assertSucceeds(sdk.updateDoc(sdk.doc(db, 'events', 'ev1'), { status: 'cancelled' }));
  });
});

// 前端組合（一般 unit 也會跑）：一般用戶 × 入口個別授權有／無 × 前台能力開／關 × 一般／課程連結活動。
const ALL_CAPS = ['user.activity.basic_create', 'user.activity.own_edit_basic', 'user.activity.own_cancel', 'user.activity.delegate_assign'];
function ctx(grant: boolean, caps: readonly string[], role = 'user'): OperateContext {
  return {
    uid: OWNER, role, rolePermissions: null, capabilities: caps, customRoles: [],
    userGrants: grant ? { uid: OWNER, permissions: ['activity.manage.entry'], enabled: true } : null,
  };
}
const helpers = [
  ['編輯基本資料', canEditOwnActivityBasic],
  ['取消', canCancelOwnActivity],
  ['設委託人', canManageEventDelegates],
] as const;
describe('P2-13 前端：直寫 Firestore 的三個動作對齊 Rules', () => {
  it.each(helpers)('%s：一般活動＋入口授權＋能力關 → 不放行（修正前是放行）', (_name, helper) => {
    expect(helper(ctx(true, ['user.activity.basic_create']), event)).toBe(false);
  });
  it.each(helpers)('%s：一般活動＋入口授權＋能力開 → 放行', (_name, helper) => {
    expect(helper(ctx(true, ALL_CAPS), event)).toBe(true);
  });
  it.each(helpers)('%s：一般活動＋無授權＋能力開 → 放行', (_name, helper) => {
    expect(helper(ctx(false, ALL_CAPS), event)).toBe(true);
  });
  it.each(helpers)('%s：一般活動＋無授權＋能力關 → 不放行', (_name, helper) => {
    expect(helper(ctx(false, ['user.activity.basic_create']), event)).toBe(false);
  });
  it.each(helpers)('%s：課程連結活動＋入口授權＋能力關 → 維持放行（不得一起關掉）', (_name, helper) => {
    expect(helper(ctx(true, ['user.activity.basic_create']), { ...event, courseLinked: true })).toBe(true);
  });
  it.each(helpers)('%s：教練（角色層 fallback）不受影響', (_name, helper) => {
    expect(helper(ctx(false, [], 'coach'), event)).toBe(true);
  });
  it.each(helpers)('%s：一般活動＋入口與 event.edit_self 授權（owner）＋能力關 → 放行（Rules owner＋edit_self 分支）', (_name, helper) => {
    const context = ctx(true, ['user.activity.basic_create']);
    context.userGrants = { uid: OWNER, permissions: ['activity.manage.entry', 'event.edit_self'], enabled: true };
    expect(helper(context, event)).toBe(true);
  });
  it('建立中（event 為 null）的一般用戶設委託人：入口授權不算，要 delegate_assign', () => {
    expect(canManageEventDelegates(ctx(true, ['user.activity.basic_create']), null)).toBe(false);
    expect(canManageEventDelegates(ctx(true, ALL_CAPS), null)).toBe(true);
  });
});
