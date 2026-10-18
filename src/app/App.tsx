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
import { useT } from '@/i18n/i18n';
import { getActiveRoutes, useRegistryVersion } from '@/core/feature-registry';
import { on } from '@/core/events';
import { initFontSize } from '@/core/font-size';
import type { FeatureRoute } from '@/core/feature-types';
import type { AuthUser } from '@/data/auth';

const lazyCache = new Map<FeatureRoute['load'], ComponentType<any>>();

function getRouteComponent(load: FeatureRoute['load']): ComponentType<any> {
  const cached = lazyCache.get(load);
  if (cached) return cached;
  const component = lazy(load);
  lazyCache.set(load, component);
  return component;
}

export interface AppProps {
  /** 可選測試／宿主整合；未提供時使用正式 lazy signIn。 */
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

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    initFontSize();
    mounted.current = true;
    let cancelled = false;
    let stopAuth: (() => void) | undefined;

    // uid 事件為登入狀態來源；立即清除舊身份，詳細資料非同步補讀。
    const stopEvents = on('auth:changed', ({ uid }) => {
      const revision = ++authRevision.current;
      currentUid.current = uid;
      setLoginError(false);
      setUser((previous) => uid === null ? null :
        previous?.uid === uid ? previous :
          { uid, displayName: null, pictureUrl: null });

      if (uid === null) return;
      void import('@/data/auth')
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
          // uid 已知時保留登入狀態與 Avatar fallback，不暴露原始錯誤。
        });
    });

    // 建立 Firebase 狀態橋接，讓頁面重載與登出也發出 auth:changed。
    void import('@/data/auth').then((auth) => {
      if (cancelled) return;
      stopAuth = auth.onAuthChanged(() => {
        // onAuthChanged 內部會 emit auth:changed；狀態統一由上面的事件處理。
      });
    }).catch(() => {
      // 初始化失敗仍可使用未登入介面。
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

    void (async () => {
      try {
        if (onLogin) {
          await onLogin();
        } else {
          const auth = await import('@/data/auth');
          if (!mounted.current || sequence !== loginSequence.current) return;
          const next = await auth.signIn();
          if (!mounted.current || sequence !== loginSequence.current) return;

          // signIn 自身會發事件；保留其 LINE profile，避免被較晚的登出覆蓋。
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
    })();
  }, [externalPending, onLogin]);

  const pending = loginPending || externalPending;

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
          <RouteArea routes={routes} />
        </main>
        <BottomNav />
      </div>
      <SideDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        returnFocusRef={menuRef}
        user={user}
        onLogin={handleLogin}
        loginPending={pending}
        loginError={loginError}
      />
    </LocationProvider>
  );
}

function RouteArea({ routes }: { routes: FeatureRoute[] }): preact.JSX.Element {
  const { path } = useLocation();
  return (
    <RouteErrorBoundary path={path} onReset={() => lazyCache.clear()}>
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
