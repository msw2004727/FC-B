import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { LocationProvider } from 'preact-iso';
import { SideDrawer } from './SideDrawer';
import { TopBar } from './TopBar';
import { _resetForTest, registerFeatures, setRemoteFlags } from '@/core/feature-registry';
import { _setDictLoaderForTest, getCurrentLocale, t } from '@/i18n/i18n';
import { LOCALES, type Locale } from '@/i18n/locales';
import { getTheme, setTheme } from '@/core/theme';
import { prepareShellLocale, shellDictionary } from './shell-test-utils';

const load = async () => ({ default: () => null });
let originalOverflow = '';
let originalPriority = '';

function Harness(): preact.JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <LocationProvider>
      <TopBar menuRef={trigger} drawerOpen={open} onMenuClick={() => setOpen(true)} />
      <SideDrawer open={open} onClose={() => setOpen(false)} returnFocusRef={trigger} />
    </LocationProvider>
  );
}

function openDrawer(): HTMLElement {
  const button = screen.getByRole('button', { name: t('ui.topBar.menu') });
  button.focus();
  fireEvent.click(button);
  return button;
}

function getLocaleSelect(): HTMLSelectElement {
  const dialog = screen.getByRole('dialog', { name: t('ui.sideDrawer.label') });
  const select = within(dialog).getByRole('combobox', {
    name: t('ui.sideDrawer.language'),
  });
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error('Locale control is not a select');
  }
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
  setTheme('system');
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
        { path: '/profile/qr', titleKey: 'profile.qr', load },
        { path: '/members/:id', titleKey: 'test.member', load },
      ],
      nav: [{ path: '/', labelKey: 'test.home', icon: 'home', order: 0 }],
    },
    {
      id: 'shell-drawer-admin',
      status: 'enabled',
      routes: [{ path: '/admin/events', titleKey: 'test.admin', load }],
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
  if (originalOverflow) {
    document.body.style.setProperty('overflow', originalOverflow, originalPriority);
  } else {
    document.body.style.removeProperty('overflow');
  }
  _resetForTest();
  _setDictLoaderForTest(null);
  setTheme('system');
  vi.restoreAllMocks();
});

describe('SideDrawer', () => {
  it('uses a div Portal, focuses, locks scrolling and restores focus and overflow', () => {
    document.body.style.setProperty('overflow', 'scroll', 'important');
    const view = render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const trigger = openDrawer();
    const dialog = screen.getByRole('dialog', { name: t('ui.sideDrawer.label') });
    expect(dialog.tagName).toBe('DIV');
    expect(dialog.parentElement).toBe(document.body);
    expect(view.container.contains(dialog)).toBe(false);
    expect(dialog.querySelector('dialog')).toBeNull();
    expect(dialog.classList.contains('ui-side-drawer')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');

    const close = screen.getByRole('button', { name: t('ui.sideDrawer.close') });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
  });

  it('closes on Escape and overlay click but not panel click', () => {
    render(<Harness />);
    openDrawer();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    openDrawer();
    fireEvent.click(screen.getByRole('heading', { name: t('ui.sideDrawer.label') }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('wraps keyboard focus in both directions and prevents focus escaping', () => {
    render(<Harness />);
    const trigger = openDrawer();
    const close = screen.getByRole('button', { name: t('ui.sideDrawer.close') });
    const select = screen.getByRole('combobox');
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(select);
    fireEvent.keyDown(select, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    trigger.focus();
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
  });

  it('blocks background interaction and releases its listeners on close', () => {
    const clicked = vi.fn();
    const view = render(
      <>
        <button type="button" onClick={clicked}>Background</button>
        <Harness />
      </>,
    );
    const background = within(view.container as HTMLElement).getByRole('button', { name: 'Background' });
    openDrawer();
    fireEvent.click(background);
    expect(clicked).not.toHaveBeenCalled();
    expect(touch(background, 'touchstart', 100).defaultPrevented).toBe(true);
    expect(touch(background, 'touchmove', 80).defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: t('ui.sideDrawer.close') }));
    fireEvent.click(background);
    expect(clicked).toHaveBeenCalledOnce();
    expect(touch(background, 'touchmove', 60).defaultPrevented).toBe(false);
  });

  it('blocks overlay and boundary touch scrolling while allowing panel scrolling', () => {
    render(<Harness />);
    openDrawer();
    const dialog = screen.getByRole('dialog');
    const panel = dialog.querySelector<HTMLElement>('.ui-side-drawer__panel');
    if (!panel) throw new Error('Missing drawer panel');

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

    expect(dialog.style.touchAction).not.toBe('none');
    expect(getComputedStyle(panel).touchAction).not.toBe('none');
  });

  it('derives links from enabled routes, excludes bottom nav, and groups admin', async () => {
    render(<Harness />);
    openDrawer();
    const navigation = screen.getByRole('navigation', {
      name: t('ui.sideDrawer.navigation'),
    });
    expect(within(navigation).queryByRole('link', { name: t('test.home') })).toBeNull();
    expect(navigation.querySelector('[href="/reserved"]')).toBeNull();
    expect(navigation.querySelector('[href="/members/:id"]')).toBeNull();
    const links = within(navigation).getAllByRole('link');
    expect(links.slice(0, 2).map((link) => link.getAttribute('href')))
      .toEqual(['/stats', '/manual']);
    const admin = screen.getByRole('region', { name: t('ui.sideDrawer.admin') });
    expect(within(admin).getByRole('link', { name: t('test.admin') })
      .getAttribute('href')).toBe('/admin/events');
    await act(() => { setRemoteFlags({ 'shell-drawer-admin': false }); });
    expect(screen.queryByRole('region', { name: t('ui.sideDrawer.admin') })).toBeNull();
  });

  it('keeps locale and three-state theme controls in the footer', () => {
    render(<Harness />);
    openDrawer();
    const select = screen.getByRole('combobox', { name: t('ui.sideDrawer.language') });
    expect(select.closest('.ui-side-drawer__tools')).not.toBeNull();

    for (const [current, next] of [
      ['system', 'light'],
      ['light', 'dark'],
      ['dark', 'system'],
    ] as const) {
      const button = screen.getByRole('button', {
        name: t('ui.sideDrawer.themeAction', {
          current: t(`ui.sideDrawer.theme_${current}`),
          next: t(`ui.sideDrawer.theme_${next}`),
        }),
      });
      expect(button.closest('.ui-side-drawer__tools')).not.toBeNull();
      fireEvent.click(button);
      expect(getTheme()).toBe(next);
    }
  });

  it('disables locale selection while loading and restores it on failure', async () => {
    const initialLocale = getCurrentLocale();
    const targetLocale = LOCALES.find((locale) => locale !== initialLocale);
    if (!targetLocale) throw new Error('Missing alternate locale fixture');

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

    // 先完成 open 更新與 Portal effects，再進行下一次使用者互動。
    await act(async () => {
      openDrawer();
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(getLocaleSelect().value).toBe(initialLocale);
    expect(getLocaleSelect().disabled).toBe(false);
    expect(loader).not.toHaveBeenCalled();

    /*
     * 附件只能證明 change 未進入處理函式，尚不能唯一確認根因。
     * 此處在 flush 後重新取得已連接的 Portal 節點，並在同一個 act
     * 內設定 value、派送該 document 所屬 window 的全新原生事件。
     * 不讀寫 Preact 私有 listener／事件欄位，也不直接呼叫處理函式。
     * loader 的同步斷言能區分「事件未進入」與「非同步畫面尚未更新」。
     * 此修正仍需在專案的 jsdom 環境執行驗證。
     */
    await act(async () => {
      const select = getLocaleSelect();
      expect(select.isConnected).toBe(true);
      expect(screen.getByRole('dialog').contains(select)).toBe(true);
      expect(Array.from(select.options).some((option) => option.value === targetLocale))
        .toBe(true);

      const ownerWindow = select.ownerDocument.defaultView;
      if (!ownerWindow) throw new Error('Missing locale control window');

      select.value = targetLocale;
      expect(select.value).toBe(targetLocale);
      select.dispatchEvent(new ownerWindow.Event('change', { bubbles: true }));

      expect(loader).toHaveBeenCalledExactlyOnceWith(targetLocale);
      expect(rejectLoad).toBeTypeOf('function');
    });

    await waitFor(() => {
      const select = getLocaleSelect();
      expect(select.disabled).toBe(true);
      expect(select.getAttribute('aria-busy')).toBe('true');
    });
    expect(getCurrentLocale()).toBe(initialLocale);
    expect(screen.getByRole('status').textContent).toBe(t('ui.sideDrawer.loading'));
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => {
      if (!rejectLoad) throw new Error('Locale loader did not start');
      rejectLoad(new Error('fixture load failure'));
    });

    await waitFor(() => {
      const select = getLocaleSelect();
      const alert = screen.getByRole('alert');
      expect(select.disabled).toBe(false);
      expect(select.hasAttribute('aria-busy')).toBe(false);
      expect(select.value).toBe(initialLocale);
      expect(getCurrentLocale()).toBe(initialLocale);
      expect(alert.textContent).toBe(t('ui.sideDrawer.localeError'));
      expect(alert.id).toBe('drawer-locale-error');
      expect(select.getAttribute('aria-describedby')).toBe(alert.id);
      expect(document.getElementById(alert.id)).toBe(alert);
      expect(select.getAttribute('aria-invalid')).toBe('true');
      expect(screen.queryByRole('status')).toBeNull();
    });
    expect(loader).toHaveBeenCalledExactlyOnceWith(targetLocale);
  });

  it('restores body scrolling and external focus on unmount', () => {
    document.body.style.overflow = 'auto';
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    try {
      trigger.focus();
      const view = render(
        <LocationProvider>
          <SideDrawer open onClose={vi.fn()} />
        </LocationProvider>,
      );
      expect(document.body.style.overflow).toBe('hidden');
      view.unmount();
      expect(document.body.style.overflow).toBe('auto');
      expect(document.activeElement).toBe(trigger);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(touch(trigger, 'touchmove', 60).defaultPrevented).toBe(false);
    } finally {
      trigger.remove();
    }
  });
});
