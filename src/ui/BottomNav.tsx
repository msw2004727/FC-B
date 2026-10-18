import { useMemo } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { useT } from '@/i18n/i18n';
import { getNavItems, useRegistryVersion } from '@/core/feature-registry';

export function BottomNav(): preact.JSX.Element {
  const t = useT();
  const { path } = useLocation();
  const registryVersion = useRegistryVersion();
  const items = useMemo(() => getNavItems(), [registryVersion]);

  return (
    <nav class="app-bottomnav" aria-label={t('app.title')}>
      {items.map((item) => {
        const active =
          item.path === '/'
            ? path === '/'
            : path === item.path || path.startsWith(`${item.path}/`);
        return (
          <a
            key={item.path}
            href={item.path}
            class={active ? 'app-bottomnav__item is-active' : 'app-bottomnav__item'}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={item.icon as IconName} size={22} />
            <Text as="span" class="app-bottomnav__label">{t(item.labelKey)}</Text>
          </a>
        );
      })}
    </nav>
  );
}
