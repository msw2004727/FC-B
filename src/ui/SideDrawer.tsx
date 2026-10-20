import type { RefObject } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { getCurrentLocale, lt, setLocale, useT } from '@/i18n/i18n';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/locales';
import { setTheme, useTheme, type ThemeMode } from '@/core/theme';
import { getActiveRoutes, getNavItems, useRegistryVersion } from '@/core/feature-registry';
import type { FeatureRoute, RouteAccessContext } from '@/core/feature-types';
import { on } from '@/core/events';
import { APP_VERSION } from '@/version';
import '@/styles/legacy/version-tag.css';
import type { AuthUser } from '@/data/auth';
import { toast } from '@/ui/Toast';

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

const FONT_STORAGE_KEY = 'sporthub_font_size';
const LEGACY_FONT_STEPS = ['15px', '16.5px', '18px'] as const;
type LegacyFontStep = (typeof LEGACY_FONT_STEPS)[number];

const UNAVAILABLE_MSG = '此功能尚未開放，請先使用舊版';

function readLegacyFontStep(): LegacyFontStep {
  try {
    const saved = localStorage.getItem(FONT_STORAGE_KEY);
    if (saved === '15px' || saved === '16.5px' || saved === '18px') return saved;
    if (saved === '15' || saved === 's' || saved === 'small') return '15px';
    if (saved === '16.5' || saved === 'm' || saved === 'medium') return '16.5px';
    if (saved === '18' || saved === 'l' || saved === 'large') return '18px';
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    const current = document.documentElement.style.fontSize;
    if (current === '16.5px' || current === '18px') return current;
  }
  return '15px';
}

function applyLegacyFontStep(step: LegacyFontStep): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.fontSize = step;
  }
  try {
    localStorage.setItem(FONT_STORAGE_KEY, step);
  } catch {
    /* ignore */
  }
}

function nextLegacyFontStep(step: LegacyFontStep): LegacyFontStep {
  if (step === '15px') return '16.5px';
  if (step === '16.5px') return '18px';
  return '15px';
}

function fontBtnClass(step: LegacyFontStep): string {
  if (step === '16.5px') return 'drawer-font-btn font-m';
  if (step === '18px') return 'drawer-font-btn font-l';
  return 'drawer-font-btn';
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

function isEffectiveDark(mode: ThemeMode): boolean {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark') return true;
    if (attr === 'light') return false;
  }
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function roleLabel(role: string | undefined, signedIn: boolean): string {
  if (!signedIn) return '未登入';
  switch (role) {
    case 'super_admin': return '最高管理員';
    case 'admin': return '管理員';
    case 'captain': return '俱樂部領隊';
    case 'coach': return '活動主辦';
    case 'venue_owner': return '場地主';
    default: return '一般會員';
  }
}

function routeRoleBgClass(route: FeatureRoute): string {
  if (route.path.startsWith('/admin/super') || route.path === '/admin/logs') {
    return 'drawer-role-super';
  }
  if (route.path.startsWith('/admin/')) {
    return 'drawer-role-admin';
  }
  return '';
}

interface BodyLock {
  count: number;
  value: string;
  priority: string;
}

const bodyLocks = new WeakMap<HTMLElement, BodyLock>();

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
  const location = useLocation();
  const path = location.path;
  const registryVersion = useRegistryVersion();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const returnRef = useRef(returnFocusRef);
  onCloseRef.current = onClose;
  returnRef.current = returnFocusRef;

  const [fontStep, setFontStep] = useState<LegacyFontStep>(() => readLegacyFontStep());
  const [locale, setLocaleState] = useState<Locale>(getCurrentLocale());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loadingRef = useRef(false);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);
  const previousPath = useRef(path);

  const routes = useMemo(() => {
    const navPaths = new Set(getNavItems().map((item) => item.path));
    return getActiveRoutes()
      .filter((route) =>
        !navPaths.has(route.path) &&
        route.path !== '/checkin' &&
        !/[:*]/.test(route.path) &&
        (!route.drawerVisibleIf || (!!routeAccess && route.drawerVisibleIf(routeAccess))))
      .sort((a, b) =>
        Number(a.path.startsWith('/admin/')) - Number(b.path.startsWith('/admin/')) ||
        drawerOrder(a.titleKey) - drawerOrder(b.titleKey));
  }, [registryVersion, routeAccess]);

  useEffect(() => {
    const step = readLegacyFontStep();
    setFontStep(step);
  }, [open]);

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
    const panel = panelRef.current;
    if (!open || !panel) return;

    const previous = document.activeElement;
    const trigger = returnRef.current?.current ??
      (previous instanceof HTMLElement ? previous : null);
    const unlock = lockBody(document.body);

    panel.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      unlock();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  const handleCycleFontSize = (): void => {
    const current = readLegacyFontStep();
    const next = nextLegacyFontStep(current);
    applyLegacyFontStep(next);
    setFontStep(next);
  };

  const handleToggleTheme = (): void => {
    const dark = isEffectiveDark(theme);
    setTheme(dark ? 'light' : 'dark');
  };

  const handleClearCache = (): void => {
    toast.show({ message: UNAVAILABLE_MSG });
  };

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

  const isDark = isEffectiveDark(theme);
  const avatarInitial = (user?.displayName?.trim()?.[0] ?? '?').toUpperCase();
  const displayName = user?.displayName || (user ? '會員' : '訪客');
  const displayRole = roleLabel(routeAccess?.role, Boolean(user));

  const normalRoutes = routes.filter((r) => !r.path.startsWith('/admin/'));
  const adminRoutes = routes.filter((r) => r.path.startsWith('/admin/'));

  return createPortal(
    <div class="legacy-ui legacy-chrome">
      <div
        id="drawer-overlay"
        class={open ? 'open' : ''}
        onClick={() => onCloseRef.current()}
      />
      <nav
        id="side-drawer"
        ref={panelRef}
        class={open ? 'open' : ''}
        role="dialog"
        aria-modal="true"
        aria-label={t('ui.sideDrawer.label')}
        tabIndex={-1}
      >
        <div class="drawer-header">
          <div class="drawer-user">
            {user?.pictureUrl ? (
              <div class="drawer-avatar drawer-avatar-img" id="drawer-avatar">
                <img src={user.pictureUrl} alt={user.displayName ?? ''} />
              </div>
            ) : (
              <div class="drawer-avatar" id="drawer-avatar">
                {avatarInitial}
              </div>
            )}
            <div class="drawer-user-info">
              <div class="drawer-name" id="drawer-name">{displayName}</div>
              <div class="drawer-role-tag" id="drawer-role-tag">{displayRole}</div>
            </div>
            <div class="drawer-actions">
              {!user && onLogin && (
                <button
                  type="button"
                  class="line-login-btn"
                  disabled={loginPending}
                  aria-label="LINE 登入"
                  aria-busy={loginPending ? 'true' : undefined}
                  onClick={onLogin}
                >
                  LINE 登入
                </button>
              )}
              <button
                class={fontBtnClass(fontStep)}
                id="drawer-font-btn"
                type="button"
                title={lt('字型大小', '字型大小')}
                aria-label={lt('字型大小', '字型大小')}
                data-i18n-title="字型大小"
                data-i18n-aria-label="字型大小"
                onClick={handleCycleFontSize}
              >
                <svg class="drawer-font-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <text class="font-icon-a font-icon-a-large" x="3.5" y="15.4">A</text>
                  <text class="font-icon-a font-icon-a-small" x="15.3" y="15.4">A</text>
                  <circle class="font-step font-step-1" cx="7" cy="20" r="1.25" />
                  <circle class="font-step font-step-2" cx="12" cy="20" r="1.25" />
                  <circle class="font-step font-step-3" cx="17" cy="20" r="1.25" />
                </svg>
              </button>
              <div class="drawer-action-stack">
                <button
                  type="button"
                  class="drawer-pwa-btn"
                  id="pwa-install-btn"
                  title={lt('下載APP', '下載APP')}
                  style="display:none"
                  data-i18n-title="下載APP"
                >
                  <span data-i18n="下載APP">{lt('下載APP', '下載APP')}</span>
                </button>
                {/* A `_renderHomeVersionTag`：側邊選單底部顯示 `v{版號}`（版號規則見 src/version.ts）。 */}
                <div class="home-version-tag" id="home-version-tag">{`v${APP_VERSION}`}</div>
              </div>
            </div>
          </div>
          {loginError && (
            <div role="alert" style={{ marginTop: '.5rem', fontSize: '.78rem', color: 'var(--danger)' }}>
              {t('ui.shell.loginError')}
            </div>
          )}
        </div>

        <div class="drawer-menu" id="drawer-menu">
          {normalRoutes.map((route) => {
            const active = path === route.path;
            return (
              <a
                key={route.path}
                href={route.path}
                class={`drawer-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onCloseRef.current()}
              >
                {t(route.titleKey)}
              </a>
            );
          })}
          {normalRoutes.length > 0 && adminRoutes.length > 0 && (
            <div class="drawer-divider" />
          )}
          {adminRoutes.map((route) => {
            const active = path === route.path;
            const bgClass = routeRoleBgClass(route);
            return (
              <a
                key={route.path}
                href={route.path}
                class={`drawer-item${bgClass ? ` ${bgClass}` : ''}${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onCloseRef.current()}
              >
                {t(route.titleKey)}
              </a>
            );
          })}
        </div>

        <div class="drawer-footer">
          <div class="drawer-theme-row">
            <button
              id="theme-toggle"
              type="button"
              onClick={handleToggleTheme}
            >
              <span data-i18n="深色模式">{lt('深色模式', '深色模式')}</span>
              <div class={`toggle-switch${isDark ? ' active' : ''}`}>
                <div class="toggle-knob" />
              </div>
            </button>
            <div class="drawer-legal-row">
              <a class="drawer-legal-btn" href="privacy.html" target="_blank" rel="noopener noreferrer">
                <span data-i18n="隱私權政策">{lt('隱私權政策', '隱私權政策')}</span>
              </a>
              <a class="drawer-legal-btn" href="terms.html" target="_blank" rel="noopener noreferrer">
                <span data-i18n="服務條款">{lt('服務條款', '服務條款')}</span>
              </a>
            </div>
          </div>
          <div class="drawer-footer-bottom">
            <div id="lang-switcher" class="lang-switcher">
              <span class="lang-label" data-i18n="語言">{lt('語言', '語言')}</span>
              <select
                id="lang-select"
                aria-label="語言"
                value={locale}
                disabled={loading}
                aria-busy={loading ? 'true' : undefined}
                aria-describedby={loadError ? 'drawer-locale-error' : undefined}
                aria-invalid={loadError ? 'true' : undefined}
                onChange={handleLocale}
              >
                {LOCALES.map((language) => (
                  <option key={language} value={language} label={LOCALE_LABELS[language]}>
                    {LOCALE_LABELS[language]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              class="drawer-clear-btn"
              title={lt('清除快取', '清除快取')}
              data-i18n-title="清除快取"
              onClick={handleClearCache}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                <path d="M19 6l-.867 12.142A2 2 0 0116.138 20H7.862a2 2 0 01-1.995-1.858L5 6" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
              <span data-i18n="清除快取">{lt('清除快取', '清除快取')}</span>
            </button>
          </div>
          {loading && <div role="status">{t('ui.sideDrawer.loading')}</div>}
          {loadError && (
            <div id="drawer-locale-error" role="alert">
              {t('ui.sideDrawer.localeError')}
            </div>
          )}
        </div>
      </nav>
    </div>,
    document.body,
  );
}
