import '@/ui/app-shell.css';
import '@/styles/font-size.css';
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
import { LocationProvider, Router, Route, lazy, useLocation } from 'preact-iso';
import { TopBar } from '@/ui/TopBar';
import { BottomNav } from '@/ui/BottomNav';
import { SideDrawer } from '@/ui/SideDrawer';
import { Text } from '@/ui/Text';
import { ErrorFallback } from '@/ui/ErrorFallback';
import { ToastHost } from '@/ui/ToastHost';
import { useT } from '@/i18n/i18n';
import { getActiveRoutes, useRegistryVersion } from '@/core/feature-registry';
import { on } from '@/core/events';
import { initFontSize } from '@/core/font-size';
import type { FeatureRoute } from '@/core/feature-types';
import type { AuthUser } from '@/data/auth';
import { resolveShareLink } from './share-link';
import { InternalTestGate } from './InternalTestGate';
import { isInternalTestMode, isInternalTester } from '@/data/internal-test';
import type { RouteAccessContext } from '@/core/feature-types';
import { useViewer } from '@/features/profile/data/viewer';

const lazyCache = new Map<FeatureRoute['load'], ComponentType<any>>();

function getRouteComponent(load: FeatureRoute['load']): ComponentType<any> {
  const cached = lazyCache.get(load);
  if (cached) return cached;
  const component = lazy(load);
  lazyCache.set(load, component);
  return component;
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
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const pendingRef = useRef(false);
  const authRevision = useRef(0);
  const loginSequence = useRef(0);
  const currentUid = useRef<string | null>(null);
  const internalTest = useMemo(() => isInternalTestMode(), []);
  // 內測模式：undefined＝確認中、true／false＝白名單結果（僅對目前 uid 有效）。
  const [tester, setTester] = useState<{ uid: string; ok: boolean } | null>(null);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    initFontSize();
    mounted.current = true;
    let cancelled = false;
    let stopAuth: (() => void) | undefined;

    const stopEvents = on('auth:changed', ({ uid }) => {
      const revision = ++authRevision.current;
      currentUid.current = uid;
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

    import('@/data/auth').then((auth) => {
      if (cancelled) return;
      stopAuth = auth.onAuthChanged(() => {
        // onAuthChanged 內部發出 auth:changed。
      });
    }).catch(() => {
      if (!cancelled) setLoginError(true);
    });

    return () => {
      cancelled = true;
      mounted.current = false;
      authRevision.current += 1;
      loginSequence.current += 1;
      stopEvents();
      stopAuth?.();
    };
  }, []);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const top = shell?.querySelector<HTMLElement>('.ui-top-bar');
    const bottom = shell?.querySelector<HTMLElement>('.ui-bottom-nav');
    const main = shell?.querySelector<HTMLElement>('.app-main');
    if (!top || !bottom || !main) return;

    const update = (): void => {
      const topHeight = top.getBoundingClientRect().height;
      const bottomHeight = bottom.getBoundingClientRect().height;
      if (topHeight > 0) {
        main.style.paddingTop = `calc(${topHeight}px + var(--space-2))`;
      }
      if (bottomHeight > 0) {
        main.style.paddingBottom =
          `calc(${bottomHeight}px + 64px + var(--line-height-caption) + var(--space-4))`;
      }
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(update);
    observer?.observe(top);
    observer?.observe(bottom);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
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
      } catch {
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

  useEffect(() => {
    const uid = user?.uid ?? null;
    if (!internalTest || uid === null) return;
    let alive = true;
    isInternalTester(uid)
      .then((ok) => { if (alive) setTester({ uid, ok }); })
      .catch(() => { if (alive) setTester({ uid, ok: false }); });
    return () => { alive = false; };
  }, [internalTest, user?.uid]);

  const [routeAccess, setRouteAccess] = useState<RouteAccessContext | null>(null);
  const pending = loginPending || externalPending;
  const gateState: boolean | null | undefined = !internalTest ? true
    : user === null ? null
      : tester?.uid === user.uid ? tester.ok : undefined;

  return (
    <LocationProvider>
      <div ref={shellRef} class="app-shell ui-app-shell">
        <TopBar
          menuRef={menuRef}
          drawerOpen={drawerOpen}
          onMenuClick={openDrawer}
          onLogin={handleLogin}
          loginPending={pending}
          user={user}
        />
        <main class="app-main">
          {loginError && !drawerOpen && (
            <div role="alert"><Text>{t('ui.shell.loginError')}</Text></div>
          )}
          {gateState === true
            ? <RouteArea routes={routes} />
            : <InternalTestGate allowed={gateState} onLogin={handleLogin} loginPending={pending} />}
        </main>
        {gateState === true && <BottomNav />}
        {internalTest && (
          <div class="internal-test-badge" aria-hidden="true">
            {t('internalTest.badge', { sha: import.meta.env.VITE_BUILD_SHA || 'dev' })}
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
        routeAccess={gateState === true ? routeAccess : null}
      />
      {gateState === true && <ViewerAccessBridge onChange={setRouteAccess} />}
      <ToastHost />
    </LocationProvider>
  );
}

/**
 * 只在通過內測閘門後掛載：讀登入者權限交給側邊選單篩選入口。
 * 放成獨立元件，是為了讓閘門前完全不觸發 viewer 的 Firestore 讀取。
 */
function ViewerAccessBridge({ onChange }: { onChange: (access: RouteAccessContext) => void }): null {
  const viewer = useViewer();
  useEffect(() => {
    onChange(viewer);
  }, [viewer, onChange]);
  return null;
}

function RouteArea({ routes }: { routes: FeatureRoute[] }): preact.JSX.Element {
  const location = useLocation();
  const redirect = resolveShareLink(location.url);

  useLayoutEffect(() => {
    if (redirect !== null) location.route(redirect, true);
  }, [redirect, location.route]);

  // 先處理分享入口，避免短暫掛載首頁並觸發首頁資料請求。
  if (redirect !== null) return <Fragment />;

  return (
    <RouteErrorBoundary path={location.path} onReset={() => lazyCache.clear()}>
      <Router>
        {routes.map((route) => (
          <Route key={route.path} path={route.path}
            component={getRouteComponent(route.load)} />
        ))}
        <Route default component={NotFound} />
      </Router>
    </RouteErrorBoundary>
  );
}

interface RouteErrorBoundaryProps {
  path: string;
  onReset: () => void;
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
