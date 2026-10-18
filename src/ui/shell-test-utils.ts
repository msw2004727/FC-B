import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import additions from './i18n-additions/shell.json';

function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      Object.assign(result, flatten(child as Record<string, unknown>, path));
    } else {
      result[path] = String(child);
    }
  }
  return result;
}

export function shellDictionary(locale: Locale): Record<string, string> {
  return {
    ...flatten(additions[locale]),
    'app.title': 'ToosterX',
    'test.home': '首頁',
    'test.events': '活動',
    'test.teams': '俱樂部',
    'test.profile': '我的',
    'test.tournaments': '賽事',
    'manual.title': '使用手冊',
    'stats.title': '個人數據',
    'test.admin': '管理活動',
  };
}

export async function prepareShellLocale(): Promise<void> {
  _setDictLoaderForTest(async (locale) => shellDictionary(locale));
  await setLocale('zh-TW');
}
