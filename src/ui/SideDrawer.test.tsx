import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { LocationProvider } from 'preact-iso';
import { SideDrawer } from './SideDrawer';
import { TopBar } from './TopBar';
import { _resetForTest, registerFeatures, setRemoteFlags } from '@/core/feature-registry';
import type { RouteAccessContext } from '@/core/feature-types';
import { getTheme, setTheme } from '@/core/theme';

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));

const load = async () => ({ default: () => null });

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
  const button = screen.getByRole('button', { name: '選單' });
  button.focus();
  fireEvent.click(button);
  return button;
}

beforeEach(() => {
  _resetForTest();
  history.replaceState(null, '', '/');
  setTheme('light');
  document.documentElement.style.fontSize = '';
  localStorage.removeItem('sporthub_font_size');

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
  _resetForTest();
  setTheme('light');
  document.documentElement.style.fontSize = '';
  localStorage.removeItem('sporthub_font_size');
});

describe('SideDrawer (legacy A DOM & CSS)', () => {
  it('wraps #drawer-overlay and #side-drawer in .legacy-ui.legacy-chrome', () => {
    render(<Harness />);
    openDrawer();
    const overlay = document.getElementById('drawer-overlay');
    const drawer = document.getElementById('side-drawer');
    expect(overlay).not.toBeNull();
    expect(drawer).not.toBeNull();
    expect(overlay?.classList.contains('open')).toBe(true);
    expect(drawer?.classList.contains('open')).toBe(true);
    expect(drawer?.closest('.legacy-ui.legacy-chrome')).not.toBeNull();
  });

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

  it('closes on #drawer-overlay click and Escape', () => {
    render(<Harness />);
    openDrawer();
    const overlay = document.getElementById('drawer-overlay')!;
    fireEvent.click(overlay);
    expect(document.getElementById('side-drawer')).toBeNull();

    openDrawer();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.getElementById('side-drawer')).toBeNull();
  });

  it('renders drawer items in #drawer-menu with A classes and hides disabled features', async () => {
    render(<Harness />);
    openDrawer();
    const menu = document.getElementById('drawer-menu')!;
    const items = Array.from(menu.querySelectorAll<HTMLAnchorElement>('a.drawer-item'));
    expect(items.map((a) => a.getAttribute('href'))).toEqual([
      '/stats', '/manual', '/profile/qr', '/admin/events',
    ]);
    expect(menu.querySelector('.drawer-divider')).not.toBeNull();
    await act(() => setRemoteFlags({ 'shell-drawer-admin': false }));
    expect(menu.querySelector('[href="/admin/events"]')).toBeNull();
  });

  it('cycles font size 15px -> 16.5px -> 18px on html style and localStorage sporthub_font_size', () => {
    render(<Harness />);
    openDrawer();
    const btn = document.getElementById('drawer-font-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();

    fireEvent.click(btn);
    expect(document.documentElement.style.fontSize).toBe('16.5px');
    expect(localStorage.getItem('sporthub_font_size')).toBe('16.5px');
    expect(btn.classList.contains('font-m')).toBe(true);

    fireEvent.click(btn);
    expect(document.documentElement.style.fontSize).toBe('18px');
    expect(localStorage.getItem('sporthub_font_size')).toBe('18px');
    expect(btn.classList.contains('font-l')).toBe(true);

    fireEvent.click(btn);
    expect(document.documentElement.style.fontSize).toBe('15px');
    expect(localStorage.getItem('sporthub_font_size')).toBe('15px');
  });

  it('toggles theme via #theme-toggle', () => {
    setTheme('light');
    render(<Harness />);
    openDrawer();
    const toggle = document.getElementById('theme-toggle')!;
    fireEvent.click(toggle);
    expect(getTheme()).toBe('dark');
    fireEvent.click(toggle);
    expect(getTheme()).toBe('light');
  });

  it('displays user name and role tag in #drawer-name and #drawer-role-tag', () => {
    render(
      <LocationProvider>
        <SideDrawer
          open
          onClose={vi.fn()}
          user={{ uid: 'u1', displayName: 'Alex', pictureUrl: null }}
        />
      </LocationProvider>,
    );
    expect(document.getElementById('drawer-name')?.textContent).toBe('Alex');
    expect(document.getElementById('drawer-role-tag')?.textContent).toBe('一般會員');
  });
});
