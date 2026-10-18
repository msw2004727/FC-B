import '@/ui/app-shell.css';
import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
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
import type { FeatureRoute } from '@/core/feature-types';

const lazyCache = new Map<FeatureRoute['load'], ComponentType<any>>();

function getRouteComponent(load: FeatureRoute['load']): ComponentType<any> {
  const cached = lazyCache.get(load);
  if (cached) return cached;
  const component = lazy(load);
  lazyCache.set(load, component);
  return component;
}

export interface AppProps {
  /**
   * 由既有登入整合提供；附件沒有 auth API，不推測登入狀態。
   * 未提供時不顯示無法操作的 LINE 登入按鈕。
   */
  onLogin?: () => void;
  loginPending?: boolean;
}

export function App({ onLogin, loginPending = false }: AppProps): preact.JSX.Element {
  const registryVersion = useRegistryVersion();
  const routes = useMemo<FeatureRoute[]>(() => getActiveRoutes(), [registryVersion]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <LocationProvider>
      <div class="app-shell ui-app-shell">
        <TopBar
          menuRef={menuRef}
          drawerOpen={drawerOpen}
          onMenuClick={openDrawer}
          onLogin={onLogin}
          loginPending={loginPending}
        />
        <main class="app-main">
          <RouteArea routes={routes} />
        </main>
        <BottomNav />
      </div>
      <SideDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        returnFocusRef={menuRef}
      />
    </LocationProvider>
  );
}

function RouteArea({ routes }: { routes: FeatureRoute[] }): preact.JSX.Element {
  const { path } = useLocation();
  return (
    <RouteErrorBoundary path={path} onReset={() => lazyCache.clear()}>
      <Router>
        {routes.map((r) => (
          <Route key={r.path} path={r.path} component={getRouteComponent(r.load)} />
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

  componentDidUpdate(prev: RouteErrorBoundaryProps): void {
    if (this.state.error && prev.path !== this.props.path) this.reset();
  }

  private reset(): void {
    this.props.onReset();
    this.setState({ error: null, resetKey: this.state.resetKey + 1 });
  }

  private handleRetry = (): void => {
    this.reset();
  };

  render(): preact.JSX.Element {
    if (this.state.error) {
      return <ErrorFallback onRetry={this.handleRetry} showHome />;
    }
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}

function NotFound(): preact.JSX.Element {
  const t = useT();
  return (
    <section class="not-found">
      <Text as="h1">{t('notFound.title')}</Text>
      <Text as="p">{t('notFound.body')}</Text>
      <a href="/"><Text>{t('nav.home')}</Text></a>
    </section>
  );
}
