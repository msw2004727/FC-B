import type { JSX } from 'preact';
import { Text } from '@/ui/Text';
import { getCurrentLocale, useT } from '@/i18n/i18n';
import { useTheme } from '@/core/theme';

export default function HomePage(): JSX.Element {
  const t = useT();
  const locale = getCurrentLocale();
  const theme = useTheme();
  return (
    <section class="home-page">
      <Text as="h1">{t('home.title')}</Text>
      <Text as="p">{t('home.demo')}</Text>
      <Text as="p" class="home-page__meta">
        {t('home.meta', { locale, theme: t(`theme.${theme}`) })}
      </Text>
    </section>
  );
}
