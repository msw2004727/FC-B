// 成就資料層：只讀 achievements／badges 與 users/{uid}/achievements。
// 進度計算與寫入屬 A evaluator 鎖定域，B 不重算、不回寫。
// 對應 A：achievement/registry.js、achievement/shared.js、achievement/stats.js、
//        profile/profile-data-stats.js#_buildTitleDisplay。

import { getFirebase } from '@/data/firebase';

export type AchCategory = 'bronze' | 'silver' | 'gold' | string;

export interface AchievementDef {
  id: string;
  name: string;
  category: AchCategory;
  badgeId?: string;
  status?: string;
  condition?: Record<string, unknown>;
  target?: number | string;
  desc?: string;
}

export interface BadgeDef {
  id: string;
  name: string;
  image?: string | null;
  achId?: string;
  category?: string;
}

export interface EvaluatedAchievement extends AchievementDef {
  current: number;
  completedAt: unknown;
  threshold: number;
  done: boolean;
}

// 照 A shared.js categoryColor／categoryLabel 逐字。
export const CATEGORY_COLORS: Record<string, string> = {
  gold: '#d4a017',
  silver: '#9ca3af',
  bronze: '#b87333',
};

export const CATEGORY_LABELS: Record<string, string> = {
  gold: '金',
  silver: '銀',
  bronze: '銅',
};

const DEFAULT_CATEGORY_COLOR = '#b87333';

// 照 A registry.js actionMetaMap 中 supported: true 的 action 清單。
const SUPPORTED_ACTIONS: ReadonlySet<string> = new Set([
  'register_event',
  'complete_event',
  'attend_play',
  'attend_friendly',
  'attend_camp',
  'attend_watch',
  'attendance_rate',
  'reach_level',
  'reach_exp',
  'join_team',
  'complete_profile',
  'bind_line_notify',
  'days_registered',
  'organize_event',
  'diverse_sports',
  'no_show_free',
  'create_team',
  'bring_companion',
  'team_member_count',
  'early_event',
  'night_event',
  'shop_trade',
  'game_play',
  'game_high_score',
  'role_coach',
  'role_captain',
  'role_venue_owner',
  'role_admin',
  'role_super_admin',
  'manual_award',
]);

// 照 A registry.js timeRangeMetaMap：僅 none 為 supported。
const SUPPORTED_TIME_RANGES: ReadonlySet<string> = new Set(['none']);

// 照 A registry.js actionMetaMap.reverseComparison（目前僅 no_show_free）。
const REVERSE_COMPARISON_ACTIONS: ReadonlySet<string> = new Set(['no_show_free']);

const CATEGORY_ORDER: Record<string, number> = { gold: 0, silver: 1, bronze: 2 };

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumberOrString(value: unknown): number | string | undefined {
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

function toSafeNumber(value: unknown): number {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || DEFAULT_CATEGORY_COLOR;
}

function isReverseComparison(condition: Record<string, unknown> | undefined): boolean {
  return REVERSE_COMPARISON_ACTIONS.has(normalizeString(condition?.['action']));
}

function sortByCategory(items: EvaluatedAchievement[]): EvaluatedAchievement[] {
  return [...items].sort(
    (a, b) => (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9),
  );
}

// 照 A stats.js#getThreshold：condition.threshold ?? target ?? 1，交給 Number() 比較。
// 非有限數字（含 'invalid'）會得到 NaN，後續比較為 false，不回退 target。
export function getAchThreshold(a: AchievementDef): number {
  const rawThreshold = a.condition?.['threshold'] ?? a.target ?? 1;
  return Number(rawThreshold);
}

// 照 A registry.js#isSupportedCondition。
export function isSupportedCondition(condition: unknown): boolean {
  const safe = asRecord(condition);
  const action = normalizeString(safe['action']);
  const timeRange = normalizeString(safe['timeRange'] || 'none') || 'none';
  return SUPPORTED_ACTIONS.has(action) && SUPPORTED_TIME_RANGES.has(timeRange);
}

function isCompleted(
  achievement: AchievementDef,
  current: number,
  threshold: number,
): boolean {
  // 照 A stats.js#isCompleted。
  const reverse = isReverseComparison(achievement.condition);
  const safeThreshold = reverse ? threshold : Math.max(1, threshold);
  const currentNum = Number(current || 0);
  return reverse ? currentNum <= safeThreshold : currentNum >= safeThreshold;
}

// 照 A stats.js#getActiveAchievements + evaluator 合併 progress。
export function evaluateFromProgress(
  defs: AchievementDef[],
  progress: Record<string, { current: number; completedAt: unknown }>,
): EvaluatedAchievement[] {
  const active = defs.filter(
    (achievement) =>
      achievement.status !== 'archived' && isSupportedCondition(achievement.condition),
  );

  const evaluated = active.map((achievement) => {
    const saved = progress[achievement.id];
    const current = saved?.current ?? 0;
    const threshold = getAchThreshold(achievement);
    return {
      ...achievement,
      current,
      completedAt: saved?.completedAt ?? null,
      threshold,
      done: isCompleted(achievement, current, threshold),
    };
  });

  return sortByCategory(evaluated);
}

// 照 A stats.js#getCompletedAchievements／getPendingAchievements。
export function splitPendingCompleted(list: EvaluatedAchievement[]): {
  pending: EvaluatedAchievement[];
  completed: EvaluatedAchievement[];
} {
  return {
    pending: list.filter((achievement) => !achievement.done),
    completed: list.filter((achievement) => achievement.done),
  };
}

// 照 A stats.js#getEarnedBadgeViewModels。
export function getEarnedBadges(
  completed: EvaluatedAchievement[],
  badges: BadgeDef[],
): { badge: BadgeDef; color: string; achievement: EvaluatedAchievement }[] {
  const completedMap = new Map(completed.map((achievement) => [achievement.id, achievement]));
  const result: { badge: BadgeDef; color: string; achievement: EvaluatedAchievement }[] = [];
  for (const badge of badges) {
    const achievement = badge.achId ? completedMap.get(badge.achId) : undefined;
    if (!achievement) continue;
    const category = achievement.category || badge.category || 'bronze';
    result.push({ badge, color: getCategoryColor(category), achievement });
  }
  return result;
}

// 照 A stats.js#getTitleOptions。
export function getTitleOptions(list: EvaluatedAchievement[]): {
  big: string[];
  normal: string[];
} {
  const big: string[] = [];
  const normal: string[] = [];
  for (const achievement of list) {
    if (!achievement.done) continue;
    if (achievement.category === 'gold') big.push(achievement.name);
    else normal.push(achievement.name);
  }
  return { big, normal };
}

// 照 A profile-data-stats.js#_buildTitleDisplay 的 safeBig／safeNormal。
export function buildTitleParts(
  user: { titleBig?: unknown; titleNormal?: unknown },
  list: EvaluatedAchievement[],
): { big: string | null; normal: string | null } {
  const availableBigTitles = new Set(
    list
      .filter((achievement) => achievement.done && achievement.category === 'gold')
      .map((achievement) => achievement.name),
  );
  const availableNormalTitles = new Set(
    list
      .filter((achievement) => achievement.done && achievement.category !== 'gold')
      .map((achievement) => achievement.name),
  );
  const big =
    typeof user.titleBig === 'string' && availableBigTitles.has(user.titleBig)
      ? user.titleBig
      : null;
  const normal =
    typeof user.titleNormal === 'string' && availableNormalTitles.has(user.titleNormal)
      ? user.titleNormal
      : null;
  return { big, normal };
}

interface SnapshotLike {
  docs: { id: string; data: () => Record<string, unknown> }[];
}

function toAchievementDef(id: string, data: Record<string, unknown>): AchievementDef {
  const rawCondition = data['condition'];
  const condition =
    rawCondition && typeof rawCondition === 'object' && !Array.isArray(rawCondition)
      ? (rawCondition as Record<string, unknown>)
      : undefined;
  return {
    id,
    name: asString(data['name']) ?? '',
    category: asString(data['category']) ?? '',
    badgeId: asString(data['badgeId']),
    status: asString(data['status']),
    condition,
    target: asNumberOrString(data['target']),
    desc: asString(data['desc']),
  };
}

function toBadgeDef(id: string, data: Record<string, unknown>): BadgeDef {
  return {
    id,
    name: asString(data['name']) ?? '',
    image: data['image'] === null ? null : asString(data['image']),
    achId: asString(data['achId']),
    category: asString(data['category']),
  };
}

// 照 A firebase-crud.js#loadUserAchievementProgress（只讀）。
export async function loadUserAchievementProgress(
  uid: string,
): Promise<Record<string, { current: number; completedAt: unknown }>> {
  const targetUid = String(uid || '').trim();
  if (!targetUid || targetUid.includes('/')) return {};

  try {
    const [{ collection, getDocs }, { db }] = await Promise.all([
      import('firebase/firestore'),
      getFirebase(),
    ]);
    const snap = (await getDocs(
      collection(db, 'users', targetUid, 'achievements'),
    )) as unknown as SnapshotLike;
    const progress: Record<string, { current: number; completedAt: unknown }> = {};
    for (const doc of snap.docs) {
      const data = asRecord(doc.data());
      const key = asString(data['achId']) || doc.id;
      progress[key] = {
        current: toSafeNumber(data['current']),
        completedAt: data['completedAt'] ?? null,
      };
    }
    return progress;
  } catch (err) {
    // 讀取失敗必須拋出，讓呼叫端區分「成功空資料」與「失敗」。
    // eslint-disable-next-line no-console
    console.warn('[achievements] loadUserAchievementProgress failed', err);
    throw err;
  }
}

// 讀取 achievements／badges 兩個集合（只讀）。
export async function loadAchievementDefs(): Promise<{
  achievements: AchievementDef[];
  badges: BadgeDef[];
}> {
  try {
    const [{ collection, getDocs }, { db }] = await Promise.all([
      import('firebase/firestore'),
      getFirebase(),
    ]);
    const [achSnap, badgeSnap] = await Promise.all([
      getDocs(collection(db, 'achievements')) as unknown as Promise<SnapshotLike>,
      getDocs(collection(db, 'badges')) as unknown as Promise<SnapshotLike>,
    ]);
    return {
      achievements: achSnap.docs.map((doc) => toAchievementDef(doc.id, asRecord(doc.data()))),
      badges: badgeSnap.docs.map((doc) => toBadgeDef(doc.id, asRecord(doc.data()))),
    };
  } catch (err) {
    // 讀取失敗必須拋出，讓呼叫端區分「成功空資料」與「失敗」。
    // eslint-disable-next-line no-console
    console.warn('[achievements] loadAchievementDefs failed', err);
    throw err;
  }
}
