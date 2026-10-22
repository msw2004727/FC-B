/**
 * 第二身份解析器，照 A `js/identity-resolver.js` 逐函式移植。
 * A 用全域 FirebaseService cache 的地方改由呼叫端傳 settings。
 */
export type IdentityId = 'main' | 'secondary';

export interface SecondaryIdentitySettings {
  identityId: 'secondary';
  enabled: boolean;
  displayName: string;
  avatarUrl: string;
  avatarStoragePath: string;
  avatarStorageBucket: string;
  displayRoleLabel: string;
  isPrimary: false;
  editable: boolean;
  updatedAt: unknown;
}

export interface IdentitySettings {
  _docId: string;
  profileActiveIdentityId: IdentityId;
  identities: { secondary: SecondaryIdentitySettings | null };
  updatedAt: unknown;
  createdAt: unknown;
}

export interface IdentityUserInput {
  uid?: string | null;
  lineUserId?: string | null;
  _docId?: string | null;
  displayName?: string | null;
  name?: string | null;
  pictureUrl?: string | null;
  photoURL?: string | null;
}

export interface ResolvedIdentity {
  identityId: IdentityId;
  uid: string;
  displayName: string;
  name: string;
  pictureUrl: string;
  photoURL: string;
  avatarCandidates: string[];
  displayRoleLabel?: string;
  isPrimary: boolean;
  source: string;
}

export interface ResolveOptions {
  settings?: IdentitySettings | null;
  allowSecondaryIdentity?: boolean;
  surface?: string;
}

const PRIVATE_MESSAGE_SURFACES: ReadonlySet<string> = new Set([
  'pm',
  'privateMessage',
  'private-message',
]);

const DEFAULT_DISPLAY_ROLE_LABEL = '一般用戶';

/** 照 A `_trim`。 */
function trim(value: unknown): string {
  return String(value || '').trim();
}

/** 照 A `_isValidIdentityId`。 */
function isValidIdentityId(id: unknown): id is IdentityId {
  return id === 'main' || id === 'secondary';
}

/** 照 A `_canUseSecondaryIdentity`：未明確指定 false 即可用（A 預設）。 */
function canUseSecondary(opts?: { allowSecondaryIdentity?: boolean } | null): boolean {
  return opts?.allowSecondaryIdentity !== false;
}

/** 照 A `normalizeSettings` 的 secondary 區塊。 */
function normalizeSecondaryIdentity(raw: Record<string, unknown>): SecondaryIdentitySettings {
  return {
    identityId: 'secondary',
    enabled: raw['enabled'] === true,
    displayName: trim(raw['displayName']).slice(0, 40),
    avatarUrl: trim(raw['avatarUrl']),
    avatarStoragePath: trim(raw['avatarStoragePath']),
    avatarStorageBucket: trim(raw['avatarStorageBucket']),
    displayRoleLabel: trim(raw['displayRoleLabel']).slice(0, 40),
    isPrimary: false,
    editable: raw['editable'] !== false,
    updatedAt: raw['updatedAt'] || null,
  };
}

/** 照 A `normalizeSettings`。 */
export function normalizeIdentitySettings(raw: unknown): IdentitySettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const activeRaw = r['profileActiveIdentityId'];
  const activeId: IdentityId = isValidIdentityId(activeRaw) ? activeRaw : 'main';

  const identitiesRaw = r['identities'];
  const secondaryRaw =
    identitiesRaw && typeof identitiesRaw === 'object' && !Array.isArray(identitiesRaw)
      ? (identitiesRaw as Record<string, unknown>)['secondary']
      : null;
  const secondary =
    secondaryRaw && typeof secondaryRaw === 'object' && !Array.isArray(secondaryRaw)
      ? normalizeSecondaryIdentity(secondaryRaw as Record<string, unknown>)
      : null;

  const docIdRaw = r['_docId'];
  const docId = typeof docIdRaw === 'string' && docIdRaw ? docIdRaw : 'settings';

  return {
    _docId: docId,
    profileActiveIdentityId: activeId,
    identities: { secondary },
    updatedAt: r['updatedAt'] || null,
    createdAt: r['createdAt'] || null,
  };
}

/** 照 A `isSecondaryEnabled`；啟用但暱稱空白視為未啟用。 */
export function isSecondaryEnabled(settings: IdentitySettings | null | undefined): boolean {
  const normalized = normalizeIdentitySettings(settings);
  const secondary = normalized?.identities.secondary ?? null;
  return !!(secondary && secondary.enabled === true && secondary.displayName);
}

/** 照 A `getActiveIdentityId`。 */
export function getActiveIdentityId(
  settings: IdentitySettings | null | undefined,
  opts?: { allowSecondaryIdentity?: boolean },
): IdentityId {
  if (!canUseSecondary(opts)) return 'main';
  const normalized = normalizeIdentitySettings(settings);
  if (
    normalized?.profileActiveIdentityId === 'secondary'
    && isSecondaryEnabled(normalized)
  ) {
    return 'secondary';
  }
  return 'main';
}

/** 照 A `getMainIdentity`；身分識別依 R-ID-002 只認 UID。 */
export function getMainIdentity(
  user: IdentityUserInput | null | undefined,
): ResolvedIdentity | null {
  if (!user) return null;
  const uid = trim(user.uid || user.lineUserId || user._docId);
  const displayName = trim(user.displayName || user.name || uid || '用戶');
  const pictureUrl = trim(user.pictureUrl || user.photoURL);
  return {
    identityId: 'main',
    uid,
    displayName,
    name: displayName,
    pictureUrl,
    photoURL: pictureUrl,
    avatarCandidates: pictureUrl ? [pictureUrl] : [],
    isPrimary: true,
    source: 'users',
  };
}

/** 照 A `getSecondaryIdentity`。 */
export function getSecondaryIdentity(
  user: IdentityUserInput | null | undefined,
  settings: IdentitySettings | null | undefined,
  opts?: { allowSecondaryIdentity?: boolean },
): ResolvedIdentity | null {
  if (!user) return null;
  if (!canUseSecondary(opts)) return null;
  const normalized = normalizeIdentitySettings(settings);
  const secondary = normalized?.identities.secondary ?? null;
  if (!secondary || secondary.enabled !== true || !secondary.displayName) return null;
  const avatarUrl = trim(secondary.avatarUrl);
  return {
    identityId: 'secondary',
    uid: trim(user.uid || user.lineUserId || user._docId),
    displayName: secondary.displayName,
    name: secondary.displayName,
    pictureUrl: avatarUrl,
    photoURL: avatarUrl,
    avatarCandidates: avatarUrl ? [avatarUrl] : [],
    displayRoleLabel: secondary.displayRoleLabel || DEFAULT_DISPLAY_ROLE_LABEL,
    isPrimary: false,
    source: 'users.identityPrivate.settings',
  };
}

/** 照 A `getEffectiveIdentity`；pm surface 一律主身份。 */
export function getEffectiveIdentity(
  user: IdentityUserInput | null | undefined,
  opts?: ResolveOptions,
): ResolvedIdentity | null {
  if (!user) return null;
  const surface = trim(opts?.surface);
  const settings = opts?.settings ?? null;
  if (PRIVATE_MESSAGE_SURFACES.has(surface)) {
    return getMainIdentity(user);
  }
  if (getActiveIdentityId(settings, opts) === 'secondary') {
    return getSecondaryIdentity(user, settings, opts) ?? getMainIdentity(user);
  }
  return getMainIdentity(user);
}

/** 照 A `buildPublicSnapshot`；displayName 截 80、avatarUrl 截 1200。 */
export function buildPublicSnapshot(
  user: IdentityUserInput | null | undefined,
  opts?: ResolveOptions & { requestedIdentityId?: string },
): { identityId: IdentityId; displayName: string; avatarUrl: string } | null {
  if (!user) return null;
  const requestedRaw = opts?.requestedIdentityId;
  const requestedIdentityId: IdentityId =
    canUseSecondary(opts) && isValidIdentityId(requestedRaw) ? requestedRaw : 'main';
  const settings = opts?.settings ?? null;
  const identity =
    requestedIdentityId === 'secondary'
      ? getSecondaryIdentity(user, settings, opts)
      : getMainIdentity(user);
  const resolved = identity ?? getMainIdentity(user);
  if (!resolved) return null;
  return {
    identityId: resolved.identityId === 'secondary' ? 'secondary' : 'main',
    displayName: trim(resolved.displayName || resolved.name).slice(0, 80),
    avatarUrl: trim(resolved.pictureUrl || resolved.photoURL).slice(0, 1200),
  };
}
