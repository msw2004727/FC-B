import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { SHOW_EXP } from '@/core/exp-display';
import { userLevelFromExp } from '@/data/user-roles';
import { useT } from '@/i18n/i18n';
import { isBrokenAvatarUrl, rememberBrokenAvatarUrl, type UserRole } from '@/ui/Avatar';
import type { CustomRoleInput } from '@/ui/drawer-menu';
import { UserTag } from '@/ui/UserTag';
import { getAvatarInitial, sanitizeHttpAvatarUrl } from '@/features/profile/components/legacy/profile-legacy-helpers';

import {
  canToggleRestrictionOf,
  formatLastLogin,
  genderIcon,
  roleLabel,
  showsEditButton,
  tagRole,
  type AdminUser,
  type AdminUserActor,
} from '../data/admin-users-model';

export interface UserCardProps {
  user: AdminUser;
  actor: AdminUserActor;
  /** A `_canViewRawUid`：只有 admin／super_admin 看得到原始 UID。 */
  canViewRawUid: boolean;
  customRoles: readonly CustomRoleInput[];
  /** 某個操作進行中（編輯儲存或限制）時鎖住按鈕，避免重複送出。 */
  busy: boolean;
  /** 第二個參數是被按下的「編輯」鈕，彈窗關閉後（commit 完成才）把焦點還給它。 */
  onEdit: (user: AdminUser, trigger: HTMLElement) => void;
  onToggleRestriction: (user: AdminUser) => void;
  onOpenProfile: (uid: string) => void;
}

const TAG_ROLES: ReadonlySet<string> = new Set<UserRole>([
  'user', 'coach', 'captain', 'team_leader', 'venue_owner', 'admin', 'super_admin',
]);

/** A `_buildAvatarImageMarkup`：有網址顯示圖片，壞圖或沒有網址換成首字圓形。 */
function UserAvatar({ url, name }: { url: string; name: string }): JSX.Element {
  const safeUrl = sanitizeHttpAvatarUrl(url);
  const [broken, setBroken] = useState(() => isBrokenAvatarUrl(safeUrl));
  useEffect(() => {
    setBroken(isBrokenAvatarUrl(safeUrl));
  }, [safeUrl]);

  if (!safeUrl || broken) {
    return <div class="au-avatar au-avatar-fallback">{getAvatarInitial(name)}</div>;
  }
  return (
    <img
      src={safeUrl}
      class="au-avatar"
      alt={name || 'avatar'}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      style="object-fit:cover"
      onError={() => {
        rememberBrokenAvatarUrl(safeUrl);
        setBroken(true);
      }}
    />
  );
}

/** 用戶卡：DOM／class 逐字照 A `renderAdminUsers`。 */
export function UserCard({
  user,
  actor,
  canViewRawUid,
  customRoles,
  busy,
  onEdit,
  onToggleRestriction,
  onOpenProfile,
}: UserCardProps): JSX.Element {
  const t = useT();
  const level = userLevelFromExp(user.exp);
  const gender = genderIcon(user.gender);
  const primaryMeta = [
    canViewRawUid ? user.uid : '',
    roleLabel(user.role, customRoles),
    SHOW_EXP ? `Lv.${level}` : '',
    (user.region || '—') + (gender ? ` ${gender}` : '') + (user.teamName ? ` ・${user.teamName}` : ''),
  ].filter(Boolean);
  const secondMeta = `${user.sports || '—'}${SHOW_EXP ? ` ・EXP ${user.exp.toLocaleString()}` : ''}`;
  const tagRoleKey = tagRole(user);
  const restrictBtn = canToggleRestrictionOf(actor, user);

  return (
    <div class="admin-user-card">
      <UserAvatar url={user.pictureUrl} name={user.name || '?'} />
      <div class="admin-user-body">
        <div class="admin-user-info">
          <div class="admin-user-name">
            <UserTag
              uid={user.uid}
              name={user.name}
              role={(TAG_ROLES.has(tagRoleKey) ? tagRoleKey : 'user') as UserRole}
              level={level}
              onOpenProfile={onOpenProfile}
            />
          </div>
          <div class="admin-user-meta">{primaryMeta.join(' ・')}</div>
          <div class="admin-user-meta">{secondMeta}</div>
          <div class="admin-user-meta" style="word-break:break-all">
            {`${t('admin-users.card.email')}${user.email.trim() || '—'}`}
          </div>
          <div class="admin-user-meta">
            {`${t('admin-users.card.restrictState')}${user.isRestricted ? t('admin-users.card.restricted') : t('admin-users.card.normal')}`}
          </div>
          <div class="admin-user-meta" style="word-break:break-all">
            {`${t('admin-users.card.lastLogin')}${formatLastLogin(user, t('admin-users.card.noRecord'))}`}
          </div>
        </div>
        <div class="admin-user-actions">
          {showsEditButton(actor, user) && (
            <button
              type="button"
              class="au-btn au-btn-edit"
              data-edit-user-doc={user._docId}
              disabled={busy}
              onClick={(event) => onEdit(user, event.currentTarget)}
            >
              {t('admin-users.card.edit')}
            </button>
          )}
          <button type="button" class="au-btn au-btn-view" onClick={() => onOpenProfile(user.uid)}>
            {t('admin-users.card.view')}
          </button>
          {restrictBtn && (
            <button
              type="button"
              class={`au-btn ${user.isRestricted ? 'au-btn-view' : 'au-btn-edit'}`}
              disabled={busy}
              onClick={() => onToggleRestriction(user)}
            >
              {user.isRestricted ? t('admin-users.card.unrestrict') : t('admin-users.card.restrict')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
