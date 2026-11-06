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
import {
  carryLoginRedirectParams,
  cleanLoginParamsFromUrl,
  consumeAutoLoginSuppressed,
  hasLoginCancelParams,
  isAutoLoginSuppressedThisPage,
  markAutoLoginSuppressed,
  hasLoginRedirectParams,
} from '@/data/login-redirect';
import { resolveShareLink } from './share-link';
import { APP_VERSION } from '@/version';
import {
  firebaseTargetLabel,
  releaseFirebaseAuthHold,
  whenFirebaseAuthAllowed,
} from '@/data/firebase';
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
  // 從 LINE 授權回來（網址帶 code＋liffClientId 或 liff.state）：登入狀態確認後自動接手登入一次。
  const resumeLoginRef = useRef(
    typeof location !== 'undefined' && hasLoginRedirectParams(location.href),
  );
  // 這次開頁略過「頁面自動要求登入」（auto）：剛在 LINE 授權頁取消、剛登出重整，或本次接手失敗過（Grok 第二輪 P1）。
  // 使用者自己按的登入不受影響。旗標在開頁讀一次就刪，下一次開頁恢復。
  const skipAutoLoginRef = useRef<boolean | null>(null);
  if (skipAutoLoginRef.current === null) {
    if (typeof location !== 'undefined' && hasLoginCancelParams(location.href)) {
      markAutoLoginSuppressed('cancel'); // 清取消參數之前寫
    }
    skipAutoLoginRef.current = consumeAutoLoginSuppressed();
  }
  // 自動要求登入要等 Auth 還原結果（authKnown）：整頁打開時 Auth 晚一步才知道是已登入者，
  // 先發的自動要求記下，還原後仍是訪客才登入、已有人就丟掉（Grok 第三輪 P1）。
  const authKnownRef = useRef(false);
  const pendingAutoLoginRef = useRef(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    // 回跳接手登入要等 Auth 還原結果，不等首頁公開讀取（T-041 暫緩）；冪等。
    if (resumeLoginRef.current) releaseFirebaseAuthHold();
    // 在 LINE 授權頁取消（error＋liffClientId）：不載 LIFF，直接清參數（審查 P3-1）。
    else if (typeof location !== 'undefined' && hasLoginCancelParams(location.href)) cleanLoginParamsFromUrl();
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
      authKnownRef.current = true;
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

    // 開在首頁且沒有登入旗標（真訪客）時，等首頁的公開讀取（events／banners／announcements）處理完才還原登入狀態：
    // Auth 一註冊進 Firestore，Firestore 的非同步佇列就會停到 Auth 初始化完成（T-041，見 data/firebase.ts）。
    // 有登入旗標的人不暫緩，whenFirebaseAuthAllowed() 立即 resolve。
    Promise.all([import('@/data/auth'), whenFirebaseAuthAllowed()]).then(([auth]) => {
      if (cancelled) return;
      stopAuth = auth.onAuthChanged(() => {
        // onAuthChanged 內部發出 auth:changed。
      });
    }).catch(() => {
      if (!cancelled) {
        authKnownRef.current = true;
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

  // resume=true：開頁接手 LINE 授權回跳，不走外部 onLogin、LIFF 未登入時不再導向 LINE。
  const runLogin = useCallback((resume: boolean): void => {
    // 首頁訪客路徑會暫緩 Auth 註冊（T-041）；按下登入代表使用者現在就要 Auth，
    // 登入流程的 callable 要等 getFirebase()，不立刻放行會多等 3～10 秒（冪等：沒有暫緩或已放行時是空操作）。
    releaseFirebaseAuthHold();
    // 登入進行中不能清回跳參數——進行中的 signIn 可能還沒跑到 liff.init，code 被清掉會讀不到
    // 而再導向 LINE；交給它在 init 之後自己清（Grok 交叉審查 P1、第二輪 P2）。
    if (pendingRef.current || externalPending) return;
    if (currentUid.current !== null) {
      // 開頁接手但已登入、也沒有進行中的登入：清掉回跳參數（審查 P3-4）。
      if (resume) cleanLoginParamsFromUrl();
      return;
    }
    pendingRef.current = true;
    const sequence = ++loginSequence.current;
    const revision = authRevision.current;
    setLoginPending(true);
    setLoginError(false);

    (async () => {
      try {
        if (onLogin && !resume) {
          await onLogin();
        } else {
          const auth = await import('@/data/auth');
          if (!mounted.current || sequence !== loginSequence.current) return;
          const next = resume ? await auth.signIn({ interactive: false }) : await auth.signIn();
          if (!mounted.current || sequence !== loginSequence.current) return;

          if (authRevision.current === revision || currentUid.current === next.uid) {
            currentUid.current = next.uid;
            setUser(next);
          }
        }
      } catch (err) {
        // 接手失敗（含 LIFF 未登入的靜默失敗）：這次開頁之後的自動登入要求一律略過（Grok 第二輪 P1）。
        if (resume) skipAutoLoginRef.current = true;
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

  const handleLogin = useCallback((): void => runLogin(false), [runLogin]);

  // 照 A 開頁 liff.init 的效果：從 LINE 授權回來時，Auth 還原結果確定後接手登入一次。
  // 已是登入狀態只清網址參數；之後使用者再按登入由 pendingRef 擋掉重複觸發。
  useEffect(() => {
    if (!authKnown || !resumeLoginRef.current) return;
    resumeLoginRef.current = false;
    // runLogin 自己處理：進行中不清、已登入且沒有進行中才清（Grok 第二輪 P2）。
    runLogin(true);
  }, [authKnown, runLogin]);

  // M-036：手機外部瀏覽器登入提示框（回呼要穩定，彈窗的返回鍵登記才不會每次重繪重來）。
  const closeMobileHint = useCallback(() => setMobileHintOpen(false), []);
  const confirmMobileHint = useCallback(() => {
    setMobileHintOpen(false);
    acknowledgeMobileLoginHint();
    handleLogin();
  }, [handleLogin]);

  // 網址還帶 LINE 授權回跳參數時（例如公開個人頁掛載就要求登入），一律走接手模式：
  // 這次開頁不可能呼叫 liff.login()，避免與接手互搶後無限重導（Grok 交叉審查 P1）。
  const startRequestedLogin = useCallback((): void => {
    if (typeof location !== 'undefined' && hasLoginRedirectParams(location.href)) {
      runLogin(true);
      return;
    }
    handleLogin();
  }, [handleLogin, runLogin]);

  // M-034、M-035：監聽全域登入請求事件（如個人頁未登入 LINE 登入按鈕、底部分頁未登入守門）
  useEffect(() => {
    return on('auth:login-request', (payload) => {
      if (payload?.auto === true) {
        // 頁面自動要求（auto）：剛取消授權／剛登出／本次接手失敗過／這一頁正在或已經登出就略過，
        // 避免反覆送去 LINE（Grok 第二輪 P1、第三輪 P2）。
        if (skipAutoLoginRef.current === true || isAutoLoginSuppressedThisPage()) return;
        // Auth 還原結果還沒出來：先記下，還原後仍是訪客才登入（Grok 第三輪 P1）。
        if (!authKnownRef.current) {
          pendingAutoLoginRef.current = true;
          return;
        }
      }
      startRequestedLogin();
    });
  }, [startRequestedLogin]);

  // 記下的自動要求：Auth 還原後仍是訪客（且沒被略過）才登入；已有登入者就丟掉（Grok 第三輪 P1）。
  useEffect(() => {
    if (!authKnown || !pendingAutoLoginRef.current) return;
    pendingAutoLoginRef.current = false;
    if (currentUid.current !== null) return;
    if (skipAutoLoginRef.current === true || isAutoLoginSuppressedThisPage()) return;
    startRequestedLogin();
  }, [authKnown, startRequestedLogin]);

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
            {t('internalTest.badge', { version: APP_VERSION })}
            {/* 站長 11-06 改名「ToosterX搶先試用版[版號]」，取代原「內測版 · sha · 連線目標」；
                連 emulator 時仍附目標，連錯資料庫能被看見（Fable 2026-10-19） */}
            {firebaseTargetLabel().endsWith('emulator') ? ` · ${firebaseTargetLabel()}` : ''}
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
        {/* 站內信排程執行器借此掛載：角色由既有 routeAccess 傳入，不另讀 viewer。 */}
        {chromeUid !== null && <LazyPmDialogHost viewer={routeAccess} />}
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
    // 帶 LINE 授權回跳參數時一併帶到目的網址，留給接手登入的 liff.init 讀（Grok 交叉審查 P2）。
    if (redirect !== null) location.route(carryLoginRedirectParams(location.url, redirect), true);
  }, [redirect, location.route]);

  // 暫緩 Auth 註冊只為了讓「首頁」的公開讀取先跑完；人不在首頁（含分享連結導向）就立刻放行（T-041）。
  useEffect(() => {
    if (redirect !== null || normalizeRoutePath(location.path || '/') !== '/') {
      releaseFirebaseAuthHold();
    }
  }, [redirect, location.path]);

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
