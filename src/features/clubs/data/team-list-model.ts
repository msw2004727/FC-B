/**
 * 俱樂部列表純函式（移植 A `js/modules/team/team-list-*`）。
 *
 * 契約：
 * - 純函式；不讀 DOM、不讀全域 App / ApiService / cache。
 * - 輸入以參數物件傳入；輸出為型別化資料，HTML 由 UI 產生。
 * - 分類文案為 i18n key（club.category.*），不寫死中文。
 * - 排序規則完全對齊 A `_sortTeams`：置頂 → pinOrder → name localeCompare。
 */

import type {
  TeamCategoryKey,
  TeamCategoryOption,
  TeamDoc,
} from './types';

export interface TeamUserLike {
  uid?: string;
  _docId?: string;
  teamIds?: unknown;
  teamId?: unknown;
}

/* ── 使用者與隊伍身分 ────────────────────────────── */

/**
 * A `_getUserTeamIds`（team-list.js:23-36 / team-list-helpers.js:98-111）。
 * 合併 teamIds 陣列與 legacy teamId 純量，trim 並去重（不排序）。
 */
export function getUserTeamIds(user: TeamUserLike | null | undefined): string[] {
  if (!user) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: unknown): void => {
    const value = String(id ?? '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    ids.push(value);
  };
  if (Array.isArray(user.teamIds)) user.teamIds.forEach(push);
  push(user.teamId);
  return ids;
}

/**
 * A `_isUserInTeam`（team-list.js:38-41 / team-list-helpers.js:113-116）。
 */
export function isUserInTeam(
  user: TeamUserLike | null | undefined,
  teamId: string | null | undefined,
): boolean {
  if (!user || !teamId) return false;
  return getUserTeamIds(user).includes(String(teamId));
}

/* ── 分類 ────────────────────────────────────────── */

/**
 * A `_normalizeTeamCategory`（team-list-helpers.js:321-327）。
 * A 原值 → 標準 key：
 *   none/no/untagged → 'none'
 *   education/teaching → 'education'
 *   leisure/casual/recreational → 'leisure'
 *   其他 → 'competitive'
 */
export function normalizeTeamCategory(type: unknown): TeamCategoryKey {
  const key = String(type ?? '').trim().toLowerCase();
  if (key === 'none' || key === 'no' || key === 'untagged') return 'none';
  if (key === 'education' || key === 'teaching') return 'education';
  if (key === 'leisure' || key === 'casual' || key === 'recreational') return 'leisure';
  return 'competitive';
}

/**
 * A `_getTeamCategoryOptions`（team-list-helpers.js:276-319）。
 *
 * A 原文（僅註解保留；不得寫死於輸出）：
 *   none        label='無'   hint='不顯示任何標籤與緞帶，也不啟用課程功能。'
 *   competitive label='競技' hint='競技標籤只作為俱樂部分類，賽事系統設定已預留。'
 *   education   label='教學' hint='教學標籤會啟用課程、學員與待審核功能。'
 *   leisure     label='休閒' hint='休閒標籤只作為俱樂部分類，未來可銜接友誼賽或休閒賽事設定。'
 *
 * 回傳型別為「非空 tuple」，使呼叫端以 index 取得首項時不需再判空。
 */
const CATEGORY_OPTIONS: readonly [TeamCategoryOption, ...TeamCategoryOption[]] = [
  {
    key: 'none',
    labelKey: 'clubs.category.none',
    formHintKey: 'clubs.category.none.hint',
    ribbonClass: '',
    pillClass: '',
    showEduSettings: false,
    coursesEnabled: false,
    tournamentSettingsReserved: false,
  },
  {
    key: 'competitive',
    labelKey: 'clubs.category.competitive',
    formHintKey: 'clubs.category.competitive.hint',
    ribbonClass: 'tc-type-ribbon-competitive',
    pillClass: 'td-category-pill-competitive',
    showEduSettings: false,
    coursesEnabled: false,
    tournamentSettingsReserved: true,
  },
  {
    key: 'education',
    labelKey: 'clubs.category.education',
    formHintKey: 'clubs.category.education.hint',
    ribbonClass: 'tc-type-ribbon-education',
    pillClass: 'td-category-pill-education',
    showEduSettings: true,
    coursesEnabled: true,
    tournamentSettingsReserved: false,
  },
  {
    key: 'leisure',
    labelKey: 'clubs.category.leisure',
    formHintKey: 'clubs.category.leisure.hint',
    ribbonClass: 'tc-type-ribbon-leisure',
    pillClass: 'td-category-pill-leisure',
    showEduSettings: false,
    coursesEnabled: false,
    tournamentSettingsReserved: true,
  },
];

export function getTeamCategoryOptions(): readonly [TeamCategoryOption, ...TeamCategoryOption[]] {
  return CATEGORY_OPTIONS;
}

/**
 * A `_isTeamTeachingTagged`（team-list-helpers.js:263-274）。
 * 優先序：
 *   1. teachingEnabled === true → true
 *   2. teachingEnabled === false → false
 *   3. isTeaching === true 或 educationTag === true → true
 *   4. eduSettings.teachingEnabled === true → true
 *   5. eduSettings.teachingEnabled === false → false
 *   6. fallback: type === 'education'
 */
export function isTeamTeachingTagged(team: TeamDoc | null | undefined): boolean {
  if (!team) return false;
  if (team.teachingEnabled === true) return true;
  if (team.teachingEnabled === false) return false;
  if (team.isTeaching === true || team.educationTag === true) return true;
  if (team.eduSettings?.teachingEnabled === true) return true;
  if (team.eduSettings?.teachingEnabled === false) return false;
  return team.type === 'education';
}

function getTeamTypeMeta(type: unknown): TeamCategoryOption {
  const normalized = normalizeTeamCategory(type);
  for (const opt of CATEGORY_OPTIONS) {
    if (opt.key === normalized) return opt;
  }
  // Unreachable — normalizeTeamCategory 保證回傳合法 key；此分支僅為 TS 收斂。
  return CATEGORY_OPTIONS[0];
}

/**
 * A `_getTeamCategoryMeta`（team-list-helpers.js:335-346）。
 * String 參數走「純 normalize」路徑；物件參數優先看 teaching tag。
 */
export function getTeamCategoryMeta(
  teamOrType: TeamDoc | string | null | undefined,
): TeamCategoryOption {
  if (teamOrType && typeof teamOrType === 'object') {
    const team = teamOrType;
    if (isTeamTeachingTagged(team)) return getTeamTypeMeta('education');
    const teachingOff =
      team.teachingEnabled === false || team.eduSettings?.teachingEnabled === false;
    const typeIsUnsetOrEducation = !team.type || team.type === 'education';
    if (teachingOff && typeIsUnsetOrEducation) return getTeamTypeMeta('competitive');
    return getTeamTypeMeta(team.type);
  }
  return getTeamTypeMeta(typeof teamOrType === 'string' ? teamOrType : '');
}

/* ── 篩選 ────────────────────────────────────────── */

export interface FilterTeamsParams {
  /** 關鍵字（trim + lowercase）；比對 name / nameEn / captain / leader。 */
  query?: string;
  /** 精確比對 region。 */
  region?: string;
  /** 精確比對 sportTag。 */
  sportTag?: string;
  /** 類型分頁（會被 normalizeTeamCategory 正規化）。 */
  typeTab?: string | null;
  /**
   * 是否過濾停用。
   * A 於呼叫端以 `ApiService.getActiveTeams()` 預先過濾；
   * B 的資料層改為參數，預設 true（僅過濾 active === false，保留 undefined）。
   */
  hideInactive?: boolean;
}

/**
 * A `_doFilterTeams`（team-list.js:150-197）核心條件；輸入改為參數物件。
 * DOM、toast、HTML 產生不在本層。
 */
export function filterTeams(
  teams: readonly TeamDoc[],
  params: FilterTeamsParams = {},
): TeamDoc[] {
  const query = String(params.query ?? '').trim().toLowerCase();
  const region = String(params.region ?? '');
  const sportTag = String(params.sportTag ?? '');
  const typeTab = params.typeTab ?? '';
  const hideInactive = params.hideInactive !== false;

  let filtered: readonly TeamDoc[] = teams;

  // 照 A ApiService.getActiveTeams：`t.active` 為真才算啟用，缺欄位也視為停用。
  if (hideInactive) {
    filtered = filtered.filter((t) => !!t.active);
  }

  if (query) {
    filtered = filtered.filter((t) => {
      const name = String(t.name ?? '').toLowerCase();
      const nameEn = String(t.nameEn ?? '').toLowerCase();
      const captain = String(t.captain ?? '').toLowerCase();
      const leader = String(t.leader ?? '').toLowerCase();
      return (
        name.includes(query) ||
        nameEn.includes(query) ||
        captain.includes(query) ||
        leader.includes(query)
      );
    });
  }

  if (region) filtered = filtered.filter((t) => t.region === region);
  if (sportTag) filtered = filtered.filter((t) => t.sportTag === sportTag);

  if (typeTab) {
    const target = normalizeTeamCategory(typeTab);
    filtered = filtered.filter((t) => getTeamCategoryMeta(t).key === target);
  }

  return [...filtered];
}

/* ── 排序與等級 ──────────────────────────────────── */

/**
 * A `_sortTeams`（team-list-stats.js:131-138）。
 * 置頂優先；皆置頂時依 pinOrder 升冪（無值視為 0）；否則 name.localeCompare（預設語系）。
 */
export function sortTeams(teams: readonly TeamDoc[]): TeamDoc[] {
  return [...teams].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (a.pinned && b.pinned) return (a.pinOrder ?? 0) - (b.pinOrder ?? 0);
    return String(a.name ?? '').localeCompare(String(b.name ?? ''));
  });
}

interface TeamRankConfigEntry {
  min: number;
  rank: string;
  color: string;
}

// A js/config.js TEAM_RANK_CONFIG（原樣搬入；`max` 只供顯示，查表只用 min）。
// `getTeamRank` 由尾端往前找第一個 `exp >= min` 的條目；最後 fallback `{ rank: 'E' }`。
const TEAM_RANK_CONFIG: readonly TeamRankConfigEntry[] = [
  { min: 0, rank: 'E', color: '#6b7280' },
  { min: 1000, rank: 'D', color: '#22c55e' },
  { min: 2000, rank: 'C', color: '#3b82f6' },
  { min: 3000, rank: 'B', color: '#8b5cf6' },
  { min: 4000, rank: 'A', color: '#f59e0b' },
  { min: 5000, rank: 'A+', color: '#f97316' },
  { min: 6000, rank: 'A++', color: '#ef4444' },
  { min: 7000, rank: 'S', color: '#ec4899' },
  { min: 8000, rank: 'SS', color: '#14b8a6' },
  { min: 9000, rank: 'SSS', color: '#dc2626' },
];

export interface TeamRank {
  rank: string;
  color: string;
}

/** A `_getTeamRank`（team-list-stats.js:122-129）。 */
export function getTeamRank(teamExp: number | null | undefined): TeamRank {
  const exp = teamExp ?? 0;
  for (let i = TEAM_RANK_CONFIG.length - 1; i >= 0; i -= 1) {
    const cfg = TEAM_RANK_CONFIG[i];
    if (!cfg) continue;
    if (exp >= cfg.min) return { rank: cfg.rank, color: cfg.color };
  }
  return { rank: 'E', color: '#6b7280' };
}

/* ── 封面與主題色 ────────────────────────────────── */

function getTeamImageUrl(
  team: TeamDoc | null | undefined,
  variant: string,
): string {
  const variants = team?.imageVariants;
  if (!variants || typeof variants !== 'object') return '';
  const value = (variants as Record<string, unknown>)[variant];
  return typeof value === 'string' ? value : '';
}

/**
 * A `_getTeamCoverImageUrl`（team-list-helpers.js:54-60）。
 * 優先序：imageVariants[variantKey] > image > coverImage > （default，此層無）。
 */
export function getTeamCoverImageUrl(
  team: TeamDoc | null | undefined,
  variantKey: string = 'cover',
): string {
  return (
    getTeamImageUrl(team, variantKey) ||
    team?.image ||
    team?.coverImage ||
    ''
  );
}

/**
 * A `_normalizeTeamThemeColor`（team-list-helpers.js 未列；由 `_getTeamThemeColor` 呼叫）。
 * ASSUMPTION: 沿用 `#RRGGBB` 驗證；與 `_normalizeTeamAttentionColor` 同一型式。
 * 無效值回空字串（A `_getTeamThemeColor` 對無值回 ''）。
 */
export function normalizeTeamThemeColor(value: unknown): string {
  const raw = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : '';
}

/** A `_getTeamThemeColor`（team-list-helpers.js:28-30）。 */
export function getTeamThemeColor(team: TeamDoc | null | undefined): string {
  return normalizeTeamThemeColor(team?.themeColor);
}
