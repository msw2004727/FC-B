import './icon-button.css';
import './button.css';
import type { JSX } from 'preact';
import { Icon, type IconName } from '@/ui/Icon';
import { Action, type ActionProps } from './action';
import type { ButtonSize, ButtonVariant } from './Button';

export interface IconButtonProps
  extends Omit<ActionProps, 'children' | 'aria-label' | 'title' | 'busy'> {
  /** 必須由呼叫端以 t() / useT() 取得翻譯。 */
  label: string;
  name: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function IconButton({
  label,
  name,
  variant = 'ghost',
  size = 'md',
  class: className,
  ...props
}: IconButtonProps): JSX.Element {
  return (
    <Action
      {...props}
      aria-label={label}
      title={label}
      class={[
        'ui-button',
        `ui-button--${variant}`,
        'ui-icon-button',
        `ui-icon-button--${variant}`,
        `ui-icon-button--${size}`,
        className ?? '',
      ].filter(Boolean).join(' ')}
    >
      <span class="ui-icon-button__icon" aria-hidden="true">
        <Icon name={name} size={size === 'lg' ? 24 : 18} />
      </span>
    </Action>
  );
}
