import './card.css';
import type { ComponentChildren, JSX } from 'preact';
import { Action, renderContent, type ActionProps } from './action';

export interface CardProps extends Omit<ActionProps, 'children' | 'busy' | 'type'> {
  children: ComponentChildren;
  variant?: 'default' | 'outlined' | 'elevated' | 'interactive';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

/**
 * href 優先渲染 a，否則有 onClick 或 interactive variant 時渲染 button。
 * 整卡可點時，children 只能包含非互動 phrasing content（例如 span/Text/Icon）。
 * 需要標題、段落、按鈕等複合內容時使用靜態 Card，於卡內放獨立控制項。
 * children 中原始字串／數字自動經 Text；傳入的 JSX 自行使用 Text。
 */
export function Card({
  children,
  variant = 'default',
  padding = 'md',
  class: className,
  disabled = false,
  ...props
}: CardProps): JSX.Element {
  const interactive = props.href !== undefined || props.onClick !== undefined || variant === 'interactive';
  const classes = [
    'ui-card',
    `ui-card--${variant}`,
    `ui-card--padding-${padding}`,
    interactive && variant !== 'interactive' ? 'ui-card--interactive' : '',
    className ?? '',
  ].filter(Boolean).join(' ');
  const content = renderContent(children);

  if (interactive) {
    return (
      <Action {...props} class={classes} disabled={disabled}>
        {content}
      </Action>
    );
  }

  return (
    <div
      id={props.id}
      class={classes}
      title={props.title}
      aria-label={props['aria-label']}
      aria-describedby={props['aria-describedby']}
      aria-disabled={disabled || undefined}
    >
      {content}
    </div>
  );
}
