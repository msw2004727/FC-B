import './side-drawer.css';
import type { RefObject } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Avatar } from '@/ui/Avatar';
import { Icon, type IconName } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { getCurrentLocale, setLocale, useT } from '@/i18n/i18n';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/locales';
import { setTheme, useTheme, type ThemeMode } from '@/core/theme';
import { nextFontSize, setFontSize, useFontSize } from '@/core/font-size';
import { getActiveRoutes, getNavItems, useRegistryVersion } from '@/core/feature-registry';
import type { RouteAccessContext } from '@/core/feature-types';
import { on } from '@/core/events';
import type { AuthUser } from '@/data/auth';

export interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLButtonElement>;
  user?: AuthUser | null;
  onLogin?: (() => void) | undefined;
  loginPending?: boolean;
  loginError?: boolean;
  /** 登入者權限摘要；用來篩選有 drawerVisibleIf 的入口。 */
  routeAccess?: RouteAccessContext | null;
}

function drawerOrder(titleKey: string): number {
  switch (titleKey.split('.')[0]) {
    case 'stats': case 'statistics': return 0;
    case 'market': case 'marketplace': return 1;
    case 'ranking': case 'leaderboard': return 2;
    case 'manual': case 'guide': case 'help': return 3;
    case 'share': return 4;
    case 'application': case 'apply': return 5;
    default: return 6;
  }
}

function nextTheme(mode: ThemeMode): ThemeMode {
  return mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
}

function themeIcon(mode: ThemeMode): IconName {
  return mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'globe';
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]',
  )).filter((element) => {
    const style = getComputedStyle(element);
    return element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[hidden],[inert],[aria-hidden="true"]') &&
      style.display !== 'none' &&
      style.visibility !== 'hidden';
  });
}

interface BodyLock {
  count: number;
  value: string;
  priority: string;
}

const bodyLocks = new WeakMap<HTMLElement, BodyLock>();
const activeDrawers: HTMLElement[] = [];

function lockBody(body: HTMLElement): () => void {
  let lock = bodyLocks.get(body);
  if (!lock) {
    lock = {
      count: 0,
      value: body.style.getPropertyValue('overflow'),
      priority: body.style.getPropertyPriority('overflow'),
    };
    bodyLocks.set(body, lock);
    body.style.setProperty('overflow', 'hidden');
  }
  lock.count += 1;
  return () => {
    const current = bodyLocks.get(body);
    if (!current) return;
    current.count -= 1;
    if (current.count !== 0) return;
    if (current.value) {
      body.style.setProperty('overflow', current.value, current.priority);
    } else {
      body.style.removeProperty('overflow');
    }
    bodyLocks.delete(body);
  };
}

export function SideDrawer({
  open,
  onClose,
  returnFocusRef,
  user = null,
  onLogin,
  loginPending = false,
  loginError = false,
  routeAccess = null,
}: SideDrawerProps): preact.JSX.Element | null {
  const t = useT();
  const theme = useTheme();
  const fontSize = useFontSize();
  const { path } = useLocation();
  const registryVersion = useRegistryVersion();
  const dialogRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const returnRef = useRef(returnFocusRef);
  onCloseRef.current = onClose;
  returnRef.current = returnFocusRef;

  const [locale, setLocaleState] = useState<Locale>(getCurrentLocale());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loadingRef = useRef(false);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);
  const previousPath = useRef(path);

  const routes = useMemo(() => {
    const navPaths = new Set(getNavItems().map((item) => item.path));
    // A 採無分組列表；保留 B 已啟用的真實入口，不捏造未實作的 A 功能。
    // 管理入口仍受 registry 控制，放在列表尾端，不再使用管理分組標題。
    return getActiveRoutes()
      .filter((route) =>
        !navPaths.has(route.path) &&
        route.path !== '/checkin' &&
        !/[:*]/.test(route.path) &&
        // 有權限條件的入口：還沒有登入者權限（未登入、內測閘門前、載入中）時一律不顯示。
        (!route.drawerVisibleIf || (!!routeAccess && route.drawerVisibleIf(routeAccess))))
      .sort((a, b) =>
        Number(a.path.startsWith('/admin/')) - Number(b.path.startsWith('/admin/')) ||
        drawerOrder(a.titleKey) - drawerOrder(b.titleKey));
  }, [registryVersion, routeAccess]);

  useEffect(() => {
    const unsubscribe = on('locale:changed', ({ locale: next }) => setLocaleState(next));
    setLocaleState(getCurrentLocale());
    return unsubscribe;
  }, []);

  useEffect(() => () => {
    request.current += 1;
    if (errorTimer.current !== null) clearTimeout(errorTimer.current);
  }, []);

  useEffect(() => {
    if (previousPath.current !== path && open) onCloseRef.current();
    previousPath.current = path;
  }, [path, open]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    if (!open || !dialog || !panel) return;

    const previous = document.activeElement;
    const trigger = returnRef.current?.current ??
      (previous instanceof HTMLElement ? previous : null);
    const unlock = lockBody(document.body);
    activeDrawers.push(dialog);
    const isTop = () => activeDrawers[activeDrawers.length - 1] === dialog;
    const focusFirst = (): void => {
      (focusableElements(panel)[0] ?? panel).focus({ preventScroll: true });
    };

    // A 頂列沒有關閉鈕；初始焦點落在面板，Escape／遮罩可關閉。
    panel.focus({ preventScroll: true });

    const keepFocus = (event: FocusEvent): void => {
      if (isTop() && event.target instanceof Node && !panel.contains(event.target)) {
        focusFirst();
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isTop()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusableElements(panel);
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey &&
        (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey &&
        (active === last || active === panel || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    const preventOutsideInteraction = (event: Event): void => {
      if (!isTop() || (event.target instanceof Node && dialog.contains(event.target))) return;
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    };

    let touchY: number | undefined;
    const rememberTouch = (event: TouchEvent): void => {
      touchY = event.touches[0]?.clientY;
    };
    const preventBackgroundScroll = (event: TouchEvent): void => {
      if (!isTop()) return;
      const target = event.target;
      const y = event.touches[0]?.clientY;
      const delta = y !== undefined && touchY !== undefined ? y - touchY : 0;
      touchY = y;
      if (target instanceof Node && panel.contains(target) && event.touches.length > 1) {
        return;
      }
      if (target instanceof Element && panel.contains(target) && delta !== 0) {
        let element: Element | null = target;
        while (element && panel.contains(element)) {
          if (element instanceof HTMLElement) {
            const overflow = getComputedStyle(element).overflowY;
            const available = element.scrollHeight - element.clientHeight;
            if (/^(auto|scroll)$/.test(overflow) && available > 0 &&
              ((delta < 0 && element.scrollTop < available - 1) ||
               (delta > 0 && element.scrollTop > 0))) {
              return;
            }
          }
          if (element === panel) break;
          element = element.parentElement;
        }
      }
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener('focusin', keepFocus, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', preventOutsideInteraction, true);
    document.addEventListener('click', preventOutsideInteraction, true);
    document.addEventListener('touchstart', preventOutsideInteraction, { capture: true, passive: false });
    document.addEventListener('touchstart', rememberTouch, { capture: true, passive: true });
    document.addEventListener('touchmove', preventBackgroundScroll, { capture: true, passive: false });

    return () => {
      const active = document.activeElement;
      const shouldRestore = isTop() &&
        (active === document.body || active === null || dialog.contains(active));
      document.removeEventListener('focusin', keepFocus, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', preventOutsideInteraction, true);
      document.removeEventListener('click', preventOutsideInteraction, true);
      document.removeEventListener('touchstart', preventOutsideInteraction, true);
      document.removeEventListener('touchstart', rememberTouch, true);
      document.removeEventListener('touchmove', preventBackgroundScroll, true);
      const index = activeDrawers.indexOf(dialog);
      if (index >= 0) activeDrawers.splice(index, 1);
      unlock();
      if (shouldRestore && trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  const handleLocale = async (event: Event): Promise<void> => {
    const select = event.currentTarget as HTMLSelectElement;
    const value = select.value;
    if (loadingRef.current || !(LOCALES as readonly string[]).includes(value)) return;
    const sequence = ++request.current;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(false);
    if (errorTimer.current !== null) {
      clearTimeout(errorTimer.current);
      errorTimer.current = null;
    }
    try {
      await setLocale(value as Locale);
    } catch {
      if (sequence !== request.current) return;
      select.value = getCurrentLocale();
      setLoadError(true);
      errorTimer.current = setTimeout(() => {
        setLoadError(false);
        errorTimer.current = null;
      }, 3000);
    } finally {
      if (sequence === request.current) {
        loadingRef.current = false;
        setLocaleState(getCurrentLocale());
        setLoading(false);
      }
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      id="side-drawer"
      ref={dialogRef}
      class="ui-side-drawer"
      role="dialog"
      aria-label={t('ui.sideDrawer.label')}
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div ref={panelRef} class="ui-side-drawer__panel" tabIndex={-1}>
        <div class="ui-side-drawer__header">
          <Avatar
            name={user?.displayName ?? t('ui.shell.guestAvatar')}
            pictureUrl={user?.pictureUrl ?? null}
            size="lg"
            decorative
          />
          <div class="ui-side-drawer__identity">
            {user?.displayName && (
              <Text class="ui-side-drawer__name">{user.displayName}</Text>
            )}
            <Text class="ui-side-drawer__role">
              {t(user ? 'ui.userTag.role.user' : 'ui.shell.signedOut')}
            </Text>
          </div>
          {!user && onLogin && (
            <button
              type="button"
              class="ui-side-drawer__login"
              disabled={loginPending}
              aria-label={t('ui.topBar.login')}
              aria-busy={loginPending || undefined}
              onClick={onLogin}
            >
              <span class="ui-side-drawer__login-face">
                {loginPending && (
                  <svg class="ui-side-drawer__spinner" width="16" height="16"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2" aria-hidden="true" focusable="false">
                    <path d="M12 3a9 9 0 1 1-9 9" />
                  </svg>
                )}
                <Text>{t('ui.topBar.login')}</Text>
              </span>
            </button>
          )}
        </div>

        {loginError && (
          <div class="ui-side-drawer__error" role="alert">
            <Text>{t('ui.shell.loginError')}</Text>
          </div>
        )}

        <nav class="ui-side-drawer__navigation" aria-label={t('ui.sideDrawer.navigation')}>
          <ul class="ui-side-drawer__list">
            {routes.map((route) => (
              <li key={route.path}>
                <a
                  href={route.path}
                  class="ui-side-drawer__link"
                  aria-current={path === route.path ? 'page' : undefined}
                  onClick={() => onCloseRef.current()}
                >
                  <Text>{t(route.titleKey)}</Text>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div class="ui-side-drawer__tools">
          <div class="ui-side-drawer__tools-row">
            <button
              id="theme-toggle"
              type="button"
              class="ui-side-drawer__theme"
              aria-label={t('ui.sideDrawer.themeAction', {
                current: t(`ui.sideDrawer.theme_${theme}`),
                next: t(`ui.sideDrawer.theme_${nextTheme(theme)}`),
              })}
              title={t(`ui.sideDrawer.theme_${theme}`)}
              onClick={() => setTheme(nextTheme(theme))}
            >
              <Text>{t('ui.sideDrawer.theme')}</Text>
              <span
                class={`ui-side-drawer__theme-track ui-side-drawer__theme-track--${theme}`}
                aria-hidden="true"
              >
                <span class="ui-side-drawer__theme-thumb">
                  <Icon name={themeIcon(theme)} size={18} />
                </span>
              </span>
            </button>
            <Text class="ui-side-drawer__theme-label">
              {t(`ui.sideDrawer.theme_${theme}`)}
            </Text>
          </div>

          <div class="ui-side-drawer__tools-row">
            <div class="ui-side-drawer__locale">
              <label for="drawer-locale">
                <Text>{t('ui.sideDrawer.language')}</Text>
              </label>
              <select
                id="drawer-locale"
                value={locale}
                disabled={loading}
                aria-busy={loading || undefined}
                aria-describedby={loadError ? 'drawer-locale-error' : undefined}
                aria-invalid={loadError || undefined}
                onChange={handleLocale}
              >
                {LOCALES.map((language) => (
                  <option key={language} value={language} label={LOCALE_LABELS[language]} />
                ))}
              </select>
            </div>
            <button
              id="drawer-font-btn"
              type="button"
              class="ui-side-drawer__font"
              aria-label={t('ui.shell.fontAction', {
                current: t(`ui.shell.font_${fontSize}`),
                next: t(`ui.shell.font_${nextFontSize(fontSize)}`),
              })}
              title={t(`ui.shell.font_${fontSize}`)}
              onClick={() => setFontSize(nextFontSize(fontSize))}
            >
              <span class="ui-side-drawer__font-face" aria-hidden="true">
                <Text>{t('ui.shell.fontSample')}</Text>
              </span>
            </button>
          </div>

          {loading && <div role="status"><Text>{t('ui.sideDrawer.loading')}</Text></div>}
          {loadError && (
            <div id="drawer-locale-error" class="ui-side-drawer__error" role="alert">
              <Text>{t('ui.sideDrawer.localeError')}</Text>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
