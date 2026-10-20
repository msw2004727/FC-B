import './empty-state.css';
import type { ComponentChildren, JSX } from 'preact';
import { useId } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';

export interface EmptyStateProps {
  /** M-054：裝飾性圖示；未傳或傳 null 皆不顯示預設日曆圖，僅在呼叫端明確傳入時顯示。 */
  icon?: ComponentChildren;
  /** 呼叫端傳入已翻譯文字；空字串使用預設空狀態標題。 */
  title?: string | null;
  /** M-054：說明文字；未傳或空字串時不自動補「找一場活動，或建立你的第一場活動」。 */
  body?: string | null;
  /** 操作元件插槽；內部文字仍應使用 Text。 */
  action?: ComponentChildren;
  class?: string;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  class: className = '',
}: EmptyStateProps): JSX.Element {
  const t = useT();
  const id = useId();
  const heading = title?.trim() || t('ui.emptyState.title');
  const description = body?.trim() || '';

  return (
    <section
      class={`ui-empty-state ${className}`.trim()}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-body` : undefined}
    >
      {icon != null && (
        <div
          class="ui-empty-state__icon"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <div id={`${id}-title`}>
        <Text as="p" class="ui-empty-state__title">{heading}</Text>
      </div>
      {description && (
        <div id={`${id}-body`}>
          <Text as="p" class="ui-empty-state__body">{description}</Text>
        </div>
      )}
      {action != null && (
        <div class="ui-empty-state__action">{action}</div>
      )}
    </section>
  );
}
