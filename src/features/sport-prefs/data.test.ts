import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SPORT_PREFS_MAX,
  favPool,
  orderedSports,
  batchCells,
  batchCount,
  RING_SLOTS,
  uidTag,
  isSeenLocal,
  markSeenLocal,
  isSportPrefsEnabled,
  _resetSportPrefsDataForTest,
} from './data';

describe('sport-prefs/data', () => {
  beforeEach(() => {
    _resetSportPrefsDataForTest();
  });

  it('favPool 20 項且不含 other', () => {
    const pool = favPool();
    expect(SPORT_PREFS_MAX).toBe(20);
    expect(pool).toHaveLength(20);
    expect(pool.some((s) => s.key === 'other')).toBe(false);
  });

  it('orderedSports 排行在前、不認得/重複忽略', () => {
    const out = orderedSports(['basketball', 'football', 'basketball', 'not-a-sport', 'hiking']);
    expect(out[0]?.key).toBe('basketball');
    expect(out[1]?.key).toBe('football');
    expect(out[2]?.key).toBe('hiking');
    expect(out.map((s) => s.key)).not.toContain('not-a-sport');
    const keys = out.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(out).toHaveLength(20);
    expect(keys).not.toContain('other');
  });

  it('batchCells 第1名在4、第2名在1、第9名在0', () => {
    const pool = favPool();
    const cells = batchCells(pool, 0);
    expect(cells).toHaveLength(9);
    expect(RING_SLOTS[0]).toBe(4);
    expect(cells[4]?.key).toBe(pool[0]?.key);
    expect(cells[1]?.key).toBe(pool[1]?.key);
    expect(cells[0]?.key).toBe(pool[8]?.key);
  });

  it('第三批只有 2 格其餘 null', () => {
    const pool = favPool();
    const cells = batchCells(pool, 2);
    const filled = cells.filter((c) => c !== null);
    expect(filled).toHaveLength(2);
    const empty = cells.filter((c) => c === null);
    expect(empty).toHaveLength(7);
    expect(cells[4]?.key).toBe(pool[18]?.key);
    expect(cells[1]?.key).toBe(pool[19]?.key);
  });

  it('batchCount(20)=3', () => {
    expect(batchCount(20)).toBe(3);
    expect(batchCount(9)).toBe(1);
    expect(batchCount(10)).toBe(2);
    expect(batchCount(0)).toBe(1);
  });

  it('uidTag 穩定、8 碼 hex、不含原字串', () => {
    const uid = 'user-abc-xyz';
    const tag = uidTag(uid);
    expect(tag).toMatch(/^[0-9a-f]{8}$/);
    expect(uidTag(uid)).toBe(tag);
    expect(tag).not.toContain(uid);
    expect(tag).not.toBe(uid);
  });

  it('isSeenLocal/markSeenLocal', () => {
    try { localStorage.clear(); } catch { /* ignore */ }
    expect(isSeenLocal('u1')).toBe(false);
    markSeenLocal('u1');
    expect(isSeenLocal('u1')).toBe(true);
    expect(isSeenLocal('u2')).toBe(false);
    const raw = localStorage.getItem('fcb:sportPrefsSeen:v1') ?? '';
    expect(raw.includes('u1')).toBe(false);
    expect(raw).toContain(uidTag('u1'));
  });

  it('markSeenLocal 最多保留 20 筆', () => {
    try { localStorage.clear(); } catch { /* ignore */ }
    for (let i = 0; i < 25; i += 1) {
      markSeenLocal(`user-${i}`);
    }
    const raw = localStorage.getItem('fcb:sportPrefsSeen:v1') ?? '[]';
    const arr = JSON.parse(raw) as unknown[];
    expect(arr.length).toBe(20);
  });

  it('isSportPrefsEnabled 讀 runtime-config.json', async () => {
    const origFetch = globalThis.fetch;

    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sportPrefs: true }) })) as unknown as typeof fetch;
    _resetSportPrefsDataForTest();
    expect(await isSportPrefsEnabled()).toBe(true);

    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sportPrefs: false }) })) as unknown as typeof fetch;
    _resetSportPrefsDataForTest();
    expect(await isSportPrefsEnabled()).toBe(false);

    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    _resetSportPrefsDataForTest();
    expect(await isSportPrefsEnabled()).toBe(false);

    globalThis.fetch = vi.fn(async () => { throw new Error('net'); }) as unknown as typeof fetch;
    _resetSportPrefsDataForTest();
    expect(await isSportPrefsEnabled()).toBe(false);

    globalThis.fetch = origFetch;
  });
});

describe('devicePushOn 鍵名', () => {
  it('與 web-push/store 的 WEB_PUSH_STORE_KEY 相同', async () => {
    const store = await import('@/features/profile/web-push/store');
    const data = await import('./data');
    expect(data.WEB_PUSH_RECORD_KEY).toBe(store.WEB_PUSH_STORE_KEY);
  });
});

describe('運動清單與伺服器一致（FC functions/sport-catalog.js 鎖同一份字面；計畫書 §5.2）', () => {
  it('SPORTS 的 key／label 與順序', async () => {
    const { SPORTS } = await import('@/features/events/data/sports');
    expect(SPORTS.map((s) => [s.key, s.label])).toEqual([
      ['football', '足球'],
      ['basketball', '籃球'],
      ['pickleball', '匹克球'],
      ['dodgeball', '美式躲避球'],
      ['restaurant', '餐廳(觀賽)'],
      ['escape_room', '密室逃脫'],
      ['esports', '電玩電競'],
      ['baseball_softball', '棒壘球'],
      ['volleyball', '排球'],
      ['table_tennis', '桌球'],
      ['tennis', '網球'],
      ['badminton', '羽球'],
      ['hiking', '登山'],
      ['running', '慢跑'],
      ['cycling', '單車'],
      ['motorcycle', '重機'],
      ['skateboard', '滑板'],
      ['dance', '舞蹈'],
      ['yoga', '瑜伽'],
      ['martial_arts', '武術'],
      ['other', '其他'],
    ]);
  });
});
