// 站內賽事清單本機快照（顧問 §3.553 條件 1～6）。關鍵判斷拿掉要變紅。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, competition } from '../testing/screen-fixtures';
import { taipeiMs } from '../format';
import { assembleInAppCards, type MineListRow } from './list-cards';
import {
  CP_LIST_SNAPSHOT_FORMAT,
  CP_LIST_SNAPSHOT_KEY,
  CP_LIST_SNAPSHOT_MAX_AGE_MS,
  CP_LIST_SNAPSHOT_MAX_CHARS,
  canReadCpListSnapshot,
  canWriteCpListSnapshot,
  dropForeignCpListSnapshot,
  readCpListSnapshot,
  writeCpListSnapshot,
} from './list-snapshot';
import type { CompetitionDoc } from './types';

const COVER = {
  url: 'https://firebasestorage.googleapis.com/v0/b/demo/o/c%2Fcover.jpg?alt=media',
  thumb: 'https://firebasestorage.googleapis.com/v0/b/demo/o/c%2Fthumb.jpg?alt=media',
};

const pub = competition({
  id: 'pub',
  name: '公開盃',
  category: 'cup',
  cover: COVER,
  contactNote: '聯絡人 0912-000-000',
  notices: [{ id: 'n1', kind: 'info', text: '公告內容', at: NOW } as unknown as CompetitionDoc['notices'][number]],
  liveLinks: ['https://example.com/live'],
  hostDisplay: '示範俱樂部',
});
const internal = competition({ id: 'internal', name: '內部賽', visibility: 'internal' });
const draft = competition({ id: 'draft', name: '草稿賽', status: 'draft', hostTeamId: 'club_a' });
const hidden = competition({ id: 'hidden', name: '下架賽', hidden: true, hiddenAt: NOW });
const deleting = competition({ id: 'deleting', name: '刪除中', deletingAt: NOW });
const nameOnly: MineListRow = { cid: 'old', name: '去年秋季盃', category: 'cup', doc: null };

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(CP_LIST_SNAPSHOT_KEY) ?? 'null') as Record<string, unknown>;
}

function cidsOf(snap: ReturnType<typeof readCpListSnapshot>, now = NOW): string[] {
  if (!snap) return [];
  return assembleInAppCards({ ...snap, now }).map((card) => card.cid).sort();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('條件 1：只存清單卡要用的欄位', () => {
  it('每筆只有卡片欄位；聯絡文字、公告、直播連結、主辦顯示名、場地地址都不在快照裡', () => {
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [], mine: [nameOnly] }, NOW);
    const env = stored();
    expect(Object.keys(env).sort()).toEqual(['names', 'owner', 'rows', 'savedAt', 'scope', 'v']);
    const rows = env.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'category', 'cover', 'deleting', 'endedAt', 'firstMatchAt', 'hidden', 'id', 'lastMatchAt',
      'mine', 'name', 'pub', 'regCloseAt', 'regOpenAt', 'status', 'venue',
    ]);
    const text = localStorage.getItem(CP_LIST_SNAPSHOT_KEY) ?? '';
    for (const secret of ['0912-000-000', '公告內容', 'example.com/live', '示範俱樂部', '示範路', 'place_demo', '報名費']) {
      expect(text).not.toContain(secret);
    }
    expect(env.names).toEqual([{ cid: 'old', name: '去年秋季盃', category: 'cup' }]);
  });

  it('讀回後組出的卡與伺服器文件組出的卡一樣（名稱、分類、日期、場地、封面、我的）', () => {
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [draft], mine: [nameOnly] }, NOW);
    const snap = readCpListSnapshot('uid_a', 'public', NOW);
    const fromSnap = assembleInAppCards({ ...snap!, now: NOW });
    const fromServer = assembleInAppCards({ publicDocs: [pub], hosted: [draft], mine: [nameOnly], now: NOW });
    expect(fromSnap).toEqual(fromServer);
  });
});

describe('條件 2：帳號區隔與訪客過濾', () => {
  it('帳號不符只跳過不刪', () => {
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [], mine: [] }, NOW);
    expect(readCpListSnapshot('uid_b', 'public', NOW)).toBeNull();
    expect(readCpListSnapshot(null, 'public', NOW)).toBeNull();
    expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).not.toBeNull();
    expect(cidsOf(readCpListSnapshot('uid_a', 'public', NOW))).toEqual(['pub']);
  });

  it('範圍不符（內部賽 internal 與一般 public）不用', () => {
    writeCpListSnapshot('uid_admin', 'internal', { publicDocs: [pub, internal], hosted: [], mine: [] }, NOW);
    expect(readCpListSnapshot('uid_admin', 'public', NOW)).toBeNull();
    expect(cidsOf(readCpListSnapshot('uid_admin', 'internal', NOW))).toEqual(['internal', 'pub']);
  });

  it('訪客寫入只留公開、公開狀態、不是我的；只有名稱的我的賽事不存', () => {
    const mineDoc = competition({ id: 'mine_pub', name: '我的公開賽' });
    writeCpListSnapshot(null, 'public', {
      publicDocs: [pub, internal, draft],
      hosted: [mineDoc],
      mine: [nameOnly],
    }, NOW);
    const env = stored();
    expect((env.rows as { id: string }[]).map((row) => row.id)).toEqual(['pub']);
    expect(env.names).toEqual([]);
    expect(env.owner).toBe('guest');
  });

  it('訪客讀出再過一次過濾：被改成內部賽、草稿、我的、名稱列的都不畫', () => {
    writeCpListSnapshot(null, 'public', { publicDocs: [pub], hosted: [], mine: [] }, NOW);
    const env = stored();
    const row = (env.rows as Record<string, unknown>[])[0]!;
    env.rows = [
      row,
      { ...row, id: 'x_internal', pub: false },
      { ...row, id: 'x_draft', status: 'draft' },
      { ...row, id: 'x_mine', mine: true },
    ];
    env.names = [{ cid: 'x_name', name: '名稱列', category: 'cup' }];
    localStorage.setItem(CP_LIST_SNAPSHOT_KEY, JSON.stringify(env));
    expect(cidsOf(readCpListSnapshot(null, 'public', NOW))).toEqual(['pub']);
  });

  it('守門：登入者要確認的帳號相同；訪客在未定或確定沒登入時才讀；寫入要確定', () => {
    expect(canReadCpListSnapshot('uid_a', 'uid_a')).toBe(true);
    expect(canReadCpListSnapshot('uid_a', undefined)).toBe(false);
    expect(canReadCpListSnapshot('uid_a', 'uid_b')).toBe(false);
    expect(canReadCpListSnapshot('uid_a', null)).toBe(false);
    expect(canReadCpListSnapshot(null, undefined)).toBe(true);
    expect(canReadCpListSnapshot(null, null)).toBe(true);
    expect(canReadCpListSnapshot(null, 'uid_a')).toBe(false);
    expect(canWriteCpListSnapshot('uid_a', 'uid_a')).toBe(true);
    expect(canWriteCpListSnapshot('uid_a', undefined)).toBe(false);
    expect(canWriteCpListSnapshot('uid_a', 'uid_b')).toBe(false);
    expect(canWriteCpListSnapshot(null, null)).toBe(true);
    expect(canWriteCpListSnapshot(null, undefined)).toBe(false);
  });
});

describe('條件 3：登出後殘留', () => {
  it('登入狀態確定是別人（含確定沒登入）時刪掉；未定時不刪；同一人不刪', () => {
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [], mine: [] }, NOW);
    dropForeignCpListSnapshot(undefined);
    expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).not.toBeNull();
    dropForeignCpListSnapshot('uid_a');
    expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).not.toBeNull();
    dropForeignCpListSnapshot(null);
    expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).toBeNull();

    writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [], mine: [] }, NOW);
    dropForeignCpListSnapshot('uid_b');
    expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).toBeNull();
  });
});

describe('條件 4：版本、時效、上限、讀寫失敗', () => {
  it('格式版本不是目前版本整份不用（含沒有 v 的）', () => {
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [], mine: [] }, NOW);
    const env = stored();
    localStorage.setItem(CP_LIST_SNAPSHOT_KEY, JSON.stringify({ ...env, v: CP_LIST_SNAPSHOT_FORMAT + 1 }));
    expect(readCpListSnapshot('uid_a', 'public', NOW)).toBeNull();
    const { v: _v, ...noVersion } = env;
    localStorage.setItem(CP_LIST_SNAPSHOT_KEY, JSON.stringify(noVersion));
    expect(readCpListSnapshot('uid_a', 'public', NOW)).toBeNull();
  });

  it('超過 30 分鐘不用；30 分鐘整還用；存的時間在未來一分鐘以上不用', () => {
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [], mine: [] }, NOW);
    expect(readCpListSnapshot('uid_a', 'public', NOW + CP_LIST_SNAPSHOT_MAX_AGE_MS)).not.toBeNull();
    expect(readCpListSnapshot('uid_a', 'public', NOW + CP_LIST_SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
    expect(readCpListSnapshot('uid_a', 'public', NOW - 61_000)).toBeNull();
  });

  it('超過字數上限不存，並刪掉舊的；讀取時太長的直接不用', () => {
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [], mine: [] }, NOW);
    const many = Array.from({ length: 380 }, (_, i) => competition({
      id: `c${i}`, name: '超'.repeat(400), cover: COVER,
    }));
    writeCpListSnapshot('uid_a', 'public', { publicDocs: many, hosted: [], mine: [] }, NOW);
    expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).toBeNull();

    localStorage.setItem(CP_LIST_SNAPSHOT_KEY, 'x'.repeat(CP_LIST_SNAPSHOT_MAX_CHARS + 1));
    expect(readCpListSnapshot('uid_a', 'public', NOW)).toBeNull();
  });

  it('一般大小（50 張都有封面）在上限內', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => competition({ id: `c${i}`, name: `第 ${i} 屆示範盃`, cover: COVER }));
    writeCpListSnapshot('uid_a', 'public', { publicDocs: fifty, hosted: [], mine: [] }, NOW);
    const size = localStorage.getItem(CP_LIST_SNAPSHOT_KEY)?.length ?? 0;
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(CP_LIST_SNAPSHOT_MAX_CHARS / 4);
  });

  it('沒有可存的卡就刪掉舊的', () => {
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [], mine: [] }, NOW);
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [], hosted: [], mine: [] }, NOW);
    expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).toBeNull();
  });

  it('localStorage 丟錯（私密模式、容量滿）一律忽略', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [], mine: [] }, NOW)).not.toThrow();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readCpListSnapshot('uid_a', 'public', NOW)).toBeNull();
    expect(() => dropForeignCpListSnapshot(null)).not.toThrow();
  });

  it('壞掉的 JSON、欄位型別不對的整筆丟掉，封面網址不在白名單就當沒封面', () => {
    localStorage.setItem(CP_LIST_SNAPSHOT_KEY, '{not json');
    expect(readCpListSnapshot('uid_a', 'public', NOW)).toBeNull();
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [], mine: [] }, NOW);
    const env = stored();
    const row = (env.rows as Record<string, unknown>[])[0]!;
    env.rows = [
      { ...row, cover: { url: 'https://evil.example/a.jpg', thumb: 'https://evil.example/b.jpg' } },
      { ...row, id: 'bad_time', firstMatchAt: 'soon' },
      { ...row, id: 'bad_flag', mine: 'yes' },
      { ...row, id: '' },
    ];
    localStorage.setItem(CP_LIST_SNAPSHOT_KEY, JSON.stringify(env));
    const cards = assembleInAppCards({ ...readCpListSnapshot('uid_a', 'public', NOW)!, now: NOW });
    expect(cards.map((card) => card.cid)).toEqual(['pub']);
    expect(cards[0]!.thumb).toBe('');
    expect(cards[0]!.cover).toBe('');
  });
});

describe('條件 5：下架、刪除中不帶入', () => {
  it('寫入時不存下架與刪除中（登入者的我的賽事也一樣）', () => {
    writeCpListSnapshot('uid_a', 'internal', {
      publicDocs: [pub],
      hosted: [hidden, deleting],
      mine: [{ cid: 'hidden', name: '下架賽', category: 'league', doc: hidden }],
    }, NOW);
    expect((stored().rows as { id: string }[]).map((row) => row.id)).toEqual(['pub']);
  });

  it('讀出時再擋一次（快照被改成下架或刪除中的不畫）', () => {
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [pub], hosted: [], mine: [] }, NOW);
    const env = stored();
    const row = (env.rows as Record<string, unknown>[])[0]!;
    env.rows = [row, { ...row, id: 'x_hidden', hidden: true }, { ...row, id: 'x_del', deleting: true }];
    localStorage.setItem(CP_LIST_SNAPSHOT_KEY, JSON.stringify(env));
    expect(cidsOf(readCpListSnapshot('uid_a', 'public', NOW))).toEqual(['pub']);
  });
});

describe('條件 6：狀態字用讀取當下的時間重算，當日摘要不存', () => {
  it('存的時候是預熱中，讀的時候首場已到 → 進行中，而且沒有今天場數重點句', () => {
    const first = taipeiMs(2026, 12, 10, 12, 10);
    const warmDoc = competition({
      id: 'w', name: '快開賽', regCloseAt: taipeiMs(2026, 12, 9, 23, 59), firstMatchAt: first, lastMatchAt: first + 86_400_000,
    });
    writeCpListSnapshot('uid_a', 'public', { publicDocs: [warmDoc], hosted: [], mine: [] }, NOW);
    expect(assembleInAppCards({ publicDocs: [warmDoc], hosted: [], mine: [], now: NOW })[0]!.phase).toBe('warm');
    const later = first + 5 * 60_000;
    const [card] = assembleInAppCards({ ...readCpListSnapshot('uid_a', 'public', later)!, now: later });
    expect(card!.phase).toBe('live');
    expect(card!.line).toBeNull();
    expect(localStorage.getItem(CP_LIST_SNAPSHOT_KEY)).not.toMatch(/"(line|count|time|today)"/);
  });
});
