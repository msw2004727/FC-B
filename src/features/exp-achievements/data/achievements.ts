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
  target?: number;
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

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
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

// 照 A shared.js#getThreshold。
export function getAchThreshold(a: AchievementDef): number {
  const threshold = a.condition?.['threshold'];
  if (threshold != null) {
    const num = Number(threshold);
    // ASSUMPTION: 文件值若為數字字串，Number() 與 A 後續比較一致；非有限值退回 target。
    if (Number.isFinite(num)) return num;
  }
  if (a.target != null) return a.target;
  return 1;
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
    target: asFiniteNumber(data['target']),
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
    // 照 A：讀取失敗只警告，回空資料。
    // eslint-disable-next-line no-console
    console.warn('[achievements] loadUserAchievementProgress failed', err);
    return {};
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
    // ASSUMPTION: A 無對應讀取函式；失敗時回空清單讓 UI 顯示尚無成就。
    // eslint-disable-next-line no-console
    console.warn('[achievements] loadAchievementDefs failed', err);
    return { achievements: [], badges: [] };
  }
}
