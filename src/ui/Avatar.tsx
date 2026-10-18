import './avatar.css';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';

export type UserRole =
  | 'user'
  | 'coach'
  | 'captain'
  | 'team_leader'
  | 'venue_owner'
  | 'admin'
  | 'super_admin';

export interface AvatarProps {
  name?: string | null;
  pictureUrl?: string | null;
  avatarUrl?: string | null;
  role?: UserRole;
  size?: 'sm' | 'md' | 'lg';
  decorative?: boolean;
  class?: string;
}

/* A 抽屜實測 44px；lg 沿用 A，sm / md 依通用規格。 */
const sizes = { sm: 24, md: 32, lg: 44 } as const;

function initialOf(name: string): string {
  const Segmenter = Intl.Segmenter;
  if (typeof Segmenter === 'function') {
    const first = new Segmenter(undefined, { granularity: 'grapheme' })
      .segment(name)[Symbol.iterator]().next().value;
    return (first?.segment ?? '').toUpperCase();
  }
  return (Array.from(name)[0] ?? '').toUpperCase();
}

interface AvatarImageProps {
  src: string | null;
  name: string;
  initial: string;
  size: number;
  decorative: boolean;
}

/** key 隨來源改變；失敗狀態不會污染下一張圖片。 */
function AvatarImage({
  src,
  name,
  initial,
  size,
  decorative,
}: AvatarImageProps): JSX.Element {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <img
        class="ui-avatar__image"
        src={src}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        alt={decorative ? '' : name}
        aria-hidden={decorative || undefined}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      class="ui-avatar__fallback"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      <Text class="ui-avatar__initial">{initial}</Text>
    </span>
  );
}

export function Avatar({
  name,
  pictureUrl,
  avatarUrl,
  role = 'user',
  size = 'md',
  decorative = false,
  class: className = '',
}: AvatarProps): JSX.Element {
  const t = useT();
  const displayName = name?.trim() || t('ui.avatar.unknown');
  // 空字串不回退 avatarUrl：嚴格遵守 ?? 的優先序，空來源顯示色塊。
  const source = (pictureUrl ?? avatarUrl)?.trim() || null;
  const initial = initialOf(displayName);

  return (
    <span
      class={`ui-avatar ui-avatar--${size} ui-avatar--${role} ${className}`.trim()}
      aria-hidden={decorative || undefined}
    >
      <AvatarImage
        key={source ?? ''}
        src={source}
        name={displayName}
        initial={initial}
        size={sizes[size]}
        decorative={decorative}
      />
    </span>
  );
}
