import { useEffect, useState } from 'preact/hooks';

import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import th from './locales/th.json';
import vi from './locales/vi.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';

const dictionaries = {
  en,
  ja,
  ko,
  th,
  vi,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};

export type CheckinTextKey = keyof typeof en;
type Locale = keyof typeof dictionaries;

function currentLocale(): Locale {
  // ASSUMPTION: 未提供共用 i18n hook；採用已提交的 html lang，
  // 不自行改動使用者語系或字典。字典只隨 /checkin chunk 載入。
  const parts = document.documentElement.lang.toLowerCase().split('-');
  const language = parts[0];

  if (language === 'zh') {
    const relevant: string[] = [];
    for (const part of parts.slice(1)) {
      if (part.length === 1) break;
      relevant.push(part);
    }
    if (relevant.includes('hant')) return 'zh-TW';
    if (relevant.includes('hans')) return 'zh-CN';
    return relevant.some((part) => ['tw', 'hk', 'mo'].includes(part))
      ? 'zh-TW'
      : 'zh-CN';
  }

  if (
    language === 'en' || language === 'ja' || language === 'ko'
    || language === 'th' || language === 'vi'
  ) {
    return language;
  }
  return 'zh-TW';
}

export function useCheckinText(): (key: CheckinTextKey) => string {
  const [locale, setLocale] = useState<Locale>(currentLocale);

  useEffect(() => {
    const update = (): void => setLocale(currentLocale());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['lang'],
    });
    update();
    return () => observer.disconnect();
  }, []);

  return (key) => dictionaries[locale][key];
}
