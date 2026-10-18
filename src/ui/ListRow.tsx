import './list-row.css';
import type { JSX } from 'preact';
import { Text } from '@/ui/Text';
import { Action, type ActionProps } from './action';

export interface ListRowProps
  extends Omit<ActionProps, 'children' | 'title' | 'busy' | 'type' | 'aria-pressed'> {
  title: string;
  subtitle?: string;
  leading?: JSX.Element;
  trailing?: JSX.Element;
  selected?: boolean;
}

/**
 * 放在 ul / ol 中；外層永遠保留 li，內部依需要使用原生 a / button。
 * 可點版本的 leading / trailing 不得包含連結、按鈕或其他可聚焦控制項。
 * 若 trailing 需要獨立按鈕，使用靜態 row 並在 trailing 放該按鈕。
 * selected + button 表示 toggle selection；導覽連結請另傳 aria-current。
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  selected,
  disabled = false,
  class: className,
  ...props
}: ListRowProps): JSX.Element {
  const interactive = props.href !== undefined || props.onClick !== undefined;
  const content = (
    <>
      {leading && <span class="ui-list-row__leading">{leading}</span>}
      <span class="ui-list-row__content">
        <span class="ui-list-row__title" title={title}>
          <Text>{title}</Text>
        </span>
        {subtitle !== undefined && (
          <Text class="ui-list-row__subtitle">{subtitle}</Text>
        )}
      </span>
      {trailing && <span class="ui-list-row__trailing">{trailing}</span>}
    </>
  );

  return (
    <li
      class={[
        'ui-list-row',
        selected ? 'ui-list-row--selected' : '',
        disabled ? 'ui-list-row--disabled' : '',
        interactive ? 'ui-list-row--interactive' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      aria-disabled={!interactive && disabled ? true : undefined}
    >
      {interactive ? (
        <Action
          {...props}
          class="ui-list-row__body"
          disabled={disabled}
          aria-pressed={props.href === undefined ? selected : undefined}
        >
          {content}
        </Action>
      ) : (
        <div
          id={props.id}
          class="ui-list-row__body"
          aria-label={props['aria-label']}
          aria-describedby={props['aria-describedby']}
        >
          {content}
        </div>
      )}
    </li>
  );
}
