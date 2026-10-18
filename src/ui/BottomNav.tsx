import './bottom-nav.css';
import { useMemo } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Icon, type IconName } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';
import { getNavItems, useRegistryVersion } from '@/core/feature-registry';
import type { FeatureNavItem } from '@/core/feature-types';

export interface BottomNavProps {
  class?: string;
}

/**
 * A 順序：賽事、俱樂部、首頁、活動、我的。
 * 以已知圖示識別既有功能，未知擴充項目保留 registry order。
 * 不新增、啟用或猜測任何功能路由。
 */
function visualOrder(item: FeatureNavItem): number {
  switch (item.icon) {
    case 'trophy': return 0;
    case 'users': return 1;
    case 'home': return 2;
    case 'calendar': return 3;
    case 'user': return 4;
    default: return 5;
  }
}

const knownIcons = new Set<string>([
  'home', 'calendar', 'qr', 'user', 'users', 'book',
  'inbox', 'settings', 'sun', 'moon', 'globe',
]);

function navIcon(name: string): preact.JSX.Element {
  if (name === 'trophy') {
    // Icon 尚未提供 trophy，不修改共用 Icon。
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M7 3h10v6a5 5 0 0 1-10 0zM7 5H3v3a4 4 0 0 0 4 4M17 5h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8" />
      </svg>
    );
  }
  return <Icon name={knownIcons.has(name) ? name as IconName : 'globe'} size={24} />;
}

export function BottomNav({ class: className }: BottomNavProps): preact.JSX.Element {
  const t = useT();
  const { path } = useLocation();
  const registryVersion = useRegistryVersion();
  const items = useMemo(
    () => [...getNavItems()].sort((a, b) => visualOrder(a) - visualOrder(b) || a.order - b.order),
    [registryVersion],
  );

  // 最長匹配避免巢狀 nav 同時具有 aria-current。
  const activePath = items
    .filter((item) => item.path === '/' ? path === '/' :
      path === item.path || path.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path;

  return (
    <nav
      class={['ui-bottom-nav', className].filter(Boolean).join(' ')}
      aria-label={t('ui.bottomNav.label')}
    >
      <a
        href="/profile/qr"
        class="ui-bottom-nav__qr"
        aria-label={t('ui.bottomNav.qr')}
        title={t('ui.bottomNav.qr')}
        aria-current={path === '/profile/qr' ? 'page' : undefined}
      >
        <Icon name="qr" size={24} />
      </a>
      <div class="ui-bottom-nav__items">
        {items.map((item) => {
          const active = item.path === activePath && path !== '/profile/qr';
          return (
            <a
              key={item.path}
              href={item.path}
              class={`ui-bottom-nav__item${active ? ' ui-bottom-nav__item--active' : ''}`}
              aria-current={active ? 'page' : undefined}
              aria-label={t(item.labelKey)}
              title={t(item.labelKey)}
            >
              {navIcon(item.icon)}
              <Text class="ui-bottom-nav__label">{t(item.labelKey)}</Text>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
