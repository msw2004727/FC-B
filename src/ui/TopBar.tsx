import './top-bar.css';
import type { RefObject } from 'preact';
import { Avatar } from '@/ui/Avatar';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';
import { emit } from '@/core/events';
import type { AuthUser } from '@/data/auth';

export interface TopBarProps {
  onMenuClick: () => void;
  drawerOpen: boolean;
  menuRef?: RefObject<HTMLButtonElement>;
  onLogin?: (() => void) | undefined;
  loginPending?: boolean;
  user?: AuthUser | null;
}

export function TopBar({
  onMenuClick,
  drawerOpen,
  menuRef,
  onLogin,
  loginPending = false,
  user = null,
}: TopBarProps): preact.JSX.Element {
  const t = useT();

  return (
    <header id="top-bar" class="ui-top-bar" aria-label={t('ui.topBar.label')}>
      <button
        id="menu-toggle"
        ref={menuRef}
        type="button"
        class="ui-top-bar__button"
        aria-label={t('ui.topBar.menu')}
        title={t('ui.topBar.menu')}
        aria-controls="side-drawer"
        aria-expanded={drawerOpen}
        aria-haspopup="dialog"
        onClick={onMenuClick}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
          aria-hidden="true" focusable="false">
          <path d="M3 5h18M3 12h18M3 19h18" />
        </svg>
      </button>

      <a class="ui-top-bar__brand" href="/" aria-label={t('ui.topBar.home')}>
        <Text>{t('app.title')}</Text>
      </a>

      {/* 刻意偏離 A：B 第一版經驗值僅預留，不顯示積分膠囊或虛構積分。 */}
      <div class="ui-top-bar__actions">
        <button
          id="sport-picker-btn"
          type="button"
          class="ui-top-bar__button ui-top-bar__sport"
          aria-label={t('ui.topBar.sport')}
          title={t('ui.topBar.sport')}
          onClick={() => emit('sport:picker-open', {})}
        >
          <span class="ui-top-bar__sport-face">
            <Text>{t('ui.shell.sportAll')}</Text>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              aria-hidden="true" focusable="false">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </button>
        <a
          id="notif-btn"
          href="/inbox"
          class="ui-top-bar__button"
          aria-label={t('ui.topBar.notifications')}
          title={t('ui.topBar.notifications')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M4 17h16l-2-3V9a6 6 0 0 0-12 0v5zM10 21h4" />
          </svg>
        </a>
        {user ? (
          <a
            href="/profile"
            class="ui-top-bar__button"
            aria-label={t('nav.profile')}
          >
            <Avatar name={user.displayName} pictureUrl={user.pictureUrl} decorative />
          </a>
        ) : onLogin ? (
          <button
            id="line-login-btn"
            type="button"
            class="ui-top-bar__login"
            disabled={loginPending}
            aria-label={t('ui.topBar.login')}
            aria-busy={loginPending || undefined}
            onClick={onLogin}
          >
            <span class="ui-top-bar__login-face">
              {loginPending ? (
                <svg class="ui-top-bar__spinner" width="16" height="16"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="2" aria-hidden="true" focusable="false">
                  <path d="M12 3a9 9 0 1 1-9 9" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"
                  aria-hidden="true" focusable="false">
                  <path d="M12 3C6.5 3 2 6.4 2 10.6c0 3.7 3.5 6.8 8.2 7.5L10 22l5.1-4.2C19.1 16.8 22 14 22 10.6 22 6.4 17.5 3 12 3Z" />
                </svg>
              )}
              <Text>{t('ui.topBar.login')}</Text>
            </span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
