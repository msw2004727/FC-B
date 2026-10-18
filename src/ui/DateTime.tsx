import './date-time.css';
import { useMemo } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { formatDate, getCurrentLocale, useT } from '@/i18n/i18n';

export interface DateTimeProps {
  value: Date | number | string;
  variant?: 'date' | 'time' | 'datetime' | 'relative';
  options?: Intl.DateTimeFormatOptions;
  /**
   * relative 必填，由呼叫端提供同一份時鐘快照。
   * 元件不建立計時器，SSR 與 hydration 可使用相同 now。
   */
  now?: Date | number;
  class?: string;
}

const formats: Record<'date' | 'time' | 'datetime', Intl.DateTimeFormatOptions> = {
  date: { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' },
  time: { hour: 'numeric', minute: '2-digit' },
  datetime: {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  },
};

function relativeParts(seconds: number): [number, Intl.RelativeTimeFormatUnit] {
  const absolute = Math.abs(seconds);
  if (absolute < 60) return [Math.round(seconds), 'second'];
  if (absolute < 3600) return [Math.round(seconds / 60), 'minute'];
  if (absolute < 86400) return [Math.round(seconds / 3600), 'hour'];
  if (absolute < 604800) return [Math.round(seconds / 86400), 'day'];
  return [Math.round(seconds / 604800), 'week'];
}

export function DateTime({
  value,
  variant = 'datetime',
  options,
  now,
  class: className = '',
}: DateTimeProps) {
  const t = useT();
  const locale = getCurrentLocale();
  const relativeFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
    [locale],
  );
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return <span class={`ui-date-time ui-date-time--invalid ${className}`}><Text>{t('ui.dateTime.invalid')}</Text></span>;
  }

  let text: string;
  if (variant === 'relative') {
    const nowMs = now instanceof Date ? now.getTime() : now;
    if (nowMs === undefined || !Number.isFinite(nowMs)) {
      throw new RangeError('Relative DateTime requires a finite now snapshot.');
    }
    const [amount, unit] = relativeParts((date.getTime() - nowMs) / 1000);
    text = relativeFormatter.format(amount, unit);
  } else {
    text = formatDate(date, { ...formats[variant], ...options });
  }

  return (
    <time
      class={`ui-date-time ui-date-time--${variant} ${className}`}
      dateTime={date.toISOString()}
      title={variant === 'relative' ? formatDate(date, { ...formats.datetime, ...options }) : undefined}
    >
      <Text>{text}</Text>
    </time>
  );
}
