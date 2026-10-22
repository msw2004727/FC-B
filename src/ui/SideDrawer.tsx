import './drawer-extra.css';
import '@/styles/legacy/version-tag.css';
import type { RefObject } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { getCurrentLocale, lt, setLocale, useT } from '@/i18n/i18n';
import { DRAWER_LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/locales';
import { setTheme, useTheme, type ThemeMode } from '@/core/theme';
import {
  getFontSize,
  nextFontSize,
  setFontSize,
  useFontSize,
  type FontSize,
} from '@/core/font-size';
import type { RouteAccessContext } from '@/core/feature-types';
import { isAuthRequiredRoute } from '@/core/back-guard';
import { emit, on } from '@/core/events';
import { prefetchRouteByPath } from '@/core/route-prefetch';
import {
  LOCKED_FEATURE_MSG,
  LOGIN_PENDING_MSG,
  UNAVAILABLE_FEATURE_MSG,
} from '@/core/unavailable';
import { APP_VERSION } from '@/version';
import type { AuthUser } from '@/data/auth';
import { getLastKnownAuthUid } from '@/data/auth';
import { toast } from '@/ui/Toast';
import {
  buildDrawerRenderNodes,
  getMiniAppShareUrl,
  resolveDrawerRoleInfo,
  type CustomRoleInput,
  type DrawerMenuEntry,
} from './drawer-menu';
import {
  readLocalAdminStealth,
  syncAdminStealthFromUser,
  toggleAdminStealth,
} from '@/data/stealth';
import {
  copyTextToClipboard,
  getDeferredInstallPrompt,
  initPwaInstallListener,
  isStandalonePwa,
} from '@/features/pwa/pwa-install';
import { PwaModals, type PwaModalStep } from '@/features/pwa/PwaModals';
import { GuestAvatarIcon } from './GuestAvatarIcon';

export interface SideDrawerIdentity {
  readonly identityId?: 'primary' | 'secondary' | string;
  readonly displayName?: string | null;
  readonly avatarCandidates?: readonly string[];
}

export interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLButtonElement>;
  user?: AuthUser | null;
  onLogin?: (() => void) | undefined;
  loginPending?: boolean;
  loginError?: boolean;
  /** 登入者權限與 Viewer 資料（含 Firestore displayName、pictureUrl、permissionSources）。 */
  routeAccess?: (RouteAccessContext & {
    displayName?: string | null;
    pictureUrl?: string | null;
    permissionSources?: {
      customRoles?: readonly CustomRoleInput[];
    };
  }) | null;
  /** 選填：第二身份解析（照 A `getCurrentIdentity('chrome')`）。 */
  identity?: SideDrawerIdentity | null;
}

const SWIPE_MIN_DX = 12;

// 字級存取統一走 core/font-size（照 A sporthub_font_size 存 15／16.5／18 數字，開站腳本才讀得懂）。
function fontBtnClass(size: FontSize): string {
  if (size === 'medium') return 'drawer-font-btn font-m';
  if (size === 'large') return 'drawer-font-btn font-l';
  return 'drawer-font-btn';
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

/** 照 A `confirmClearCache` 清除快取與登出並重載。 */
async function executeClearCache(): Promise<void> {
  try {
    try {
      const auth = await import('@/data/auth');
      if (typeof auth.signOut === 'function') await auth.signOut();
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((n) => caches.delete(n)));
      } catch {
        /* ignore */
      }
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      } catch {
        /* ignore */
      }
    }
    try {
      const lsKeys = Object.keys(localStorage);
      for (const k of lsKeys) {
        if (
          k.startsWith('shub_c_')
          || k.startsWith('shub_ts_')
          || k.startsWith('shub_cache_')
          || k.startsWith('LIFF')
          || k.startsWith('toosterx:auth')
        ) {
          localStorage.removeItem(k);
        }
      }
      localStorage.removeItem('sporthub_auto_exp_rules');
      localStorage.removeItem('sporthub_auto_exp_logs');
    } catch {
      /* ignore */
    }
    try {
      const idb = indexedDB as IDBFactory & {
        databases?: () => Promise<Array<{ name?: string }>>;
      };
      if (typeof idb?.databases === 'function') {
        const dbs = await idb.databases();
        dbs.forEach((db) => {
          if (db?.name) indexedDB.deleteDatabase(db.name);
        });
      }
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.removeItem('_lineLoginRetryCount');
    } catch {
      /* ignore */
    }
  } finally {
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      try {
        window.location.reload();
      } catch {
        /* ignore in test environment */
      }
    }
  }
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
  identity = null,
}: SideDrawerProps): preact.JSX.Element | null {
  const t = useT();
  const theme = useTheme();
  const location = useLocation();
  const path = location.path;
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const returnRef = useRef(returnFocusRef);
  onCloseRef.current = onClose;
  returnRef.current = returnFocusRef;

  const fontSize = useFontSize();
  const [locale, setLocaleState] = useState<Locale>(() => {
    const cur = getCurrentLocale();
    return cur === 'zh-CN' ? 'zh-TW' : cur;
  });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [stealth, setStealth] = useState<boolean>(() => readLocalAdminStealth());
  const [brokenUrls, setBrokenUrls] = useState<ReadonlySet<string>>(() => new Set());
  const [pwaStep, setPwaStep] = useState<PwaModalStep>('none');
  const [showApplyNotice, setShowApplyNotice] = useState(false);
  const [showClearCacheConfirm, setShowClearCacheConfirm] = useState(false);
  const [dragOffsetX, setDragOffsetX] = useState<number | null>(null);

  const loadingRef = useRef(false);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);
  const previousPath = useRef(path);
  const touchStateRef = useRef<{ startX: number; startY: number; dragging: boolean; lastDx: number } | null>(null);

  useEffect(() => {
    initPwaInstallListener();
  }, []);

  useEffect(() => {
    if (!open) setDragOffsetX(null);
  }, [open]);

  useEffect(() => {
    const unsubscribe = on('locale:changed', ({ locale: next }) => {
      setLocaleState(next === 'zh-CN' ? 'zh-TW' : next);
    });
    const cur = getCurrentLocale();
    setLocaleState(cur === 'zh-CN' ? 'zh-TW' : cur);
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

  // 同步管理員隱身狀態
  const signedInUid = user?.uid || routeAccess?.uid || null;
  const effectiveRoleKey = routeAccess?.role && routeAccess.role !== 'guest'
    ? routeAccess.role
    : 'user';
  const isAdminOrSuper = Boolean(signedInUid) && (effectiveRoleKey === 'admin' || effectiveRoleKey === 'super_admin');

  useEffect(() => {
    if (!signedInUid || !isAdminOrSuper) {
      setStealth(readLocalAdminStealth());
      return;
    }
    let alive = true;
    syncAdminStealthFromUser(signedInUid)
      .then((val) => {
        if (alive) setStealth(val);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [signedInUid, isAdminOrSuper]);

  // 當使用者登入或換帳號時清空壞圖記錄（照 A `App._forgetBrokenAvatarUrl`）
  useEffect(() => {
    setBrokenUrls(new Set());
  }, [signedInUid, routeAccess?.pictureUrl, user?.pictureUrl]);

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

  const customRoles = routeAccess?.permissionSources?.customRoles ?? null;
  const renderNodes = useMemo(
    () => buildDrawerRenderNodes(routeAccess, undefined, customRoles),
    [routeAccess, customRoles],
  );

  const handleCycleFontSize = (): void => {
    setFontSize(nextFontSize(getFontSize()));
  };

  const handleToggleTheme = (): void => {
    const dark = isEffectiveDark(theme);
    setTheme(dark ? 'light' : 'dark');
  };

  const handleRoleTagClick = (): void => {
    if (!isAdminOrSuper) return;
    const next = toggleAdminStealth(signedInUid, stealth);
    setStealth(next);
    toast.show({ message: next ? '已開啟隱身模式' : '已關閉隱身模式' });
  };

  const handlePwaClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const deferred = getDeferredInstallPrompt();
    if (deferred) {
      deferred.prompt().catch(() => undefined);
      deferred.userChoice.catch(() => undefined);
      return;
    }
    if (isStandalonePwa()) {
      toast.show({ message: '你已在使用 APP 版' });
    }
    setPwaStep('picker');
  };

  const handleMenuItemClick = (entry: DrawerMenuEntry): void => {
    // M-039：A 本身就鎖定／停用的項目用 LOCKED_FEATURE_MSG（「功能尚未開放」）
    if (entry.locked || entry.action === 'coming-soon') {
      toast.show({ message: LOCKED_FEATURE_MSG });
      onCloseRef.current();
      return;
    }
    if (entry.action === 'manual') {
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open('/manual.html', '_blank', 'noopener,noreferrer');
      }
      onCloseRef.current();
      return;
    }
    if (entry.action === 'share') {
      const shareUrl = getMiniAppShareUrl();
      copyTextToClipboard(shareUrl)
        .then((ok) => {
          toast.show({ message: ok ? '已複製分享連結！' : '複製失敗，請手動複製' });
        })
        .catch(() => {
          toast.show({ message: '複製失敗，請手動複製' });
        });
      onCloseRef.current();
      return;
    }
    if (entry.action === 'apply-role') {
      onCloseRef.current();
      setShowApplyNotice(true);
      return;
    }

    // M-034：與底部分頁共用 AUTH_REQUIRED_PAGES 守門（個人資料、我的信箱）
    const targetKey = entry.page || entry.routePath || '';
    if (isAuthRequiredRoute(targetKey)) {
      const hasAuth = Boolean(signedInUid) || (getLastKnownAuthUid() !== null && !onLogin);
      if (!hasAuth) {
        onCloseRef.current();
        if (loginPending) {
          toast.show({ message: LOGIN_PENDING_MSG });
          return;
        }
        if (onLogin) {
          onLogin();
        } else {
          emit('auth:login-request', {});
        }
        return;
      }
    }

    if (entry.routePath) {
      location.route(entry.routePath);
      onCloseRef.current();
      return;
    }
    toast.show({ message: UNAVAILABLE_FEATURE_MSG });
    onCloseRef.current();
  };

  const handleConfirmApplyRole = (): void => {
    setShowApplyNotice(false);
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open('https://toosterx.com/roles', '_blank', 'noopener,noreferrer');
    }
    onCloseRef.current();
  };

  const handleLocale = async (event: Event): Promise<void> => {
    const select = event.currentTarget as HTMLSelectElement;
    const value = select.value;
    if (loadingRef.current || !(DRAWER_LOCALES as readonly string[]).includes(value)) return;
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
      const fallback = getCurrentLocale();
      select.value = fallback === 'zh-CN' ? 'zh-TW' : fallback;
      setLoadError(true);
      errorTimer.current = setTimeout(() => {
        setLoadError(false);
        errorTimer.current = null;
      }, 3000);
    } finally {
      if (sequence === request.current) {
        loadingRef.current = false;
        const cur = getCurrentLocale();
        setLocaleState(cur === 'zh-CN' ? 'zh-TW' : cur);
        setLoading(false);
      }
    }
  };

  // U-001：左滑關閉手勢
  const handleTouchStart = (e: TouchEvent): void => {
    if (!open || e.touches.length !== 1) return;
    const touch = e.touches[0]!;
    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      dragging: false,
      lastDx: 0,
    };
  };

  const handleTouchMove = (e: TouchEvent): void => {
    const st = touchStateRef.current;
    if (!st || !open || e.touches.length !== 1) return;
    const touch = e.touches[0]!;
    const dx = touch.clientX - st.startX;
    const dy = touch.clientY - st.startY;

    if (!st.dragging) {
      if (Math.abs(dx) < SWIPE_MIN_DX) return;
      if (Math.abs(dy) > Math.abs(dx) || dx >= 0) {
        touchStateRef.current = null;
        return;
      }
      st.dragging = true;
    }

    const clamped = Math.min(0, dx);
    st.lastDx = clamped;
    setDragOffsetX(clamped);
  };

  const handleTouchEnd = (): void => {
    const st = touchStateRef.current;
    touchStateRef.current = null;
    if (!st || !st.dragging) return;
    const width = panelRef.current?.offsetWidth || 280;
    const shouldClose = Math.abs(st.lastDx) > width / 3;
    setDragOffsetX(null);
    if (shouldClose) {
      onCloseRef.current();
    }
  };

  if (typeof document === 'undefined') return null;

  const isDark = isEffectiveDark(theme);
  const isSignedIn = Boolean(user || routeAccess?.uid);

  // M-009 & M-010：抽屜頭部名字與頭像來源（優先 identity → Firestore viewer → AuthUser）
  const isSecondaryIdentity = identity?.identityId === 'secondary';
  const resolvedName = isSignedIn
    ? (identity?.displayName || routeAccess?.displayName || user?.displayName || '同步中...')
    : (loginPending ? '登入確認中...' : '未登入');

  const candidateUrls: string[] = [];
  if (isSignedIn) {
    if (Array.isArray(identity?.avatarCandidates)) {
      for (const u of identity.avatarCandidates) {
        if (typeof u === 'string' && u.trim() && !candidateUrls.includes(u.trim())) {
          candidateUrls.push(u.trim());
        }
      }
    }
    if (!isSecondaryIdentity) {
      for (const u of [routeAccess?.pictureUrl, user?.pictureUrl]) {
        if (typeof u === 'string' && u.trim() && !candidateUrls.includes(u.trim())) {
          candidateUrls.push(u.trim());
        }
      }
    }
  }
  const activeAvatarUrl = candidateUrls.find((u) => !brokenUrls.has(u)) ?? null;
  const avatarInitial = isSignedIn
    ? ((resolvedName.trim()[0] ?? '?').toUpperCase())
    : '?';

  // M-014 & M-015 & M-016：角色標籤文字、顏色與隱身切換
  const roleInfo = resolveDrawerRoleInfo(effectiveRoleKey, isSignedIn, customRoles, loginPending);
  const roleTagStyle: Record<string, string> = {
    background: `${roleInfo.color}22`,
    color: roleInfo.color,
  };
  if (isAdminOrSuper) {
    roleTagStyle.cursor = 'pointer';
    roleTagStyle.opacity = stealth ? '.45' : '1';
  }

  const drawerStyle: Record<string, string> | undefined = dragOffsetX !== null
    ? { transform: `translateX(${dragOffsetX}px)`, transition: 'none' }
    : undefined;

  return createPortal(
    <div class="legacy-ui legacy-chrome">
      <div
        id="drawer-overlay"
        class={open ? 'open' : ''}
        onClick={() => {
          if (open) onCloseRef.current();
        }}
      />
      <nav
        id="side-drawer"
        ref={panelRef}
        class={open ? 'open' : ''}
        style={drawerStyle}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? 'true' : undefined}
        aria-hidden={open ? undefined : 'true'}
        aria-label={t('ui.sideDrawer.label')}
        tabIndex={-1}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div class="drawer-header">
          <div class="drawer-user">
            {activeAvatarUrl ? (
              <div
                class={`drawer-avatar drawer-avatar-img${isSecondaryIdentity ? ' avatar-identity-crown' : ''}`}
                id="drawer-avatar"
                data-identity-crown={isSecondaryIdentity ? '1' : undefined}
              >
                <img
                  src={activeAvatarUrl}
                  alt={resolvedName}
                  onError={() => {
                    setBrokenUrls((prev) => {
                      const next = new Set(prev);
                      next.add(activeAvatarUrl);
                      return next;
                    });
                  }}
                />
              </div>
            ) : (
              <div
                class={`drawer-avatar${isSecondaryIdentity ? ' avatar-identity-crown' : ''}`}
                id="drawer-avatar"
                data-identity-crown={isSecondaryIdentity ? '1' : undefined}
                style={isSignedIn
                  ? undefined
                  : { color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}
              >
                {isSignedIn ? avatarInitial : <GuestAvatarIcon />}
              </div>
            )}
            <div class="drawer-user-info">
              <div class="drawer-name" id="drawer-name">{resolvedName}</div>
              <div
                class="drawer-role-tag"
                id="drawer-role-tag"
                style={roleTagStyle}
                title={isAdminOrSuper && stealth ? '隱身模式（點擊恢復）' : undefined}
                onClick={isAdminOrSuper ? handleRoleTagClick : undefined}
              >
                {roleInfo.label}
              </div>
            </div>
            <div class="drawer-actions">
              <button
                class={fontBtnClass(fontSize)}
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
                  data-i18n-title="下載APP"
                  onClick={handlePwaClick}
                >
                  <span data-i18n="下載APP">{lt('下載APP', '下載APP')}</span>
                </button>
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
          {renderNodes.map((node) => {
            if (node.kind === 'divider') {
              return <div key={node.key} class="drawer-divider" />;
            }
            if (node.kind === 'section') {
              const sectionText = node.i18nKey ? lt(node.i18nKey, node.label) : node.label;
              return (
                <div key={node.key} class="drawer-section-label">
                  {sectionText}
                </div>
              );
            }
            const { entry, bgClass, locked } = node;
            const displayLabel = node.i18nKey ? lt(node.i18nKey, node.label) : node.label;
            const isActive = Boolean(!locked && entry.routePath && path === entry.routePath);
            const itemClass = `drawer-item${bgClass ? ` ${bgClass}` : ''}${isActive ? ' active' : ''}`;
            const lockedStyle = locked
              ? { opacity: '.55', display: 'flex', alignItems: 'center' }
              : undefined;

            return (
              <div
                key={node.key}
                class={itemClass}
                style={lockedStyle}
                data-page={entry.page}
                data-action={entry.action}
                aria-current={isActive ? 'page' : undefined}
                onPointerDown={() => {
                  if (!locked && entry.routePath) prefetchRouteByPath(entry.routePath);
                }}
                onClick={() => handleMenuItemClick(entry)}
              >
                {displayLabel}
                {locked && (
                  <span style={{ marginLeft: 'auto', fontSize: '.7rem', opacity: '.5' }}>🔒</span>
                )}
              </div>
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
                {DRAWER_LOCALES.map((language) => (
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
              onClick={() => setShowClearCacheConfirm(true)}
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

      {/* M-005：申請（俱樂部/場主/教練）說明彈窗（照 A `_showRoleApplicationNotice`） */}
      {showApplyNotice && (
        <div
          id="role-application-notice-overlay"
          class="role-application-notice-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowApplyNotice(false);
          }}
        >
          <div
            class="role-application-notice-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-application-notice-title"
          >
            <div class="role-application-notice-kicker">已全面開放</div>
            <div class="role-application-notice-title" id="role-application-notice-title">
              一般用戶都可以自由開團
            </div>
            <div class="role-application-notice-hero">
              <strong>不用申請身分</strong>
              <span>現在就能建立活動、自由開團、自由使用。</span>
            </div>
            <div class="role-application-notice-body">
              <p>
                <b>想開一般活動？</b>
                直接使用即可，不需要先申請俱樂部、場主或教練身分。
              </p>
              <p>
                <b>需要進階功能？</b>
                如果還需要創立賽事或建立俱樂部，請再前往聯繫申請。
              </p>
            </div>
            <button
              type="button"
              class="role-application-notice-confirm"
              onClick={handleConfirmApplyRole}
            >
              了解，前往聯繫
            </button>
          </div>
        </div>
      )}

      {/* M-011：清除快取紅字 Warning 確認框（照 A `confirmClearCache`） */}
      {showClearCacheConfirm && (
        <div
          id="app-confirm-modal"
          class="app-confirm-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowClearCacheConfirm(false);
          }}
        >
          <div class="app-confirm-box" role="alertdialog" aria-modal="true" aria-describedby="app-confirm-msg">
            <div class="app-confirm-msg" id="app-confirm-msg">
              <div class="app-confirm-warning">⚠ Warning</div>
              確定要清除所有快取並重新登入嗎？
              <br />
              這會回到最乾淨的狀態，或許可解決白屏或異常問題，但若您的網路狀態與手機性能不佳時可能會讓問題更嚴重。
              <br />
              建議您先使用關閉分頁並重新登入的方式試試看。
            </div>
            <div class="app-confirm-btns">
              <button
                type="button"
                class="app-confirm-cancel"
                id="app-confirm-cancel"
                onClick={() => setShowClearCacheConfirm(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                class="app-confirm-ok"
                id="app-confirm-ok"
                onClick={() => {
                  setShowClearCacheConfirm(false);
                  executeClearCache().catch(() => undefined);
                }}
              >
                {t('common.ok')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* M-030 / M-031：PWA 系統選擇與教學彈窗 */}
      <PwaModals step={pwaStep} onChangeStep={setPwaStep} />
    </div>,
    document.body,
  );
}
