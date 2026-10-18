import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import zhTW from '@/i18n/messages/zh-TW.json';
import zhCN from '@/i18n/messages/zh-CN.json';
import en from '@/i18n/messages/en.json';
import ja from '@/i18n/messages/ja.json';
import vi from '@/i18n/messages/vi.json';
import th from '@/i18n/messages/th.json';
import ko from '@/i18n/messages/ko.json';

const dictionaries: Record<Locale, Record<string, unknown>> = {
  'zh-TW': zhTW,
  'zh-CN': zhCN,
  en,
  ja,
  vi,
  th,
  ko,
};

export function flattenMessages(
  value: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      result[path] = child;
    } else if (child && typeof child === 'object' && !Array.isArray(child)) {
      Object.assign(result, flattenMessages(child as Record<string, unknown>, path));
    }
  }
  return result;
}

export function shellDictionary(locale: Locale): Record<string, string> {
  return {
    ...flattenMessages(dictionaries[locale]),
    // 僅供 registry 測試的虛構 route；正式 UI 文案全部來自正式字典。
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
