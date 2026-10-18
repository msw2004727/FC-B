import './input.css';
import { useId } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';
import { descriptionIds, type FormFieldProps } from './form-types';

export interface InputProps extends FormFieldProps {
  type?: 'text' | 'email' | 'tel' | 'number' | 'search';
  value: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
  maxLength?: number;
}

export function Input({
  id,
  name,
  label,
  hint,
  error,
  required = false,
  disabled = false,
  readOnly = false,
  loading = false,
  success = false,
  describedBy,
  class: className = '',
  type = 'text',
  value,
  onValueChange,
  placeholder,
  autoComplete,
  min,
  max,
  step,
  maxLength,
}: InputProps) {
  const generatedId = useId();
  const controlId = id ?? `input-${generatedId}`;
  const t = useT();
  const description = descriptionIds(
    describedBy,
    hint && `${controlId}-hint`,
    error && `${controlId}-error`,
    loading && `${controlId}-loading`,
    success && !error && `${controlId}-success`,
  );

  return (
    <div
      class={`ui-input ui-input--${type}${error ? ' ui-input--error' : ''}${success && !error ? ' ui-input--success' : ''} ${className}`}
      aria-busy={loading || undefined}
    >
      <label for={controlId}>
        <Text>{label}</Text>
        {required && <small><Text>{t('ui.input.required')}</Text></small>}
      </label>
      <input
        id={controlId}
        name={name}
        type={type}
        value={value}
        required={required}
        disabled={disabled}
        readOnly={readOnly || loading}
        placeholder={placeholder}
        autoComplete={autoComplete}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={description}
        aria-busy={loading || undefined}
        onInput={(event) => {
          if (!disabled && !readOnly && !loading) {
            onValueChange?.(event.currentTarget.value);
          }
        }}
      />
      {hint && <div id={`${controlId}-hint`} data-field-hint><Text>{hint}</Text></div>}
      {error && <div id={`${controlId}-error`} data-field-error aria-live="polite"><Text>{error}</Text></div>}
      {success && !error && (
        <div id={`${controlId}-success`} data-field-status>
          <Text>{t('ui.input.success')}</Text>
        </div>
      )}
      {loading && (
        <div id={`${controlId}-loading`} data-field-status role="status">
          {/* Icon 未提供 loader；新增局部裝飾 SVG，不修改 Icon.tsx。 */}
          <svg data-field-spinner width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2"
            aria-hidden="true" focusable="false">
            <path d="M20 12a8 8 0 1 1-8-8" />
          </svg>
          <Text>{t('ui.input.loading')}</Text>
        </div>
      )}
    </div>
  );
}
