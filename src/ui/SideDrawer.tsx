import './side-drawer.css';
import type { RefObject } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Icon, type IconName } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { getCurrentLocale, setLocale, useT } from '@/i18n/i18n';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/locales';
import { setTheme, useTheme, type ThemeMode } from '@/core/theme';
import { getActiveRoutes, getNavItems, useRegistryVersion } from '@/core/feature-registry';
import { on } from '@/core/events';

export interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLButtonElement>;
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

/**
 * Portal 與自訂 modal 行為不依賴 HTMLDialogElement 或 inert。
 * touchmove 僅在可消耗該方向捲動的面板內放行，避免舊 iOS 捲動鏈穿透。
 */
export function SideDrawer({
  open,
  onClose,
  returnFocusRef,
}: SideDrawerProps): preact.JSX.Element | null {
  const t = useT();
  const theme = useTheme();
  const { path } = useLocation();
  const registryVersion = useRegistryVersion();
  const dialogRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const returnRef = useRef(returnFocusRef);
  onCloseRef.current = onClose;
  returnRef.current = returnFocusRef;

  const [locale, setLocaleState] = useState<Locale>(getCurrentLocale());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);
  const previousPath = useRef(path);

  const groups = useMemo(() => {
    const navPaths = new Set(getNavItems().map((item) => item.path));
    const routes = getActiveRoutes().filter((route) =>
      !navPaths.has(route.path) && !/[:*]/.test(route.path),
    );
    return {
      general: routes.filter((route) => !route.path.startsWith('/admin/'))
        .sort((a, b) => drawerOrder(a.titleKey) - drawerOrder(b.titleKey)),
      admin: routes.filter((route) => route.path.startsWith('/admin/')),
    };
  }, [registryVersion]);

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

    const focusFirst = () => {
      (focusableElements(panel)[0] ?? panel).focus({ preventScroll: true });
    };
    (closeRef.current ?? panel).focus({ preventScroll: true });

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

    // 阻擋 Portal 外的背景互動；面板與遮罩本身仍可正常接收事件。
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

      // 面板內的多指縮放保持可用。
      if (target instanceof Node && panel.contains(target) && event.touches.length > 1) {
        return;
      }

      if (target instanceof Element && panel.contains(target) && delta !== 0) {
        let element: Element | null = target;
        while (element && panel.contains(element)) {
          if (element instanceof HTMLElement) {
            const overflow = getComputedStyle(element).overflowY;
            const scrollable = /^(auto|scroll)$/.test(overflow);
            const available = element.scrollHeight - element.clientHeight;
            if (scrollable && available > 0 &&
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
    if (loading || !(LOCALES as readonly string[]).includes(value)) return;

    const sequence = ++request.current;
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
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        display: 'block',
        width: '100%',
        height: '100%',
        maxWidth: 'none',
        maxHeight: 'none',
        margin: 0,
        padding: 0,
        border: 0,
        overflow: 'hidden',
        pointerEvents: 'auto',
        touchAction: 'auto',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <style>{`
        #side-drawer .ui-side-drawer__panel {
          max-width: 100%;
          height: 100%;
          max-height: 100%;
          overflow-y: auto;
          overscroll-behavior-y: contain;
          -webkit-overflow-scrolling: touch;
          touch-action: auto;
        }
        #side-drawer button,
        #side-drawer select,
        #side-drawer a {
          min-width: 44px;
          min-height: 44px;
        }
        #side-drawer a {
          display: flex;
          align-items: center;
        }
        @media (prefers-reduced-motion: reduce) {
          #side-drawer,
          #side-drawer *,
          #side-drawer *::before,
          #side-drawer *::after {
            animation: none !important;
            transition: none !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>
      <div ref={panelRef} class="ui-side-drawer__panel" tabIndex={-1}>
        <div class="ui-side-drawer__header">
          <span class="ui-side-drawer__avatar" aria-hidden="true">
            <Icon name="user" size={24} />
          </span>
          <Text as="h2" class="ui-side-drawer__title">{t('ui.sideDrawer.label')}</Text>
          <button
            ref={closeRef}
            type="button"
            class="ui-side-drawer__close"
            aria-label={t('ui.sideDrawer.close')}
            title={t('ui.sideDrawer.close')}
            onClick={() => onCloseRef.current()}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
              aria-hidden="true" focusable="false">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <nav class="ui-side-drawer__navigation" aria-label={t('ui.sideDrawer.navigation')}>
          <ul class="ui-side-drawer__list">
            {groups.general.map((route) => (
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
          {groups.admin.length > 0 && (
            <section class="ui-side-drawer__admin" aria-labelledby="drawer-admin-title">
              <h3 id="drawer-admin-title" class="ui-side-drawer__group-title">
                <Text>{t('ui.sideDrawer.admin')}</Text>
              </h3>
              <ul class="ui-side-drawer__list">
                {groups.admin.map((route) => (
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
            </section>
          )}
        </nav>

        <div class="ui-side-drawer__tools">
          <button
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
            <span class="ui-side-drawer__theme-state">
              <Icon name={themeIcon(theme)} size={18} />
              <Text>{t(`ui.sideDrawer.theme_${theme}`)}</Text>
            </span>
          </button>

          <div class="ui-side-drawer__locale">
            <label for="drawer-locale"><Text>{t('ui.sideDrawer.language')}</Text></label>
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
