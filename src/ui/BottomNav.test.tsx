import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { BottomNav } from './BottomNav';
import { _resetForTest, registerFeatures, setRemoteFlags } from '@/core/feature-registry';
import { _setDictLoaderForTest, t } from '@/i18n/i18n';
import { prepareShellLocale } from './shell-test-utils';

const load = async () => ({ default: () => null });

beforeEach(async () => {
  _resetForTest();
  await prepareShellLocale();
  history.replaceState(null, '', '/');
  registerFeatures([
    {
      id: 'shell-nav-fixture',
      status: 'enabled',
      routes: [{ path: '/', titleKey: 'test.home', load }],
      nav: [
        { path: '/', labelKey: 'test.home', icon: 'home', order: 0 },
        { path: '/events', labelKey: 'test.events', icon: 'calendar', order: 1 },
        { path: '/teams', labelKey: 'test.teams', icon: 'users', order: 2 },
        { path: '/tournaments', labelKey: 'test.tournaments', icon: 'trophy', order: 3 },
        { path: '/profile', labelKey: 'test.profile', icon: 'user', order: 4 },
      ],
    },
  ]);
});

afterEach(() => {
  cleanup();
  _resetForTest();
  _setDictLoaderForTest(null);
  history.replaceState(null, '', '/');
});

describe('BottomNav', () => {
  it('renders registry items in A order and a separate QR link', () => {
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    const links = Array.from(container.querySelectorAll('.ui-bottom-nav__item'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/tournaments', '/teams', '/', '/events', '/profile',
    ]);
    expect(screen.getByRole('navigation', { name: t('ui.bottomNav.label') })).toBeTruthy();
    const qr = screen.getByRole('link', { name: t('ui.bottomNav.qr') });
    expect(qr.getAttribute('href')).toBe('/profile/qr');
    expect(qr.classList.contains('ui-bottom-nav__qr')).toBe(true);
    expect(screen.getByRole('link', { name: t('test.home') })
      .getAttribute('aria-current')).toBe('page');
  });

  it('marks QR alone current on the QR page', () => {
    history.replaceState(null, '', '/profile/qr');
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    expect(container.querySelectorAll('[aria-current="page"]').length).toBe(1);
    expect(screen.getByRole('link', { name: t('ui.bottomNav.qr') })
      .getAttribute('aria-current')).toBe('page');
  });

  it('reacts to disabled features without removing the fixed QR control', async () => {
    render(<LocationProvider><BottomNav /></LocationProvider>);
    await act(() => setRemoteFlags({ 'shell-nav-fixture': false }));
    expect(screen.queryByRole('link', { name: t('test.home') })).toBeNull();
    expect(screen.getByRole('link', { name: t('ui.bottomNav.qr') })).toBeTruthy();
  });
});
