import './bottom-nav.css';
import { useMemo } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Icon, type IconName } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';
import {
  getActiveRoutes,
  getNavItems,
  useRegistryVersion,
} from '@/core/feature-registry';

export interface BottomNavProps {
  class?: string;
}

const knownIcons = new Set<string>([
  'home', 'calendar', 'qr', 'user', 'users', 'book',
  'inbox', 'settings', 'sun', 'moon', 'globe',
]);

/**
 * A 原位：賽事、俱樂部、首頁、活動、我的。
 * B 以真實訊息功能佔第一格；簽到使用獨立 QR 入口。
 * order 由 manifest 決定，停用前面的功能仍保留首頁中央位置。
 */
export function BottomNav({ class: className }: BottomNavProps): preact.JSX.Element {
  const t = useT();
  const { path } = useLocation();
  const registryVersion = useRegistryVersion();
  const { items, hasCheckin } = useMemo(() => ({
    items: getNavItems(),
    hasCheckin: getActiveRoutes().some((route) => route.path === '/checkin'),
  }), [registryVersion]);

  const qrActive = hasCheckin &&
    (path === '/checkin' || path.startsWith('/checkin/'));
  // A 的列表與詳情不共用 prefix；詳情仍選中「活動」入口。
  const navigationPath = path.startsWith('/events/') ? '/activities' : path;
  const activePath = items
    .filter((item) => item.path === '/' ? navigationPath === '/' :
      navigationPath === item.path || navigationPath.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path;

  return (
    <nav
      id="bottom-tabs"
      class={['ui-bottom-nav', className].filter(Boolean).join(' ')}
      aria-label={t('ui.bottomNav.label')}
    >
      {hasCheckin && (
        <a
          href="/checkin"
          class="ui-bottom-nav__qr"
          aria-label={t('ui.shell.qrCheckin')}
          title={t('ui.shell.qrCheckin')}
          aria-current={qrActive ? 'page' : undefined}
        >
          <Icon name="qr" size={24} />
        </a>
      )}
      <div class="ui-bottom-nav__items">
        {items.map((item) => {
          const active = !qrActive && item.path === activePath;
          const column = item.order >= 0 && item.order <= 4 ? item.order + 1 : undefined;
          return (
            <a
              key={item.path}
              href={item.path}
              style={{ gridColumn: column }}
              class={`ui-bottom-nav__item${active ? ' ui-bottom-nav__item--active' : ''}`}
              aria-current={active ? 'page' : undefined}
              aria-label={t(item.labelKey)}
              title={t(item.labelKey)}
            >
              <Icon
                name={knownIcons.has(item.icon) ? item.icon as IconName : 'globe'}
                size={24}
              />
              <Text class="ui-bottom-nav__label">{t(item.labelKey)}</Text>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
