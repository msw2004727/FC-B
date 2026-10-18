import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/preact';
import {
  _setDictLoaderForTest,
  setLocale,
} from '@/i18n/i18n';
import additions from './i18n-additions/ui4.json';

/**
 * additions 是待整合字典，不由目前正式 i18n loader 自動載入。
 * 測試載入真實新增文案，避免以「回傳 key」假裝翻譯通過。
 */
function flatten(
  value: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === 'string') result[path] = item;
    else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      Object.assign(result, flatten(item as Record<string, unknown>, path));
    }
  }
  return result;
}

export function installUi4TestLocale(): void {
  beforeEach(async () => {
    _setDictLoaderForTest(async (locale) => flatten(additions[locale]));
    await setLocale('zh-TW');
  });

  afterEach(() => {
    cleanup();
    _setDictLoaderForTest(null);
  });
}
