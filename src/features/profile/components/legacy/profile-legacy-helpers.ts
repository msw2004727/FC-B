import type { UserRole } from '@/ui/Avatar';
import { userLevelFromExp } from '@/data/user-roles';
import type { UserProfile } from '../../data/profile-model';

export const UNAVAILABLE_MSG = '此功能尚未開放，請先使用舊版';

/** A `js/config.js#TW_REGIONS`（22 縣市）。 */
export const TW_REGIONS: readonly string[] = [
  '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
  '基隆市', '新竹市', '嘉義市',
  '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣',
  '屏東縣', '宜蘭縣', '花蓮縣', '台東縣',
  '澎湖縣', '金門縣', '連江縣',
];

export const TW_REGIONS_WITH_OTHER: readonly string[] = [...TW_REGIONS, '其他'];

/** A `js/config.js#filterTwRegions`：字元依序出現模糊比對，臺/台互通。 */
export function filterTwRegions(keyword: string, includeOther = true): string[] {
  const list = includeOther === false ? TW_REGIONS : TW_REGIONS_WITH_OTHER;
  const q = String(keyword || '').trim().replace(/臺/g, '台').toLowerCase();
  if (!q) return list.slice();
  return list.filter((name) => {
    const text = name.replace(/臺/g, '台').toLowerCase();
    let ti = 0;
    for (let qi = 0; qi < q.length; qi++) {
      let found = false;
      while (ti < text.length) {
        if (text[ti] === q[qi]) {
          ti++;
          found = true;
          break;
        }
        ti++;
      }
      if (!found) return false;
    }
    return true;
  });
}

/** A `profile-core.js#_calcLevelFromExp`。 */
export function calcLevelFromExp(totalExp: unknown): {
  level: number;
  progress: number;
  needed: number;
  percent: number;
} {
  const exp = Number(totalExp || 0);
  if (!(exp > 0)) {
    return { level: 0, progress: 0, needed: 100, percent: 0 };
  }
  const level = userLevelFromExp(exp);
  const baseExp = 50 * level * (level + 1);
  const progress = exp - baseExp;
  const needed = (level + 1) * 100;
  const percent = Math.min(100, Math.round((progress / needed) * 100));
  return { level, progress, needed, percent };
}

/**
 * A `config.js#_BASE_ROLES` 的 label／color（角色標籤 `.uc-role-tag` 用）。
 * team_leader 不在 A 基本角色內，A `ROLES[role] || ROLES.user` 會退回一般用戶。
 */
export const ROLE_DISPLAY_MAP: Record<UserRole, { label: string; color: string }> = {
  user: { label: '一般用戶', color: '#6b7280' },
  coach: { label: '教練', color: '#0d9488' },
  captain: { label: '領隊', color: '#7c3aed' },
  team_leader: { label: '一般用戶', color: '#6b7280' },
  venue_owner: { label: '場主', color: '#d97706' },
  admin: { label: '管理員', color: '#2563eb' },
  super_admin: { label: '總管', color: '#dc2626' },
};

const VALID_ROLES: ReadonlySet<string> = new Set<UserRole>([
  'user',
  'coach',
  'captain',
  'team_leader',
  'venue_owner',
  'admin',
  'super_admin',
]);

export function resolveEffectiveRole(
  profile: UserProfile,
  cachedRole?: UserRole,
): UserRole {
  if (cachedRole && VALID_ROLES.has(cachedRole)) {
    if ((cachedRole === 'admin' || cachedRole === 'super_admin') && profile['stealth'] === true) {
      return 'user';
    }
    return cachedRole;
  }
  const raw = typeof profile['role'] === 'string' && VALID_ROLES.has(profile['role'])
    ? (profile['role'] as UserRole)
    : 'user';
  if ((raw === 'admin' || raw === 'super_admin') && profile['stealth'] === true) {
    return 'user';
  }
  return raw;
}

/** A `app.js#_isAdminPlusRole`：只有 admin / super_admin（非隱身或原始管理角色）可看原始 UID。 */
export function isAdminPlusRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

/** 僅接受 http/https 頭像網址。 */
export function sanitizeHttpAvatarUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

export function getAvatarInitial(name: unknown): string {
  const text = String(name || '?').trim();
  return text ? text.charAt(0) : '?';
}

/** A `profile-data-render.js#_fmtCreatedAt`。 */
export function formatCreatedAt(ca: unknown): string {
  if (!ca) return '-';
  let d: Date | null = null;
  if (typeof ca === 'object' && ca !== null) {
    const obj = ca as { toDate?: () => Date; seconds?: unknown };
    if (typeof obj.toDate === 'function') {
      try {
        d = obj.toDate();
      } catch {
        d = null;
      }
    } else if (typeof obj.seconds === 'number' && Number.isFinite(obj.seconds)) {
      d = new Date(obj.seconds * 1000);
    }
  } else if (typeof ca === 'string' || typeof ca === 'number') {
    d = new Date(ca);
  }
  if (!d || Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export interface UserTeamEntry {
  id: string;
  name: string;
}

/**
 * 對應 A `_getUserTeamHtml`：從使用者文件的 `teamIds`/`teamId` 與 `teamNames`/`teamName` 組出所屬俱樂部清單。
 */
export function getUserTeamEntries(profile: UserProfile): UserTeamEntry[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const pushId = (val: unknown): void => {
    const v = String(val || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    ids.push(v);
  };
  if (Array.isArray(profile['teamIds'])) {
    profile['teamIds'].forEach(pushId);
  }
  pushId(profile['teamId']);

  const rawNames = Array.isArray(profile['teamNames'])
    ? profile['teamNames'].map((n) => (typeof n === 'string' ? n.trim() : ''))
    : [];
  const singleName = typeof profile['teamName'] === 'string' ? profile['teamName'].trim() : '';

  if (ids.length > 0) {
    return ids.map((tid, idx) => ({
      id: tid,
      name: rawNames[idx] || singleName || '俱樂部',
    }));
  }

  // 若無 teamId 但有 teamNames / teamName（例如測試替身只給 teamName），仍保留顯示。
  const fallbackNames = [...new Set([...rawNames.filter(Boolean), ...(singleName ? [singleName] : [])])];
  return fallbackNames.map((name) => ({ id: '', name }));
}

export interface SecondaryIdentityInfo {
  enabled: boolean;
  displayName: string;
  avatarUrl: string | null;
}

export function extractSecondaryIdentity(profile: UserProfile): SecondaryIdentityInfo {
  const settings = profile['identitySettings'];
  const identities =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)['identities']
      : null;
  const secondary =
    identities && typeof identities === 'object' && !Array.isArray(identities)
      ? (identities as Record<string, unknown>)['secondary']
      : null;
  const secObj =
    secondary && typeof secondary === 'object' && !Array.isArray(secondary)
      ? (secondary as Record<string, unknown>)
      : null;

  const enabled =
    profile['secondaryEnabled'] === true || secObj?.['enabled'] === true;
  const displayName =
    (typeof profile['secondaryDisplayName'] === 'string' && profile['secondaryDisplayName'].trim())
    || (typeof secObj?.['displayName'] === 'string' && secObj['displayName'].trim())
    || '';
  const avatarUrl = sanitizeHttpAvatarUrl(
    profile['secondaryAvatarUrl'] ?? secObj?.['avatarUrl'],
  );

  return { enabled, displayName, avatarUrl };
}
