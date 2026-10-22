import {
  buildPublicSnapshot as resolveBuildPublicSnapshot,
  getEffectiveIdentity,
  getMainIdentity as resolveMainIdentity,
  type IdentityUserInput,
  type ResolvedIdentity,
} from '@/data/identity-resolver';
import { getIdentitySettings } from '@/data/identity-settings';

export interface IdentityUser extends IdentityUserInput {
  /** 呼叫端傳入 viewer.hasPermission，用來判斷是否允許第二身份（照 A `ApiService.canUseSecondaryIdentityFeature()`）。 */
  hasPermission?: (code: string) => boolean;
}

export interface PublicIdentitySnapshot {
  identityId: 'main' | 'secondary';
  displayName: string;
  avatarUrl: string;
}

export interface CommentAuthor {
  uid: string;
  authorName: string;
  authorPhoto: string;
  identitySnapshot: PublicIdentitySnapshot;
}

const SECONDARY_IDENTITY_PERMISSION = 'profile.secondary_identity';

function trim(value: unknown): string {
  return String(value || '').trim();
}

/** 照 A `IdentityResolver.getMainIdentity`；身分識別依 R-ID-002 只認 UID。 */
export function getMainIdentity(user: IdentityUser): ResolvedIdentity {
  const resolved = resolveMainIdentity(user);
  if (resolved) return resolved;
  return {
    identityId: 'main',
    uid: '',
    displayName: '用戶',
    name: '用戶',
    pictureUrl: '',
    photoURL: '',
    avatarCandidates: [],
    isPrimary: true,
    source: 'users',
  };
}

/** 照 A `IdentityResolver.buildPublicSnapshot`；第二身份由呼叫端的 hasPermission 決定。 */
export function buildPublicSnapshot(user: IdentityUser): PublicIdentitySnapshot {
  const allowSecondary = user.hasPermission?.(SECONDARY_IDENTITY_PERMISSION) === true;
  const resolved = resolveBuildPublicSnapshot(user, {
    settings: getIdentitySettings(),
    allowSecondaryIdentity: allowSecondary,
  });
  if (!resolved) {
    return { identityId: 'main', displayName: '用戶', avatarUrl: '' };
  }
  return resolved;
}

/** 照 A `event-comments.js#_getEventCommentAuthor`。 */
export function getEventCommentAuthor(user: IdentityUser): CommentAuthor {
  const rootIdentity = getMainIdentity(user);
  const allowSecondary = user.hasPermission?.(SECONDARY_IDENTITY_PERMISSION) === true;
  const effective = getEffectiveIdentity(user, {
    settings: getIdentitySettings(),
    surface: 'comment',
    allowSecondaryIdentity: allowSecondary,
  });
  const requestedIdentityId: 'main' | 'secondary' =
    effective?.identityId === 'secondary' ? 'secondary' : 'main';
  const snapshot = resolveBuildPublicSnapshot(user, {
    settings: getIdentitySettings(),
    surface: 'comment',
    allowSecondaryIdentity: allowSecondary,
    requestedIdentityId,
  });
  const rootName = trim(rootIdentity.displayName || user.displayName || user.name || '用戶');
  const rootPhoto = trim(rootIdentity.pictureUrl || user.pictureUrl || user.photoURL);
  return {
    uid: rootIdentity.uid,
    authorName: rootName || '用戶',
    authorPhoto: rootPhoto,
    identitySnapshot: snapshot ?? {
      identityId: 'main',
      displayName: rootName || '用戶',
      avatarUrl: rootPhoto,
    },
  };
}

/** 照 A `_normalizePublicIdentitySnapshot`。 */
export function normalizePublicIdentitySnapshot(value: unknown): PublicIdentitySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.identityId !== 'main' && raw.identityId !== 'secondary') return null;
  const displayName = trim(raw.displayName);
  if (!displayName) return null;
  return {
    identityId: raw.identityId,
    displayName,
    avatarUrl: trim(raw.avatarUrl),
  };
}

/** 照 A `_resolveEventCommentDisplay`；官方身份不退回主帳號照片。 */
export function resolveEventCommentDisplay(data: Record<string, unknown>) {
  const identitySnapshot = normalizePublicIdentitySnapshot(data.identitySnapshot);
  return {
    identitySnapshot,
    authorName: trim(identitySnapshot?.displayName || data.authorName || '用戶') || '用戶',
    authorPhoto: trim(identitySnapshot ? identitySnapshot.avatarUrl : data.authorPhoto),
    rootAuthorName: trim(data.authorName),
    rootAuthorPhoto: trim(data.authorPhoto),
  };
}
