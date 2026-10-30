/**
 * 後台「用戶管理」純函式層（M-142）。對應 A `js/modules/user-admin/user-admin-list.js`：
 * 篩選語意（_applyAdminUserFilters／_matchesAdminUserDayRange）、權限判斷（_canXxx）、
 * 可指派角色（_getAssignableRoleKeys）、編輯差異（saveUserEdit 的 updates）。
 *
 * 不碰 Firestore、不碰 DOM；按鈕顯示（元件）與送出守衛（admin-users.ts 的 manageAdminUser）共用同一組判斷（R-IAM-011）。
 */
import { formatTaipei, parseTaipei } from '@/core/taipei-time';
import {
  BASE_ROLES,
  getRuntimeRoleLevel,
  getRuntimeRoleSequence,
  type CustomRoleInput,
} from '@/ui/drawer-menu';

export const ADMIN_USER_PAGE_SIZE = 30;
const DAY_MS = 86_400_000;

/** 權限碼（與 A／Functions 一致；不得改名，R-IAM-007）。 */
export const PERM_USERS_ENTRY = 'admin.users.entry';
export const PERM_USERS_EDIT_PROFILE = 'admin.users.edit_profile';
export const PERM_USERS_CHANGE_ROLE = 'admin.users.change_role';
export const PERM_USERS_RESTRICT = 'admin.users.restrict';

/** adminManageUser 伺服器白名單（functions/index.js ADMIN_MANAGED_USER_PROFILE_FIELDS）。 */
export const ADMIN_PROFILE_FIELDS = ['region', 'gender', 'birthday', 'sports', 'phone', 'email'] as const;
export type AdminProfileField = (typeof ADMIN_PROFILE_FIELDS)[number];
export type AdminProfileUpdates = Partial<Record<AdminProfileField, string | null>>;

/**
 * 伺服器的角色層級（functions/index.js ROLE_LEVELS）：只有 6 個內建角色，自訂角色在伺服器一律視為 0。
 * 前端守衛照伺服器算，才不會出現「前端放行、伺服器拒絕」或相反。
 */
const SERVER_ROLE_LEVELS: Readonly<Record<string, number>> = Object.freeze({
  user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5,
});

const ADMIN_LEVEL = 4;

export function serverRoleLevel(role: string | null | undefined): number {
  const key = String(role || '').trim();
  return Object.prototype.hasOwnProperty.call(SERVER_ROLE_LEVELS, key) ? (SERVER_ROLE_LEVELS[key] ?? 0) : 0;
}

/** 使用者列表一筆（A `FirebaseService._mapUserDoc` 的精簡投影；時間欄位在讀入時就轉成毫秒）。 */
export interface AdminUser {
  /** users 文件 ID。 */
  _docId: string;
  /** A：data.uid || data.lineUserId || docId（R-ID-002）。 */
  uid: string;
  lineUserId: string;
  name: string;
  role: string;
  email: string;
  gender: string;
  region: string;
  /** 運動類別顯示文字（陣列以「, 」串接）。 */
  sports: string;
  phone: string;
  /** 編輯彈窗生日欄位用，YYYY-MM-DD；沒有或解析不了為空字串。 */
  birthday: string;
  exp: number;
  pictureUrl: string;
  teamName: string;
  isRestricted: boolean;
  /** A `_stealthRole`：管理員隱身時名單膠囊顯示為一般用戶。 */
  stealth: boolean;
  /** A：createdAt || joinedAt || registeredAt。 */
  joinedAtMs: number | null;
  /** A：lastLogin || lastActive。 */
  lastLoginMs: number | null;
  lastLoginIp: string;
  lastLoginRegion: string;
  lastLoginIsp: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A `_coerceAdminUserTimeMs`：Timestamp／Date／數字（小於 1e12 視為秒）／字串；字串依 taipei-time 規則（無時區字串當台北牆鐘）。 */
export function coerceTimeMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'number') {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    return Number.isFinite(ms) ? ms : null;
  }
  return parseTaipei(value);
}

function firstTruthy(...values: unknown[]): unknown {
  for (const value of values) if (value) return value;
  return null;
}

/** 生日欄位：A 存 `YYYY/MM/DD`（編輯時 `-`→`/`）；彈窗的 date input 需要 `YYYY-MM-DD`。 */
export function normalizeBirthdayForInput(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const ms = parseTaipei(value);
    if (ms !== null && /^\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(value.trim())) return formatTaipei(ms, 'YYYY-MM-DD');
    return value.replace(/\//g, '-').slice(0, 10);
  }
  const ms = parseTaipei(value);
  return ms === null ? '' : formatTaipei(ms, 'YYYY-MM-DD');
}

/** A `_mapUserDoc`：name = displayName || name || '未知'；uid = uid || lineUserId || docId。 */
export function mapUserDoc(data: Record<string, unknown> | undefined, docId: string): AdminUser {
  const d = data ?? {};
  const sportsRaw = d['sports'];
  const sports = Array.isArray(sportsRaw)
    ? sportsRaw.filter((item): item is string => typeof item === 'string').join(', ')
    : text(sportsRaw);
  const role = text(d['role']).trim() || 'user';
  return {
    _docId: docId,
    uid: text(d['uid']) || text(d['lineUserId']) || docId,
    lineUserId: text(d['lineUserId']),
    name: text(d['displayName']) || text(d['name']) || '未知',
    role,
    email: text(d['email']),
    gender: text(d['gender']),
    region: text(d['region']),
    sports,
    phone: text(d['phone']),
    birthday: normalizeBirthdayForInput(d['birthday']),
    exp: Number(d['exp']) > 0 ? Number(d['exp']) : 0,
    pictureUrl: text(d['pictureUrl']),
    teamName: text(d['teamName']),
    isRestricted: d['isRestricted'] === true,
    stealth: d['stealth'] === true,
    joinedAtMs: coerceTimeMs(firstTruthy(d['createdAt'], d['joinedAt'], d['registeredAt'])),
    lastLoginMs: coerceTimeMs(firstTruthy(d['lastLogin'], d['lastActive'])),
    lastLoginIp: text(d['lastLoginIp']),
    lastLoginRegion: text(d['lastLoginRegion']),
    lastLoginIsp: text(d['lastLoginIsp']),
  };
}

// ─── 篩選（A _getAdminUserFilters／_applyAdminUserFilters） ───

export interface AdminUserFilters {
  keyword: string;
  role: string;
  gender: string;
  joinedMinDays: number | null;
  joinedMaxDays: number | null;
  loginMinDays: number | null;
  loginMaxDays: number | null;
  region: string;
  email: string;
}

/** 面板上的原始輸入（皆為字串，等同 A 讀 input.value）。 */
export interface AdminUserFilterInputs {
  keyword: string;
  role: string;
  gender: string;
  joinedMin: string;
  joinedMax: string;
  loginMin: string;
  loginMax: string;
  region: string;
  email: string;
}

export const EMPTY_FILTER_INPUTS: AdminUserFilterInputs = Object.freeze({
  keyword: '', role: '', gender: '', joinedMin: '', joinedMax: '', loginMin: '', loginMax: '', region: '', email: '',
});

/** A `readNumber`：空字串→null；非有限或負數→null；其餘無條件捨去小數。 */
function readDays(raw: string): number | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export function normalizeFilters(inputs: AdminUserFilterInputs): AdminUserFilters {
  const read = (v: string): string => String(v ?? '').trim();
  return {
    keyword: read(inputs.keyword).toLowerCase(),
    role: read(inputs.role),
    gender: read(inputs.gender),
    joinedMinDays: readDays(inputs.joinedMin),
    joinedMaxDays: readDays(inputs.joinedMax),
    loginMinDays: readDays(inputs.loginMin),
    loginMaxDays: readDays(inputs.loginMax),
    region: read(inputs.region).toLowerCase(),
    email: read(inputs.email).toLowerCase(),
  };
}

export function hasActiveFilters(filters: AdminUserFilters | null | undefined): boolean {
  if (!filters) return false;
  return !!(
    filters.keyword || filters.role || filters.gender || filters.region || filters.email
    || filters.joinedMinDays !== null || filters.joinedMaxDays !== null
    || filters.loginMinDays !== null || filters.loginMaxDays !== null
  );
}

/** A `_getAdminUserDaysSince`：經過的整天數（不是日曆天），負值取 0。 */
export function daysSince(timeMs: number | null, nowMs: number): number | null {
  if (timeMs === null) return null;
  const diff = nowMs - timeMs;
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.floor(diff / DAY_MS));
}

/** A `_matchesAdminUserDayRange`：起迄顛倒時互換；沒有時間的人在有設定區間時一律不符合。 */
export function matchesDayRange(
  timeMs: number | null,
  minDays: number | null,
  maxDays: number | null,
  nowMs: number,
): boolean {
  if (minDays === null && maxDays === null) return true;
  const days = daysSince(timeMs, nowMs);
  if (days === null) return false;
  let min = minDays;
  let max = maxDays;
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  if (min !== null && days < min) return false;
  if (max !== null && days > max) return false;
  return true;
}

export function applyFilters(
  users: readonly AdminUser[],
  filters: AdminUserFilters,
  nowMs: number,
): AdminUser[] {
  return users.filter((user) => {
    if (filters.keyword) {
      // A：name、displayName、uid、lineUserId、_docId、email（B 的 name 已含 displayName）。
      const haystack = [user.name, user.uid, user.lineUserId, user._docId, user.email]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      if (!haystack.includes(filters.keyword)) return false;
    }
    if (filters.role && user.role !== filters.role) return false;
    if (filters.gender && user.gender !== filters.gender) return false;
    if (filters.region && !user.region.toLowerCase().includes(filters.region)) return false;
    if (filters.email && !user.email.toLowerCase().includes(filters.email)) return false;
    if (!matchesDayRange(user.joinedAtMs, filters.joinedMinDays, filters.joinedMaxDays, nowMs)) return false;
    if (!matchesDayRange(user.lastLoginMs, filters.loginMinDays, filters.loginMaxDays, nowMs)) return false;
    return true;
  });
}

/** A renderAdminUsers：依名字 localeCompare 排序（不改原陣列）。 */
export function sortUsersByName(users: readonly AdminUser[]): AdminUser[] {
  return [...users].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/** A 每頁 30 筆、載入更多每次 +30。 */
export function sliceVisible<T>(items: readonly T[], visibleCount: number): { visible: T[]; hasMore: boolean } {
  const count = Math.max(ADMIN_USER_PAGE_SIZE, Math.floor(visibleCount) || ADMIN_USER_PAGE_SIZE);
  return { visible: items.slice(0, count), hasMore: items.length > count };
}

// ─── 顯示 ───

/** A `_formatLastLoginMeta` 的時間部分；一律台北牆鐘（不依裝置時區）。 */
export function formatLastLogin(user: AdminUser, noRecordText: string): string {
  const timeStr = user.lastLoginMs === null ? noRecordText : formatTaipei(user.lastLoginMs);
  const parts = [timeStr];
  if (user.lastLoginIp) parts.push(user.lastLoginIp);
  const regionIsp = [user.lastLoginRegion, user.lastLoginIsp].filter(Boolean).join(' / ');
  if (regionIsp) parts.push(regionIsp);
  return parts.join(' ・ ');
}

export function genderIcon(gender: string): string {
  return gender === '男' ? '♂' : gender === '女' ? '♀' : '';
}

/** 舊資料才會出現的角色鍵（B `UserTag` 一直把它當「領隊」顯示；A 的 ROLES 沒有這個鍵，會直接顯示原字串）。 */
const LEGACY_ROLE_LABELS: Readonly<Record<string, string>> = Object.freeze({ team_leader: '領隊' });

/** 角色顯示名稱：內建 → 自訂角色 → 舊資料角色對照 → 原字串（A `ROLES[role]?.label || role` 多一層舊資料對照）。 */
export function roleLabel(role: string, customRoles: readonly CustomRoleInput[]): string {
  const base = BASE_ROLES[role];
  if (base) return base.label;
  const custom = customRoles.find((item) => item.key === role);
  if (custom?.label) return custom.label;
  return LEGACY_ROLE_LABELS[role] ?? role;
}

/** 膠囊用的角色：管理員隱身時顯示為一般用戶（A `_stealthRole`）。 */
export function tagRole(user: AdminUser): string {
  return (user.role === 'admin' || user.role === 'super_admin') && user.stealth ? 'user' : user.role;
}

// ─── 權限（A _canXxx；按鈕顯示與送出守衛共用） ───

export interface AdminUserActor {
  uid: string | null;
  role: string;
  hasPermission: (code: string) => boolean;
}

/** A `_canManageTargetSuperAdmin`：非 super_admin 不得處理 super_admin。 */
export function canManageTarget(actor: AdminUserActor, target: AdminUser): boolean {
  return actor.role === 'super_admin' || target.role !== 'super_admin';
}

export function canEditProfileOf(actor: AdminUserActor, target: AdminUser): boolean {
  return actor.hasPermission(PERM_USERS_EDIT_PROFILE) && canManageTarget(actor, target);
}

/**
 * 變更角色：權限碼 + 伺服器規則（呼叫者至少 admin；非 super_admin 不得改同級或更高）。
 * 比 A 只看權限碼更嚴，伺服器仍是最終裁判。
 */
export function canChangeRoleOf(actor: AdminUserActor, target: AdminUser): boolean {
  if (!actor.hasPermission(PERM_USERS_CHANGE_ROLE)) return false;
  if (!canManageTarget(actor, target)) return false;
  if (actor.role === 'super_admin') return true;
  const actorLevel = serverRoleLevel(actor.role);
  return actorLevel >= ADMIN_LEVEL && serverRoleLevel(target.role) < actorLevel;
}

/**
 * 非 super_admin 不得指派 admin 以上的角色。
 * 伺服器只認 6 個內建角色（自訂角色一律視為 0），前端多一道防線：自訂角色依其插入層級
 * （`getRuntimeRoleLevel`）判斷，排在 admin／super_admin 之後的自訂角色同樣不給非 super_admin 指派。
 */
export function canAssignRole(
  actor: AdminUserActor,
  role: string,
  customRoles: readonly CustomRoleInput[] = [],
): boolean {
  const key = String(role || '').trim();
  if (!key) return false;
  if (actor.role === 'super_admin') return true;
  return key !== 'super_admin' && getRuntimeRoleLevel(key, customRoles) < ADMIN_LEVEL;
}

/** A `_canOpenUserEditor`。 */
export function canOpenEditor(actor: AdminUserActor, target: AdminUser): boolean {
  return canManageTarget(actor, target) && (canEditProfileOf(actor, target) || canChangeRoleOf(actor, target));
}

/** 列表「編輯」鈕：A 另外對 super_admin 目標一律不顯示。 */
export function showsEditButton(actor: AdminUserActor, target: AdminUser): boolean {
  return canOpenEditor(actor, target) && target.role !== 'super_admin';
}

/** A `_canToggleUserRestrictionFor`＋「不可限制自己」：目標須是 role==='user'、非自己。 */
export function canToggleRestrictionOf(actor: AdminUserActor, target: AdminUser): boolean {
  if (!actor.hasPermission(PERM_USERS_RESTRICT)) return false;
  if (!canManageTarget(actor, target)) return false;
  if (target.role !== 'user') return false;
  return !(actor.uid && target.uid && actor.uid === target.uid);
}

/**
 * A `_getAssignableRoleKeys`：執行期角色序列（內建＋自訂）；非 super_admin 不含 super_admin。
 * 另外，伺服器不允許非 super_admin 指派 admin 以上，所以這裡也不列（避免選了必失敗）。
 */
export function getAssignableRoleKeys(
  actorRole: string,
  customRoles: readonly CustomRoleInput[],
): string[] {
  const all = getRuntimeRoleSequence(customRoles);
  if (actorRole === 'super_admin') return all;
  return all.filter((key) => key !== 'super_admin' && getRuntimeRoleLevel(key, customRoles) < ADMIN_LEVEL);
}

// ─── 編輯差異（A saveUserEdit） ───

export interface EditFormValues {
  role: string;
  region: string;
  gender: string;
  /** date input 值（YYYY-MM-DD）。 */
  birthday: string;
  sports: string;
  phone: string;
  email: string;
}

export function formValuesFromUser(user: AdminUser): EditFormValues {
  return {
    role: user.role,
    region: user.region,
    gender: user.gender,
    birthday: user.birthday,
    sports: user.sports,
    phone: user.phone,
    email: user.email,
  };
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX_LENGTH = 254;

export type BuildEditResult =
  | { ok: true; profileUpdates: AdminProfileUpdates; role: string | null }
  | { ok: false; reason: 'invalid_email' | 'no_change' };

/**
 * A `saveUserEdit` 的 updates 組裝：只送「有改的欄位」；只有有對應權限才納入。
 * 與 A 的差異：舊值用編輯彈窗預填的同一份正規化文字比較（sports 陣列、birthday Timestamp 不會因為格式不同被誤判成有改）。
 */
export function buildEditUpdates(
  actor: AdminUserActor,
  target: AdminUser,
  form: EditFormValues,
): BuildEditResult {
  const profileUpdates: AdminProfileUpdates = {};
  let role: string | null = null;

  if (canChangeRoleOf(actor, target) && form.role !== target.role) role = form.role;

  if (canEditProfileOf(actor, target)) {
    const setIfChanged = (field: AdminProfileField, oldText: string, next: string | null): void => {
      if (oldText !== (next ?? '')) profileUpdates[field] = next;
    };
    setIfChanged('region', target.region, form.region);
    setIfChanged('gender', target.gender, form.gender);
    setIfChanged('sports', target.sports, form.sports.trim());
    setIfChanged('phone', target.phone, form.phone.trim());
    const email = form.email.trim();
    if (email && (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX_LENGTH)) {
      return { ok: false, reason: 'invalid_email' };
    }
    setIfChanged('email', target.email, email || null);
    // A：生日以 `YYYY/MM/DD` 儲存，清空為 null。
    setIfChanged('birthday', target.birthday.replace(/-/g, '/'), form.birthday ? form.birthday.replace(/-/g, '/') : null);
  }

  if (role === null && Object.keys(profileUpdates).length === 0) return { ok: false, reason: 'no_change' };
  return { ok: true, profileUpdates, role };
}

/** 成功後把已送出的變更套回本機那一筆（伺服器會 trim／過濾，細節以重新整理為準）。 */
export function applyEditToUser(
  user: AdminUser,
  profileUpdates: AdminProfileUpdates,
  role: string | null,
): AdminUser {
  const next: AdminUser = { ...user };
  if (role !== null) next.role = role;
  if ('region' in profileUpdates) next.region = profileUpdates.region ?? '';
  if ('gender' in profileUpdates) next.gender = profileUpdates.gender ?? '';
  if ('sports' in profileUpdates) next.sports = profileUpdates.sports ?? '';
  if ('phone' in profileUpdates) next.phone = profileUpdates.phone ?? '';
  if ('email' in profileUpdates) next.email = profileUpdates.email ?? '';
  if ('birthday' in profileUpdates) next.birthday = (profileUpdates.birthday ?? '').replace(/\//g, '-');
  return next;
}

// ─── 操作日誌措辭（operationLogs：type／typeName／content；對象只放 content，不放 uid 欄位） ───

export interface UserOpLogEntry {
  type: string;
  typeName: string;
  content: string;
}

/** 彈窗欄位名稱（A pages/admin-users.html 的標籤）；操作日誌只記「改了哪些欄位」，不記電話、Email 等值。 */
const PROFILE_FIELD_LABELS: Readonly<Record<AdminProfileField, string>> = {
  region: '地區',
  gender: '性別',
  birthday: '生日',
  sports: '運動類別',
  phone: '聯繫電話',
  email: '電子郵件',
};

/**
 * 角色變更：type／typeName 與 A `team-list-helpers.js#_applyRoleChange` 的 `_writeOpLog('role', '角色變更', …)` 相同，
 * 句型照 A（`{名字} 自動晉升／調整為「角色」（原：舊角色）`），後台手動指派把「自動」換成「手動」。
 */
export function buildRoleChangeOpLog(
  name: string,
  oldRole: string,
  newRole: string,
  customRoles: readonly CustomRoleInput[],
): UserOpLogEntry {
  const isUpgrade = getRuntimeRoleLevel(newRole, customRoles) > getRuntimeRoleLevel(oldRole, customRoles);
  return {
    type: 'role',
    typeName: '角色變更',
    content: `${name} 手動${isUpgrade ? '晉升' : '調整'}為「${roleLabel(newRole, customRoles)}」（原：${roleLabel(oldRole, customRoles)}）`,
  };
}

/** A 用戶管理本來沒有限制帳號的操作日誌；句型比照 A 的 `ann_toggle`（固定 typeName＋動詞「對象」）。 */
export function buildRestrictionOpLog(name: string, restricted: boolean): UserOpLogEntry {
  return {
    type: 'user_restrict',
    typeName: '帳號限制',
    content: `${restricted ? '限制' : '解除限制'}「${name}」`,
  };
}

/** A 用戶管理本來沒有資料編輯的操作日誌；句型比照 A 的 `team_edit`（編輯「對象」）。沒有資料欄位被改時回 null。 */
export function buildProfileEditOpLog(name: string, updates: AdminProfileUpdates): UserOpLogEntry | null {
  const labels = ADMIN_PROFILE_FIELDS.filter((field) => field in updates).map((field) => PROFILE_FIELD_LABELS[field]);
  if (labels.length === 0) return null;
  return {
    type: 'user_edit',
    typeName: '編輯用戶資料',
    content: `編輯「${name}」的資料：${labels.join('、')}`,
  };
}

/** 編輯彈窗的地區選項（A pages/admin-users.html 的 #ue-region，逐字）。 */
export const USER_EDIT_REGION_OPTIONS: readonly string[] = [
  '北部', '中部', '南部', '東部&外島',
  '台北', '台北市', '新北', '新北市', '桃園', '桃園市',
  '台中', '台中市', '台南', '台南市', '高雄', '高雄市',
  '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣',
  '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
  '台東縣', '澎湖縣', '金門縣', '連江縣', '其他',
];

/** 性別選項的儲存值（A 存中文）；顯示文字走 i18n key `admin-users.gender.<key>`。 */
export const USER_EDIT_GENDER_OPTIONS: readonly { value: string; key: string }[] = [
  { value: '男', key: 'male' },
  { value: '女', key: 'female' },
  { value: '其他', key: 'other' },
  { value: '不透露', key: 'undisclosed' },
];
