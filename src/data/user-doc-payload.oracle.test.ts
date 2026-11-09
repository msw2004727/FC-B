import { describe, expect, it } from 'vitest';

import oracleFixture from './__fixtures__/user-doc-oracle.json';
import {
  assertUserRootCreate,
  buildExistingLoginUpdate,
  buildLegacyMigration,
  buildLoginUpdate,
  buildNewUserDoc,
  isNoopLoginUpdate,
  USER_DOC_CREATE_FIELDS,
  USER_ROOT_CREATE_RULES_FIELDS,
  type LineLoginProfile,
} from './user-doc-payload';

// A 對照：fixture 由 scripts/gen-user-doc-oracle.mjs 以 A 原始碼（js/firebase-crud.js#createOrUpdateUser）原樣執行產生，
// 記錄同一輸入下 A 送出的寫入；這裡用 B 的 payload 建構函式算出同一筆，逐欄比對。

interface OracleWrite {
  op: 'set' | 'update';
  path: string;
  payload: Record<string, unknown>;
  options?: { merge?: boolean };
}
interface OracleCase {
  id: string;
  input: {
    authUid: string;
    profile: { userId: string; displayName?: string | null; pictureUrl?: string | null; email?: string | null };
    canonical: Record<string, unknown> | null;
    legacy: { id: string; data: Record<string, unknown> } | null;
    nowMs: number;
  };
  expected: { writes: OracleWrite[]; error: { code: string | null } | null };
}

const fixture = oracleFixture as unknown as { meta: { serverTimestamp: string; caseCount: number }; cases: OracleCase[] };
const TS = fixture.meta.serverTimestamp;

/** fixture 的 {__timestamp: ms} 還原成有 toMillis 的物件（A 讀 lastLogin.toMillis()）。 */
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const ms = (value as { __timestamp?: unknown }).__timestamp;
    if (typeof ms === 'number') return { toMillis: () => ms, __timestamp: ms };
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}
function encode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    const ms = (value as { __timestamp?: unknown }).__timestamp;
    if (typeof ms === 'number') return { __timestamp: ms };
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  return value;
}

function profileOf(c: OracleCase): LineLoginProfile {
  const p = c.input.profile;
  return {
    userId: p.userId,
    displayName: p.displayName ?? null,
    pictureUrl: p.pictureUrl ?? null,
    email: p.email ?? null,
    source: 'getProfile',
  };
}

/** B 依同一輸入算出的寫入（不含「內容相同時省略寫入」的最佳化，那一段另外驗）。 */
function bWrite(c: OracleCase): OracleWrite | null {
  const { authUid, canonical, legacy, nowMs } = c.input;
  if (authUid !== c.input.profile.userId) return null;
  const profile = profileOf(c);
  const path = `users/${authUid}`;
  if (canonical) {
    return { op: 'update', path, payload: buildLoginUpdate(decode(canonical) as Record<string, unknown>, profile, nowMs, TS) };
  }
  if (legacy) {
    return {
      op: 'set', path, options: { merge: true },
      payload: buildLegacyMigration(decode(legacy.data) as Record<string, unknown>, authUid, profile, TS),
    };
  }
  return { op: 'set', path, payload: buildNewUserDoc(authUid, profile, TS) };
}

describe('會員文件 payload × A createOrUpdateUser（oracle）', () => {
  it('fixture 案例數與 meta 一致，且涵蓋新建／legacy／已存在／uid 不一致', () => {
    expect(fixture.cases).toHaveLength(fixture.meta.caseCount);
    const ids = fixture.cases.map((c) => c.id);
    expect(ids.some((id) => id.startsWith('new-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('legacy-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('existing-'))).toBe(true);
    expect(ids).toContain('uid-mismatch');
  });

  it.each(fixture.cases.map((c) => [c.id, c] as const))('%s：B 寫入與 A 逐欄相同', (_id, c) => {
    const write = bWrite(c);
    if (c.expected.error) {
      // A 拒絕（uid 不一致）時不寫入；B 也不產生寫入。
      expect(c.expected.writes).toEqual([]);
      expect(write).toBeNull();
      return;
    }
    expect(c.expected.writes).toHaveLength(1);
    const a = c.expected.writes[0]!;
    expect(write).not.toBeNull();
    expect(write!.op).toBe(a.op);
    expect(write!.path).toBe(a.path);
    expect(write!.options).toEqual(a.options);
    expect(encode(write!.payload)).toEqual(a.payload);
    // 鍵的集合也要一樣（toEqual 不在乎 undefined 鍵，另外比一次）。
    expect(Object.keys(write!.payload).sort()).toEqual(Object.keys(a.payload).sort());
  });

  it('新建：A 的欄位正好是 USER_DOC_CREATE_FIELDS，且通過 Rules 建立條件', () => {
    for (const c of fixture.cases.filter((x) => x.id.startsWith('new-'))) {
      const payload = c.expected.writes[0]!.payload;
      expect(Object.keys(payload).sort()).toEqual([...USER_DOC_CREATE_FIELDS].sort());
      expect(() => assertUserRootCreate(payload, c.input.authUid, TS, USER_DOC_CREATE_FIELDS)).not.toThrow();
    }
  });

  it('審查 P3-5：建立一定要帶本次 serverTimestamp 的 createdAt，缺少或換成其他值都拒寫（保證只建立、不覆寫）', () => {
    const c = fixture.cases.find((x) => x.id === 'new-basic')!;
    const payload = buildNewUserDoc(c.input.authUid, profileOf(c), TS);
    expect(() => assertUserRootCreate(payload, c.input.authUid, TS, USER_DOC_CREATE_FIELDS)).not.toThrow();
    const withoutCreatedAt = { ...payload };
    delete withoutCreatedAt.createdAt;
    expect(() => assertUserRootCreate(withoutCreatedAt, c.input.authUid, TS, USER_DOC_CREATE_FIELDS))
      .toThrow(/create-values-not-allowed:createdAt$/);
    expect(() => assertUserRootCreate({ ...payload, createdAt: { toMillis: () => 1 } }, c.input.authUid, TS, USER_DOC_CREATE_FIELDS))
      .toThrow(/create-values-not-allowed:createdAt$/);
    // legacy 遷移也一樣：舊文件沒有 createdAt 時 B 會補本次時間；有就照抄而被拒。
    const legacy = buildLegacyMigration({ lineUserId: c.input.authUid }, c.input.authUid, profileOf(c), TS);
    expect(legacy.createdAt).toBe(TS);
  });

  it('legacy：沒有 createdAt 的舊文件可遷移；A 照抄舊 createdAt／非 user 角色的 payload 會被 Rules 擋，B 不送', () => {
    const ok = fixture.cases.find((c) => c.id === 'legacy-no-createdAt')!;
    expect(() => assertUserRootCreate(
      ok.expected.writes[0]!.payload, ok.input.authUid, TS, USER_ROOT_CREATE_RULES_FIELDS,
    )).not.toThrow();

    const blocked = fixture.cases.find((c) => c.id === 'legacy-with-createdAt')!;
    const payload = decode(blocked.expected.writes[0]!.payload) as Record<string, unknown>;
    expect(() => assertUserRootCreate(payload, blocked.input.authUid, TS, USER_ROOT_CREATE_RULES_FIELDS))
      .toThrow(/create-values-not-allowed:role,exp,createdAt/);
  });

  it('已存在：A 只寫 displayName／pictureUrl（＋超過 10 分鐘的 lastLogin），不碰 role／exp／level／lineNotify', () => {
    for (const c of fixture.cases.filter((x) => x.id.startsWith('existing-'))) {
      const keys = Object.keys(c.expected.writes[0]!.payload);
      expect(keys.every((k) => ['displayName', 'pictureUrl', 'lastLogin'].includes(k))).toBe(true);
      expect(keys).toEqual(expect.arrayContaining(['displayName', 'pictureUrl']));
    }
  });

  it('B 已存在分支（buildExistingLoginUpdate）：真的 getProfile 有名稱時與 A 相同；名稱空白時不覆寫名稱（與 A 的刻意差異，審查 P3-2）', () => {
    for (const c of fixture.cases.filter((x) => x.id.startsWith('existing-'))) {
      const existingDoc = decode(c.input.canonical) as Record<string, unknown>;
      const b = encode(buildExistingLoginUpdate(existingDoc, profileOf(c), c.input.nowMs, TS)) as Record<string, unknown>;
      const a = c.expected.writes[0]!.payload;
      if (String(c.input.profile.displayName ?? '').trim()) {
        expect(b).toEqual(a);
      } else {
        const rest = { ...a };
        delete rest.displayName;
        expect(b).toEqual(rest);
      }
    }
    const idTokenProfile = { ...profileOf(fixture.cases.find((c) => c.id === 'existing-old-login')!), source: 'idToken' as const };
    expect(buildExistingLoginUpdate({ lastLogin: { toMillis: () => 0 } }, idTokenProfile, 11 * 60_000, TS)).toEqual({ lastLogin: TS });
  });

  it('已存在且內容相同：A 仍送一次相同內容的 update，B 判定為無變更不送（結果相同）', () => {
    const same = fixture.cases.find((c) => c.id === 'existing-same-values')!;
    const updates = bWrite(same)!.payload;
    expect(isNoopLoginUpdate(decode(same.input.canonical) as Record<string, unknown>, updates)).toBe(true);
    const changed = fixture.cases.find((c) => c.id === 'existing-recent-login')!;
    expect(isNoopLoginUpdate(decode(changed.input.canonical) as Record<string, unknown>, bWrite(changed)!.payload))
      .toBe(false);
  });
});
