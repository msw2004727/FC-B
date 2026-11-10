import type { JSX } from 'preact';
import { SHOW_EXP } from '@/core/exp-display';
import { useEffect, useState } from 'preact/hooks';

import { emit } from '@/core/events';
import { useUserRoles } from '@/data/user-roles';
import type { UserProfile } from '../../data/profile-model';
import type { ViewerView } from '../../data/viewer';
import type { UserAttendanceSummary } from '../../data/attendance-summary';
import { buildPlayerCardModel } from '../../data/player-card-model';
import { loadProfilePopularityViews } from '../../data/profile-popularity';
import { popularityStars } from '../../data/popularity-tiers';
import { buildShareUrl } from '@/features/events/data/event-share-builders';
import { PlayerCard } from '../PlayerCard';
import { PlayerCardShareButton } from '../PlayerCardShareButton';
import { IdentityCrownSvg } from '@/ui/IdentityCrown';
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
  // T-092：頂部改成球員卡；UID＋QR、身分標籤、分享按鈕移到卡片外（不進 PNG）。
  // 11-06 站長：身分標籤移到卡片上方（與鎖頭同一列），分享按鈕接在 UID＋QR 下方（原身分標籤位置）。
  // PNG CMP 欄下方 QR：只有本人的球員卡才放，內容與 A `_buildProfileLiffUrl` 相同的個人名片分享網址
  // （MINI_APP_BASE_URL + '?profile=' + encodeURIComponent(uid)，R-SHARE-001／004）。網頁卡面不顯示。
  const isSelf = Boolean(uid && viewer.uid && uid === viewer.uid);
  const cardQrText = isSelf ? buildShareUrl('profile', uid) : null;
  // 人氣只在看自己時背景讀；失敗或尚未部署維持 null，球員卡首屏先照舊畫，載入完才出現星星。
  const [popularityViews, setPopularityViews] = useState<number | null>(null);
  useEffect(() => {
    if (!isSelf) {
      setPopularityViews(null);
      return undefined;
    }
    let alive = true;
    loadProfilePopularityViews(uid).then(
      (views) => {
        if (alive) setPopularityViews(views);
      },
      () => {
        if (alive) setPopularityViews(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [isSelf, uid]);
  const cardModel = buildPlayerCardModel({
    name: displayName,
    uid,
    avatarUrl: rawAvatar,
    summary,
    teamIds: viewer.teamIds,
    // 身分圖案：沿用上方已算好的有效身分與已載入的 profile.gender，0 次額外讀取。
    role: effectiveRole,
    gender: profile['gender'],
    popularityStars: popularityViews == null ? null : popularityStars(popularityViews),
  });

  return (
    <div class="profile-header player-card-header">
      <PlayerCard
        model={cardModel}
        popularityViews={isSelf ? popularityViews : undefined}
        avatar={(
          <LegacyAvatar
            id="profile-avatar"
            url={rawAvatar}
            name={cardModel.name === '-' ? '' : cardModel.name}
            baseClass="profile-avatar"
            imageContainerClass="profile-avatar profile-avatar-img"
            crown={isSecondary}
          />
        )}
        topBar={(
          <div id="profile-role-tag-wrap">
            <span
              class="uc-role-tag"
              style={`background:${roleInfo.color}22;color:${roleInfo.color}`}
            >
              {roleInfo.label}
            </span>
          </div>
        )}
      />
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
      <div>
        <PlayerCardShareButton model={cardModel} qrText={cardQrText} />
      </div>
    </div>
  );
}
