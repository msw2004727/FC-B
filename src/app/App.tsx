import '@/ui/app-shell.css';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { Component, Fragment } from 'preact';
import type { ComponentChildren, ComponentType } from 'preact';
import { Suspense, lazy as lazyComponent } from 'preact/compat';
import { LocationProvider, Router, Route, lazy, useLocation } from 'preact-iso';
import { TopBar } from '@/ui/TopBar';
import { QaBanner } from '@/features/qa-login/components/QaBanner';
import { BottomNav } from '@/ui/BottomNav';
import { SideDrawer } from '@/ui/SideDrawer';
import { Text } from '@/ui/Text';
import { ErrorFallback } from '@/ui/ErrorFallback';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import { toast } from '@/ui/Toast';
import { useT } from '@/i18n/i18n';
import { getActiveRoutes, useRegistryVersion } from '@/core/feature-registry';
import { on } from '@/core/events';
import { initFontSize } from '@/core/font-size';
import { initBackGuard, markHistoryRoot, normalizeRoutePath } from '@/core/back-guard';
import {
  isScrollRestoreListPath,
  markListScrollForRestore,
  resetPageScrollToTop,
  saveListScrollPosition,
  scheduleAutoListScrollRestore,
} from '@/core/scroll-restore';
import {
  beginRouteLoading,
  endRouteLoading,
  getRouteFailureToast,
  ROUTE_STEP_TIMEOUT,
  ROUTE_TIMEOUT_MS,
} from '@/core/route-loading';
import { initMultiTabGuard } from '@/core/multi-tab-guard';
import {
  markContentReady,
  setContentStallRetryHandler,
  startContentStallCheck,
} from '@/core/content-stall';
import { installOfflineWriteGuard } from '@/core/sync-status';
import { scheduleIdleRoutePrefetch } from '@/core/route-prefetch';
import { RESTRICTED_ACCOUNT_MSG } from '@/core/unavailable';
import type { FeatureRoute, RouteAccessContext } from '@/core/feature-types';
import {
  acknowledgeMobileLoginHint,
  isLoginRedirectingError,
  type AuthUser,
} from '@/data/auth';
import { readAuthHint } from '@/data/auth-hint';
import { resolveShareLink } from './share-link';
import { firebaseTargetLabel } from '@/data/firebase';
import { isInternalTestMode } from '@/data/internal-test';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { getEffectiveIdentity } from '@/data/identity-resolver';
import {
  startIdentitySettings,
  stopIdentitySettings,
  useIdentitySettings,
} from '@/data/identity-settings';
import { LazyUidQrModal } from './LazyUidQrModal';
import { SyncStatusBar } from './SyncStatusBar';
import { MobileLineLoginHintModal } from './MobileLineLoginHintModal';

// M-139：全站私訊即時泡泡與浮層外框一律 lazy 載入，避免首屏帶入 firestore。
const LazyPmBubbleHost = lazyComponent(() =>
  import('@/features/inbox/components/PmBubbleHost').then((m) => ({ default: m.PmBubbleHost })),
);
const LazyPmDialogHost = lazyComponent(() =>
  import('@/features/inbox/components/PmDialogHost').then((m) => ({ default: m.PmDialogHost })),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lazyCache = new Map<FeatureRoute['load'], ComponentType<any>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteComponent(load: FeatureRoute['load'], routePath = ''): ComponentType<any> {
  const cached = lazyCache.get(load);
  if (cached) return cached;
  // M-047：載入超過 10 秒照 A 提示「網路較慢…」，但不中斷下載（晚到仍會顯示，不把頁面卡在失敗）；
  // L-08：失敗時從快取移除以便重試。
  const wrappedLoad = (): ReturnType<FeatureRoute['load']> => {
    const timer = setTimeout(() => {
      toast.show({ message: getRouteFailureToast(routePath, { code: ROUTE_STEP_TIMEOUT }) });
    }, ROUTE_TIMEOUT_MS);
    const p = Promise.resolve().then(() => load());
    p.then(
      () => clearTimeout(timer),
      () => {
        clearTimeout(timer);
        lazyCache.delete(load);
      },
    );
    return p;
  };
  const component = lazy(wrappedLoad);
  lazyCache.set(load, component);
  return component;
}

/** 取第一個「去空白後不為空」的字串；都沒有回 null（空字串、全空白、null、undefined 都算沒有資料）。 */
function firstNonBlank(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

export interface AppProps {
  onLogin?: () => void | Promise<void>;
  loginPending?: boolean;
}

export function App({
  onLogin,
  loginPending: externalPending = false,
}: AppProps = {}): preact.JSX.Element {
  const t = useT();
  const registryVersion = useRegistryVersion();
  const routes = useMemo<FeatureRoute[]>(() => getActiveRoutes(), [registryVersion]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  // 登入狀態確認前，上次已登入的人先顯示頭像位置（與 index.html 骨架一致），確認後才換成真頭像或登入按鈕。
  const [authKnown, setAuthKnown] = useState(false);
  const expectSignedIn = useMemo(() => readAuthHint(), []);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [mobileHintOpen, setMobileHintOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const pendingRef = useRef(false);
  const authRevision = useRef(0);
  const loginSequence = useRef(0);
  const currentUid = useRef<string | null>(null);
  // 內測模式只剩角落浮水印（2026-10-20 站長取消白名單閘門與寫入守門）。
  const internalTest = useMemo(() => isInternalTestMode(), []);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    initFontSize();
    const stopMultiTab = initMultiTabGuard();
    const stopOfflineGuard = installOfflineWriteGuard();
    const stopIdlePrefetch = scheduleIdleRoutePrefetch();

    mounted.current = true;
    let cancelled = false;
    let stopAuth: (() => void) | undefined;

    const stopEvents = on('auth:changed', ({ uid }) => {
      const revision = ++authRevision.current;
      currentUid.current = uid;
      setAuthKnown(true);
      setLoginError(false);
      setUser((previous) => uid === null ? null :
        previous?.uid === uid ? previous :
          { uid, displayName: null, pictureUrl: null });

      if (uid === null) return;
      import('@/data/auth')
        .then((auth) => auth.getCurrentUser())
        .then((next) => {
          if (!cancelled && revision === authRevision.current && next?.uid === uid) {
            setUser((previous) => ({
              uid,
              displayName: next.displayName ?? previous?.displayName ?? null,
              pictureUrl: next.pictureUrl ?? previous?.pictureUrl ?? null,
            }));
          }
        })
        .catch(() => {
          if (!cancelled && revision === authRevision.current) {
            setLoginError(true);
          }
        });
    });

    const stopMobileHint = on('auth:mobile-login-hint', () => {
      if (!cancelled) setMobileHintOpen(true);
    });

    import('@/data/auth').then((auth) => {
      if (cancelled) return;
      stopAuth = auth.onAuthChanged(() => {
        // onAuthChanged 內部發出 auth:changed。
      });
    }).catch(() => {
      if (!cancelled) {
        setAuthKnown(true);
        setLoginError(true);
      }
    });

    return () => {
      cancelled = true;
      mounted.current = false;
      authRevision.current += 1;
      loginSequence.current += 1;
      stopEvents();
      stopMobileHint();
      stopAuth?.();
      stopMultiTab();
      stopOfflineGuard();
      stopIdlePrefetch();
    };
  }, []);

  const handleLogin = useCallback((): void => {
    if (pendingRef.current || externalPending || currentUid.current !== null) return;
    pendingRef.current = true;
    const sequence = ++loginSequence.current;
    const revision = authRevision.current;
    setLoginPending(true);
    setLoginError(false);

    (async () => {
      try {
        if (onLogin) {
          await onLogin();
        } else {
          const auth = await import('@/data/auth');
          if (!mounted.current || sequence !== loginSequence.current) return;
          const next = await auth.signIn();
          if (!mounted.current || sequence !== loginSequence.current) return;

          if (authRevision.current === revision || currentUid.current === next.uid) {
            currentUid.current = next.uid;
            setUser(next);
          }
        }
      } catch (err) {
        // M-036：觸發 liff.login 重導向或手機外部瀏覽器說明框時不顯示「無法完成 LINE 登入」錯誤
        if (isLoginRedirectingError(err)) {
          return;
        }
        if (mounted.current && sequence === loginSequence.current &&
          currentUid.current === null) {
          setLoginError(true);
        }
      } finally {
        if (sequence === loginSequence.current) {
          pendingRef.current = false;
          if (mounted.current) setLoginPending(false);
        }
      }
    })().catch(() => {
      if (mounted.current) setLoginError(true);
    });
  }, [externalPending, onLogin]);

  // M-036：手機外部瀏覽器登入提示框（回呼要穩定，彈窗的返回鍵登記才不會每次重繪重來）。
  const closeMobileHint = useCallback(() => setMobileHintOpen(false), []);
  const confirmMobileHint = useCallback(() => {
    setMobileHintOpen(false);
    acknowledgeMobileLoginHint();
    handleLogin();
  }, [handleLogin]);

  // M-034、M-035：監聽全域登入請求事件（如個人頁未登入 LINE 登入按鈕、底部分頁未登入守門）
  useEffect(() => {
    return on('auth:login-request', () => {
      handleLogin();
    });
  }, [handleLogin]);

  const [routeAccess, setRouteAccess] = useState<(RouteAccessContext & Partial<ViewerView>) | null>(null);
  const pending = loginPending || externalPending;
  const isRestricted = routeAccess?.isRestricted === true;

  // 照 A `renderLoginUI`：以 `getCurrentIdentity('chrome')` 解析右上角／抽屜顯示身份。
  const identitySettings = useIdentitySettings();
  const chromeUid = routeAccess?.uid ?? null;
  const chromeIdentity = chromeUid
    ? getEffectiveIdentity(
      {
        uid: chromeUid,
        displayName: routeAccess?.displayName ?? user?.displayName ?? null,
        pictureUrl: routeAccess?.pictureUrl ?? user?.pictureUrl ?? null,
      },
      {
        settings: identitySettings,
        surface: 'chrome',
        allowSecondaryIdentity:
          routeAccess?.hasPermission?.('profile.secondary_identity') === true,
      },
    )
    : null;
  // 照 A `renderLoginUI`：第二身份時 TopBar 只用第二身份的頭像候選，不退回 LINE 頭像。
  // 主身份與抽屜用同一份資料（Firestore 使用者資料優先、Auth 備援）：LINE 使用者的 Auth 帳號
  // 沒有名稱與頭像（functions ensureAuthUser 只給 uid），只看 Auth 會永遠顯示「?」。
  // 兩邊都沒名稱時不退回 uid／「用戶」，維持 TopBar 的「?」。
  const viewerForUser = user && routeAccess?.uid === user.uid ? routeAccess : null;
  const topBarUser = !user
    ? null
    : chromeIdentity?.identityId === 'secondary'
      ? {
        ...user,
        displayName: chromeIdentity.displayName,
        pictureUrl: chromeIdentity.avatarCandidates[0] ?? null,
      }
      : {
        ...user,
        displayName: firstNonBlank(viewerForUser?.displayName, user.displayName),
        pictureUrl: firstNonBlank(viewerForUser?.pictureUrl, user.pictureUrl),
      };

  return (
    <LocationProvider>
      <div ref={shellRef} class="app-shell ui-app-shell">
        <QaBanner uid={routeAccess?.uid ?? null} />
        <TopBar
          menuRef={menuRef}
          drawerOpen={drawerOpen}
          onMenuClick={openDrawer}
          onLogin={handleLogin}
          loginPending={pending}
          user={topBarUser}
          crown={chromeIdentity?.identityId === 'secondary'}
          authPending={!authKnown && expectSignedIn}
          isSyncing={user !== null && viewerForUser === null}
        />
        <SyncStatusBar />
        <main class="app-main">
          {loginError && !drawerOpen && (
            <div role="alert"><Text>{t('ui.shell.loginError')}</Text></div>
          )}
          <RouteArea routes={routes} isRestricted={isRestricted} />
        </main>
        <BottomNav
          user={user}
          onLogin={handleLogin}
          loginPending={pending}
          isRestricted={isRestricted}
        />
        {internalTest && (
          <div class="internal-test-badge" aria-hidden="true">
            {t('internalTest.badge', {
              sha: import.meta.env.VITE_BUILD_SHA || 'dev',
              // 顯示實際連線目標（專案 · emulator／prod），連錯資料庫能被看見（Fable 2026-10-19）
              target: firebaseTargetLabel(),
            })}
          </div>
        )}
      </div>
      <SideDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        returnFocusRef={menuRef}
        user={user}
        onLogin={handleLogin}
        loginPending={pending}
        loginError={loginError}
        routeAccess={routeAccess}
        identity={chromeIdentity
          ? {
            identityId: chromeIdentity.identityId,
            displayName: chromeIdentity.displayName,
            avatarCandidates: chromeIdentity.avatarCandidates,
          }
          : null}
      />
      <ViewerAccessBridge onChange={setRouteAccess} />
      <IdentitySettingsBridge uid={chromeUid} />
      <Suspense fallback={null}>
        {chromeUid !== null && <LazyPmBubbleHost uid={chromeUid} />}
      </Suspense>
      <Suspense fallback={null}>
        {/* 私訊只在登入後可用；未登入不載入浮層外框。 */}
        {chromeUid !== null && <LazyPmDialogHost />}
      </Suspense>
      <LazyUidQrModal user={user} onLogin={handleLogin} loginPending={pending} />
      <MobileLineLoginHintModal
        open={mobileHintOpen}
        onCancel={closeMobileHint}
        onConfirm={confirmMobileHint}
      />
      <ToastHost />
      <AppConfirmHost />
    </LocationProvider>
  );
}

/**
 * 只在通過內測閘門後掛載：讀登入者權限交給側邊選單篩選入口。
 * 放成獨立元件，是為了讓閘門前完全不觸發 viewer 的 Firestore 讀取。
 */
function ViewerAccessBridge({ onChange }: { onChange: (access: ViewerView) => void }): null {
  const viewer = useViewer();
  useEffect(() => {
    onChange(viewer);
  }, [viewer, onChange]);
  return null;
}

/**
 * 照 A `_setupIdentityPrivateListener`／`_stopIdentityPrivateListener`：
 * routeAccess 提供 uid 後才啟動監聽（避免閘門前讀 Firestore）；
 * uid 變空或元件卸載時停止並清成 null。
 */
function IdentitySettingsBridge({ uid }: { uid: string | null }): null {
  useEffect(() => {
    if (!uid) {
      stopIdentitySettings();
      return undefined;
    }
    startIdentitySettings(uid);
    return () => {
      stopIdentitySettings();
    };
  }, [uid]);
  return null;
}

function RouteArea({
  routes,
  isRestricted = false,
}: {
  routes: FeatureRoute[];
  isRestricted?: boolean;
}): preact.JSX.Element {
  const location = useLocation();
  const redirect = resolveShareLink(location.url);
  const prevPathRef = useRef<string>(location.path || '/');
  const loadingSeqRef = useRef<number>(0);
  const [stallRetryKey, setStallRetryKey] = useState(0);

  useLayoutEffect(() => {
    if (redirect !== null) location.route(redirect, true);
  }, [redirect, location.route]);

  // M-045、M-046：標記返回起點；LINE／PWA 裝首頁返回保護哨兵（只在開站時一次）。
  useEffect(() => initBackGuard(), []);

  // M-038：帳號受限時若不在首頁，提示「帳號限制中」並導回首頁（照 A `_handleRestrictedStateChange`）
  useEffect(() => {
    if (!isRestricted) return;
    const clean = normalizeRoutePath(location.path || '/');
    if (clean !== '/') {
      toast.show({ message: RESTRICTED_ACCOUNT_MSG });
      location.route('/', true);
      markHistoryRoot();
    }
  }, [isRestricted, location]);

  // U-010：在列表頁記錄位置（捲動時，以及點擊當下——點卡片換頁前一定先記到），並於換頁時處理「列表返回保留捲動位置、其他頁回頂」
  useEffect(() => {
    const clean = normalizeRoutePath(location.path || '/');
    if (!isScrollRestoreListPath(clean)) return undefined;
    const save = (): void => saveListScrollPosition(clean);
    window.addEventListener('scroll', save, { passive: true });
    document.addEventListener('click', save, true);
    return () => {
      window.removeEventListener('scroll', save);
      document.removeEventListener('click', save, true);
    };
  }, [location.path]);

  useEffect(() => {
    const prevPath = prevPathRef.current;
    const nextPath = location.path || '/';

    if (prevPath !== nextPath) {
      // 列表位置由上面的捲動監聽隨時記錄；這裡不再讀 scrollY，新頁畫出後的值已不是離開前的位置。
      const shouldRestore = markListScrollForRestore(prevPath, nextPath);
      prevPathRef.current = nextPath;
      if (shouldRestore) {
        return scheduleAutoListScrollRestore(nextPath);
      }
      resetPageScrollToTop();
    }
    return undefined;
  }, [location.path]);

  // M-051、U-019：換頁載入程式卡住檢查——只在路由程式下載期間計時，載完即解除；點重試只重載當前路由程式。
  const stopStallRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    setContentStallRetryHandler(() => {
      lazyCache.clear();
      setStallRetryKey((k) => k + 1);
    });
    return () => {
      setContentStallRetryHandler(null);
      stopStallRef.current?.();
    };
  }, []);

  // 先處理分享入口，避免短暫掛載首頁並觸發首頁資料請求。
  if (redirect !== null) return <Fragment />;

  return (
    <RouteErrorBoundary
      key={stallRetryKey}
      path={location.path}
      previousPath={prevPathRef.current}
      onReset={() => lazyCache.clear()}
      onNavigateBack={(fallback) => {
        endRouteLoading(loadingSeqRef.current);
        location.route(fallback, true);
      }}
    >
      <Router
        onLoadStart={(url: string) => {
          loadingSeqRef.current = beginRouteLoading({ path: url });
          stopStallRef.current?.();
          stopStallRef.current = startContentStallCheck({ path: url });
        }}
        onLoadEnd={() => {
          endRouteLoading(loadingSeqRef.current);
          markContentReady();
        }}
      >
        {routes.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            component={getRouteComponent(route.load, route.path)}
          />
        ))}
        <Route default component={NotFound} />
      </Router>
    </RouteErrorBoundary>
  );
}

interface RouteErrorBoundaryProps {
  path: string;
  previousPath?: string;
  onReset: () => void;
  onNavigateBack?: (targetPath: string) => void;
  children: ComponentChildren;
}

interface RouteErrorBoundaryState {
  error: unknown;
  resetKey: number;
}

class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: unknown): Partial<RouteErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: unknown): void {
    console.error('[app] route error', error);
    // M-047 & M-048：換頁載入失敗時彈出 A 的 Toast（「頁面載入失敗，請稍後再試」或逾時訊息），
    // 若有上一個站內頁面則留在原頁並自動重設錯誤邊界。
    const msg = getRouteFailureToast(this.props.path, error);
    toast.show({ message: msg, tone: 'error' });
    const prev = this.props.previousPath;
    if (prev && prev !== this.props.path && this.props.onNavigateBack) {
      this.props.onReset();
      this.setState({ error: null, resetKey: this.state.resetKey + 1 });
      this.props.onNavigateBack(prev);
    }
  }

  componentDidUpdate(previous: RouteErrorBoundaryProps): void {
    if (this.state.error && previous.path !== this.props.path) this.reset();
  }

  private reset(): void {
    this.props.onReset();
    this.setState({ error: null, resetKey: this.state.resetKey + 1 });
  }

  private handleRetry = (): void => {
    this.reset();
  };

  render(): preact.JSX.Element {
    if (this.state.error) return <ErrorFallback onRetry={this.handleRetry} showHome />;
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}

function NotFound(): preact.JSX.Element {
  const t = useT();
  return (
    <section class="not-found">
      <Text as="h1">{t('notFound.title')}</Text>
      <Text as="p">{t('notFound.body')}</Text>
      <a href="/" style={{
        minWidth: '44px',
        minHeight: '44px',
        display: 'inline-flex',
        alignItems: 'center',
      }}>
        <Text>{t('nav.home')}</Text>
      </a>
    </section>
  );
}
