export const LOCALES = ['zh-TW', 'zh-CN', 'en', 'ja', 'vi', 'th', 'ko'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh-TW';

/**
 * 側邊抽屜語言選單的 6 種語言與順序（照 A `js/i18n.js`；站長決定拿掉简体中文選項，保留 zh-CN 字典）。
 */
export const DRAWER_LOCALES: readonly Locale[] = [
  'zh-TW',
  'en',
  'ja',
  'ko',
  'th',
  'vi',
] as const;

/** 各語系顯示名稱（照 A `js/i18n.js` `_label` 國旗＋名稱）。 */
export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-TW': '🇹🇼 繁中',
  'zh-CN': '简体中文',
  en: '🇺🇸 EN',
  ja: '🇯🇵 日本語',
  ko: '🇰🇷 한국어',
  th: '🇹🇭 ไทย',
  vi: '🇻🇳 Tiếng Việt',
};
