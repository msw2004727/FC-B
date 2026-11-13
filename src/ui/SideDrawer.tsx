import './drawer-extra.css';
import './drawer-foot.css';
import '@/styles/legacy/version-tag.css';
import type { RefObject } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { getCurrentLocale, lt, setLocale, useT } from '@/i18n/i18n';
import { DRAWER_LOCALES, LOCALE_LABELS, LOCALE_SHORT_LABELS, type Locale } from '@/i18n/locales';
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
import { pushOverlay } from '@/core/overlay-back';
import { openStaticPage, shouldLeaveAnchorClick } from '@/core/open-external';
import { prefetchRouteByPath } from '@/core/route-prefetch';
import {
  LOCKED_FEATURE_MSG,
  LOGIN_PENDING_MSG,
  UNAVAILABLE_FEATURE_MSG,
} from '@/core/unavailable';
import { readAppVersion } from '@/core/app-meta';
import { isInternalTestMode } from '@/data/internal-test';
import type { AuthUser } from '@/data/auth';
import { clearAccountLocalState, getLastKnownAuthUid } from '@/data/auth';
import { markAutoLoginSuppressed } from '@/data/login-redirect';
import { toast } from '@/ui/Toast';
import {
  BASE_ROLES,
  BUILTIN_ROLE_KEYS,
  buildDrawerRenderNodes,
  drawerItemStatus,
  getMiniAppShareUrl,
  resolveDrawerRoleInfo,
  type CustomRoleInput,
  type DrawerItemStatus,
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
import { IdentityCrownSvg } from './IdentityCrown';
import { CaretIcon, GlobeIcon, ResetIcon, ThemeIcon } from './drawer-foot-icons';

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
  /** 'expired'＝LINE 權杖已失效（B1-02），顯示專屬文案。 */
  loginError?: boolean | 'expired';
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

const THEME_CHOICES: readonly ThemeMode[] = ['light', 'dark', 'system'];

// 字級存取統一走 core/font-size（照 A sporthub_font_size 存 15／16.5／18 數字，開站腳本才讀得懂）。
function fontBtnClass(size: FontSize): string {
  if (size === 'medium') return 'drawer-font-btn font-m';
  if (size === 'large') return 'drawer-font-btn font-l';
  return 'drawer-font-btn';
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
  // 登出段走 signOutForCacheClear：signOut 之前就擋這一頁的自動登入、刪 LIFF* 之前先登出 LINE（最多 8 秒）、
  // 寫剛登出旗標。Firebase 登出失敗（已提示）就停：不刪 LIFF*、不重整（Grok 第三輪 P2）。
  // 登入模組載入失敗則照舊繼續清快取（與原本行為相同）。
  let proceed = true;
  try {
    const auth = await import('@/data/auth');
    if (typeof auth.signOutForCacheClear === 'function') proceed = await auth.signOutForCacheClear();
    else markAutoLoginSuppressed('logout');
  } catch {
    markAutoLoginSuppressed('logout');
  }
  if (!proceed) return;
  try {
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
    // B1-05：帳號相關 localStorage 與 sessionStorage `_lineLoginRetryCount` 改用登出共用的同一份清單，
    // 取代原本這裡自己列的前綴（漏了活動列表快照等，兩份清單會漂移）；儲存空間不可用時內部靜默略過。
    clearAccountLocalState();
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

// 內測站專用的功能進度圖示：打勾＝已完成、打叉＝沒開放、驚嘆號＝未完成（站長 2026-11-02）。
function DrawerStatusIcon({ status }: { status: DrawerItemStatus }): preact.JSX.Element {
  return (
    <svg
      class={`drawer-status drawer-status-${status}`}
      data-status={status}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      {status === 'done' && <path d="M4.6 8.3l2.2 2.2 4.6-4.7" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />}
      {status === 'closed' && <path d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />}
      {status === 'wip' && <path d="M8 4.4v4.2M8 11v.1" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" />}
    </svg>
  );
}

/**
 * 隱私／條款是靜態頁，沒有 SPA 路由。
 * preact-iso 的全域 click 不看 defaultPrevented，只 preventDefault 仍會被換成站內換頁，所以同時停掉冒泡。
 * 修飾鍵與非左鍵留給瀏覽器。
 */
function handleStaticLink(
  event: {
    preventDefault: () => void;
    stopPropagation: () => void;
    defaultPrevented?: boolean;
    button?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  },
  path: string,
): void {
  if (shouldLeaveAnchorClick(event)) return;
  event.preventDefault();
  event.stopPropagation();
  openStaticPage(path);
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
  const internalTest = useMemo(() => isInternalTestMode(), []);
  const [showApplyNotice, setShowApplyNotice] = useState(false);
  const [showClearCacheConfirm, setShowClearCacheConfirm] = useState(false);
  /** 抽屜的 Esc 先看確認框：開著就交給確認框只關框（Grok 初審 P2）。 */
  const confirmOpenRef = useRef(false);
  confirmOpenRef.current = showClearCacheConfirm;
  const drawerOpenRef = useRef(open);
  drawerOpenRef.current = open;
  const resetBtnRef = useRef<HTMLButtonElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const confirmBoxRef = useRef<HTMLDivElement>(null);
  const themeBtnRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
    if (!open) {
      setDragOffsetX(null);
      // 抽屜因換頁等原因關掉時，確認框不留在畫面上
      setShowClearCacheConfirm(false);
    }
  }, [open]);

  // 重設確認框（比照 AppConfirm）：開框焦點放「取消」；Esc 與實體返回鍵同一路徑「只關框、不執行」；關框把焦點還給重設鈕。
  // Tab／Shift+Tab 只在框內兩顆按鈕間循環（aria-modal 不會自己擋 Tab，原本會跑到後面的抽屜）。
  useLayoutEffect(() => {
    if (!showClearCacheConfirm) return undefined;
    confirmCancelRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        const box = confirmBoxRef.current;
        const items = box ? [...box.querySelectorAll<HTMLElement>('button:not([disabled])')] : [];
        const first = items[0];
        const last = items[items.length - 1];
        if (!box || !first || !last) return;
        const active = document.activeElement;
        const inside = active instanceof Node && box.contains(active);
        if (event.shiftKey ? (!inside || active === first) : (!inside || active === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setShowClearCacheConfirm(false);
    };
    document.addEventListener('keydown', onKey, true);
    const releaseBack = pushOverlay(() => {
      setShowClearCacheConfirm(false);
      return true;
    });
    return () => {
      document.removeEventListener('keydown', onKey, true);
      releaseBack();
      // 抽屜已關（例如換頁）時焦點交給抽屜自己還給選單鈕，不搶回藏起來的重設鈕
      const btn = resetBtnRef.current;
      if (drawerOpenRef.current && btn?.isConnected) btn.focus({ preventScroll: true });
    };
  }, [showClearCacheConfirm]);

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
        // 確認框開著：交給確認框自己的 Esc（只關框），抽屜不動
        if (confirmOpenRef.current) return;
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
      // 靜態頁。preact-iso 的 location 沒有 assign。
      openStaticPage('/manual.html');
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
    openStaticPage('/roles/');
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

  // 主題三段（radiogroup）：方向鍵移動選取並切換主題，焦點跟著走；選中項才在 Tab 順序（roving tabindex，Grok 初審 P3）。
  const handleThemeKeyDown = (event: KeyboardEvent): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const current = Math.max(0, THEME_CHOICES.indexOf(theme));
    const next = (current + step + THEME_CHOICES.length) % THEME_CHOICES.length;
    setTheme(THEME_CHOICES[next]!);
    themeBtnRefs.current[next]?.focus();
  };

  if (typeof document === 'undefined') return null;

  const isSignedIn = Boolean(user || routeAccess?.uid);

  // M-009 & M-010：抽屜頭部名字與頭像來源（優先 identity → Firestore viewer → AuthUser）
  const isSecondaryIdentity = identity?.identityId === 'secondary';
  const resolvedName = isSignedIn
    ? (identity?.displayName || routeAccess?.displayName || user?.displayName || t('ui.sideDrawer.syncing'))
    : t(loginPending ? 'ui.sideDrawer.loginChecking' : 'ui.sideDrawer.guestName');

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
  // 內建角色與未登入／確認中走七語系（B4-01）；自訂角色名稱是後台資料，照原樣顯示。
  const roleI18nKey = !isSignedIn
    ? (loginPending ? 'pending' : 'guest')
    : BUILTIN_ROLE_KEYS.find((key) => BASE_ROLES[key] === roleInfo);
  const roleLabel = roleI18nKey ? t(`ui.sideDrawer.role.${roleI18nKey}`) : roleInfo.label;
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
                class={`drawer-avatar drawer-avatar-img${isSecondaryIdentity ? ' has-identity-crown' : ''}`}
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
                {isSecondaryIdentity && <IdentityCrownSvg />}
              </div>
            ) : (
              <div
                class={`drawer-avatar${isSecondaryIdentity ? ' has-identity-crown' : ''}`}
                id="drawer-avatar"
                data-identity-crown={isSecondaryIdentity ? '1' : undefined}
                style={isSignedIn
                  ? undefined
                  : { color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}
              >
                {isSignedIn ? avatarInitial : <GuestAvatarIcon />}
                {isSecondaryIdentity && <IdentityCrownSvg />}
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
                {roleLabel}
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
                <div class="home-version-tag" id="home-version-tag">{`v${readAppVersion()}`}</div>
              </div>
            </div>
          </div>
          {loginError && (
            <div role="alert" style={{ marginTop: '.5rem', fontSize: '.78rem', color: 'var(--danger)' }}>
              {t(loginError === 'expired' ? 'ui.shell.loginExpired' : 'ui.shell.loginError')}
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
                {internalTest && <DrawerStatusIcon status={drawerItemStatus(entry)} />}
                {locked && (
                  <span style={{ marginLeft: 'auto', fontSize: '.7rem', opacity: '.5' }}>🔒</span>
                )}
              </div>
            );
          })}
        </div>

        {/* 站長 2026-11-13 選方案一「單片收納」：主題三段（圖示）與語言同一片玻璃；下兩行小字：聲明、重設。
            取代 A 的深色模式開關＋粉紅膠囊＋語言下拉＋清除快取鈕（泰、越文聲明膠囊會撐出抽屜、從畫面左緣露出）。 */}
        <div class="drawer-footer drawer-foot">
          <div class="drawer-foot-slab">
            <div
              class="drawer-theme-seg"
              role="radiogroup"
              aria-label={t('ui.sideDrawer.theme')}
              onKeyDown={handleThemeKeyDown}
            >
              {THEME_CHOICES.map((mode, index) => {
                const label = t(`ui.sideDrawer.theme_${mode}`);
                return (
                  <button
                    key={mode}
                    ref={(el) => { themeBtnRefs.current[index] = el; }}
                    type="button"
                    role="radio"
                    tabIndex={theme === mode ? 0 : -1}
                    class="drawer-theme-btn"
                    data-theme-choice={mode}
                    aria-checked={theme === mode ? 'true' : 'false'}
                    aria-label={label}
                    title={label}
                    onClick={() => setTheme(mode)}
                  >
                    <ThemeIcon mode={mode} />
                  </button>
                );
              })}
            </div>
            <label id="lang-switcher" class="drawer-lang" title={t('ui.sideDrawer.language')}>
              <GlobeIcon />
              <span class="drawer-lang-code">{LOCALE_SHORT_LABELS[locale]}</span>
              <CaretIcon />
              <select
                id="lang-select"
                aria-label={t('ui.sideDrawer.language')}
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
            </label>
          </div>
          <div class="drawer-foot-fine drawer-foot-legal">
            <a
              class="drawer-foot-link"
              href="/privacy"
              title={lt('隱私權政策', '隱私權政策')}
              onClick={(event) => handleStaticLink(event, '/privacy')}
            >
              {t('ui.sideDrawer.privacyShort')}
            </a>
            <span class="drawer-foot-dot" aria-hidden="true">·</span>
            <a
              class="drawer-foot-link"
              href="/terms"
              title={lt('服務條款', '服務條款')}
              onClick={(event) => handleStaticLink(event, '/terms')}
            >
              {t('ui.sideDrawer.termsShort')}
            </a>
          </div>
          <div class="drawer-foot-fine">
            <button
              type="button"
              class="drawer-reset-btn"
              ref={resetBtnRef}
              onClick={() => setShowClearCacheConfirm(true)}
            >
              <ResetIcon cls="drawer-reset-icon" />
              <span>{t('ui.sideDrawer.reset')}</span>
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

      {/* M-011：重設確認框（站長 2026-11-13：說清楚會登出、會重新載入；取代 A 的「⚠ Warning」長文）。執行邏輯照 A `confirmClearCache` 不變。 */}
      {showClearCacheConfirm && (
        <div
          id="app-confirm-modal"
          class="app-confirm-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowClearCacheConfirm(false);
          }}
        >
          <div
            ref={confirmBoxRef}
            class="app-confirm-box drawer-reset-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="drawer-reset-title"
            aria-describedby="app-confirm-msg"
          >
            <div class="drawer-reset-confirm-icon"><ResetIcon cls="drawer-reset-confirm-svg" /></div>
            <div class="drawer-reset-confirm-title" id="drawer-reset-title">{t('ui.sideDrawer.resetTitle')}</div>
            <div class="drawer-reset-confirm-msg" id="app-confirm-msg">{t('ui.sideDrawer.resetBody')}</div>
            <div class="app-confirm-btns">
              <button
                type="button"
                class="app-confirm-cancel"
                id="app-confirm-cancel"
                ref={confirmCancelRef}
                onClick={() => setShowClearCacheConfirm(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                class="app-confirm-ok drawer-reset-confirm-ok"
                id="app-confirm-ok"
                onClick={() => {
                  setShowClearCacheConfirm(false);
                  executeClearCache().catch(() => undefined);
                }}
              >
                {t('ui.sideDrawer.resetConfirm')}
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
