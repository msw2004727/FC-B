import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/preact';

import {
  buildTitleParts,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  evaluateFromProgress,
  getAchThreshold,
  getEarnedBadges,
  getTitleOptions,
  isSupportedCondition,
  loadAchievementDefs,
  loadUserAchievementProgress,
  splitPendingCompleted,
  type AchievementDef,
  type BadgeDef,
  type EvaluatedAchievement,
} from './achievements';

describe('getAchThreshold（照 A stats.js）', () => {
  it('threshold 非數值時不比對 target，視為未完成', () => {
    const ach: AchievementDef = {
      id: 'a1',
      name: 'A1',
      category: 'bronze',
      condition: { action: 'register_event', threshold: 'invalid' },
      target: 1,
    };
    const [ev] = evaluateFromProgress([ach], {
      a1: { current: 1, completedAt: null },
    });
    expect(ev?.done).toBe(false);
  });

  it('數字字串 target 照 A 以 Number() 比較', () => {
    const ach: AchievementDef = {
      id: 'a2',
      name: 'A2',
      category: 'bronze',
      condition: { action: 'register_event' },
      target: '2',
    };
    const [ev] = evaluateFromProgress([ach], {
      a2: { current: 2, completedAt: null },
    });
    expect(ev?.done).toBe(true);
  });
});

const f = vi.hoisted(() => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  addDoc: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('firebase/firestore', () => f);
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { __mock: true } })),
}));

interface MockDoc {
  id: string;
  data: () => Record<string, unknown>;
}

function makeSnap(docs: MockDoc[]): { docs: MockDoc[] } {
  return { docs };
}

function achievement(overrides: Partial<AchievementDef> = {}): AchievementDef {
  return { id: 'a1', name: '測試成就', category: 'bronze', ...overrides };
}

function evaluated(overrides: Partial<EvaluatedAchievement> = {}): EvaluatedAchievement {
  return {
    id: 'a1',
    name: '測試成就',
    category: 'bronze',
    current: 0,
    completedAt: null,
    threshold: 1,
    done: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  f.collection.mockReset();
  f.getDocs.mockReset();
  f.collection.mockImplementation((_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }));
});

afterEach(() => {
  cleanup();
});

describe('getAchThreshold', () => {
  it('condition.threshold 優先，0 也保留', () => {
    expect(getAchThreshold(achievement({ condition: { threshold: 0 }, target: 5 }))).toBe(0);
  });

  it('沒有 condition.threshold 時用 target', () => {
    expect(getAchThreshold(achievement({ target: 7 }))).toBe(7);
  });

  it('兩者都沒有時為 1', () => {
    expect(getAchThreshold(achievement())).toBe(1);
  });
});

describe('isSupportedCondition', () => {
  it('支援的 action 與 none 時段', () => {
    expect(isSupportedCondition({ action: 'register_event', timeRange: 'none' })).toBe(true);
    expect(isSupportedCondition({ action: 'register_event' })).toBe(true);
  });

  it('不支援的 action 或時段回 false', () => {
    expect(isSupportedCondition({ action: 'list_shop_item', timeRange: 'none' })).toBe(false);
    expect(isSupportedCondition({ action: 'register_event', timeRange: '7d' })).toBe(false);
    expect(isSupportedCondition(undefined)).toBe(false);
  });
});

describe('evaluateFromProgress', () => {
  it('排除 archived／不支援條件，合併進度並排序', () => {
    const defs: AchievementDef[] = [
      achievement({
        id: 'a2',
        name: '銀',
        category: 'silver',
        condition: { action: 'complete_event', timeRange: 'none' },
        target: 3,
      }),
      achievement({
        id: 'a1',
        name: '金',
        category: 'gold',
        condition: { action: 'register_event', timeRange: 'none', threshold: 1 },
      }),
      achievement({
        id: 'a3',
        name: '歸檔',
        category: 'gold',
        status: 'archived',
        condition: { action: 'register_event' },
      }),
      achievement({ id: 'a4', name: '不支援', condition: { action: 'list_shop_item' } }),
    ];

    const result = evaluateFromProgress(defs, {
      a1: { current: 1, completedAt: '2024-01-01' },
      a2: { current: 2, completedAt: null },
    });

    expect(result.map((item) => item.id)).toEqual(['a1', 'a2']);
    expect(result[0]).toMatchObject({
      current: 1,
      threshold: 1,
      done: true,
      completedAt: '2024-01-01',
    });
    expect(result[1]).toMatchObject({ current: 2, threshold: 3, done: false });
  });

  it('reverseComparison 以 current <= threshold 判斷完成', () => {
    const def = achievement({
      id: 'n',
      condition: { action: 'no_show_free', timeRange: 'none', threshold: 0 },
    });

    expect(evaluateFromProgress([def], { n: { current: 0, completedAt: null } })[0]?.done).toBe(
      true,
    );
    expect(evaluateFromProgress([def], { n: { current: 1, completedAt: null } })[0]?.done).toBe(
      false,
    );
  });
});

describe('splitPendingCompleted', () => {
  it('依 done 分組', () => {
    const list = [evaluated({ id: 'a', done: true }), evaluated({ id: 'b', done: false })];
    const result = splitPendingCompleted(list);
    expect(result.completed.map((item) => item.id)).toEqual(['a']);
    expect(result.pending.map((item) => item.id)).toEqual(['b']);
  });
});

describe('getEarnedBadges', () => {
  it('以 badge.achId 對應完成成就並取分類色', () => {
    const completed = [evaluated({ id: 'a1', name: '金成就', category: 'gold', done: true })];
    const badges: BadgeDef[] = [{ id: 'b1', name: '徽章', achId: 'a1' }];

    const result = getEarnedBadges(completed, badges);

    expect(result).toHaveLength(1);
    expect(result[0]?.badge.id).toBe('b1');
    expect(result[0]?.color).toBe(CATEGORY_COLORS['gold']);
  });
});

describe('getTitleOptions / buildTitleParts', () => {
  const list = [
    evaluated({ id: 'g', name: '金稱號', category: 'gold', done: true }),
    evaluated({ id: 's', name: '銀稱號', category: 'silver', done: true }),
    evaluated({ id: 'p', name: '未完成', category: 'gold', done: false }),
  ];

  it('只取已完成，gold 進 big', () => {
    expect(getTitleOptions(list)).toEqual({ big: ['金稱號'], normal: ['銀稱號'] });
  });

  it('只接受已取得的稱號', () => {
    expect(buildTitleParts({ titleBig: '金稱號', titleNormal: '銀稱號' }, list)).toEqual({
      big: '金稱號',
      normal: '銀稱號',
    });
    expect(buildTitleParts({ titleBig: '未完成', titleNormal: '不存在' }, list)).toEqual({
      big: null,
      normal: null,
    });
  });

  it('分類文字與顏色照 A', () => {
    expect(CATEGORY_LABELS['gold']).toBe('金');
    expect(CATEGORY_COLORS['bronze']).toBe('#b87333');
  });
});

describe('讀取', () => {
  it('loadAchievementDefs 只讀 achievements 與 badges，不呼叫寫入', async () => {
    f.getDocs.mockImplementation(async (ref: unknown) => {
      const path = (ref as { path?: string }).path;
      if (path === 'achievements') {
        return makeSnap([
          {
            id: 'a1',
            data: () => ({
              name: '初心者',
              category: 'bronze',
              condition: { action: 'register_event', timeRange: 'none' },
            }),
          },
        ]);
      }
      if (path === 'badges') {
        return makeSnap([{ id: 'b1', data: () => ({ name: '新手徽章', achId: 'a1', image: null }) }]);
      }
      return makeSnap([]);
    });

    const result = await loadAchievementDefs();

    expect(f.collection).toHaveBeenCalledWith({ __mock: true }, 'achievements');
    expect(f.collection).toHaveBeenCalledWith({ __mock: true }, 'badges');
    expect(result.achievements).toHaveLength(1);
    expect(result.achievements[0]).toMatchObject({
      id: 'a1',
      name: '初心者',
      category: 'bronze',
    });
    expect(result.badges).toHaveLength(1);
    expect(result.badges[0]).toMatchObject({
      id: 'b1',
      name: '新手徽章',
      achId: 'a1',
      image: null,
    });
    expect(f.setDoc).not.toHaveBeenCalled();
    expect(f.updateDoc).not.toHaveBeenCalled();
    expect(f.addDoc).not.toHaveBeenCalled();
    expect(f.writeBatch).not.toHaveBeenCalled();
  });

  it('loadUserAchievementProgress 讀 users/{uid}/achievements，key 用 achId || doc.id', async () => {
    f.getDocs.mockImplementation(async () =>
      makeSnap([
        { id: 'doc1', data: () => ({ achId: 'a1', current: 3, completedAt: '2024-01-01' }) },
        { id: 'doc2', data: () => ({ current: 1, completedAt: null }) },
      ]),
    );

    const result = await loadUserAchievementProgress('u1');

    expect(f.collection).toHaveBeenCalledWith({ __mock: true }, 'users', 'u1', 'achievements');
    expect(result).toEqual({
      a1: { current: 3, completedAt: '2024-01-01' },
      doc2: { current: 1, completedAt: null },
    });
    expect(f.setDoc).not.toHaveBeenCalled();
    expect(f.updateDoc).not.toHaveBeenCalled();
    expect(f.addDoc).not.toHaveBeenCalled();
    expect(f.writeBatch).not.toHaveBeenCalled();
  });
});
