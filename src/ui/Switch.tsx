import './switch.css';
import { useId } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';

export interface SwitchProps {
  id?: string;
  name?: string;
  value?: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  class?: string;
}

export function Switch({
  id,
  name,
  value = 'on',
  label,
  checked,
  onCheckedChange,
  disabled = false,
  loading = false,
  class: className = '',
}: SwitchProps) {
  const generatedId = useId();
  const controlId = id ?? `switch-${generatedId}`;
  const t = useT();
  const blocked = disabled || loading;

  function toggle() {
    if (!blocked) onCheckedChange(!checked);
  }

  return (
    <div class={`ui-switch${checked ? ' ui-switch--checked' : ''} ${className}`}>
      <button
        id={controlId}
        type="button"
        role="switch"
        class="ui-switch__button"
        aria-checked={checked}
        aria-labelledby={`${controlId}-label`}
        aria-describedby={loading ? `${controlId}-loading` : undefined}
        aria-busy={loading || undefined}
        disabled={blocked}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return;
          // 阻止瀏覽器的後續合成 click，避免一次鍵盤操作切換兩次。
          event.preventDefault();
          if (!event.repeat) toggle();
        }}
      >
        <span id={`${controlId}-label`} class="ui-switch__label"><Text>{label}</Text></span>
        <span class="ui-switch__track" aria-hidden="true">
          <span class="ui-switch__thumb">
            {/* Icon 未提供 check/close；使用局部 inline SVG。 */}
            <svg width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true" focusable="false">
              <path d={checked ? 'm5 12 4 4L19 6' : 'm7 7 10 10M17 7 7 17'} />
            </svg>
          </span>
        </span>
        <span class="ui-switch__state" aria-hidden="true">
          <Text>{t(checked ? 'ui.switch.on' : 'ui.switch.off')}</Text>
        </span>
      </button>
      {name && checked && !blocked && <input type="hidden" name={name} value={value} />}
      {loading && <div id={`${controlId}-loading`} role="status"><Text>{t('ui.switch.loading')}</Text></div>}
    </div>
  );
}
