import './badge.css';
import type { JSX } from 'preact';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export type BadgeVariant = 'soft' | 'solid' | 'outline';
export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps {
  label?: string | null;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: BadgeSize;
  disabled?: boolean;
  class?: string;
}

/** 純展示；狀態更新需要公告時，由使用端提供 role="status" 容器。 */
export function Badge({
  label,
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  disabled = false,
  class: className = '',
}: BadgeProps): JSX.Element {
  const t = useT();
  const text = label?.trim() || t('ui.badge.empty');

  return (
    <span
      class={[
        'ui-badge',
        `ui-badge--${tone}`,
        `ui-badge--${variant}`,
        `ui-badge--${size}`,
        disabled ? 'ui-badge--disabled' : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-disabled={disabled || undefined}
      title={text}
    >
      <Text class="ui-badge__label">{text}</Text>
    </span>
  );
}
