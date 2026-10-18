import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/i18n';
import { Heading } from './Heading';
import { installUiTestLocale } from './ui1-test-utils';

installUiTestLocale();

describe('Heading', () => {
  it.each([1, 2, 3, 4] as const)('renders semantic level %s with Text', (level) => {
    render(<Heading level={level}>{t('fixture.heading')}</Heading>);
    const heading = screen.getByRole('heading', { level, name: t('fixture.heading') });
    expect(heading.tagName).toBe(`H${level}`);
    expect(heading.querySelector('.ui-text')?.textContent).toBe(t('fixture.heading'));
  });

  it.each(['title', 'title-lg', 'display'] as const)(
    'changes visual size %s without changing semantic level',
    (size) => {
      render(<Heading level={2} size={size} id="section-title">{t('fixture.heading')}</Heading>);
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading.classList.contains(`ui-heading--${size}`)).toBe(true);
      expect(heading.id).toBe('section-title');
      expect(heading.hasAttribute('tabindex')).toBe(false);
      expect(heading.hasAttribute('aria-disabled')).toBe(false);
    },
  );
});
