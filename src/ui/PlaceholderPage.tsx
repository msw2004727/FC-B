import { Text } from './Text';
import { useT } from '@/i18n/i18n';

export interface PlaceholderPageProps {
  titleKey: string;
}

/** 尚未實作的功能頁佔位。 */
export function PlaceholderPage({ titleKey }: PlaceholderPageProps): preact.JSX.Element {
  const t = useT();
  return (
    <section class="placeholder-page">
      <Text as="h1">{t(titleKey)}</Text>
      <Text as="p" class="placeholder-page__hint">{t('feature.reserved')}</Text>
    </section>
  );
}
