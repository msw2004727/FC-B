import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { t } from '@/i18n/i18n';
import type { UserRole } from './Avatar';
import { UserTag } from './UserTag';
import { prepareUi2Locale, resetUi2Locale } from './ui2-test-utils';

beforeEach(prepareUi2Locale);
afterEach(() => {
  cleanup();
  resetUi2Locale();
});

describe('UserTag', () => {
  it('uses uid for identity even when names are identical', () => {
    const onOpenProfile = vi.fn();
    const { getAllByRole } = render(
      <>
        <UserTag uid="uid-a" name="同名" onOpenProfile={onOpenProfile} />
        <UserTag uid="uid-b" name="同名" onOpenProfile={onOpenProfile} />
      </>,
    );
    for (const button of getAllByRole('button')) {
      fireEvent.click(button);
    }
    expect(onOpenProfile.mock.calls).toEqual([['uid-a'], ['uid-b']]);
    expect(getAllByRole('button').map((button) => button.getAttribute('data-uid')))
      .toEqual(['uid-a', 'uid-b']);
  });

  it.each<UserRole>([
    'user', 'coach', 'captain', 'team_leader', 'venue_owner', 'admin', 'super_admin',
  ])('renders role %s and independent level', (role) => {
    const { getByRole, container } = render(
      <UserTag uid="id" name="Alice" role={role} level={3} onOpenProfile={vi.fn()} />,
    );
    expect(getByRole('button').classList.contains(`ui-user-tag--${role}`)).toBe(true);
    expect(container.querySelector('.ui-user-tag__role')?.textContent)
      .toBe(t(`ui.userTag.role.${role}`));
    expect(container.querySelector('.ui-user-tag__level')?.textContent).toBe('Lv 3');
    expect(container.querySelector('.ui-user-tag__identity .ui-user-tag__level')).toBeNull();
  });

  it.each([{ disabled: true }, { loading: true }])('blocks opening: %o', (state) => {
    const onOpenProfile = vi.fn();
    const { getByRole } = render(
      <UserTag uid="id" name="Alice" {...state} onOpenProfile={onOpenProfile} />,
    );
    const button = getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onOpenProfile).not.toHaveBeenCalled();
    if ('loading' in state) expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('does not open a profile without a usable uid', () => {
    const onOpenProfile = vi.fn();
    const { getByRole } = render(<UserTag uid=" " onOpenProfile={onOpenProfile} />);
    fireEvent.click(getByRole('button'));
    expect((getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(onOpenProfile).not.toHaveBeenCalled();
  });

  it('supports native keyboard activation without duplicate key handlers', () => {
    const onOpenProfile = vi.fn();
    const { getByRole } = render(
      <UserTag uid="stable-id" name="Alice" onOpenProfile={onOpenProfile} />,
    );
    const button = getByRole('button') as HTMLButtonElement;
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.type).toBe('button');

    // jsdom 無原生 Space → click；模擬瀏覽器產生的 detail=0 click。
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyUp(button, { key: ' ' });
    fireEvent.click(button, { detail: 0 });
    expect(onOpenProfile).toHaveBeenCalledExactlyOnceWith('stable-id');
  });

  it('renders translated empty values and optional status badges', () => {
    const { container, getByRole } = render(
      <UserTag
        uid="id"
        name=""
        jersey={null}
        attendanceWarning
        recentNoShow
        onOpenProfile={vi.fn()}
      />,
    );
    expect(container.querySelector('.ui-user-tag__name')?.textContent)
      .toBe(t('ui.userTag.unknown'));
    expect(container.querySelector('.ui-user-tag__level')?.textContent)
      .toBe(t('ui.userTag.levelUnset'));
    expect(container.textContent).toContain(t('ui.userTag.jerseyUnset'));
    expect(container.textContent).toContain(t('ui.userTag.attendanceWarning'));
    expect(container.textContent).toContain(t('ui.userTag.recentNoShow'));
    expect(getByRole('button').getAttribute('aria-label'))
      .toContain(t('ui.userTag.openProfile', { name: t('ui.userTag.unknown') }));
  });

  it('preserves zero level and jersey number', () => {
    const { container } = render(
      <UserTag uid="id" level={0} jersey={0} onOpenProfile={vi.fn()} />,
    );
    expect(container.querySelector('.ui-user-tag__level')?.textContent).toBe('Lv 0');
    expect(container.textContent).toContain('背號 0');
  });
});
