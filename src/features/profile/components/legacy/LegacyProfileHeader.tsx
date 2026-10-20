import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { useUserRoles } from '@/data/user-roles';
import { lt } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { UserProfile } from '../../data/profile-model';
import type { ViewerView } from '../../data/viewer';
import type { UserAttendanceSummary } from '../../data/attendance-summary';
import {
  ROLE_DISPLAY_MAP,
  UNAVAILABLE_MSG,
  calcLevelFromExp,
  extractSecondaryIdentity,
  getAvatarInitial,
  isAdminPlusRole,
  resolveEffectiveRole,
  sanitizeHttpAvatarUrl,
} from './profile-legacy-helpers';

export function IdentityCrownSvg(): JSX.Element {
  return (
    <svg class="identity-crown" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="identityCrownGold" x1="3" y1="5" x2="20" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fff4c2" />
          <stop offset=".42" stop-color="#ffd24a" />
          <stop offset=".72" stop-color="#f2a517" />
          <stop offset="1" stop-color="#b5710b" />
        </linearGradient>
        <clipPath id="identityCrownClip">
          <path d="M2.7 9.1 6.8 13 12 5.6 17.2 13 21.3 9.1V16.4q0 1.7-1.7 1.7H4.4Q2.7 18.1 2.7 16.4Z" />
        </clipPath>
      </defs>
      <path class="identity-crown-body" d="M2.7 9.1 6.8 13 12 5.6 17.2 13 21.3 9.1V16.4q0 1.7-1.7 1.7H4.4Q2.7 18.1 2.7 16.4Z" />
      <path class="identity-crown-band" d="M4 15.3h16" />
      <circle class="identity-crown-gem" cx="12" cy="5.9" r="1.6" />
      <circle class="identity-crown-gem" cx="2.9" cy="9.1" r="1.3" />
      <circle class="identity-crown-gem" cx="21.1" cy="9.1" r="1.3" />
      <g clip-path="url(#identityCrownClip)">
        <rect class="identity-crown-shine" x="-9" y="-5" width="7" height="34" />
      </g>
    </svg>
  );
}

export function LegacyAvatar({
  url,
  name,
  baseClass,
  imageContainerClass,
  crown = false,
  id,
}: {
  url: string | null;
  name: string;
  baseClass: string;
  imageContainerClass?: string;
  crown?: boolean;
  id?: string;
}): JSX.Element {
  const safeUrl = sanitizeHttpAvatarUrl(url);
  const [imgBroken, setImgBroken] = useState(false);

  useEffect(() => {
    setImgBroken(false);
  }, [safeUrl]);

  const showImg = Boolean(safeUrl && !imgBroken);
  const containerClass = [
    showImg ? (imageContainerClass || baseClass) : baseClass,
    crown ? 'has-identity-crown' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div class={containerClass} id={id}>
      {showImg ? (
        <img
          src={safeUrl ?? undefined}
          alt={name || 'avatar'}
          referrerPolicy="no-referrer"
          decoding="async"
          onError={() => setImgBroken(true)}
        />
      ) : (
        getAvatarInitial(name)
      )}
      {crown && <IdentityCrownSvg />}
    </div>
  );
}

export function LegacyProfileTopSection({
  uid,
  profile,
  viewer,
  summary,
}: {
  uid: string;
  profile: UserProfile;
  viewer: ViewerView;
  summary: UserAttendanceSummary | null;
}): JSX.Element {
  const location = useLocation();
  const rolesMap = useUserRoles([uid]);
  const effectiveRole = resolveEffectiveRole(profile, rolesMap[uid]);
  const roleInfo = ROLE_DISPLAY_MAP[effectiveRole] ?? ROLE_DISPLAY_MAP.user;

  const secondary = extractSecondaryIdentity(profile);
  const displayName =
    (secondary.enabled && secondary.displayName)
    || (typeof profile['displayName'] === 'string' && profile['displayName'].trim())
    || profile.name
    || '-';
  const rawAvatar = secondary.enabled
    ? secondary.avatarUrl
    : sanitizeHttpAvatarUrl(profile['pictureUrl'] ?? profile['picture']);

  // A `_canViewRawUid`：只有 admin / super_admin 看得到原始 UID。
  const canViewRawUid =
    isAdminPlusRole(viewer.role)
    || isAdminPlusRole(typeof profile['role'] === 'string' ? profile['role'] : '')
    || isAdminPlusRole(rolesMap[uid]);

  const { level, progress, needed, percent } = calcLevelFromExp(profile['exp']);

  const handleUnavailable = (): void => {
    toast.show({ message: UNAVAILABLE_MSG });
  };

  return (
    <>
      <div class="profile-header">
        <LegacyAvatar
          id="profile-avatar"
          url={rawAvatar}
          name={displayName}
          baseClass="profile-avatar"
          imageContainerClass="profile-avatar profile-avatar-img"
          crown={secondary.enabled}
        />
        {/* B 無稱號成就系統，照 A 無稱號時輸出純顯示名稱 */}
        <div class="profile-title" id="profile-title" data-no-translate>
          {displayName}
        </div>
        <div
          id="profile-uid-wrap"
          style="margin-top:.25rem;display:flex;align-items:center;justify-content:center;gap:.3rem"
        >
          {canViewRawUid && uid && (
            <span style="font-size:.72rem;color:var(--text-muted);letter-spacing:.3px">
              {uid}
            </span>
          )}
          <button
            type="button"
            onClick={() => location.route('/profile/qr')}
            style="background:none;border:none;cursor:pointer;padding:2px;display:flex;align-items:center"
            title="顯示簽到 QR Code"
            aria-label="顯示簽到 QR Code"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-muted)"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="3" height="3" />
              <line x1="21" y1="14" x2="21" y2="17" />
              <line x1="17" y1="21" x2="21" y2="21" />
            </svg>
          </button>
        </div>
        <div id="profile-role-tag-wrap" style="margin-top:.3rem">
          <span
            class="uc-role-tag"
            style={`background:${roleInfo.color}22;color:${roleInfo.color}`}
          >
            {roleInfo.label}
          </span>
        </div>
        <div class="profile-level" id="profile-level">
          <span id="profile-lv">{`Lv.${level}`}</span>
          <div class="exp-bar">
            <div
              class="exp-fill"
              id="profile-exp-fill"
              style={`width:${percent}%`}
            />
          </div>
          <span class="exp-text" id="profile-exp-text">
            {`${progress.toLocaleString()} / ${needed.toLocaleString()}`}
          </span>
        </div>
      </div>

      <div id="profile-slot-banner" class="profile-scene-preview">
        <button
          type="button"
          class="profile-scene-key"
          onClick={handleUnavailable}
          aria-label="場景鑰匙"
        >
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="6" r="4" />
            <path d="M12 10v11m0-4h4m-4 4h4" />
          </svg>
        </button>
        <span class="profile-scene-stars" aria-hidden="true" />
        <span class="profile-scene-orb" aria-hidden="true" />
        <span class="profile-scene-title">Coming soon.</span>
        <span class="profile-scene-subtitle">── 敬請期待 ──</span>
        <span class="profile-scene-grass" aria-hidden="true" />
      </div>

      <div class="profile-stats">
        <div class="stat-item">
          <span class="stat-num" id="profile-stat-total">
            {summary ? String(summary.expectedCount) : '--'}
          </span>
          <span class="stat-label" data-i18n="應到場次">
            {lt('應到場次', '應到場次')}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-num" id="profile-stat-done">
            {summary ? String(summary.completedCount) : '--'}
          </span>
          <span class="stat-label" data-i18n="完成場次">
            {lt('完成場次', '完成場次')}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-num" id="profile-stat-rate">
            {summary ? `${summary.attendRate}%` : '--'}
          </span>
          <span class="stat-label" data-i18n="profile.attendanceRate">
            {lt('profile.attendanceRate', '出席率')}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-num" id="profile-stat-badges">--</span>
          <span class="stat-label" data-i18n="profile.badges">
            {lt('profile.badges', '徽章')}
          </span>
        </div>
      </div>

      <div class="quick-grid">
        <button type="button" class="quick-item" onClick={handleUnavailable}>
          <span>🏅</span>
          <span data-i18n="profile.achievements">
            {lt('profile.achievements', '成就/徽章')}
          </span>
        </button>
        <button type="button" class="quick-item" onClick={handleUnavailable}>
          <span>🎖️</span>
          <span data-i18n="profile.titles">{lt('profile.titles', '稱號')}</span>
        </button>
        <button
          type="button"
          class="quick-item disabled"
          disabled
          style="opacity:.35;filter:grayscale(1)"
        >
          <span>🎒</span>
          <span data-i18n="profile.inventory">
            {lt('profile.inventory', '道具欄')}
          </span>
        </button>
      </div>
    </>
  );
}
