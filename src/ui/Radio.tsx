import './radio.css';
import type { Ref } from 'preact';
import { useId, useRef } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';
import { descriptionIds } from './form-types';

export interface RadioProps {
  id?: string;
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  describedBy?: string;
  tabIndex?: number;
  inputRef?: Ref<HTMLInputElement>;
  class?: string;
}

export function Radio({
  id,
  name,
  value,
  label,
  checked,
  onCheckedChange,
  required = false,
  disabled = false,
  loading = false,
  error,
  describedBy,
  tabIndex,
  inputRef,
  class: className = '',
}: RadioProps) {
  const generatedId = useId();
  const controlId = id ?? `radio-${generatedId}`;
  const internalRef = useRef<HTMLInputElement>(null);
  const t = useT();

  return (
    <div
      class={`ui-radio${checked ? ' ui-radio--checked' : ''} ${className}`}
      aria-busy={loading || undefined}
    >
      <label class="ui-radio__label" for={controlId}>
        <input
          ref={(element) => {
            internalRef.current = element;
            if (typeof inputRef === 'function') inputRef(element);
            else if (inputRef) inputRef.current = element;
          }}
          id={controlId}
          type="radio"
          name={name}
          value={value}
          checked={checked}
          required={required}
          disabled={disabled || loading}
          tabIndex={tabIndex}
          aria-invalid={Boolean(error)}
          aria-describedby={descriptionIds(
            describedBy,
            error && `${controlId}-error`,
            loading && `${controlId}-loading`,
          )}
          onChange={(event) => {
            if (disabled || loading || !event.currentTarget.checked) return;
            onCheckedChange?.(true);
            if (internalRef.current) internalRef.current.checked = checked;
          }}
        />
        <span class="ui-radio__text">
          <Text>{label}</Text>
          {required && <small><Text>{t('ui.radio.required')}</Text></small>}
        </span>
      </label>
      {error && <div id={`${controlId}-error`} class="ui-radio__error" aria-live="polite"><Text>{error}</Text></div>}
      {loading && <div id={`${controlId}-loading`} role="status"><Text>{t('ui.radio.loading')}</Text></div>}
    </div>
  );
}
