import './empty-state.css';
import type { ComponentChildren, JSX } from 'preact';
import { useId } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';

export interface EmptyStateProps {
  /** 裝飾性圖示；null 可隱藏。預設為 A 版日曆插圖。 */
  icon?: ComponentChildren;
  /** 呼叫端傳入已翻譯文字；空字串使用預設空狀態文案。 */
  title?: string | null;
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
  const description = body?.trim() || t('ui.emptyState.body');

  return (
    <section
      class={`ui-empty-state ${className}`.trim()}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
    >
      {icon !== null && (
        <div
          class={`ui-empty-state__icon${icon === undefined ? ' ui-empty-state__icon--calendar' : ''}`}
          aria-hidden="true"
        >
          {icon === undefined ? (
            /* Icon 尚無 A 版填色日曆插圖；使用 inline SVG。 */
            <svg
              width="128"
              height="88"
              viewBox="0 0 128 88"
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <rect class="ui-empty-state__calendar" x=".5" y=".5" width="127" height="87" rx="20" />
              <path class="ui-empty-state__binding" d="M19 15h12v8H19zm25 0h12v8H44zm25 0h12v8H69zm25 0h12v8H94z" />
              <g class="ui-empty-state__cell">
                <rect x="19" y="30" width="24" height="17" rx="6" />
                <rect x="52" y="30" width="24" height="17" rx="6" />
                <rect x="85" y="30" width="24" height="17" rx="6" />
                <rect x="19" y="55" width="24" height="17" rx="6" />
              </g>
              <rect class="ui-empty-state__add" x="52" y="55" width="24" height="17" rx="5" />
              <path class="ui-empty-state__plus" d="M64 59v9m-4.5-4.5h9" stroke-width="2" stroke-linecap="round" />
            </svg>
          ) : icon}
        </div>
      )}
      <div id={`${id}-title`}>
        <Text as="p" class="ui-empty-state__title">{heading}</Text>
      </div>
      <div id={`${id}-body`}>
        <Text as="p" class="ui-empty-state__body">{description}</Text>
      </div>
      {action != null && (
        <div class="ui-empty-state__action">{action}</div>
      )}
    </section>
  );
}
