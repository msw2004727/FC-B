import type { ComponentChildren, JSX } from 'preact';
import { toChildArray } from 'preact';
import { Text } from '@/ui/Text';

/**
 * 保留原生 button / anchor 鍵盤行為，不以 keydown 重造瀏覽器 activation。
 */
export interface ActionProps {
  children?: ComponentChildren;
  class?: string;
  id?: string;
  style?: JSX.CSSProperties | string;
  href?: string;
  target?: '_self' | '_blank' | '_parent' | '_top';
  rel?: string;
  title?: string;
  disabled?: boolean;
  busy?: boolean;
  type?: 'button' | 'submit' | 'reset';
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-controls'?: string;
  'aria-expanded'?: boolean;
  'aria-pressed'?: boolean;
  'aria-current'?: 'page' | 'step' | 'location' | 'date' | 'time' | true | false;
  onClick?: (event: JSX.TargetedMouseEvent<HTMLElement>) => void;
}

export function renderContent(children: ComponentChildren): ComponentChildren {
  return toChildArray(children).map((child, index) =>
    typeof child === 'string' || typeof child === 'number'
      ? <Text key={index}>{child}</Text>
      : child,
  );
}

/** Internal primitive. Interactive children must not contain other controls. */
export function Action({
  children,
  class: className,
  id,
  style,
  href,
  target,
  rel,
  title,
  disabled = false,
  busy = false,
  type = 'button',
  onClick,
  ...aria
}: ActionProps): JSX.Element {
  const blocked = disabled || busy;

  function handleClick(event: JSX.TargetedMouseEvent<HTMLElement>): void {
    if (blocked) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  }

  const common = {
    ...aria,
    id,
    class: className,
    style,
    title,
    'data-btn-loading': busy ? '1' : undefined,
    'aria-disabled': blocked || undefined,
    'aria-busy': busy || undefined,
    onClick: handleClick,
  };

  if (href !== undefined) {
    const safeRel = target === '_blank'
      ? [...new Set(`${rel ?? ''} noopener noreferrer`.split(/\s+/).filter(Boolean))].join(' ')
      : rel;

    return (
      <a
        {...common}
        href={blocked ? undefined : href}
        role={blocked ? 'link' : undefined}
        tabIndex={blocked ? -1 : undefined}
        target={target}
        rel={safeRel}
        onAuxClick={(event) => {
          if (blocked) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onKeyDown={(event) => {
          if (blocked && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <button {...common} type={type} disabled={blocked}>
      {children}
    </button>
  );
}
