import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { LocationProvider } from 'preact-iso';
import { SideDrawer } from './SideDrawer';
import { TopBar } from './TopBar';
import { Text } from './Text';
import { _resetForTest, registerFeatures, setRemoteFlags } from '@/core/feature-registry';
import type { RouteAccessContext } from '@/core/feature-types';
import { _setDictLoaderForTest, getCurrentLocale, t } from '@/i18n/i18n';
import { LOCALES, type Locale } from '@/i18n/locales';
import { getTheme, setTheme } from '@/core/theme';
import { initFontSize, setFontSize } from '@/core/font-size';
import { prepareShellLocale, shellDictionary } from './shell-test-utils';

const load = async () => ({ default: () => null });
let originalOverflow = '';
let originalPriority = '';

function Harness({ routeAccess = null }: { routeAccess?: RouteAccessContext | null } = {}): preact.JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <LocationProvider>
      <TopBar menuRef={trigger} drawerOpen={open} onMenuClick={() => setOpen(true)} />
      <SideDrawer open={open} onClose={() => setOpen(false)} returnFocusRef={trigger} routeAccess={routeAccess} />
    </LocationProvider>
  );
}

function openDrawer(): HTMLElement {
  const button = screen.getByRole('button', { name: t('ui.topBar.menu') });
  button.focus();
  fireEvent.click(button);
  return button;
}

function getPanel(): HTMLElement {
  const panel = screen.getByRole('dialog').querySelector<HTMLElement>('.ui-side-drawer__panel');
  if (!panel) throw new Error('Missing drawer panel');
  return panel;
}

function getFontButton(): HTMLButtonElement {
  const button = screen.getByRole('dialog').querySelector<HTMLButtonElement>('#drawer-font-btn');
  if (!button) throw new Error('Missing font button');
  return button;
}

function getLocaleSelect(): HTMLSelectElement {
  const select = within(screen.getByRole('dialog')).getByRole('combobox', {
    name: t('ui.sideDrawer.language'),
  });
  if (!(select instanceof HTMLSelectElement)) throw new Error('Missing locale select');
  return select;
}

function touch(target: Element, type: 'touchstart' | 'touchmove', y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: [{ clientY: y }] });
  fireEvent(target, event);
  return event;
}

beforeEach(async () => {
  _resetForTest();
  await prepareShellLocale();
  history.replaceState(null, '', '/');
  setTheme('system');
  setFontSize('medium');
  originalOverflow = document.body.style.getPropertyValue('overflow');
  originalPriority = document.body.style.getPropertyPriority('overflow');

  registerFeatures([
    {
      id: 'shell-drawer-main',
      status: 'enabled',
      routes: [
        { path: '/', titleKey: 'test.home', load },
        { path: '/manual', titleKey: 'manual.title', load },
        { path: '/stats', titleKey: 'stats.title', load },
        { path: '/profile/qr', titleKey: 'ui.bottomNav.qr', load },
        { path: '/checkin', titleKey: 'nav.checkin', load },
        { path: '/members/:id', titleKey: 'test.member', load },
      ],
      nav: [{ path: '/', labelKey: 'test.home', icon: 'home', order: 2 }],
    },
    {
      id: 'shell-drawer-admin',
      status: 'enabled',
      routes: [{ path: '/admin/events', titleKey: 'test.admin', load }],
    },
    {
      id: 'shell-drawer-gated',
      status: 'enabled',
      routes: [{
        path: '/admin/logs',
        titleKey: 'test.gated',
        load,
        drawerVisibleIf: (access) => access.hasPermission('admin.logs.entry'),
      }],
    },
    {
      id: 'shell-drawer-reserved',
      status: 'reserved',
      routes: [{ path: '/reserved', titleKey: 'test.reserved', load }],
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalOverflow) {
    document.body.style.setProperty('overflow', originalOverflow, originalPriority);
  } else {
    document.body.style.removeProperty('overflow');
  }
  _resetForTest();
  _setDictLoaderForTest(null);
  setTheme('system');
  setFontSize('medium');
  localStorage.removeItem('toosterx:font-size');
});

describe('SideDrawer', () => {
  it('有權限條件的入口：沒有登入者權限時不顯示，有權限才顯示（照 A DRAWER_MENUS）', () => {
    const base: RouteAccessContext = {
      uid: 'U_x', role: 'admin', roleLevel: 4, capabilities: [], hasPermission: () => false,
    };
    const view = render(<Harness />);
    openDrawer();
    expect(document.querySelector('[href="/admin/logs"]')).toBeNull();
    view.unmount();

    const denied = render(<Harness routeAccess={base} />);
    openDrawer();
    expect(document.querySelector('[href="/admin/logs"]')).toBeNull();
    denied.unmount();

    render(<Harness routeAccess={{ ...base, hasPermission: (c) => c === 'admin.logs.entry' }} />);
    openDrawer();
    expect(document.querySelector('[href="/admin/logs"]')).not.toBeNull();
  });

  it('uses a div Portal, focuses the panel, locks scrolling and restores focus', () => {
    document.body.style.setProperty('overflow', 'scroll', 'important');
    const view = render(<Harness />);
    const trigger = openDrawer();
    const dialog = screen.getByRole('dialog', { name: t('ui.sideDrawer.label') });
    expect(dialog.tagName).toBe('DIV');
    expect(dialog.parentElement).toBe(document.body);
    expect(view.container.contains(dialog)).toBe(false);
    expect(dialog.querySelector('dialog')).toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(getPanel());
    expect(screen.queryByRole('button', { name: t('ui.sideDrawer.close') })).toBeNull();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
  });

  it('closes on overlay click but not panel click', () => {
    render(<Harness />);
    openDrawer();
    fireEvent.click(getPanel());
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('wraps keyboard focus and prevents focus escaping', () => {
    render(<Harness />);
    const trigger = openDrawer();
    const first = screen.getByRole('link', { name: t('stats.title') });
    const last = getFontButton();

    fireEvent.keyDown(getPanel(), { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    trigger.focus();
    expect(document.activeElement).toBe(first);
  });

  it('blocks background interaction and releases listeners on close', () => {
    const clicked = vi.fn();
    const view = render(
      <>
        <button type="button" onClick={clicked}><Text>Background</Text></button>
        <Harness />
      </>,
    );
    const background = within(view.container as HTMLElement).getByRole('button', { name: 'Background' });
    openDrawer();
    fireEvent.click(background);
    expect(clicked).not.toHaveBeenCalled();
    expect(touch(background, 'touchstart', 100).defaultPrevented).toBe(true);
    expect(touch(background, 'touchmove', 80).defaultPrevented).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(background);
    expect(clicked).toHaveBeenCalledOnce();
    expect(touch(background, 'touchmove', 60).defaultPrevented).toBe(false);
  });

  it('blocks overlay and boundary scrolling while allowing panel scrolling', () => {
    render(<Harness />);
    openDrawer();
    const dialog = screen.getByRole('dialog');
    const panel = getPanel();
    Object.defineProperties(panel, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
    });
    panel.style.overflowY = 'auto';

    touch(dialog, 'touchstart', 100);
    expect(touch(dialog, 'touchmove', 80).defaultPrevented).toBe(true);
    panel.scrollTop = 100;
    touch(panel, 'touchstart', 100);
    expect(touch(panel, 'touchmove', 80).defaultPrevented).toBe(false);
    touch(panel, 'touchstart', 100);
    expect(touch(panel, 'touchmove', 120).defaultPrevented).toBe(false);
    panel.scrollTop = 0;
    touch(panel, 'touchstart', 100);
    expect(touch(panel, 'touchmove', 120).defaultPrevented).toBe(true);
    panel.scrollTop = 700;
    touch(panel, 'touchstart', 100);
    expect(touch(panel, 'touchmove', 80).defaultPrevented).toBe(true);
  });

  it('uses an ungrouped A-style list with only active routes', async () => {
    render(<Harness />);
    openDrawer();
    const navigation = screen.getByRole('navigation', {
      name: t('ui.sideDrawer.navigation'),
    });
    const links = within(navigation).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/stats', '/manual', '/profile/qr', '/admin/events',
    ]);
    expect(within(navigation).queryByRole('heading')).toBeNull();
    expect(navigation.querySelector('[href="/reserved"]')).toBeNull();
    expect(navigation.querySelector('[href="/members/:id"]')).toBeNull();
    await act(() => setRemoteFlags({ 'shell-drawer-admin': false }));
    expect(navigation.querySelector('[href="/admin/events"]')).toBeNull();
  });

  it('shows identity and login in the header and Avatar for a signed-in user', () => {
    const login = vi.fn();
    const view = render(
      <LocationProvider>
        <SideDrawer open onClose={vi.fn()} onLogin={login} />
      </LocationProvider>,
    );
    expect(screen.getByText(t('ui.shell.signedOut'))).toBeTruthy();
    const button = screen.getByRole('button', { name: t('ui.topBar.login') });
    expect(button.closest('.ui-side-drawer__header')).not.toBeNull();
    fireEvent.click(button);
    expect(login).toHaveBeenCalledOnce();

    view.rerender(
      <LocationProvider>
        <SideDrawer open onClose={vi.fn()} onLogin={login}
          user={{ uid: 'u1', displayName: 'Alex', pictureUrl: null }} />
      </LocationProvider>,
    );
    expect(screen.queryByRole('button', { name: t('ui.topBar.login') })).toBeNull();
    expect(screen.getByText('Alex')).toBeTruthy();
    expect(screen.getByText(t('ui.userTag.role.user'))).toBeTruthy();
    expect(screen.getByRole('dialog').querySelector('.ui-avatar--lg')).not.toBeNull();
  });

  it('disables drawer login while pending and displays a safe error', () => {
    const login = vi.fn();
    render(
      <LocationProvider>
        <SideDrawer open onClose={vi.fn()} onLogin={login} loginPending loginError />
      </LocationProvider>,
    );
    const button = screen.getByRole('button', {
      name: t('ui.topBar.login'),
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    button.click();
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(t('ui.shell.loginError'));
  });

  it('keeps locale, font size and three-state theme in the footer', () => {
    render(<Harness />);
    openDrawer();
    expect(getLocaleSelect().closest('.ui-side-drawer__tools')).not.toBeNull();
    expect(getFontButton().closest('.ui-side-drawer__tools')).not.toBeNull();

    for (const [current, next] of [
      ['system', 'light'], ['light', 'dark'], ['dark', 'system'],
    ] as const) {
      const button = screen.getByRole('button', {
        name: t('ui.sideDrawer.themeAction', {
          current: t(`ui.sideDrawer.theme_${current}`),
          next: t(`ui.sideDrawer.theme_${next}`),
        }),
      });
      fireEvent.click(button);
      expect(getTheme()).toBe(next);
    }

    for (const next of ['large', 'small', 'medium'] as const) {
      fireEvent.click(getFontButton());
      expect(document.documentElement.dataset.fontSize).toBe(next);
      expect(localStorage.getItem('toosterx:font-size')).toBe(next);
    }
  });

  it('restores stored font preference and tolerates unavailable storage', () => {
    localStorage.setItem('toosterx:font-size', 'large');
    initFontSize();
    expect(document.documentElement.dataset.fontSize).toBe('large');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => initFontSize()).not.toThrow();
    expect(document.documentElement.dataset.fontSize).toBe('medium');
    expect(() => setFontSize('small')).not.toThrow();
    expect(document.documentElement.dataset.fontSize).toBe('small');
  });

  it('disables locale selection while loading and restores it on failure', async () => {
    const initialLocale = getCurrentLocale();
    const targetLocale = LOCALES.find((locale) => locale !== initialLocale);
    if (!targetLocale) throw new Error('Missing alternate locale');

    let rejectLoad: ((reason: Error) => void) | undefined;
    const loader = vi.fn(async (locale: Locale) => {
      if (locale === targetLocale) {
        return new Promise<Record<string, string>>((_resolve, reject) => {
          rejectLoad = reject;
        });
      }
      return shellDictionary(locale);
    });
    _setDictLoaderForTest(loader);
    render(<Harness />);
    await act(async () => { openDrawer(); });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      const select = getLocaleSelect();
      const ownerWindow = select.ownerDocument.defaultView;
      if (!ownerWindow) throw new Error('Missing window');
      select.value = targetLocale;
      select.dispatchEvent(new ownerWindow.Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(loader).toHaveBeenCalledExactlyOnceWith(targetLocale);
      expect(getLocaleSelect().disabled).toBe(true);
      expect(getLocaleSelect().getAttribute('aria-busy')).toBe('true');
    });
    expect(screen.getByRole('status').textContent).toBe(t('ui.sideDrawer.loading'));

    await act(async () => {
      if (!rejectLoad) throw new Error('Loader did not start');
      rejectLoad(new Error('fixture failure'));
    });
    await waitFor(() => {
      const select = getLocaleSelect();
      const alert = screen.getByRole('alert');
      expect(select.disabled).toBe(false);
      expect(select.value).toBe(initialLocale);
      expect(getCurrentLocale()).toBe(initialLocale);
      expect(alert.textContent).toBe(t('ui.sideDrawer.localeError'));
      expect(select.getAttribute('aria-describedby')).toBe(alert.id);
      expect(select.getAttribute('aria-invalid')).toBe('true');
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  it('restores body scrolling and external focus on unmount', () => {
    document.body.style.overflow = 'auto';
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    try {
      trigger.focus();
      const view = render(
        <LocationProvider><SideDrawer open onClose={vi.fn()} /></LocationProvider>,
      );
      expect(document.body.style.overflow).toBe('hidden');
      view.unmount();
      expect(document.body.style.overflow).toBe('auto');
      expect(document.activeElement).toBe(trigger);
      expect(touch(trigger, 'touchmove', 60).defaultPrevented).toBe(false);
    } finally {
      trigger.remove();
    }
  });
});
