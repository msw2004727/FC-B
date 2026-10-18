import './textarea.css';
import { useId, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { getCurrentLocale, useT } from '@/i18n/i18n';
import { descriptionIds, type FormFieldProps } from './form-types';
import { countTextarea } from './textarea-count';

export interface TextareaProps extends FormFieldProps {
  value: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  variant?: 'auto-grow' | 'fixed';
  rows?: number;
  /**
   * 語意計數上限。超限保留輸入、顯示錯誤並阻止原生表單提交；
   * 不裁切貼上內容或中斷 IME composition。
   */
  maxLength?: number;
}

export function Textarea({
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
  onValueChange,
  placeholder,
  variant = 'auto-grow',
  rows = 3,
  maxLength,
}: TextareaProps) {
  const generatedId = useId();
  const controlId = id ?? `textarea-${generatedId}`;
  const ref = useRef<HTMLTextAreaElement>(null);
  const t = useT();
  const locale = getCurrentLocale();
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const count = useMemo(() => countTextarea(value, locale), [value, locale]);
  const limit = maxLength === undefined || !Number.isFinite(maxLength)
    ? undefined
    : Math.max(0, Math.floor(maxLength));
  const overLimit = limit !== undefined && count > limit;
  const message = error || (overLimit ? t('ui.textarea.tooLong') : undefined);

  useLayoutEffect(() => {
    ref.current?.setCustomValidity(message ?? '');
  }, [message]);

  return (
    <div
      class={`ui-textarea ui-textarea--${variant}${message ? ' ui-textarea--error' : ''}${success && !message ? ' ui-textarea--success' : ''} ${className}`}
      aria-busy={loading || undefined}
    >
      <label for={controlId}>
        <Text>{label}</Text>
        {required && <small><Text>{t('ui.textarea.required')}</Text></small>}
      </label>
      {/*
       * CSS grid 鏡像提供 auto-grow，無全域事件、ResizeObserver 或逐鍵同步量測。
       * 鏡像與 textarea 共用字型、padding、邊框及換行方式。
       */}
      <div class="ui-textarea__grow">
        {variant === 'auto-grow' && (
          <div class="ui-textarea__mirror" aria-hidden="true" data-value={`${value}\n`} />
        )}
        <textarea
          ref={ref}
          id={controlId}
          name={name}
          value={value}
          rows={Math.max(1, Math.floor(rows) || 1)}
          required={required}
          disabled={disabled}
          readOnly={readOnly || loading}
          placeholder={placeholder}
          aria-invalid={Boolean(message)}
          aria-describedby={descriptionIds(
            describedBy,
            hint && `${controlId}-hint`,
            message && `${controlId}-error`,
            limit !== undefined && `${controlId}-count`,
            loading && `${controlId}-loading`,
            success && !message && `${controlId}-success`,
          )}
          onInput={(event) => {
            if (!disabled && !readOnly && !loading) {
              onValueChange?.(event.currentTarget.value);
            }
          }}
        />
      </div>
      {limit !== undefined && (
        <div id={`${controlId}-count`} class="ui-textarea__count">
          <Text>{t('ui.textarea.count', {
            current: numberFormat.format(count),
            max: numberFormat.format(limit),
          })}</Text>
        </div>
      )}
      {hint && <div id={`${controlId}-hint`} data-field-hint><Text>{hint}</Text></div>}
      {message && <div id={`${controlId}-error`} data-field-error aria-live="polite"><Text>{message}</Text></div>}
      {success && !message && <div id={`${controlId}-success`} data-field-status><Text>{t('ui.textarea.success')}</Text></div>}
      {loading && (
        <div id={`${controlId}-loading`} data-field-status role="status">
          {/* Icon 未提供 loader；使用局部 inline SVG。 */}
          <svg data-field-spinner width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2"
            aria-hidden="true" focusable="false">
            <path d="M20 12a8 8 0 1 1-8-8" />
          </svg>
          <Text>{t('ui.textarea.loading')}</Text>
        </div>
      )}
    </div>
  );
}
