import type { JSX } from 'preact';
import { SHOW_EXP } from '@/core/exp-display';
import { useEffect, useState } from 'preact/hooks';

import { emit } from '@/core/events';
import { useUserRoles } from '@/data/user-roles';
import { lt } from '@/i18n/i18n';
import { useLocation } from 'preact-iso';
import type { UserProfile } from '../../data/profile-model';
import type { ViewerView } from '../../data/viewer';
import type { UserAttendanceSummary } from '../../data/attendance-summary';
import { useIdentitySettings } from '@/data/identity-settings';
import { getEffectiveIdentity } from '@/data/identity-resolver';
import {
  ROLE_DISPLAY_MAP,
  calcLevelFromExp,
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
  const rolesMap = useUserRoles([uid]);
  const effectiveRole = resolveEffectiveRole(profile, rolesMap[uid]);
  const roleInfo = ROLE_DISPLAY_MAP[effectiveRole] ?? ROLE_DISPLAY_MAP.user;

  // 照 A `renderProfileData`：用 `getCurrentIdentity('profile')` 解析有效身份。
  const identitySettings = useIdentitySettings();
  const canUseSecondary = viewer.hasPermission('profile.secondary_identity');
  const identity = getEffectiveIdentity(
    {
      uid,
      displayName:
        typeof profile['displayName'] === 'string' ? profile['displayName'] : null,
      name: profile.name,
      pictureUrl:
        typeof profile['pictureUrl'] === 'string' ? profile['pictureUrl'] : null,
      photoURL:
        typeof profile['picture'] === 'string' ? profile['picture'] : null,
    },
    {
      settings: identitySettings,
      surface: 'profile',
      allowSecondaryIdentity: canUseSecondary,
    },
  );
  const displayName = (identity?.displayName ?? '').trim() || '-';
  const rawAvatar = sanitizeHttpAvatarUrl(identity?.pictureUrl ?? null);
  const isSecondary = identity?.identityId === 'secondary';

  // A `_canViewRawUid`：只有 admin / super_admin 看得到原始 UID。
  const canViewRawUid =
    isAdminPlusRole(viewer.role)
    || isAdminPlusRole(typeof profile['role'] === 'string' ? profile['role'] : '')
    || isAdminPlusRole(rolesMap[uid]);

  const { level, progress, needed, percent } = calcLevelFromExp(profile['exp']);

  // 照 A `_buildTitleDisplayHtml` / `getCurrentBadgeCount`：頭部徽章數與稱號於資料載入後更新。
  //   動態 import 成就資料層，避免 firestore 進首屏。載入失敗保留 `--` 與純名字。
  const [badgeCount, setBadgeCount] = useState<string>('--');
  const [titleParts, setTitlePartsState] = useState<{
    big: string | null;
    normal: string | null;
  }>({ big: null, normal: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@/features/exp-achievements/data/achievements');
        const [defs, progressMap] = await Promise.all([
          mod.loadAchievementDefs(),
          mod.loadUserAchievementProgress(uid),
        ]);
        if (cancelled) return;
        const evaluated = mod.evaluateFromProgress(defs.achievements, progressMap);
        const { completed } = mod.splitPendingCompleted(evaluated);
        const earned = mod.getEarnedBadges(completed, defs.badges);
        setBadgeCount(String(earned.length));
        setTitlePartsState(
          mod.buildTitleParts(
            { titleBig: profile['titleBig'], titleNormal: profile['titleNormal'] },
            evaluated,
          ),
        );
      } catch (err) {
        // 照 A：載入失敗不影響頭部其他欄位。
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.warn('[profile] load achievements for header failed', err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // 只在 uid／稱號欄位變動時重讀，避免 profile 物件識別改變造成重複。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, profile.titleBig, profile.titleNormal]);

  const location = useLocation();

  return (
    <>
      <div class="profile-header">
        <LegacyAvatar
          id="profile-avatar"
          url={rawAvatar}
          name={displayName}
          baseClass="profile-avatar"
          imageContainerClass="profile-avatar profile-avatar-img"
          crown={isSecondary}
        />
        {/* 照 A `_buildTitleDisplayHtml`：金／銀稱號標籤 + 名字 */}
        <div class="profile-title" id="profile-title" data-no-translate>
          {titleParts.big ? (
            <>
              <span class="title-tag title-gold">{titleParts.big}</span>
              <span class="title-dot">·</span>
            </>
          ) : null}
          {titleParts.normal ? (
            <>
              <span class="title-tag title-normal">{titleParts.normal}</span>
              <span class="title-dot">·</span>
            </>
          ) : null}
          <span>{displayName}</span>
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
            onClick={() => emit('qr:open', {})}
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
        {/* 新版關閉經驗值顯示時不畫等級條（src/core/exp-display.ts） */}
        {SHOW_EXP && (
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
        )}
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
          <span class="stat-num" id="profile-stat-badges">{badgeCount}</span>
          <span class="stat-label" data-i18n="profile.badges">
            {lt('profile.badges', '徽章')}
          </span>
        </div>
      </div>

      <div class="quick-grid">
        <button
          type="button"
          class="quick-item"
          onClick={() => location.route('/achievements')}
        >
          <span>🏅</span>
          <span data-i18n="profile.achievements">
            {lt('profile.achievements', '成就/徽章')}
          </span>
        </button>
        <button
          type="button"
          class="quick-item"
          onClick={() => location.route('/titles')}
        >
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
