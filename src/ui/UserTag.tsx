import './user-capsule.css';
import './user-tag.css';
import type { JSX } from 'preact';
import type { UserRole } from '@/ui/Avatar';
import { getCachedUserLevel } from '@/data/user-roles';
import { useT } from '@/i18n/i18n';

/**
 * 使用者膠囊：照 A `profile-core.js#_userTag` 的外觀（R-UI-020～025）。
 * `<… class="user-capsule uc-{role}" title="{角色名稱}"><span class="uc-lv">Lv{等級}</span>{名字}</…>`
 * - 底色表示角色（樣式為 A profile.css 原樣抽出，見 user-capsule.css）；角色名稱只在 title（照 A）。
 * - 身分只用 uid；點擊開個人名片（R-UI-023）。照 A 用 <span>（A base.css 的 button 重設會蓋掉膠囊底色），
 *   以 role="button"、tabIndex 與 Enter／Space 提供鍵盤操作。
 * - 等級：呼叫端沒給時用 useUserRoles 快取的 EXP 算（A `_calcLevelFromExp`）；隱身管理員在讀取時已當一般用戶（A `_stealthRole`）。
 * 2026-10-19 改寫，取代 B 原本「名字＋角色文字」的膠囊（站長要求外觀照舊版）。
 */
export interface UserTagProps {
  uid: string;
  name?: string | null;
  role?: UserRole;
  /** 不給時用快取；仍沒有就顯示 Lv0（A 查不到使用者時 exp 視為 0）。 */
  level?: number | null;
  disabled?: boolean;
  loading?: boolean;
  /** A uc-att-warn（出席率染色）；有值時 title 改成放鴿子說明。 */
  attendanceFill?: { pct: number; color: string; noShow: number; ended: number };
  recentNoShow?: boolean;
  onOpenProfile: (uid: string) => void;
  class?: string;
  /** A 俱樂部成員卡會把名字包成 `<span class="td-member-name-text">`（長名字省略號用）。 */
  nameClass?: string;
}

/** A `config.js#_BASE_ROLES` 的 label（title 用，照 A 不翻譯）。 */
const ROLE_LABELS: Record<UserRole, string> = {
  user: '一般用戶',
  coach: '教練',
  captain: '領隊',
  team_leader: '領隊',
  venue_owner: '場主',
  admin: '管理員',
  super_admin: '總管',
};

function roleClass(role: UserRole): string {
  return role === 'team_leader' ? 'uc-team-leader' : `uc-${role}`;
}

export function UserTag({
  uid,
  name,
  role = 'user',
  level,
  disabled = false,
  loading = false,
  attendanceFill,
  recentNoShow = false,
  onOpenProfile,
  class: className = '',
  nameClass,
}: UserTagProps): JSX.Element {
  const t = useT();
  const displayName = name?.trim() || t('ui.userTag.unknown');
  const resolvedLevel = level ?? getCachedUserLevel(uid) ?? 0;
  const blocked = disabled || loading || !uid.trim();
  const title = attendanceFill
    ? `放鴿子 ${attendanceFill.noShow}/${attendanceFill.ended} 場 (${attendanceFill.pct}%)`
    : ROLE_LABELS[role] ?? ROLE_LABELS.user;
  const style = attendanceFill
    ? { '--att-fill-pct': `${attendanceFill.pct}%`, '--att-fill-color': attendanceFill.color }
    : undefined;

  const open = (): void => {
    if (!blocked) onOpenProfile(uid);
  };

  return (
    <span
      role="button"
      tabIndex={blocked ? -1 : 0}
      aria-disabled={blocked || undefined}
      class={[
        'user-capsule',
        roleClass(role),
        attendanceFill ? 'uc-att-warn' : '',
        'ui-user-tag',
        blocked ? 'ui-user-tag--disabled' : '',
        className,
      ].filter(Boolean).join(' ')}
      style={style}
      data-no-translate
      data-profile-uid={uid}
      data-uid={uid}
      aria-busy={loading || undefined}
      aria-label={t('ui.userTag.openProfile', { name: displayName })}
      title={title}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
    >
      <span class="uc-lv">{`Lv${resolvedLevel}`}</span>
      {recentNoShow && (
        <span class="uc-recent-noshow" aria-label="最近一場活動未簽到" title="最近一場活動未簽到">🕊</span>
      )}
      {nameClass ? <span class={nameClass}>{displayName}</span> : displayName}
    </span>
  );
}
