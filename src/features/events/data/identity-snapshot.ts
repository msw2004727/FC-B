export interface IdentityUser {
  uid?: string | null;
  displayName?: string | null;
  name?: string | null;
  pictureUrl?: string | null;
  photoURL?: string | null;
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

function trim(value: unknown): string {
  return String(value || '').trim();
}

/** 照 A getMainIdentity；身分識別依 R-ID-002 只認 UID。 */
export function getMainIdentity(user: IdentityUser) {
  const uid = trim(user.uid);
  const displayName = trim(user.displayName || user.name || uid || '用戶');
  const pictureUrl = trim(user.pictureUrl || user.photoURL);
  return {
    identityId: 'main' as const,
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

/** 照 A buildPublicSnapshot。 */
export function buildPublicSnapshot(user: IdentityUser): PublicIdentitySnapshot {
  const identity = getMainIdentity(user);
  // ASSUMPTION: B 沒有第二身份切換來源，寫入固定使用主身份。
  return {
    identityId: 'main',
    displayName: identity.displayName.trim().slice(0, 80),
    avatarUrl: identity.pictureUrl.trim().slice(0, 1200),
  };
}

/** 照 A _getEventCommentAuthor。 */
export function getEventCommentAuthor(user: IdentityUser): CommentAuthor {
  const identity = getMainIdentity(user);
  return {
    uid: trim(user.uid),
    authorName: identity.displayName || '用戶',
    authorPhoto: identity.pictureUrl,
    identitySnapshot: buildPublicSnapshot(user),
  };
}

/** 照 A _normalizePublicIdentitySnapshot。 */
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

/** 照 A _resolveEventCommentDisplay；官方身份不退回主帳號照片。 */
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
