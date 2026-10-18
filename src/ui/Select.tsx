import './select.css';
import { useId, useRef } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';
import { descriptionIds, type FormFieldProps } from './form-types';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends FormFieldProps {
  value: string;
  options: readonly SelectOption[];
  onValueChange?: (value: string) => void;
}

export function Select({
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
  value,
  options,
  onValueChange,
}: SelectProps) {
  const generatedId = useId();
  const controlId = id ?? `select-${generatedId}`;
  const t = useT();
  const selectRef = useRef<HTMLSelectElement>(null);
  const unavailable = disabled || readOnly || loading;

  return (
    <div
      class={`ui-select ui-select--native${error ? ' ui-select--error' : ''}${success && !error ? ' ui-select--success' : ''} ${className}`}
      aria-busy={loading || undefined}
    >
      <label for={controlId}>
        <Text>{label}</Text>
        {required && <small><Text>{t('ui.select.required')}</Text></small>}
      </label>
      <select
        ref={selectRef}
        id={controlId}
        name={readOnly ? undefined : name}
        value={value}
        required={required}
        disabled={unavailable}
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionIds(
          describedBy,
          hint && `${controlId}-hint`,
          error && `${controlId}-error`,
          readOnly && `${controlId}-readonly`,
          loading && `${controlId}-loading`,
          success && !error && `${controlId}-success`,
        )}
        onChange={(event) => {
          if (unavailable) return;
          const next = event.currentTarget.value;
          onValueChange?.(next);
          // 保持 controlled 語意；父層未接受變更時仍顯示原值。
          if (selectRef.current) selectRef.current.value = value;
        }}
      >
        {options.map((option) => (
          /*
           * 傳統原生 option 不允許 Text 產生的 span/wbr。
           * 使用原生 label 屬性提供選項文字，避免無效 HTML。
           */
          <option
            key={option.value}
            value={option.value}
            label={option.label}
            disabled={option.disabled}
          />
        ))}
      </select>
      {/* select 沒有原生 readonly；停用可見控制項並保留表單提交值。 */}
      {readOnly && !disabled && name && <input type="hidden" name={name} value={value} />}
      {hint && <div id={`${controlId}-hint`} data-field-hint><Text>{hint}</Text></div>}
      {readOnly && <div id={`${controlId}-readonly`} data-field-status><Text>{t('ui.select.readonly')}</Text></div>}
      {error && <div id={`${controlId}-error`} data-field-error aria-live="polite"><Text>{error}</Text></div>}
      {success && !error && <div id={`${controlId}-success`} data-field-status><Text>{t('ui.select.success')}</Text></div>}
      {loading && (
        <div id={`${controlId}-loading`} data-field-status role="status">
          {/* Icon 未提供 loader；使用局部 inline SVG。 */}
          <svg data-field-spinner width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2"
            aria-hidden="true" focusable="false">
            <path d="M20 12a8 8 0 1 1-8-8" />
          </svg>
          <Text>{t('ui.select.loading')}</Text>
        </div>
      )}
    </div>
  );
}
