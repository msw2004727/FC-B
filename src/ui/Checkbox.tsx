import './checkbox.css';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';
import { descriptionIds } from './form-types';

export interface CheckboxProps {
  id?: string;
  name?: string;
  value?: string;
  label: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  indeterminate?: boolean;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  describedBy?: string;
  class?: string;
}

export function Checkbox({
  id,
  name,
  value,
  label,
  checked,
  onCheckedChange,
  indeterminate = false,
  required = false,
  disabled = false,
  loading = false,
  error,
  describedBy,
  class: className = '',
}: CheckboxProps) {
  const generatedId = useId();
  const controlId = id ?? `checkbox-${generatedId}`;
  const ref = useRef<HTMLInputElement>(null);
  const t = useT();

  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate, checked]);

  return (
    <div
      class={`ui-checkbox${checked ? ' ui-checkbox--checked' : ''}${indeterminate ? ' ui-checkbox--mixed' : ''} ${className}`}
      aria-busy={loading || undefined}
    >
      <label class="ui-checkbox__label" for={controlId}>
        <input
          ref={ref}
          id={controlId}
          name={name}
          value={value}
          type="checkbox"
          checked={checked}
          required={required}
          disabled={disabled || loading}
          aria-checked={indeterminate ? 'mixed' : checked}
          aria-invalid={Boolean(error)}
          aria-describedby={descriptionIds(
            describedBy,
            error && `${controlId}-error`,
            loading && `${controlId}-loading`,
          )}
          onChange={(event) => {
            if (disabled || loading) return;
            onCheckedChange?.(event.currentTarget.checked);
            if (ref.current) {
              ref.current.checked = checked;
              ref.current.indeterminate = indeterminate;
            }
          }}
        />
        <span class="ui-checkbox__text">
          <Text>{label}</Text>
          {required && <small><Text>{t('ui.checkbox.required')}</Text></small>}
        </span>
      </label>
      {error && <div id={`${controlId}-error`} class="ui-checkbox__error" aria-live="polite"><Text>{error}</Text></div>}
      {loading && <div id={`${controlId}-loading`} role="status"><Text>{t('ui.checkbox.loading')}</Text></div>}
    </div>
  );
}
