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
 * A：賽事、俱樂部、首頁、活動、我的。
 * B 第一版沒有賽事；活動與俱樂部保留 A 的原位，
 * 剩餘功能中以訊息作為賽事／活動資訊通知的替代入口，
 * 使用真實「訊息」名稱及 inbox 圖示，不冒充已實作賽事。
 * 簽到改由首頁正上方的 QR 入口進入，不在一般導覽重複呈現。
 *
 * order 由 manifest 決定。保留五格位置，功能停用時不讓首頁偏離中央。
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
  const activePath = items
    .filter((item) => item.path === '/' ? path === '/' :
      path === item.path || path.startsWith(`${item.path}/`))
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
          const column = item.order >= 0 && item.order <= 4
            ? item.order + 1
            : undefined;
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
