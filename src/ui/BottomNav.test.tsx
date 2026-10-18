import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { BottomNav } from './BottomNav';
import { _resetForTest, registerFeatures, setRemoteFlags } from '@/core/feature-registry';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
import { manifest as home } from '@/features/home';
import { manifest as events } from '@/features/events';
import { manifest as clubs } from '@/features/clubs';
import { manifest as inbox } from '@/features/inbox';
import { manifest as profile } from '@/features/profile';
import { manifest as checkin } from '@/features/checkin';

beforeEach(async () => {
  _resetForTest();
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
  history.replaceState(null, '', '/');
  registerFeatures([home, events, clubs, inbox, profile, checkin]);
});

afterEach(() => {
  cleanup();
  _resetForTest();
  _setDictLoaderForTest(null);
  history.replaceState(null, '', '/');
});

describe('BottomNav', () => {
  it('uses compatible list routes with home in the third slot and one QR entry', () => {
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('.ui-bottom-nav__item'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/inbox', '/teams', '/', '/activities', '/profile',
    ]);
    expect(links[2]?.style.gridColumn).toBe('3');
    expect(screen.getByRole('navigation', { name: t('ui.bottomNav.label') })).toBeTruthy();
    expect(screen.getByRole('link', { name: t('ui.shell.qrCheckin') })
      .getAttribute('href')).toBe('/checkin');
    expect(container.querySelectorAll('a[href="/checkin"]').length).toBe(1);
    expect(screen.getByRole('link', { name: t('nav.home') })
      .getAttribute('aria-current')).toBe('page');
  });

  it('marks only QR current on nested check-in routes', () => {
    history.replaceState(null, '', '/checkin/session');
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    expect(container.querySelectorAll('[aria-current="page"]').length).toBe(1);
    expect(screen.getByRole('link', { name: t('ui.shell.qrCheckin') })
      .getAttribute('aria-current')).toBe('page');
  });

  it('marks profile current for the separate personal QR page', () => {
    history.replaceState(null, '', '/profile/qr');
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    expect(container.querySelectorAll('[aria-current="page"]').length).toBe(1);
    expect(screen.getByRole('link', { name: t('nav.profile') })
      .getAttribute('aria-current')).toBe('page');
  });

  it.each(['/activities', '/events/public-event'])('marks activities current on %s', (path) => {
    history.replaceState(null, '', path);
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    expect(container.querySelectorAll('[aria-current="page"]').length).toBe(1);
    expect(screen.getByRole('link', { name: t('nav.events') })
      .getAttribute('aria-current')).toBe('page');
  });

  it('marks clubs current on a shared club detail URL', () => {
    history.replaceState(null, '', '/teams/public-team');
    render(<LocationProvider><BottomNav /></LocationProvider>);
    expect(screen.getByRole('link', { name: t('nav.clubs') })
      .getAttribute('aria-current')).toBe('page');
  });

  it('keeps home centered when a preceding feature is disabled', async () => {
    render(<LocationProvider><BottomNav /></LocationProvider>);
    await act(() => setRemoteFlags({ inbox: false }));
    expect(screen.queryByRole('link', { name: t('nav.inbox') })).toBeNull();
    expect((screen.getByRole('link', { name: t('nav.home') }) as HTMLElement)
      .style.gridColumn).toBe('3');
  });

  it('hides QR when check-in or its events dependency is disabled', async () => {
    render(<LocationProvider><BottomNav /></LocationProvider>);
    await act(() => setRemoteFlags({ checkin: false }));
    expect(screen.queryByRole('link', { name: t('ui.shell.qrCheckin') })).toBeNull();
    await act(() => setRemoteFlags({ events: false }));
    expect(screen.queryByRole('link', { name: t('ui.shell.qrCheckin') })).toBeNull();
    await act(() => setRemoteFlags({}));
    expect(screen.getByRole('link', { name: t('ui.shell.qrCheckin') })).toBeTruthy();
  });
});
