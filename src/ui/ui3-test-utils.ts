import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/preact';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';

type Additions = Record<Locale, Record<string, unknown>>;

const loaders = import.meta.glob<Additions>('./i18n-additions/ui3.json', {
  import: 'default',
});

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

export async function loadUi3Messages(): Promise<Additions> {
  const loader = loaders['./i18n-additions/ui3.json'];
  if (!loader) throw new Error('Missing ui3.json fixture.');
  return loader();
}

/** 測試使用真實 t/useT，只替換字典來源；不模擬翻譯函式。 */
export function setupUi3Tests(): void {
  beforeEach(async () => {
    const additions = await loadUi3Messages();
    _setDictLoaderForTest(async (locale) => flattenMessages(additions[locale]));
    await setLocale('zh-TW');
  });

  afterEach(() => {
    cleanup();
    _setDictLoaderForTest(null);
  });
}
