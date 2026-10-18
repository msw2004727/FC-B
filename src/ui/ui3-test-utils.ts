import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/preact';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { LOCALES, type Locale } from '@/i18n/locales';

type Messages = Record<Locale, Record<string, unknown>>;

const loaders = import.meta.glob<Record<string, unknown>>(
  '../i18n/messages/*.json',
  { import: 'default' },
);

export function flattenMessages(
  source: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenMessages(value as Record<string, unknown>, path));
    } else if (typeof value === 'string') {
      result[path] = value;
    }
  }
  return result;
}

/** 保留既有測試 API，來源改為七語正式核心字典。 */
export async function loadUi3Messages(): Promise<Messages> {
  const entries = await Promise.all(LOCALES.map(async (locale) => {
    const loader = loaders[`../i18n/messages/${locale}.json`];
    if (!loader) throw new Error(`Missing official dictionary: ${locale}`);
    return [locale, await loader()] as const;
  }));
  return Object.fromEntries(entries) as Messages;
}

export function setupUi3Tests(): void {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
  });

  afterEach(() => {
    cleanup();
    _setDictLoaderForTest(null);
  });
}
