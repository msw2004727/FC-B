// 安裝教學彈窗的翻譯（站長 2026-11-25 要求七語）：字典放 `locales-lazy/`，七語都跟著教學彈窗分塊一起到，不進首頁主程式。
// 不拆成每語一個分塊：每多一個分塊，首頁入口的分塊對照表就多一筆檔名（入口預算只剩幾百位元組）；七語合計約 2 KB gzip，只在打開教學時下載。
// 7 語系一致性由 scripts/check-i18n.mjs 檢查（namespace「pwa:lazy」）。
import { getCurrentLocale, useT } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import en from './locales-lazy/en.json';
import ja from './locales-lazy/ja.json';
import ko from './locales-lazy/ko.json';
import th from './locales-lazy/th.json';
import vi from './locales-lazy/vi.json';
import zhCN from './locales-lazy/zh-CN.json';
import zhTW from './locales-lazy/zh-TW.json';

type Dict = Record<string, string>;
export type GuideT = (key: string, params?: Record<string, string | number>) => string;

const DICTS: Record<Locale, Dict> = { 'zh-TW': zhTW, 'zh-CN': zhCN, en, ja, ko, th, vi };

export function makeGuideT(dict: Dict): GuideT {
  return (key, params) => {
    let s = dict[key] ?? (zhTW as Dict)[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}

/** 跟著目前語系；切換語系時重畫（useT 訂閱語系變化）。 */
export function useGuideT(): GuideT {
  useT();
  return makeGuideT(DICTS[getCurrentLocale()] ?? zhTW);
}
