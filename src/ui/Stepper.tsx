import './stepper.css';
import './button.css';
import { useId, useMemo } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { getCurrentLocale, useT } from '@/i18n/i18n';

export interface StepperProps {
  id?: string;
  name?: string;
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  class?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function advance(value: number, step: number, direction: -1 | 1): number {
  const result = value + step * direction;
  return Number.isFinite(result) ? Number(result.toPrecision(15)) : result;
}

export function Stepper({
  id,
  name,
  label,
  value,
  onValueChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  size = 'md',
  disabled = false,
  loading = false,
  class: className = '',
}: StepperProps) {
  const generatedId = useId();
  const controlId = id ?? `stepper-${generatedId}`;
  const t = useT();
  const locale = getCurrentLocale();
  const formatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }),
    [locale],
  );

  if (![value, min, max, step].every(Number.isFinite) || min > max || step <= 0) {
    throw new RangeError('Stepper requires finite values, min <= max, and step > 0.');
  }

  const current = clamp(value, min, max);
  const blocked = disabled || loading;
  // 既有中文字典為「增加{label}」；在插值中保留詞間空格。
  // 其他語系保留各自字典的句型與標點順序。
  const labelParameter = locale.startsWith('zh') ? ` ${label.trim()}` : label;
  const decreaseLabel = t('ui.stepper.decrease', { label: labelParameter });
  const increaseLabel = t('ui.stepper.increase', { label: labelParameter });

  function commit(next: number): void {
    if (blocked) return;
    const bounded = clamp(next, min, max);
    if (bounded !== current) onValueChange(bounded);
  }

  return (
    <div class={`ui-stepper ui-stepper--${size} ${className}`} aria-busy={loading || undefined}>
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .ui-stepper button {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
      <div id={`${controlId}-label`}><Text>{label}</Text></div>
      <div class="ui-stepper__controls">
        <button
          type="button"
          class="ui-button ui-button--ghost ui-stepper__decrease"
          style={{ minWidth: '44px', minHeight: '44px' }}
          aria-label={decreaseLabel}
          title={decreaseLabel}
          disabled={blocked || current <= min}
          onClick={() => commit(advance(current, step, -1))}
        >
          <svg width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2"
            aria-hidden="true" focusable="false">
            <path d="M5 12h14" />
          </svg>
        </button>
        <div
          id={controlId}
          role="spinbutton"
          class="ui-stepper__value"
          tabIndex={blocked ? -1 : 0}
          aria-labelledby={`${controlId}-label`}
          aria-describedby={loading ? `${controlId}-loading` : undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={current}
          aria-valuetext={formatter.format(current)}
          aria-disabled={blocked}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'Home') commit(min);
            else if (event.key === 'End') commit(max);
            else commit(advance(current, step, event.key === 'ArrowUp' ? 1 : -1));
          }}
        >
          <Text>{formatter.format(current)}</Text>
        </div>
        <button
          type="button"
          class="ui-button ui-button--ghost ui-stepper__increase"
          style={{ minWidth: '44px', minHeight: '44px' }}
          aria-label={increaseLabel}
          title={increaseLabel}
          disabled={blocked || current >= max}
          onClick={() => commit(advance(current, step, 1))}
        >
          <svg width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2"
            aria-hidden="true" focusable="false">
            <path d="M5 12h14M12 5v14" />
          </svg>
        </button>
      </div>
      {name && !blocked && <input type="hidden" name={name} value={current} />}
      {loading && (
        <div id={`${controlId}-loading`} role="status">
          <Text>{t('ui.stepper.loading')}</Text>
        </div>
      )}
    </div>
  );
}
