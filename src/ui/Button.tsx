import './button.css';
import type { JSX } from 'preact';
import { Text } from '@/ui/Text';
import { Action, type ActionProps } from './action';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ActionProps, 'children' | 'busy'> {
  children: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leading?: JSX.Element;
  trailing?: JSX.Element;
}

/**
 * children 由呼叫端以 t() 提供；leading / trailing 僅放裝飾圖示。
 * loading 保留名稱並透過 aria-busy 表達，沒有額外固定文案。
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  leading,
  trailing,
  class: className,
  ...props
}: ButtonProps): JSX.Element {
  return (
    <Action
      {...props}
      busy={loading}
      class={[
        'ui-button',
        `ui-button--${variant}`,
        `ui-button--${size}`,
        loading ? 'ui-button--loading' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
    >
      {loading ? (
        // Icon.tsx 尚無 spinner；使用裝飾性 inline SVG，不修改圖示清單。
        <svg
          class="ui-button__spinner"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 3a9 9 0 1 1-9 9" />
        </svg>
      ) : leading ? (
        <span class="ui-button__icon" aria-hidden="true">{leading}</span>
      ) : null}
      <Text class="ui-button__label">{children}</Text>
      {trailing && (
        <span class="ui-button__icon" aria-hidden="true">{trailing}</span>
      )}
    </Action>
  );
}
