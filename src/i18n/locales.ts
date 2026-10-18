export const LOCALES = ['zh-TW', 'zh-CN', 'en', 'ja', 'vi', 'th', 'ko'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh-TW';

/** 各語系以「該語言本身」書寫的顯示名稱。 */
export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  en: 'English',
  ja: '日本語',
  vi: 'Tiếng Việt',
  th: 'ไทย',
  ko: '한국어',
};
