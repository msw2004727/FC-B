import './topbar-extra.css';
import type { JSX, RefObject } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { SHOW_EXP } from '@/core/exp-display';
import {
  PICKER_SPORT_OPTIONS,
  getPickerSportLabel,
  useActiveSport,
} from '@/core/sport-filter';
import { useTheme, type ThemeMode } from '@/core/theme';
import {
  LOGIN_PENDING_MSG,
  LOGIN_REQUIRED_MSG,
  UNAVAILABLE_FEATURE_MSG,
} from '@/core/unavailable';
import type { AuthUser } from '@/data/auth';
import { eventSportTag } from '@/features/events/data/sports';
import { lt } from '@/i18n/i18n';
import { SportIcon } from '@/ui/SportIcon';
import { toast } from '@/ui/Toast';

export interface TopBarProps {
  onMenuClick: () => void;
  drawerOpen: boolean;
  menuRef?: RefObject<HTMLButtonElement>;
  onLogin?: (() => void) | undefined;
  loginPending?: boolean;
  user?: AuthUser | null;
  /** 登入狀態確認前、且上次是已登入：先畫頭像位置（與 index.html 骨架相同），不顯示登入按鈕。 */
  authPending?: boolean;
  /** 第二身份：右上角頭像加金色皇冠（照 A `options.crown === true`）。 */
  crown?: boolean;
  /** 是否正在同步使用者資料且尚無頭像網址（照 A `options.isSyncing`）。 */
  isSyncing?: boolean;
}

const LIGHT_WEBP = '/assets/logo-black.webp';
const LIGHT_PNG = '/assets/logo-black.png';
const DARK_WEBP = '/assets/logo-white.webp';
const DARK_PNG = '/assets/logo-white.png';

/** 記憶本次執行期已知損壞的頭像網址，避免重複嘗試載入破圖（照 A `_rememberBrokenAvatarUrl`）。 */
const brokenAvatarUrls = new Set<string>();

/** 測試用：清空已記憶的損壞頭像網址。 */
export function _resetBrokenAvatarUrlsForTest(): void {
  brokenAvatarUrls.clear();
}

function getRenderableCandidates(rawUrl: string | null | undefined): string[] {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed || brokenAvatarUrls.has(trimmed)) return [];
  return [trimmed];
}

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

/**
 * 判斷目前路徑是否為詳情頁，若是則回傳切換運動時應退回的列表頁路由（照 A `DETAIL_TO_LIST_MAP`）。
 */
function getDetailBackRoute(path: string): string | null {
  if (/^\/events\/[^/]+/.test(path) || /^\/activities\/[^/]+/.test(path)) {
    return '/activities';
  }
  if (/^\/tournaments\/[^/]+/.test(path)) {
    return '/tournaments';
  }
  if (/^\/teams\/[^/]+/.test(path)) {
    return '/teams';
  }
  return null;
}

export function TopBar({
  onMenuClick,
  drawerOpen,
  menuRef,
  onLogin,
  loginPending = false,
  user = null,
  authPending = false,
  crown = false,
  isSyncing = false,
}: TopBarProps): JSX.Element {
  const theme = useTheme();
  const location = useLocation();
  const isDark = isEffectiveDark(theme);
  const primaryLogo = isDark ? DARK_WEBP : LIGHT_WEBP;
  const fallbackLogo = isDark ? DARK_PNG : LIGHT_PNG;
  const [logoSrc, setLogoSrc] = useState<string>(primaryLogo);

  const [activeSport, setActiveSport] = useActiveSport();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [loadedAvatarUrl, setLoadedAvatarUrl] = useState<string | null>(null);

  const pickerWrapperRef = useRef<HTMLDivElement>(null);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);
  const pickerListRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const avatarTriggerRef = useRef<HTMLElement | null>(null);

  // M-022：打開下拉時才用「已載入」的活動快照計算亮綠點（不觸發讀取、不把活動資料模組放進首屏必經路徑）。
  const [activeSportsSet, setActiveSportsSet] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!pickerOpen) return undefined;
    let alive = true;
    void import('@/features/events/data/events-repo').then(({ getEventsRepo }) => {
      if (!alive) return;
      const set = new Set<string>();
      for (const e of getEventsRepo().getSnapshot().active) {
        const status = String(e.status ?? '').toLowerCase();
        if (status === 'ended' || status === 'cancelled') continue;
        if (e.privateEvent) continue;
        set.add(eventSportTag(e) || 'football');
      }
      setActiveSportsSet(set);
    }).catch(() => {});
    return () => { alive = false; };
  }, [pickerOpen]);

  useEffect(() => {
    setLogoSrc(isDark ? DARK_WEBP : LIGHT_WEBP);
  }, [isDark]);

  // M-018：頭像先顯示 fallback 首字，背景以 new Image() 試載成功且寬度 >= 2 才換成 <img>，3 秒超時保護
  useEffect(() => {
    setLoadedAvatarUrl(null);
    if (!user) return undefined;
    const candidates = getRenderableCandidates(user.pictureUrl);
    if (candidates.length === 0) return undefined;

    let done = false;
    let idx = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tryNext = (): void => {
      if (done || idx >= candidates.length) return;
      const url = candidates[idx++]!;
      if (typeof Image === 'undefined') return;
      const probe = new Image();
      probe.referrerPolicy = 'no-referrer';
      probe.onload = () => {
        if (done) return;
        // JSDOM 環境中 naturalWidth 可能為 0，真實瀏覽器破圖 < 2；若 naturalWidth > 0 且 < 2 視為破圖
        if (probe.naturalWidth > 0 && probe.naturalWidth < 2) {
          brokenAvatarUrls.add(url);
          tryNext();
          return;
        }
        done = true;
        if (timer !== undefined) clearTimeout(timer);
        setLoadedAvatarUrl(url);
      };
      probe.onerror = () => {
        if (done) return;
        brokenAvatarUrls.add(url);
        if (timer !== undefined) clearTimeout(timer);
        tryNext();
      };
      probe.src = url;
      timer = setTimeout(() => {
        if (!done && probe.complete && probe.naturalWidth < 2) {
          brokenAvatarUrls.add(url);
          tryNext();
        }
      }, 3000);
    };

    tryNext();
    return () => {
      done = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [user?.uid, user?.pictureUrl]);

  // 登出或使用者變更時關閉頭像選單
  useEffect(() => {
    if (!user) setUserMenuOpen(false);
  }, [user]);

  // 點擊外部或按 Esc 關閉運動下拉與頭像選單
  useEffect(() => {
    const handleDocClick = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (pickerWrapperRef.current && !pickerWrapperRef.current.contains(target)) {
        setPickerOpen(false);
      }
      if (
        userMenuRef.current
        && !userMenuRef.current.contains(target)
        && avatarTriggerRef.current !== target
        && !(avatarTriggerRef.current && avatarTriggerRef.current.contains(target))
      ) {
        setUserMenuOpen(false);
      }
    };

    const handleDocKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setPickerOpen((wasOpen) => {
          if (wasOpen) {
            pickerBtnRef.current?.focus();
          }
          return false;
        });
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('click', handleDocClick);
    document.addEventListener('keydown', handleDocKeyDown);
    return () => {
      document.removeEventListener('click', handleDocClick);
      document.removeEventListener('keydown', handleDocKeyDown);
    };
  }, []);

  // U-004：展開運動下拉時將焦點移至目前選中的項目
  useEffect(() => {
    if (!pickerOpen || !pickerListRef.current) return;
    const activeItem =
      pickerListRef.current.querySelector<HTMLButtonElement>('.sport-picker-item.active')
      ?? pickerListRef.current.querySelector<HTMLButtonElement>('.sport-picker-item');
    activeItem?.focus();
  }, [pickerOpen]);

  const handleUnavailable = (): void => {
    toast.show({ message: UNAVAILABLE_FEATURE_MSG });
  };

  // M-033：通知鈴未登入時攔下並提示「請先登入LINE帳號」，留在原頁（照 A `js/core/navigation.js:2096-2101`）
  const handleNotifClick = (e: MouseEvent): void => {
    if (user?.uid) return;
    e.preventDefault();
    e.stopPropagation();
    if (loginPending || authPending) {
      toast.show({ message: LOGIN_PENDING_MSG });
      return;
    }
    toast.show({ message: LOGIN_REQUIRED_MSG });
  };

  const handleLogoError = (): void => {
    if (logoSrc !== fallbackLogo) {
      setLogoSrc(fallbackLogo);
    }
  };

  const handleTogglePicker = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setUserMenuOpen(false);
    setPickerOpen((prev) => !prev);
  };

  const handleSelectSport = useCallback(
    (sportKey: string, e?: Event): void => {
      if (e) {
        e.stopPropagation();
      }
      const currentPath = location?.path || (typeof window !== 'undefined' ? window.location.pathname : '/');
      const backTo = getDetailBackRoute(currentPath);
      const nextSport = setActiveSport(sportKey);
      setPickerOpen(false);
      const label = getPickerSportLabel(nextSport);
      toast.show({ message: `已切換為 ${label}` });

      if (backTo && typeof location?.route === 'function') {
        try {
          location.route(backTo);
        } catch {
          /* ignore */
        }
      }
    },
    [location, setActiveSport],
  );

  // U-004：上下鍵移動焦點、Home/End、Enter/Space 選取、Esc 關閉
  const handlePickerKeyDown = (e: KeyboardEvent): void => {
    if (!pickerOpen || !pickerListRef.current) return;
    const items = Array.from(
      pickerListRef.current.querySelectorAll<HTMLButtonElement>('.sport-picker-item[data-sport]'),
    );
    if (items.length === 0) return;
    const currentIndex = items.findIndex((el) => el === document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
      items[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      items[prevIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      const focused = items[currentIndex];
      if (focused) {
        e.preventDefault();
        const key = focused.getAttribute('data-sport') || 'all';
        handleSelectSport(key, e);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setPickerOpen(false);
      pickerBtnRef.current?.focus();
    }
  };

  const handleToggleUserMenu = (e?: Event): void => {
    if (e) {
      e.stopPropagation();
    }
    setPickerOpen(false);
    setUserMenuOpen((prev) => !prev);
  };

  const handleOpenProfile = (): void => {
    setUserMenuOpen(false);
    if (typeof location?.route === 'function') {
      location.route('/profile');
    } else if (typeof window !== 'undefined') {
      window.location.href = '/profile';
    }
  };

  const handleLogout = (): void => {
    setUserMenuOpen(false);
    // 登入模組用到時才載入（與 App 相同，不放進首屏必經路徑）。
    import('@/data/auth').then(({ signOut }) => signOut()).catch((err: unknown) => {
      console.error('[TopBar] signOut failed', err);
    });
  };

  const handleAvatarImgError = (): void => {
    if (loadedAvatarUrl) {
      brokenAvatarUrls.add(loadedAvatarUrl);
      setLoadedAvatarUrl(null);
    }
  };

  const displayName = user?.displayName?.trim() || '?';
  const initial = (displayName[0] ?? '?').toUpperCase();
  const syncingFallback = Boolean((authPending && !user) || (isSyncing && !user?.pictureUrl));
  const hasAnyActiveEvents = activeSportsSet.size > 0;

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
          {/* 新版關閉經驗值顯示時不畫 EXP（src/core/exp-display.ts）；index.html 骨架同步 */}
          {SHOW_EXP && (
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
          )}

          <div
            ref={pickerWrapperRef}
            class="sport-picker-wrapper"
            id="sport-picker-wrapper"
            onKeyDown={handlePickerKeyDown}
          >
            <button
              ref={pickerBtnRef}
              type="button"
              class={`sport-picker-btn${pickerOpen ? ' open' : ''}`}
              id="sport-picker-btn"
              aria-label={lt('切換運動項目', '切換運動項目')}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen ? 'true' : 'false'}
              aria-controls="sport-picker-dropdown"
              data-i18n-aria-label="切換運動項目"
              onClick={handleTogglePicker}
            >
              <span class="sport-picker-icon">
                {activeSport === 'all' ? (
                  <span class="sp-all-label" aria-hidden="true">All</span>
                ) : (
                  <SportIcon sportKey={activeSport} />
                )}
              </span>
            </button>
            <div
              class={`sport-picker-dropdown${pickerOpen ? ' open' : ''}`}
              id="sport-picker-dropdown"
              role="listbox"
            >
              <div class="sport-picker-header" data-i18n="切換運動項目">
                {lt('切換運動項目', '切換運動項目')}
              </div>
              <div id="sport-picker-list" ref={pickerListRef}>
                {PICKER_SPORT_OPTIONS.map((item) => {
                  const isActive = item.key === activeSport;
                  const hasGlow =
                    item.key === 'all' ? hasAnyActiveEvents : activeSportsSet.has(item.key);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      class={`sport-picker-item${isActive ? ' active' : ''}${hasGlow ? ' has-events' : ''}`}
                      data-sport={item.key}
                      role="option"
                      aria-selected={isActive ? 'true' : 'false'}
                      tabIndex={pickerOpen ? (isActive ? 0 : -1) : -1}
                      onClick={(e) => handleSelectSport(item.key, e)}
                    >
                      <span class="sp-icon">
                        {item.key === 'all' ? (
                          <span class="sp-all-label" aria-hidden="true">All</span>
                        ) : (
                          <SportIcon sportKey={item.key} />
                        )}
                      </span>
                      <span>{item.label}</span>
                      <span class="sp-pulse" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <a
            id="notif-btn"
            href="/inbox"
            aria-label={lt('通知', '通知')}
            data-i18n-aria-label="通知"
            onClick={handleNotifClick}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            <span class="notif-badge" id="notif-badge" style="display:none" />
            <span class="pm-notif-hint" id="pm-notif-hint" aria-hidden="true" hidden>
              <img src="/img/chat.png" alt="" loading="lazy" />
            </span>
          </a>

          <div id="line-login-wrapper" class="line-login-wrapper">
            {user ? (
              <div
                id="line-user-topbar"
                class={`line-user-topbar${crown ? ' has-identity-crown' : ''}`}
              >
                {loadedAvatarUrl ? (
                  <img
                    ref={(el) => {
                      avatarTriggerRef.current = el;
                    }}
                    id="line-avatar-topbar"
                    class="line-avatar-topbar"
                    src={loadedAvatarUrl}
                    alt={displayName}
                    referrerPolicy="no-referrer"
                    onClick={handleToggleUserMenu}
                    onError={handleAvatarImgError}
                  />
                ) : (
                  <div
                    ref={(el) => {
                      avatarTriggerRef.current = el;
                    }}
                    id="line-avatar-topbar"
                    class={`line-avatar-topbar line-avatar-fallback${syncingFallback ? ' line-avatar-loading' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={syncingFallback ? '同步中' : '使用者選單'}
                    title={syncingFallback ? '同步中' : '使用者選單'}
                    aria-expanded={userMenuOpen ? 'true' : 'false'}
                    onClick={handleToggleUserMenu}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleToggleUserMenu(e);
                      }
                    }}
                  >
                    {syncingFallback ? (
                      <span class="line-avatar-spinner" aria-hidden="true" />
                    ) : (
                      initial
                    )}
                  </div>
                )}
                {/* ASSUMPTION: 第二身份皇冠 DOM 照 A `_identityCrownBadgeHtml()` 使用 `.identity-crown-badge` */}
                {crown && (
                  <span class="identity-crown-badge" aria-hidden="true">
                    👑
                  </span>
                )}
                <div
                  ref={userMenuRef}
                  id="user-menu-dropdown"
                  class="user-menu-dropdown"
                  style={{ display: userMenuOpen ? '' : 'none' }}
                >
                  <div class="user-menu-name" id="user-menu-name">
                    {user.displayName ?? ''}
                  </div>
                  <div class="user-menu-divider" />
                  <button
                    type="button"
                    class="user-menu-item"
                    data-i18n="個人檔案"
                    onClick={handleOpenProfile}
                  >
                    {lt('個人檔案', '個人檔案')}
                  </button>
                  <button
                    type="button"
                    class="user-menu-item user-menu-logout"
                    data-i18n="登出"
                    onClick={handleLogout}
                  >
                    {lt('登出', '登出')}
                  </button>
                </div>
              </div>
            ) : authPending ? (
              <div id="line-user-topbar" class="line-user-topbar" aria-hidden="true">
                <div
                  id="line-avatar-topbar"
                  class="line-avatar-topbar line-avatar-fallback line-avatar-loading"
                  aria-label="同步中"
                  title="同步中"
                >
                  <span class="line-avatar-spinner" aria-hidden="true" />
                </div>
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
