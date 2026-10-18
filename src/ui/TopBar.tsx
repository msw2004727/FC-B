import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { useT, getCurrentLocale, setLocale } from '@/i18n/i18n';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/locales';
import { useTheme } from '@/core/theme';
import { setTheme, type ThemeMode } from '@/core/theme';
import { on } from '@/core/events';

function nextTheme(mode: ThemeMode): ThemeMode {
  if (mode === 'light') return 'dark';
  if (mode === 'dark') return 'system';
  return 'light';
}

function themeIcon(mode: ThemeMode): IconName {
  if (mode === 'light') return 'sun';
  if (mode === 'dark') return 'moon';
  return 'globe';
}

export function TopBar(): preact.JSX.Element {
  const t = useT();
  const theme = useTheme();
  const [locale, setLocaleState] = useState<Locale>(getCurrentLocale());
  const [loadError, setLoadError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const offLocale = on('locale:changed', ({ locale: next }) => setLocaleState(next));
    return () => {
      offLocale();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (errorTimer.current !== null) {
        clearTimeout(errorTimer.current);
        errorTimer.current = null;
      }
    };
  }, []);

  const showLoadError = (message: string): void => {
    setLoadError(message);
    if (errorTimer.current !== null) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => {
      setLoadError(null);
      errorTimer.current = null;
    }, 3000);
  };

  const handleLocale = async (e: Event): Promise<void> => {
    const select = e.currentTarget as HTMLSelectElement;
    const next = select.value as Locale;
    try {
      await setLocale(next);
    } catch {
      select.value = getCurrentLocale();
      showLoadError(t('locale.loadFailed'));
    }
  };

  return (
    <header class="app-topbar">
      <Text as="span" class="app-topbar__title">{t('app.title')}</Text>
      <div class="app-topbar__actions">
        <select
          class="app-topbar__select"
          aria-label={t('locale.label')}
          value={locale}
          onChange={handleLocale}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
        {loadError ? (
          <Text as="span" class="app-topbar__error">{loadError}</Text>
        ) : null}
        <button
          type="button"
          class="ui-icon-button"
          aria-label={t(`theme.${theme}`)}
          onClick={() => setTheme(nextTheme(theme))}
        >
          <Icon name={themeIcon(theme)} />
        </button>
      </div>
    </header>
  );
}
