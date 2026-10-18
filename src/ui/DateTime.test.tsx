import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/preact';
import { formatDate, setLocale, t } from '@/i18n/i18n';
import { DateTime } from './DateTime';
import { setupUi3Tests } from './ui3-test-utils';

setupUi3Tests();

describe('DateTime', () => {
  const value = '2024-06-15T09:00:00.000Z';

  it('uses ISO datetime and formatDate in the active locale', async () => {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'UTC',
    };
    const { container } = render(<DateTime value={value} variant="date" options={options} />);
    const time = container.querySelector('time');
    expect(time?.dateTime).toBe(value);
    expect(time?.textContent).toBe(formatDate(new Date(value), options));
    expect(time?.classList.contains('ui-date-time--date')).toBe(true);

    await act(async () => { await setLocale('en'); });
    expect(time?.textContent).toBe(formatDate(new Date(value), options));
  });

  it('formats relative values from an explicit clock snapshot', () => {
    const date = new Date(value);
    const { container } = render(
      <DateTime value={date} variant="relative" now={date.getTime() - 3600000} />,
    );
    expect(container.querySelector('time')?.textContent).toBe(
      new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' }).format(1, 'hour'),
    );
  });

  it('renders translated invalid data without invalid time markup', () => {
    const { container } = render(<DateTime value="invalid" />);
    expect(container.querySelector('time')).toBeNull();
    expect(screen.getByText(t('ui.dateTime.invalid'))).toBeTruthy();
  });
});
