import { useMemo } from 'preact/hooks';
import { Component, Fragment } from 'preact';
import type { ComponentChildren, ComponentType } from 'preact';
import { LocationProvider, Router, Route, lazy, useLocation } from 'preact-iso';
import { TopBar } from '@/ui/TopBar';
import { BottomNav } from '@/ui/BottomNav';
import { Text } from '@/ui/Text';
import { ErrorFallback } from '@/ui/ErrorFallback';
import { useT } from '@/i18n/i18n';
import { getActiveRoutes, useRegistryVersion } from '@/core/feature-registry';
import type { FeatureRoute } from '@/core/feature-types';

// lazy 元件依 load 函式身分快取；旗標變動不會讓仍啟用的頁面重新掛載。
// 用 Map 而非 WeakMap，才能在錯誤重試時整體清除，讓載入失敗的頁面重新呼叫 loader。
const lazyCache = new Map<FeatureRoute['load'], ComponentType<any>>();

function getRouteComponent(load: FeatureRoute['load']): ComponentType<any> {
  const cached = lazyCache.get(load);
  if (cached) return cached;
  const component = lazy(load);
  lazyCache.set(load, component);
  return component;
}

export function App(): preact.JSX.Element {
  const registryVersion = useRegistryVersion();
  const routes = useMemo<FeatureRoute[]>(() => getActiveRoutes(), [registryVersion]);

  return (
    <LocationProvider>
      <div class="app-shell">
        <TopBar />
        <main class="app-main">
          <RouteArea routes={routes} />
        </main>
        <BottomNav />
      </div>
    </LocationProvider>
  );
}

/** 在 LocationProvider 內取得目前路徑，交給錯誤邊界：站內導覽到別的路徑時自動清除錯誤畫面。 */
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

  // 錯誤狀態下使用者用「回首頁」或 BottomNav 換頁時，清除錯誤並重掛載路由區塊（Codex 第二輪 P1）。
  // 只在有錯誤時才重設，正常換頁不重掛載，避免影響 preact-iso 的頁面切換。
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
      <a href="/">{t('nav.home')}</a>
    </section>
  );
}
