import type { RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { emit } from '@/core/events';
import { useTheme, type ThemeMode } from '@/core/theme';
import type { AuthUser } from '@/data/auth';
import { toast } from '@/ui/Toast';
import { lt } from '@/i18n/i18n';

export interface TopBarProps {
  onMenuClick: () => void;
  drawerOpen: boolean;
  menuRef?: RefObject<HTMLButtonElement>;
  onLogin?: (() => void) | undefined;
  loginPending?: boolean;
  user?: AuthUser | null;
  /** 登入狀態確認前、且上次是已登入：先畫頭像位置（與 index.html 骨架相同），不顯示登入按鈕。 */
  authPending?: boolean;
}

const UNAVAILABLE_MSG = '此功能尚未開放，請先使用舊版';

const LIGHT_WEBP = '/assets/logo-black.webp';
const LIGHT_PNG = '/assets/logo-black.png';
const DARK_WEBP = '/assets/logo-white.webp';
const DARK_PNG = '/assets/logo-white.png';

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

export function TopBar({
  onMenuClick,
  drawerOpen,
  menuRef,
  onLogin,
  loginPending = false,
  user = null,
  authPending = false,
}: TopBarProps): preact.JSX.Element {
  const theme = useTheme();
  const isDark = isEffectiveDark(theme);
  const primaryLogo = isDark ? DARK_WEBP : LIGHT_WEBP;
  const fallbackLogo = isDark ? DARK_PNG : LIGHT_PNG;
  const [logoSrc, setLogoSrc] = useState<string>(primaryLogo);

  useEffect(() => {
    setLogoSrc(isDark ? DARK_WEBP : LIGHT_WEBP);
  }, [isDark]);

  const handleUnavailable = (): void => {
    toast.show({ message: UNAVAILABLE_MSG });
  };

  const handleLogoError = (): void => {
    if (logoSrc !== fallbackLogo) {
      setLogoSrc(fallbackLogo);
    }
  };

  const initial = (user?.displayName?.trim()?.[0] ?? '?').toUpperCase();

  return (
    <div class="legacy-ui legacy-chrome">
      <header id="top-bar">
        <button
          id="menu-toggle"
          ref={menuRef}
          type="button"
          aria-label={lt('選單', '選單')}
          data-i18n-aria-label="選單"
          aria-controls="side-drawer"
          aria-expanded={drawerOpen ? 'true' : 'false'}
          onClick={onMenuClick}
        >
          <span />
          <span />
          <span />
        </button>

        <div class="logo">
          <a href="/" aria-label="首頁" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img
              id="top-logo-img"
              alt="ToosterX"
              class="logo-img"
              width={473}
              height={96}
              decoding="async"
              src={logoSrc}
              data-logo-light-webp={LIGHT_WEBP}
              data-logo-light-png={LIGHT_PNG}
              data-logo-dark-webp={DARK_WEBP}
              data-logo-dark-png={DARK_PNG}
              data-logo-fallback={fallbackLogo}
              onError={handleLogoError}
            />
          </a>
        </div>

        <div class="top-bar-right">
          <div
            id="points-display"
            class="points-display"
            title={lt('我的 EXP', '我的 EXP')}
            data-i18n-title="我的 EXP"
            role="button"
            tabIndex={0}
            onClick={handleUnavailable}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleUnavailable();
              }
            }}
          >
            <span class="points-icon">P</span>
            {/* A updatePointsDisplay：訪客顯示「-」，登入顯示 users.exp；B 的 EXP 資料下一批接上，先一律「-」不顯示錯誤的 0 */}
            <span class="points-value" id="points-value">-</span>
          </div>

          <div class="sport-picker-wrapper" id="sport-picker-wrapper">
            <button
              type="button"
              class="sport-picker-btn"
              id="sport-picker-btn"
              aria-label={lt('切換運動項目', '切換運動項目')}
              aria-haspopup="listbox"
              aria-expanded="false"
              aria-controls="sport-picker-dropdown"
              data-i18n-aria-label="切換運動項目"
              onClick={() => emit('sport:picker-open', {})}
            >
              <span class="sport-picker-icon">
                <span class="sp-all-label" aria-hidden="true">All</span>
              </span>
            </button>
            <div class="sport-picker-dropdown" id="sport-picker-dropdown" role="listbox">
              <div class="sport-picker-header" data-i18n="切換運動項目">{lt('切換運動項目', '切換運動項目')}</div>
              <div id="sport-picker-list" />
            </div>
          </div>

          <a
            id="notif-btn"
            href="/inbox"
            aria-label={lt('通知', '通知')}
            data-i18n-aria-label="通知"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            <span class="notif-badge" id="notif-badge" style="display:none" />
            <span class="pm-notif-hint" id="pm-notif-hint" aria-hidden="true" hidden>
              {/* 絕對路徑：相對路徑在 /teams/xxx 等子路徑會抓錯檔；平常隱藏，lazy 讓它顯示時才下載 */}
              <img src="/img/chat.png" alt="" loading="lazy" />
            </span>
          </a>

          <div id="line-login-wrapper" class="line-login-wrapper">
            {user ? (
              <div id="line-user-topbar" class="line-user-topbar">
                <a
                  href="/profile"
                  aria-label="個人檔案"
                  title={user.displayName ?? '個人檔案'}
                  style={{ display: 'inline-flex', textDecoration: 'none' }}
                >
                  {user.pictureUrl ? (
                    <img
                      id="line-avatar-topbar"
                      class="line-avatar-topbar"
                      src={user.pictureUrl}
                      alt={user.displayName ?? ''}
                    />
                  ) : (
                    <div
                      id="line-avatar-topbar"
                      class="line-avatar-topbar line-avatar-fallback"
                    >
                      {initial}
                    </div>
                  )}
                </a>
              </div>
            ) : authPending ? (
              <div id="line-user-topbar" class="line-user-topbar" aria-hidden="true">
                <div id="line-avatar-topbar" class="line-avatar-topbar line-avatar-fallback" />
              </div>
            ) : onLogin ? (
              <button
                id="line-login-btn"
                type="button"
                class="line-login-btn"
                disabled={loginPending}
                aria-label="LINE 登入"
                aria-busy={loginPending ? 'true' : undefined}
                onClick={onLogin}
              >
                {loginPending ? (
                  <span class="line-avatar-spinner" aria-hidden="true" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
                    <path d="M12 2C6.48 2 2 5.83 2 10.5c0 4.18 3.66 7.68 8.58 8.38.33.07.78.22.9.5.1.26.07.66.03.92l-.15.86c-.04.26-.2 1.01.88.55s5.88-3.47 8.03-5.93C22.08 13.79 22 12.18 22 10.5 22 5.83 17.52 2 12 2z" />
                  </svg>
                )}
                LINE 登入
              </button>
            ) : null}
          </div>
        </div>
      </header>
    </div>
  );
}
