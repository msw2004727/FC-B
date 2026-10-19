import { useMemo } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { getActiveRoutes, useRegistryVersion } from '@/core/feature-registry';
import { toast } from '@/ui/Toast';
import { lt } from '@/i18n/i18n';

export interface BottomNavProps {
  class?: string;
}

const UNAVAILABLE_MSG = '此功能尚未開放，請先使用舊版';

function isTabActive(currentPath: string, tabKey: 'tournaments' | 'teams' | 'home' | 'activities' | 'profile', qrActive: boolean): boolean {
  if (qrActive) return false;
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

export function BottomNav({ class: className }: BottomNavProps): preact.JSX.Element {
  const location = useLocation();
  const path = location.path;
  const registryVersion = useRegistryVersion();

  const { activePaths, hasCheckin } = useMemo(() => {
    const routes = getActiveRoutes();
    const set = new Set(routes.map((r) => r.path));
    return {
      activePaths: set,
      // A 中央鈕是「我的 QR Code」（App._openQrPopup，顯示本人身分 QR），對到 B 的 /profile/qr，不是掃碼頁。
      hasCheckin: set.has('/profile/qr'),
    };
  }, [registryVersion]);

  const qrPath = '/profile/qr';
  const qrActive = hasCheckin && path === qrPath;

  const navigateOrToast = (targetPath: string): void => {
    if (activePaths.has(targetPath)) {
      location.route(targetPath);
    } else {
      // 目標頁尚未在 B 啟用（例如 /tournaments）時提示尚未開放
      toast.show({ message: UNAVAILABLE_MSG });
    }
  };

  const handleQrClick = (): void => {
    if (hasCheckin) {
      location.route(qrPath);
    } else {
      toast.show({ message: UNAVAILABLE_MSG });
    }
  };

  const tournamentsActive = isTabActive(path, 'tournaments', qrActive);
  const teamsActive = isTabActive(path, 'teams', qrActive);
  const homeActive = isTabActive(path, 'home', qrActive);
  const activitiesActive = isTabActive(path, 'activities', qrActive);
  const profileActive = isTabActive(path, 'profile', qrActive);

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
              class={`bot-tab-qr${qrActive ? ' active' : ''}`}
              aria-label={lt('我的 QR Code', '我的 QR Code')}
              data-i18n-aria-label="我的 QR Code"
              aria-current={qrActive ? 'page' : undefined}
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
