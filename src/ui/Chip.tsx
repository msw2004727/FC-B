import './chip.css';
import type { JSX } from 'preact';
import { Text } from '@/ui/Text';
import { Icon, type IconName } from '@/ui/Icon';
import { useT } from '@/i18n/i18n';

export interface ChipProps {
  label?: string | null;
  /** 已格式化、已翻譯的第二行文字，例如活動數。 */
  description?: string;
  icon?: IconName;
  variant?: 'outline' | 'soft' | 'solid';
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onSelect?: (selected: boolean) => void;
  onRemove?: () => void;
  class?: string;
}

/**
 * 受控選取；選取與移除是相鄰按鈕，避免 button 巢狀及互相觸發。
 * 多個 Chip 的父容器應使用 flex-wrap: wrap。
 */
export function Chip({
  label,
  description,
  icon,
  variant = 'outline',
  size = 'md',
  selected = false,
  disabled = false,
  loading = false,
  onSelect,
  onRemove,
  class: className = '',
}: ChipProps): JSX.Element {
  const t = useT();
  const text = label?.trim() || t('ui.chip.empty');
  const detail = description?.trim();
  const blocked = disabled || loading;
  const accessibleName = detail ? `${text} ${detail}` : text;
  const removeLabel = t('ui.chip.remove', { label: text });
  const content = (
    <>
      {loading ? (
        /* Icon 尚無 spinner；inline SVG 僅以 transform 旋轉。 */
        <svg
          class="ui-chip__spinner"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M20 12a8 8 0 1 1-8-8" />
        </svg>
      ) : icon ? (
        <span class="ui-chip__icon" aria-hidden="true">
          <Icon name={icon} size={24} />
        </span>
      ) : null}
      <span class={`ui-chip__content${detail ? ' ui-chip__content--detail' : ''}`}>
        <Text class="ui-chip__label">{text}</Text>
        {detail && <Text class="ui-chip__description">{detail}</Text>}
      </span>
    </>
  );

  return (
    <span
      class={[
        'ui-chip',
        `ui-chip--${variant}`,
        `ui-chip--${size}`,
        selected ? 'ui-chip--selected' : '',
        disabled ? 'ui-chip--disabled' : '',
        loading ? 'ui-chip--loading' : '',
        onSelect || onRemove ? 'ui-chip--interactive' : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-busy={loading || undefined}
    >
      {onSelect ? (
        <button
          type="button"
          class="ui-chip__select"
          disabled={blocked}
          aria-pressed={selected}
          aria-label={accessibleName}
          title={accessibleName}
          onClick={() => {
            if (!blocked) onSelect(!selected);
          }}
        >
          {content}
        </button>
      ) : (
        <span class="ui-chip__display" title={accessibleName}>
          {content}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          class="ui-chip__remove"
          disabled={blocked}
          aria-label={removeLabel}
          title={removeLabel}
          onClick={() => {
            if (!blocked) onRemove();
          }}
        >
          {/* Icon 尚無 close；維持同一線性 SVG 規格。 */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </span>
  );
}
