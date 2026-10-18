import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import additions from './i18n-additions/ui2.json';

function flatten(
  value: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof entry === 'string') {
      result[key] = entry;
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      Object.assign(result, flatten(entry as Record<string, unknown>, key));
    }
  }
  return result;
}

/** 使用交付的真實翻譯資料與真實 t / useT，不 mock 翻譯函式。 */
export async function prepareUi2Locale(): Promise<void> {
  _setDictLoaderForTest(async (locale) => flatten(additions[locale]));
  await setLocale('zh-TW');
}

export function resetUi2Locale(): void {
  _setDictLoaderForTest(null);
}
