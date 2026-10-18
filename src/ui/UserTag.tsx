import './user-tag.css';
import type { JSX } from 'preact';
import { Text } from '@/ui/Text';
import { Badge } from '@/ui/Badge';
import type { UserRole } from '@/ui/Avatar';
import { formatNumber, useT } from '@/i18n/i18n';

export interface UserTagProps {
  uid: string;
  name?: string | null;
  role?: UserRole;
  /** undefined 不顯示；null 或無效值顯示「未設定等級」。 */
  level?: number | null;
  disabled?: boolean;
  loading?: boolean;
  attendanceWarning?: boolean;
  recentNoShow?: boolean;
  /** undefined 不顯示；null 或空字串顯示「未設背號」。 */
  jersey?: string | number | null;
  onOpenProfile: (uid: string) => void;
  class?: string;
}

const roleKeys: Record<UserRole, string> = {
  user: 'ui.userTag.role.user',
  coach: 'ui.userTag.role.coach',
  captain: 'ui.userTag.role.captain',
  team_leader: 'ui.userTag.role.team_leader',
  venue_owner: 'ui.userTag.role.venue_owner',
  admin: 'ui.userTag.role.admin',
  super_admin: 'ui.userTag.role.super_admin',
};

export function UserTag({
  uid,
  name,
  role = 'user',
  level,
  disabled = false,
  loading = false,
  attendanceWarning = false,
  recentNoShow = false,
  jersey,
  onOpenProfile,
  class: className = '',
}: UserTagProps): JSX.Element {
  const t = useT();
  const displayName = name?.trim() || t('ui.userTag.unknown');
  const roleName = t(roleKeys[role]);
  // 比照 jersey：undefined 不顯示（經驗值為預留功能，多數呼叫端沒有等級），null 或無效值顯示「未設定」。
  const levelText = level === undefined
    ? ''
    : level != null && Number.isFinite(level) && level >= 0
      ? t('ui.userTag.level', { level: formatNumber(level) })
      : t('ui.userTag.levelUnset');
  const jerseyValue = typeof jersey === 'number'
    ? (Number.isFinite(jersey) ? formatNumber(jersey) : '')
    : jersey?.trim();
  const jerseyText = jerseyValue
    ? t('ui.userTag.jersey', { number: jerseyValue })
    : t('ui.userTag.jerseyUnset');
  const blocked = disabled || loading || !uid.trim();
  const details = [
    roleName,
    levelText,
    attendanceWarning ? t('ui.userTag.attendanceWarning') : '',
    recentNoShow ? t('ui.userTag.recentNoShow') : '',
    jersey !== undefined ? jerseyText : '',
  ].filter(Boolean).join(' · ');
  const accessibleName = `${t('ui.userTag.openProfile', { name: displayName })} · ${details}`;

  return (
    <button
      type="button"
      class={[
        'ui-user-tag',
        `ui-user-tag--${role}`,
        disabled ? 'ui-user-tag--disabled' : '',
        loading ? 'ui-user-tag--loading' : '',
        className,
      ].filter(Boolean).join(' ')}
      data-uid={uid}
      disabled={blocked}
      aria-busy={loading || undefined}
      aria-label={accessibleName}
      title={accessibleName}
      onClick={() => {
        if (!blocked) onOpenProfile(uid);
      }}
    >
      <span class="ui-user-tag__identity">
        <Text class="ui-user-tag__name">{displayName}</Text>
        <Text class="ui-user-tag__role">{roleName}</Text>
      </span>
      {levelText && <Text class="ui-user-tag__level">{levelText}</Text>}
      {attendanceWarning && (
        <Badge tone="warning" label={t('ui.userTag.attendanceWarning')} />
      )}
      {recentNoShow && (
        <Badge tone="danger" label={t('ui.userTag.recentNoShow')} />
      )}
      {jersey !== undefined && <Badge label={jerseyText} />}
    </button>
  );
}
