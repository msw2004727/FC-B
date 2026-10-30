import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { FirestoreSdk } from '@/data/firestore-sdk';
import { parseTaipei } from '@/core/taipei-time';
import { BANNERS_SNAPSHOT_KEY } from '@/features/home/data/home-snapshot';
import {
  BANNER_CLEAR_WRITE,
  BannerWriteError,
  CLEAR_FIELDS,
  SAVE_FIELDS,
  applyBannerTransition,
  applyDueBannerTransitions,
  canManageBanners,
  clearBannerSlot,
  delistBanner,
  loadBannerSlots,
  relistBanner,
  saveBanner,
  type BannerActor,
  type BannerDeps,
} from './banner-admin';
import type { BannerRef, BannerSaveWrite, BannerSlot, BannerTransition } from './banner-model';

const NOW = parseTaipei('2026/10/27 12:00') as number;
const TS = '__SERVER_TS__';

// ── 四身分＋權限碼 ─────────────────────────────────────
function actor(role: string, hasCode: boolean, uid: string | null = `u_${role}`): BannerActor {
  return { uid, displayName: `名-${role}`, hasPermission: (code) => hasCode && code === 'admin.banners.entry' };
}
const ALLOWED: Array<[string, BannerActor]> = [
  ['admin（有 admin.banners.entry）', actor('admin', true)],
  ['super_admin（有 admin.banners.entry）', actor('super_admin', true)],
];
const DENIED: Array<[string, BannerActor | null | undefined]> = [
  ['user', actor('user', false)],
  ['coach', actor('coach', false)],
  ['captain', actor('captain', false)],
  ['admin（沒有 admin.banners.entry）', actor('admin', false)],
  ['訪客（uid 為 null，即使碼為真）', actor('guest', true, null)],
  ['null', null],
  ['undefined', undefined],
];

// ── 假 Firestore SDK ──────────────────────────────────
function makeEnv() {
  const updateDoc = vi.fn().mockResolvedValue(undefined);
  const deleteDoc = vi.fn();
  const setDoc = vi.fn();
  const addDoc = vi.fn();
  const doc = vi.fn((_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }));
  const serverTimestamp = vi.fn(() => TS);
  const txGet = vi.fn();
  const txUpdate = vi.fn();
  const runTransaction = vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<boolean>) =>
    fn({ get: txGet, update: txUpdate }),
  );
  const getDocs = vi.fn();
  const limit = vi.fn((n: number) => ({ limit: n }));
  const query = vi.fn((c: unknown, ...rest: unknown[]) => ({ c, rest }));
  const collection = vi.fn((_db: unknown, name: string) => ({ name }));
  const sdk = {
    updateDoc,
    deleteDoc,
    setDoc,
    addDoc,
    doc,
    serverTimestamp,
    runTransaction,
    getDocs,
    limit,
    query,
    collection,
  } as unknown as FirestoreSdk;
  const getFirebase = vi.fn(async () => ({ db: {} as Firestore }));
  const callFn = vi.fn().mockResolvedValue({ success: true });
  const writeOpLog = vi.fn().mockResolvedValue(undefined);
  const warn = vi.fn();
  const deps: BannerDeps = {
    getFirebase,
    loadSdk: async () => sdk,
    now: () => NOW,
    warn,
    // 稽核日誌旗標預設關閉（F3）；這裡明確打開才能驗它的行為，關閉的案例另測。
    audit: { enabled: true, callFn: callFn as never, warn },
    opLog: { opLogEnabled: true, writeOpLog, warn },
  };
  return {
    deps,
    updateDoc,
    deleteDoc,
    setDoc,
    addDoc,
    doc,
    txGet,
    txUpdate,
    runTransaction,
    getDocs,
    limit,
    getFirebase,
    callFn,
    writeOpLog,
    warn,
  };
}

type RelistRef = BannerRef & { unpublishAt: string };

function ref(id = 'ban1', overrides: Partial<RelistRef> = {}): RelistRef {
  return { docId: id, id, slot: '1', slotName: '春季聯賽', unpublishAt: '', ...overrides };
}

const SAVE: BannerSaveWrite = {
  title: '標題',
  subtitle: '小標',
  titleColor: '#ffffff',
  subtitleColor: '#e5edf8',
  slotName: '春季聯賽',
  linkUrl: 'https://example.com',
  image: 'https://example.com/a.webp',
  publishAt: '2026/10/27 12:00',
  unpublishAt: null,
  status: 'active',
};

function slot(overrides: Partial<BannerSlot> = {}): BannerSlot {
  return {
    id: 'ban1',
    docId: 'ban1',
    slot: '1',
    slotName: '廣告位 1',
    title: '',
    subtitle: '',
    titleColor: '#ffffff',
    subtitleColor: '#e5edf8',
    image: '',
    linkUrl: '',
    status: 'scheduled',
    publishAt: '2026/10/27 10:00',
    unpublishAt: '',
    clicks: 0,
    ...overrides,
  };
}

function transition(overrides: Partial<BannerTransition> = {}): BannerTransition {
  return {
    docId: 'ban1',
    id: 'ban1',
    label: '廣告位 1',
    from: 'scheduled',
    to: 'active',
    reason: 'publish_due',
    publishAt: '2026/10/27 10:00',
    unpublishAt: '',
    ...overrides,
  };
}

function snap(data: Record<string, unknown> | null) {
  return { exists: () => data !== null, data: () => data };
}

beforeEach(() => {
  localStorage.setItem(BANNERS_SNAPSHOT_KEY, '{"v":1}');
});
afterEach(() => {
  localStorage.clear();
});

describe('canManageBanners', () => {
  it.each(ALLOWED)('%s 可以', (_label, who) => {
    expect(canManageBanners(who)).toBe(true);
  });
  it.each(DENIED)('%s 不可以', (_label, who) => {
    expect(canManageBanners(who)).toBe(false);
  });
  it('只認 admin.banners.entry（其他權限碼不行）', () => {
    const other: BannerActor = { uid: 'u1', hasPermission: (code) => code === 'admin.users.entry' };
    expect(canManageBanners(other)).toBe(false);
  });
});

describe('寫入函式內部的權限守衛（四身分矩陣）', () => {
  const calls: Array<[string, (a: BannerActor | null | undefined, d: BannerDeps) => Promise<unknown>]> = [
    ['saveBanner', (a, d) => saveBanner(ref(), SAVE, a, d)],
    ['delistBanner', (a, d) => delistBanner(ref(), a, d)],
    ['relistBanner', (a, d) => relistBanner(ref(), a, d)],
    ['clearBannerSlot', (a, d) => clearBannerSlot(ref(), a, d)],
    ['applyBannerTransition', (a, d) => applyBannerTransition(transition(), a, d)],
    ['applyDueBannerTransitions', (a, d) => applyDueBannerTransitions([slot()], a, d)],
  ];

  for (const [name, call] of calls) {
    describe(name, () => {
      it.each(DENIED)('拒絕 %s：丟 permission-denied，沒有任何讀寫、沒有任何日誌', async (_label, who) => {
        const env = makeEnv();
        await expect(call(who, env.deps)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(env.getFirebase).not.toHaveBeenCalled();
        expect(env.updateDoc).not.toHaveBeenCalled();
        expect(env.runTransaction).not.toHaveBeenCalled();
        expect(env.writeOpLog).not.toHaveBeenCalled();
        expect(env.callFn).not.toHaveBeenCalled();
        expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBe('{"v":1}');
      });
    });
  }

  it('沒有權限時，即使 payload 也不合法，仍先回 permission-denied（權限檢查在最前面）', async () => {
    const env = makeEnv();
    const bad = { ...SAVE, image: 'data:image/webp;base64,AAAA' };
    await expect(saveBanner(ref(), bad, actor('user', false), env.deps)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});

describe('欄位 allowlist 與 payload（逐值對 A）', () => {
  it('saveBanner：只寫儲存欄位＋updatedAt', async () => {
    const env = makeEnv();
    await saveBanner(ref('ban1'), SAVE, actor('admin', true), env.deps);
    expect(env.updateDoc).toHaveBeenCalledTimes(1);
    const [docRef, payload] = env.updateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(docRef).toEqual({ path: 'banners/ban1' });
    expect(payload).toEqual({ ...SAVE, updatedAt: TS });
    expect(Object.keys(payload).sort()).toEqual([...SAVE_FIELDS, 'updatedAt'].sort());
  });

  it('delistBanner／relistBanner：只寫 status＋updatedAt', async () => {
    const env = makeEnv();
    await delistBanner(ref('ban2'), actor('admin', true), env.deps);
    await relistBanner(ref('ban3'), actor('admin', true), env.deps);
    expect(env.updateDoc.mock.calls[0]).toEqual([{ path: 'banners/ban2' }, { status: 'expired', updatedAt: TS }]);
    expect(env.updateDoc.mock.calls[1]).toEqual([{ path: 'banners/ban3' }, { status: 'active', updatedAt: TS }]);
  });

  it('clearBannerSlot：清空欄位（A clearAdSlot 的 emptyData 逐值相同），不是刪文件', async () => {
    const env = makeEnv();
    await clearBannerSlot(ref('ban1'), actor('admin', true), env.deps);
    expect(env.updateDoc).toHaveBeenCalledWith(
      { path: 'banners/ban1' },
      {
        title: '',
        slotName: '',
        linkUrl: '',
        image: null,
        publishAt: null,
        unpublishAt: null,
        status: 'empty',
        clicks: 0,
        updatedAt: TS,
      },
    );
    expect(Object.keys(BANNER_CLEAR_WRITE).sort()).toEqual([...CLEAR_FIELDS].sort());
  });

  it('絕不 deleteDoc／setDoc／addDoc（delete 規則是 if false）', async () => {
    const env = makeEnv();
    const a = actor('admin', true);
    await saveBanner(ref(), SAVE, a, env.deps);
    await delistBanner(ref(), a, env.deps);
    await relistBanner(ref(), a, env.deps);
    await clearBannerSlot(ref(), a, env.deps);
    env.txGet.mockResolvedValue(snap({ status: 'scheduled', publishAt: '', unpublishAt: '' }));
    await applyBannerTransition(transition({ publishAt: '' }), a, env.deps);
    expect(env.deleteDoc).not.toHaveBeenCalled();
    expect(env.setDoc).not.toHaveBeenCalled();
    expect(env.addDoc).not.toHaveBeenCalled();
  });

  it('夾帶 allowlist 外的欄位（強轉）：整筆拒絕，什麼都不寫、不記日誌', async () => {
    const env = makeEnv();
    const a = actor('admin', true);
    const withClicks = { ...SAVE, clicks: 999 } as unknown as BannerSaveWrite;
    const withUid = { ...SAVE, uid: 'u_x' } as unknown as BannerSaveWrite;
    const withType = { ...SAVE, type: 'shotgame' } as unknown as BannerSaveWrite;
    for (const bad of [withClicks, withUid, withType]) {
      await expect(saveBanner(ref(), bad, a, env.deps)).rejects.toThrow(/未允許欄位/);
    }
    expect(env.updateDoc).not.toHaveBeenCalled();
    expect(env.writeOpLog).not.toHaveBeenCalled();
  });

  it('圖片還是 data URL：拒絕（不可把 base64 寫進 Firestore）', async () => {
    const env = makeEnv();
    await expect(
      saveBanner(ref(), { ...SAVE, image: 'data:image/webp;base64,AAAA' }, actor('admin', true), env.deps),
    ).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(env.updateDoc).not.toHaveBeenCalled();
    expect(env.writeOpLog).not.toHaveBeenCalled();
  });

  it('F2：連結不安全（引號、空白、角括號、反引號、反斜線、非 http(s)）在寫入層也拒絕，什麼都不寫', async () => {
    const env = makeEnv();
    const a = actor('admin', true);
    const bad = [
      "https://example.com/a'b",
      'https://example.com/a"b',
      'https://example.com/a b',
      'https://example.com/<x>',
      'https://example.com/a`b',
      'https://example.com/a\\b',
      'javascript:alert(1)',
      'ftp://example.com',
      '//example.com',
    ];
    for (const linkUrl of bad) {
      await expect(saveBanner(ref(), { ...SAVE, linkUrl }, a, env.deps)).rejects.toMatchObject({
        code: 'invalid-payload',
      });
    }
    expect(env.updateDoc).not.toHaveBeenCalled();
    expect(env.writeOpLog).not.toHaveBeenCalled();
    // 空字串與正常網址可以。
    await saveBanner(ref(), { ...SAVE, linkUrl: '' }, a, env.deps);
    await saveBanner(ref(), { ...SAVE, linkUrl: 'https://example.com/a?b=1&c=2' }, a, env.deps);
    expect(env.updateDoc).toHaveBeenCalledTimes(2);
  });

  it('status 只能是 active／scheduled', async () => {
    const env = makeEnv();
    for (const status of ['expired', 'empty', 'weird']) {
      await expect(
        saveBanner(ref(), { ...SAVE, status } as unknown as BannerSaveWrite, actor('admin', true), env.deps),
      ).rejects.toMatchObject({ code: 'invalid-payload' });
    }
    expect(env.updateDoc).not.toHaveBeenCalled();
  });

  it.each(['', ' ban1', 'a/b', 'sga1', 'watch-party-bg', 'home-info', 'home-layout'])(
    '文件 id「%s」不合法或屬於特殊文件：拒絕',
    async (docId) => {
      const env = makeEnv();
      const a = actor('admin', true);
      await expect(delistBanner(ref(docId), a, env.deps)).rejects.toMatchObject({ code: 'invalid-doc-id' });
      await expect(clearBannerSlot(ref(docId), a, env.deps)).rejects.toBeInstanceOf(BannerWriteError);
      expect(env.updateDoc).not.toHaveBeenCalled();
      expect(env.writeOpLog).not.toHaveBeenCalled();
    },
  );
});

describe('relistBanner：寫入前用現在重檢結束時間（F5）', () => {
  const a = actor('admin', true);

  it('結束時間已過或恰好等於現在：拒絕（relist-expired），不寫、不記日誌、快照不動', async () => {
    for (const unpublishAt of ['2026/10/27 12:00', '2026/10/27 11:59', '2020/01/01 00:00']) {
      const env = makeEnv();
      await expect(
        relistBanner(ref('ban1', { unpublishAt }), a, env.deps),
      ).rejects.toMatchObject({ code: 'relist-expired' });
      expect(env.updateDoc).not.toHaveBeenCalled();
      expect(env.writeOpLog).not.toHaveBeenCalled();
      expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBe('{"v":1}');
    }
  });

  it('結束時間還沒到或永久（空字串）：可以上架', async () => {
    const env = makeEnv();
    await relistBanner(ref('ban1', { unpublishAt: '2026/10/27 12:01' }), a, env.deps);
    await relistBanner(ref('ban2', { unpublishAt: '' }), a, env.deps);
    expect(env.updateDoc).toHaveBeenCalledTimes(2);
    expect(env.writeOpLog).toHaveBeenCalledTimes(2);
  });

  it('用的是呼叫當下的時間（同一份資料，時間往後走就會被擋）', async () => {
    const env = makeEnv();
    const target = ref('ban1', { unpublishAt: '2026/10/27 13:00' });
    await relistBanner(target, a, env.deps);
    env.deps.now = () => parseTaipei('2026/10/27 13:00') as number;
    await expect(relistBanner(target, a, env.deps)).rejects.toMatchObject({ code: 'relist-expired' });
    expect(env.updateDoc).toHaveBeenCalledTimes(1);
  });

  it('沒有權限時先回 permission-denied（不洩漏時間判斷）', async () => {
    const env = makeEnv();
    await expect(
      relistBanner(ref('ban1', { unpublishAt: '2020/01/01 00:00' }), actor('user', false), env.deps),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('首頁快照失效', () => {
  it.each([
    ['saveBanner', (d: BannerDeps) => saveBanner(ref(), SAVE, actor('admin', true), d)],
    ['delistBanner', (d: BannerDeps) => delistBanner(ref(), actor('admin', true), d)],
    ['relistBanner', (d: BannerDeps) => relistBanner(ref(), actor('admin', true), d)],
    ['clearBannerSlot', (d: BannerDeps) => clearBannerSlot(ref(), actor('admin', true), d)],
  ])('%s 成功後清掉橫幅快照', async (_name, run) => {
    const env = makeEnv();
    await run(env.deps);
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();
  });

  it('寫入失敗時快照保留，錯誤往外丟', async () => {
    const env = makeEnv();
    env.updateDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(delistBanner(ref(), actor('admin', true), env.deps)).rejects.toThrow('permission-denied');
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBe('{"v":1}');
  });
});

describe('操作日誌 operationLogs（顧問 2026-10-27：每個動作、每筆轉換都寫）', () => {
  const admin = actor('admin', true, 'u_op_1');

  const writers: Array<
    [string, (d: BannerDeps) => Promise<unknown>, { type: string; typeName: string; content: string }]
  > = [
    [
      'saveBanner（立即啟用）',
      (d) => saveBanner(ref('ban1'), SAVE, admin, d),
      { type: 'banner_edit', typeName: '編輯 Banner', content: '編輯「春季聯賽」(ban1)，立即啟用' },
    ],
    [
      'saveBanner（預約）',
      (d) =>
        saveBanner(ref('ban1'), { ...SAVE, status: 'scheduled', publishAt: '2026/11/05 10:00' }, admin, d),
      {
        type: 'banner_edit',
        typeName: '編輯 Banner',
        content: '編輯「春季聯賽」(ban1)，預約 2026/11/05 10:00 啟用',
      },
    ],
    [
      'delistBanner',
      (d) => delistBanner(ref('ban1'), admin, d),
      { type: 'banner_toggle', typeName: 'Banner 上下架', content: '下架「春季聯賽」(ban1)' },
    ],
    [
      'relistBanner',
      (d) => relistBanner(ref('ban1'), admin, d),
      { type: 'banner_toggle', typeName: 'Banner 上下架', content: '上架「春季聯賽」(ban1)' },
    ],
    [
      'clearBannerSlot',
      (d) => clearBannerSlot(ref('ban1'), admin, d),
      { type: 'banner_delete', typeName: '刪除 Banner', content: '刪除「春季聯賽」(ban1)，已清空設定' },
    ],
  ];

  it.each(writers)('%s：成功後寫一筆日誌，actorUid ＝呼叫者 UID', async (_name, run, expected) => {
    const env = makeEnv();
    await run(env.deps);
    expect(env.writeOpLog).toHaveBeenCalledTimes(1);
    expect(env.writeOpLog).toHaveBeenCalledWith({ ...expected, actorUid: 'u_op_1', operator: '名-admin' });
    const input = env.writeOpLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(['actorUid', 'content', 'operator', 'type', 'typeName']);
  });

  it('不同呼叫者各自帶自己的 UID（super_admin 也一樣）', async () => {
    const env = makeEnv();
    await delistBanner(ref(), actor('super_admin', true, 'u_super_9'), env.deps);
    expect(env.writeOpLog).toHaveBeenCalledWith(expect.objectContaining({ actorUid: 'u_super_9' }));
  });

  it('廣告位沒名稱時用「廣告位 {slot}」當對象', async () => {
    const env = makeEnv();
    await delistBanner(ref('ban3', { slot: '3', slotName: '  ' }), admin, env.deps);
    expect(env.writeOpLog).toHaveBeenCalledWith(
      expect.objectContaining({ content: '下架「廣告位 3」(ban3)' }),
    );
  });

  it.each(writers)('%s：旗標關閉時不寫日誌，主要寫入照常', async (_name, run) => {
    const env = makeEnv();
    env.deps.opLog = { opLogEnabled: false, writeOpLog: env.writeOpLog, warn: env.warn };
    await run(env.deps);
    expect(env.updateDoc).toHaveBeenCalledTimes(1);
    expect(env.writeOpLog).not.toHaveBeenCalled();
  });

  it.each(writers)('%s：writeOpLog 失敗不影響主結果（只 warn）', async (_name, run) => {
    const env = makeEnv();
    env.writeOpLog.mockRejectedValue(new Error('denied'));
    await expect(run(env.deps)).resolves.toBeUndefined();
    expect(env.updateDoc).toHaveBeenCalledTimes(1);
    expect(env.warn).toHaveBeenCalledWith('[banners] writeOpLog failed', expect.any(Error));
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();
  });

  it.each(writers)('%s：寫入失敗時不寫日誌', async (_name, run) => {
    const env = makeEnv();
    env.updateDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(run(env.deps)).rejects.toThrow('permission-denied');
    expect(env.writeOpLog).not.toHaveBeenCalled();
  });
});

describe('loadBannerSlots', () => {
  it('limit(200) 讀整集合，只留一般橫幅位（排除射門／觀賽／首頁資訊／版面設定）', async () => {
    const env = makeEnv();
    const docs = [
      ['ban1', { id: 'ban1', slot: 1, status: 'active', title: 'A' }],
      ['ban2', { id: 'ban2', slot: 2, status: 'empty' }],
      ['sga1', { id: 'sga1', type: 'shotgame', status: 'active' }],
      ['watch-party-bg', { id: 'watch-party-bg', type: 'watchParty' }],
      ['home-info', { id: 'home-info', type: 'homeInfo' }],
      ['home-layout', { id: 'home-layout', type: 'homeLayout' }],
    ].map(([id, data]) => ({ id, data: () => data }));
    env.getDocs.mockResolvedValue({ docs });
    const slots = await loadBannerSlots(env.deps);
    expect(slots.map((s) => s.docId)).toEqual(['ban1', 'ban2']);
    expect(env.limit).toHaveBeenCalledWith(200);
  });

  it('讀取不需要權限（Rules read: if true）', async () => {
    const env = makeEnv();
    env.getDocs.mockResolvedValue({ docs: [] });
    await expect(loadBannerSlots(env.deps)).resolves.toEqual([]);
  });
});

describe('applyBannerTransition（transaction，冪等）', () => {
  const t = transition({ publishAt: '2026/10/27 10:00', unpublishAt: '' });
  const a = actor('admin', true);

  it('狀態與時間都沒變：tx.update 只寫 status＋updatedAt，回 true', async () => {
    const env = makeEnv();
    env.txGet.mockResolvedValue(snap({ status: 'scheduled', publishAt: '2026/10/27 10:00', unpublishAt: null }));
    await expect(applyBannerTransition(t, a, env.deps)).resolves.toBe(true);
    expect(env.txUpdate).toHaveBeenCalledWith({ path: 'banners/ban1' }, { status: 'active', updatedAt: TS });
    expect(env.updateDoc).not.toHaveBeenCalled();
  });

  it('狀態已經是目標（別人先轉過了）：0 寫入，回 false', async () => {
    const env = makeEnv();
    env.txGet.mockResolvedValue(snap({ status: 'active', publishAt: '2026/10/27 10:00', unpublishAt: '' }));
    await expect(applyBannerTransition(t, a, env.deps)).resolves.toBe(false);
    expect(env.txUpdate).not.toHaveBeenCalled();
  });

  it('管理員剛改過時間：不動', async () => {
    const env = makeEnv();
    env.txGet.mockResolvedValue(snap({ status: 'scheduled', publishAt: '2026/11/01 10:00', unpublishAt: '' }));
    await expect(applyBannerTransition(t, a, env.deps)).resolves.toBe(false);
    env.txGet.mockResolvedValue(snap({ status: 'scheduled', publishAt: '2026/10/27 10:00', unpublishAt: '2026/12/01 00:00' }));
    await expect(applyBannerTransition(t, a, env.deps)).resolves.toBe(false);
    expect(env.txUpdate).not.toHaveBeenCalled();
  });

  it('文件不存在：不寫', async () => {
    const env = makeEnv();
    env.txGet.mockResolvedValue(snap(null));
    await expect(applyBannerTransition(t, a, env.deps)).resolves.toBe(false);
    expect(env.txUpdate).not.toHaveBeenCalled();
  });

  it('特殊文件 id 拒絕', async () => {
    const env = makeEnv();
    await expect(applyBannerTransition({ ...t, docId: 'home-layout' }, a, env.deps)).rejects.toMatchObject({
      code: 'invalid-doc-id',
    });
    expect(env.runTransaction).not.toHaveBeenCalled();
  });

  it('applyBannerTransition 本身不記日誌（日誌由 applyDueBannerTransitions 在確認寫入後記）', async () => {
    const env = makeEnv();
    env.txGet.mockResolvedValue(snap({ status: 'scheduled', publishAt: '2026/10/27 10:00', unpublishAt: '' }));
    await applyBannerTransition(t, a, env.deps);
    expect(env.writeOpLog).not.toHaveBeenCalled();
    expect(env.callFn).not.toHaveBeenCalled();
  });
});

describe('applyDueBannerTransitions', () => {
  const a = actor('admin', true, 'u_op_1');
  const slots = [
    slot({ docId: 'ban1', id: 'ban1', status: 'scheduled', publishAt: '2026/10/27 10:00', unpublishAt: '2026/11/05 00:00' }),
    slot({ docId: 'ban2', id: 'ban2', slot: '2', slotName: '', status: 'active', publishAt: '2026/10/01 00:00', unpublishAt: '2026/10/27 11:00' }),
    slot({ docId: 'ban3', id: 'ban3', status: 'active', publishAt: '2026/10/01 00:00', unpublishAt: '2026/11/30 00:00' }),
  ];

  function mirror(env: ReturnType<typeof makeEnv>, state: Record<string, Record<string, unknown>>) {
    env.txGet.mockImplementation(async (docRef: { path: string }) => snap(state[docRef.path.split('/')[1] ?? ''] ?? null));
    env.txUpdate.mockImplementation((docRef: { path: string }, data: Record<string, unknown>) => {
      const id = docRef.path.split('/')[1] ?? '';
      state[id] = { ...state[id], status: data.status };
    });
  }

  it('只轉換到期的位；每筆成功轉換一筆 audit＋一筆操作日誌；已正確的 0 寫入', async () => {
    const env = makeEnv();
    const state: Record<string, Record<string, unknown>> = {
      ban1: { status: 'scheduled', publishAt: '2026/10/27 10:00', unpublishAt: '2026/11/05 00:00' },
      ban2: { status: 'active', publishAt: '2026/10/01 00:00', unpublishAt: '2026/10/27 11:00' },
      ban3: { status: 'active', publishAt: '2026/10/01 00:00', unpublishAt: '2026/11/30 00:00' },
    };
    mirror(env, state);
    const result = await applyDueBannerTransitions(slots, a, env.deps);
    expect(result.failed).toBe(0);
    expect(result.applied.map((x) => [x.docId, x.to])).toEqual([
      ['ban1', 'active'],
      ['ban2', 'expired'],
    ]);
    expect(env.txUpdate).toHaveBeenCalledTimes(2);
    expect(env.callFn).toHaveBeenCalledTimes(2);
    expect(env.writeOpLog).toHaveBeenCalledTimes(2);
    expect(env.writeOpLog).toHaveBeenNthCalledWith(1, {
      type: 'banner_auto',
      typeName: 'Banner 自動切換',
      content: '「廣告位 1」(ban1)預約時間已到，自動啟用',
      actorUid: 'u_op_1',
      operator: '名-admin',
    });
    expect(env.writeOpLog).toHaveBeenNthCalledWith(2, {
      type: 'banner_auto',
      typeName: 'Banner 自動切換',
      content: '「廣告位 2」(ban2)結束時間已到，自動下架',
      actorUid: 'u_op_1',
      operator: '名-admin',
    });
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();

    // 第二次（資料已是正確狀態）：不再寫、不再 audit、不再記日誌、快照不動。
    localStorage.setItem(BANNERS_SNAPSHOT_KEY, '{"v":1}');
    env.txUpdate.mockClear();
    env.callFn.mockClear();
    env.writeOpLog.mockClear();
    const fixedSlots = slots.map((s) => (state[s.docId] ? { ...s, status: state[s.docId]!.status as BannerSlot['status'] } : s));
    const again = await applyDueBannerTransitions(fixedSlots, a, env.deps);
    expect(again.applied).toEqual([]);
    expect(env.txUpdate).not.toHaveBeenCalled();
    expect(env.callFn).not.toHaveBeenCalled();
    expect(env.writeOpLog).not.toHaveBeenCalled();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBe('{"v":1}');
  });

  it('同樣的清單重送（兩位管理員同時開頁）：第二位 tx 內發現已轉過，0 寫入、不記日誌', async () => {
    const env = makeEnv();
    const state: Record<string, Record<string, unknown>> = {
      ban1: { status: 'scheduled', publishAt: '2026/10/27 10:00', unpublishAt: '2026/11/05 00:00' },
      ban2: { status: 'active', publishAt: '2026/10/01 00:00', unpublishAt: '2026/10/27 11:00' },
    };
    mirror(env, state);
    await applyDueBannerTransitions(slots, a, env.deps);
    env.txUpdate.mockClear();
    env.callFn.mockClear();
    env.writeOpLog.mockClear();
    const second = await applyDueBannerTransitions(slots, a, env.deps);
    expect(second.applied).toEqual([]);
    expect(env.txUpdate).not.toHaveBeenCalled();
    expect(env.callFn).not.toHaveBeenCalled();
    expect(env.writeOpLog).not.toHaveBeenCalled();
  });

  it('單筆失敗不影響其他筆，失敗的那筆不記日誌，並記 warn', async () => {
    const env = makeEnv();
    env.txGet
      .mockRejectedValueOnce(new Error('aborted'))
      .mockResolvedValueOnce(snap({ status: 'active', publishAt: '2026/10/01 00:00', unpublishAt: '2026/10/27 11:00' }));
    const result = await applyDueBannerTransitions(slots, a, env.deps);
    expect(result.failed).toBe(1);
    expect(result.applied.map((x) => x.docId)).toEqual(['ban2']);
    expect(env.writeOpLog).toHaveBeenCalledTimes(1);
    expect(env.writeOpLog).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('(ban2)') }));
    expect(env.warn).toHaveBeenCalled();
  });

  it('audit 失敗（best-effort）不影響轉換結果，操作日誌照寫', async () => {
    const env = makeEnv();
    env.callFn.mockRejectedValue(new Error('invalid-argument'));
    env.txGet.mockResolvedValue(snap({ status: 'scheduled', publishAt: '2026/10/27 10:00', unpublishAt: '2026/11/05 00:00' }));
    const result = await applyDueBannerTransitions([slots[0]!], a, env.deps);
    expect(result.applied).toHaveLength(1);
    expect(result.failed).toBe(0);
    expect(env.warn).toHaveBeenCalledWith('[banners] writeAuditLog failed', expect.any(Error));
    expect(env.writeOpLog).toHaveBeenCalledTimes(1);
  });

  it('F3：稽核日誌旗標預設關閉——沒指定時不呼叫 writeAuditLog，操作日誌照寫', async () => {
    const env = makeEnv();
    env.deps.audit = { callFn: env.callFn as never, warn: env.warn };
    env.txGet.mockResolvedValue(snap({ status: 'scheduled', publishAt: '2026/10/27 10:00', unpublishAt: '2026/11/05 00:00' }));
    const result = await applyDueBannerTransitions([slots[0]!], a, env.deps);
    expect(result.applied).toHaveLength(1);
    expect(env.callFn).not.toHaveBeenCalled();
    expect(env.writeOpLog).toHaveBeenCalledTimes(1);
  });

  it('操作日誌失敗（best-effort）不影響轉換結果，audit 照寫', async () => {
    const env = makeEnv();
    env.writeOpLog.mockRejectedValue(new Error('denied'));
    env.txGet.mockResolvedValue(snap({ status: 'scheduled', publishAt: '2026/10/27 10:00', unpublishAt: '2026/11/05 00:00' }));
    const result = await applyDueBannerTransitions([slots[0]!], a, env.deps);
    expect(result.applied).toHaveLength(1);
    expect(result.failed).toBe(0);
    expect(env.callFn).toHaveBeenCalledTimes(1);
    expect(env.warn).toHaveBeenCalledWith('[banners] writeOpLog failed', expect.any(Error));
  });

  it('旗標關閉：轉換與 audit 照常，不寫操作日誌', async () => {
    const env = makeEnv();
    env.deps.opLog = { opLogEnabled: false, writeOpLog: env.writeOpLog, warn: env.warn };
    env.txGet.mockResolvedValue(snap({ status: 'scheduled', publishAt: '2026/10/27 10:00', unpublishAt: '2026/11/05 00:00' }));
    const result = await applyDueBannerTransitions([slots[0]!], a, env.deps);
    expect(result.applied).toHaveLength(1);
    expect(env.callFn).toHaveBeenCalledTimes(1);
    expect(env.writeOpLog).not.toHaveBeenCalled();
  });

  it('沒有要轉換的：完全不讀不寫 Firestore，也不記日誌', async () => {
    const env = makeEnv();
    const result = await applyDueBannerTransitions([slots[2]!], a, env.deps);
    expect(result).toEqual({ applied: [], failed: 0 });
    expect(env.runTransaction).not.toHaveBeenCalled();
    expect(env.getFirebase).not.toHaveBeenCalled();
    expect(env.writeOpLog).not.toHaveBeenCalled();
    expect(env.callFn).not.toHaveBeenCalled();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBe('{"v":1}');
  });
});
