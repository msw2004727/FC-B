import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { t } from '@/i18n/i18n';
import { Avatar, type UserRole } from './Avatar';
import { prepareUi2Locale, resetUi2Locale } from './ui2-test-utils';

beforeEach(prepareUi2Locale);
afterEach(() => {
  cleanup();
  resetUi2Locale();
});

describe('Avatar', () => {
  it('prefers pictureUrl and reserves image dimensions', () => {
    const { getByRole } = render(
      <Avatar name="Alice" pictureUrl="/picture.png" avatarUrl="/avatar.png" size="lg" />,
    );
    const image = getByRole('img', { name: 'Alice' });
    expect(image.getAttribute('src')).toBe('/picture.png');
    expect(image.getAttribute('width')).toBe('44');
    expect(image.getAttribute('height')).toBe('44');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
  });

  it('uses avatarUrl only when pictureUrl is nullish', () => {
    const { getByRole, rerender } = render(
      <Avatar name="Alice" pictureUrl={null} avatarUrl="/avatar.png" />,
    );
    expect(getByRole('img').getAttribute('src')).toBe('/avatar.png');

    rerender(<Avatar name="Alice" pictureUrl="" avatarUrl="/avatar.png" />);
    expect(getByRole('img').tagName).toBe('SPAN');
    expect(getByRole('img').textContent).toBe('A');
  });

  it('falls back on error and retries when source changes', () => {
    const { getByRole, rerender } = render(<Avatar name="王小明" pictureUrl="/bad.png" />);
    fireEvent.error(getByRole('img'));
    expect(getByRole('img', { name: '王小明' }).textContent).toBe('王');

    rerender(<Avatar name="王小明" pictureUrl="/good.png" />);
    expect(getByRole('img').getAttribute('src')).toBe('/good.png');
  });

  it.each<UserRole>([
    'user', 'coach', 'captain', 'team_leader', 'venue_owner', 'admin', 'super_admin',
  ])('maps role %s to its variant', (role) => {
    const { container } = render(<Avatar name="alex" role={role} />);
    expect(container.firstElementChild?.classList.contains(`ui-avatar--${role}`)).toBe(true);
    expect(container.textContent).toBe('A');
  });

  it.each([
    ['sm', '24'], ['md', '32'], ['lg', '44'],
  ] as const)('uses %s dimensions', (size, pixels) => {
    const { getByRole, container } = render(<Avatar name="A" pictureUrl="/a.png" size={size} />);
    expect(getByRole('img').getAttribute('width')).toBe(pixels);
    expect(container.firstElementChild?.classList.contains(`ui-avatar--${size}`)).toBe(true);
  });

  it('hides decorative images and fallback from accessibility queries', () => {
    const { queryByRole, container, rerender } = render(
      <Avatar name="Alice" pictureUrl="/a.png" decorative />,
    );
    expect(queryByRole('img')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');

    rerender(<Avatar name="Alice" decorative />);
    expect(queryByRole('img')).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses translated missing-name fallback', () => {
    const { getByRole } = render(<Avatar />);
    expect(getByRole('img').getAttribute('aria-label')).toBe(t('ui.avatar.unknown'));
    expect(getByRole('img').getAttribute('aria-label')).toBe('未提供名稱');
  });
});
