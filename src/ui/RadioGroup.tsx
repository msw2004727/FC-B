import './radio-group.css';
import type { JSX } from 'preact';
import { useId, useRef } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { Radio } from '@/ui/Radio';
import { useT } from '@/i18n/i18n';
import { descriptionIds } from './form-types';

export interface RadioGroupOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  id?: string;
  name?: string;
  label: string;
  value: string | undefined;
  options: readonly RadioGroupOption[];
  onValueChange: (value: string) => void;
  orientation?: 'horizontal' | 'vertical';
  disabled?: boolean;
  loading?: boolean;
  required?: boolean;
  hint?: string;
  error?: string;
  class?: string;
}

export function RadioGroup({
  id,
  name,
  label,
  value,
  options,
  onValueChange,
  orientation = 'vertical',
  disabled = false,
  loading = false,
  required = false,
  hint,
  error,
  class: className = '',
}: RadioGroupProps) {
  const generatedId = useId();
  const groupId = id ?? `radio-group-${generatedId}`;
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const blocked = disabled || loading;
  const enabled = options.filter((option) => !blocked && !option.disabled);
  const tabValue = enabled.find((option) => option.value === value)?.value
    ?? enabled[0]?.value;
  const description = descriptionIds(
    undefined,
    hint && `${groupId}-hint`,
    error && `${groupId}-error`,
    loading && `${groupId}-loading`,
  );

  function handleKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDivElement>) {
    if (blocked || event.altKey || event.ctrlKey || event.metaKey) return;
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const radios = Array.from(
      ref.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]:not(:disabled)') ?? [],
    );
    const current = radios.findIndex((radio) => radio === event.target);
    if (current < 0 || radios.length === 0) return;
    event.preventDefault();

    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = radios.length - 1;
    else {
      const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      next = (current + delta + radios.length) % radios.length;
    }

    const target = radios[next];
    if (!target) return;
    target.focus();
    if (target.value !== value) onValueChange(target.value);
  }

  return (
    <div class={`ui-radio-group ui-radio-group--${orientation} ${className}`}>
      <div id={`${groupId}-label`} class="ui-radio-group__label">
        <Text>{label}</Text>
        {required && <small><Text>{t('ui.radioGroup.required')}</Text></small>}
      </div>
      <div
        ref={ref}
        role="radiogroup"
        aria-labelledby={`${groupId}-label`}
        aria-describedby={description}
        aria-orientation={orientation}
        aria-required={required}
        aria-invalid={Boolean(error)}
        aria-disabled={blocked}
        aria-busy={loading || undefined}
        class="ui-radio-group__options"
        onKeyDown={handleKeyDown}
      >
        {options.map((option) => (
          <Radio
            key={option.value}
            name={name ?? groupId}
            value={option.value}
            label={option.label}
            checked={value === option.value}
            disabled={blocked || option.disabled}
            required={required}
            describedBy={description}
            tabIndex={option.value === tabValue ? 0 : -1}
            onCheckedChange={() => onValueChange(option.value)}
          />
        ))}
      </div>
      {hint && <div id={`${groupId}-hint`}><Text>{hint}</Text></div>}
      {error && <div id={`${groupId}-error`} class="ui-radio-group__error" aria-live="polite"><Text>{error}</Text></div>}
      {loading && <div id={`${groupId}-loading`} role="status"><Text>{t('ui.radioGroup.loading')}</Text></div>}
    </div>
  );
}
