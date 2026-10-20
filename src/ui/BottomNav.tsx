import { useMemo } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { emit } from '@/core/events';
import { getActiveRoutes, useRegistryVersion } from '@/core/feature-registry';
import {
  isAuthRequiredRoute,
  markHistoryRoot,
  normalizeRoutePath,
} from '@/core/back-guard';
import { prefetchRouteByPath } from '@/core/route-prefetch';
import {
  LOGIN_PENDING_MSG,
  RESTRICTED_ACCOUNT_MSG,
  UNAVAILABLE_FEATURE_MSG,
} from '@/core/unavailable';
import type { AuthUser } from '@/data/auth';
import { getLastKnownAuthUid } from '@/data/auth';
import { toast } from '@/ui/Toast';
import { lt } from '@/i18n/i18n';

export interface BottomNavProps {
  class?: string;
  user?: AuthUser | null;
  onLogin?: () => void;
  loginPending?: boolean;
  isRestricted?: boolean;
}

function isTabActive(
  currentPath: string,
  tabKey: 'tournaments' | 'teams' | 'home' | 'activities' | 'profile',
): boolean {
  const normalized = currentPath.startsWith('/events/') ? '/activities' : currentPath;
  switch (tabKey) {
    case 'tournaments':
      return normalized === '/tournaments' || normalized.startsWith('/tournaments/');
    case 'teams':
      return normalized === '/teams' || normalized.startsWith('/teams/');
    case 'home':
      return normalized === '/';
    case 'activities':
      return normalized === '/activities' || normalized.startsWith('/activities/');
    case 'profile':
      return normalized === '/profile' || normalized.startsWith('/profile/');
  }
}

export function BottomNav({
  class: className,
  user,
  onLogin,
  loginPending = false,
  isRestricted = false,
}: BottomNavProps): preact.JSX.Element {
  const location = useLocation();
  const path = location.path || '/';
  const registryVersion = useRegistryVersion();

  const { activePaths, hasCheckin } = useMemo(() => {
    const routes = getActiveRoutes();
    const set = new Set(routes.map((r) => r.path));
    return {
      activePaths: set,
      // A 中央鈕是「我的 QR Code」（App._openQrPopup，原頁彈窗顯示本人身分 QR）。
      hasCheckin: set.has('/profile/qr'),
    };
  }, [registryVersion]);

  const navigateOrToast = (targetPath: string): void => {
    // M-038：被限制的帳號點首頁以外分頁提示「帳號限制中」並導回首頁（照 A `js/core/navigation.js:485-488`）
    if (isRestricted && targetPath !== '/') {
      toast.show({ message: RESTRICTED_ACCOUNT_MSG });
      if (normalizeRoutePath(path) !== '/') {
        location.route('/', true);
        markHistoryRoot();
      }
      return;
    }

    // M-034：未登入點 AUTH_REQUIRED_PAGES（「我的」/profile、訊息 /inbox）時直接帶去 LINE 登入，不直接進頁。
    // 當使用端明確傳入 user === null 或 onLogin 時啟用守門；若獨立掛載未傳 user 則參考 getLastKnownAuthUid()。
    if (isAuthRequiredRoute(targetPath)) {
      const signedIn =
        user !== undefined
          ? Boolean(user?.uid)
          : getLastKnownAuthUid() !== null || !onLogin;
      if (!signedIn) {
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

    if (!activePaths.has(targetPath)) {
      // 目標頁尚未在 B 啟用（例如 /tournaments）時提示尚未開放
      toast.show({ message: UNAVAILABLE_FEATURE_MSG });
      return;
    }

    // M-037：照 A `this.pageHistory = []`，切分頁後的這頁是返回起點（頁內返回鈕回預設頁）；點目前所在分頁不重複推紀錄。
    if (normalizeRoutePath(path) === normalizeRoutePath(targetPath)) return;
    location.route(targetPath);
    markHistoryRoot();
  };

  const handleQrClick = (): void => {
    if (hasCheckin) {
      // M-025：照 A `App._openQrPopup()` 在原頁開啟 #uid-qr-modal 彈窗，不換頁。
      emit('qr:open', {});
    } else {
      toast.show({ message: UNAVAILABLE_FEATURE_MSG });
    }
  };

  // M-025：彈窗不算換頁，中央 QR 鈕不標為 active 分頁；5 個主分頁照目前路徑計算 active。
  // U-009：手指按下時立即開始預載該分頁程式碼
  const handlePrefetch = (targetPath: string): void => {
    prefetchRouteByPath(targetPath);
  };

  const tournamentsActive = isTabActive(path, 'tournaments');
  const teamsActive = isTabActive(path, 'teams');
  const homeActive = isTabActive(path, 'home');
  const activitiesActive = isTabActive(path, 'activities');
  const profileActive = isTabActive(path, 'profile');

  return (
    <div class="legacy-ui legacy-chrome">
      <nav
        id="bottom-tabs"
        class={className}
        aria-label="底部導覽"
      >
        <button
          type="button"
          class={`bot-tab${tournamentsActive ? ' active' : ''}`}
          data-page="page-tournaments"
          aria-current={tournamentsActive ? 'page' : undefined}
          onPointerDown={() => handlePrefetch('/tournaments')}
          onClick={() => navigateOrToast('/tournaments')}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 9H4.5a2.5 2.5 0 010-5C7 4 7 7 7 7" />
            <path d="M18 9h1.5a2.5 2.5 0 000-5C17 4 17 7 17 7" />
            <path d="M4 22h16" />
            <path d="M10 14.66V22" />
            <path d="M14 14.66V22" />
            <path d="M8 6v4a4 4 0 008 0V6H8z" />
          </svg>
          <span data-i18n="賽事">{lt('賽事', '賽事')}</span>
        </button>

        <button
          type="button"
          class={`bot-tab${teamsActive ? ' active' : ''}`}
          data-page="page-teams"
          aria-current={teamsActive ? 'page' : undefined}
          onPointerDown={() => handlePrefetch('/teams')}
          onClick={() => navigateOrToast('/teams')}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" />
            <path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
          <span data-i18n="俱樂部">{lt('俱樂部', '俱樂部')}</span>
        </button>

        <div class="bot-tab-center-wrap">
          {hasCheckin && (
            <button
              type="button"
              class="bot-tab-qr"
              aria-label={lt('我的 QR Code', '我的 QR Code')}
              data-i18n-aria-label="我的 QR Code"
              onClick={handleQrClick}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="2" width="8" height="8" rx="1" />
                <rect x="14" y="2" width="8" height="8" rx="1" />
                <rect x="2" y="14" width="8" height="8" rx="1" />
                <rect x="14" y="14" width="4" height="4" />
                <line x1="22" y1="14" x2="22" y2="18" />
                <line x1="18" y1="22" x2="22" y2="22" />
              </svg>
            </button>
          )}
          <button
            type="button"
            class={`bot-tab${homeActive ? ' active' : ''}`}
            data-page="page-home"
            aria-current={homeActive ? 'page' : undefined}
            onPointerDown={() => handlePrefetch('/')}
            onClick={() => navigateOrToast('/')}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            <span data-i18n="首頁">{lt('首頁', '首頁')}</span>
          </button>
        </div>

        <button
          type="button"
          class={`bot-tab${activitiesActive ? ' active' : ''}`}
          data-page="page-activities"
          aria-current={activitiesActive ? 'page' : undefined}
          onPointerDown={() => handlePrefetch('/activities')}
          onClick={() => navigateOrToast('/activities')}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span data-i18n="活動">{lt('活動', '活動')}</span>
        </button>

        <button
          type="button"
          class={`bot-tab${profileActive ? ' active' : ''}`}
          data-page="page-profile"
          aria-current={profileActive ? 'page' : undefined}
          onPointerDown={() => handlePrefetch('/profile')}
          onClick={() => navigateOrToast('/profile')}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span data-i18n="我的">{lt('我的', '我的')}</span>
        </button>
      </nav>
    </div>
  );
}
