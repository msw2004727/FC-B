import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/preact';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';

/** 使用正式核心及功能字典，不再載入待整合的 additions。 */
export function installUi4TestLocale(): void {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
  });

  afterEach(() => {
    cleanup();
    _setDictLoaderForTest(null);
  });
}
