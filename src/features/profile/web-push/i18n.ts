// 推播列的翻譯：字典放 `src/features/profile/locales-lazy/`，跟著推播列分塊按需載入，不進首頁主程式。
// 繁中跟著本模組一起到（不閃鍵名）；其他語系按需載入，載入失敗保留上一份、沒有上一份就退回繁中（L-08、L-09）。
// 7 語系一致性由 scripts/check-i18n.mjs 一併檢查（namespace「profile:lazy」）。
import { useEffect, useMemo, useState } from 'preact/hooks';
import { getCurrentLocale, useT } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import zhTW from '../locales-lazy/zh-TW.json';

type Dict = Record<string, string>;
export type WebPushT = (key: string) => string;

const loaders = import.meta.glob<Record<string, unknown>>(
  ['../locales-lazy/*.json', '!../locales-lazy/zh-TW.json'],
  { import: 'default' },
);

function flatten(obj: Record<string, unknown>, prefix = '', out: Dict = {}): Dict {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else out[key] = String(v);
  }
  return out;
}

const ZH_TW: Dict = flatten(zhTW as Record<string, unknown>);
const cache = new Map<Locale, Dict>([['zh-TW', ZH_TW]]);
const inflight = new Map<Locale, Promise<Dict>>();

export function loadWebPushDict(locale: Locale): Promise<Dict> {
  const cached = cache.get(locale);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(locale);
  if (existing) return existing;
  const loader = loaders[`../locales-lazy/${locale}.json`];
  if (!loader) return Promise.resolve(ZH_TW);
  const p = loader()
    .then((data) => {
      const dict = flatten(data);
      cache.set(locale, dict);
      return dict;
    })
    .finally(() => {
      inflight.delete(locale);
    });
  inflight.set(locale, p);
  return p;
}

export function makeWebPushT(dict: Dict): WebPushT {
  return (key) => dict[key] ?? ZH_TW[key] ?? key;
}

/** null＝字典還沒到（第一次載入外語），畫面先保留等高空白。 */
export function useWebPushT(): WebPushT | null {
  useT();
  const locale = getCurrentLocale();
  const [state, setState] = useState<{ locale: Locale; dict: Dict } | null>(() => {
    const dict = cache.get(locale);
    return dict ? { locale, dict } : null;
  });

  useEffect(() => {
    if (state?.locale === locale) return undefined;
    const cached = cache.get(locale);
    if (cached) {
      setState({ locale, dict: cached });
      return undefined;
    }
    let alive = true;
    loadWebPushDict(locale)
      .then((dict) => {
        if (alive) setState({ locale, dict });
      })
      .catch(() => {
        // 保留上一份；沒有上一份就退回繁中。
        if (alive) setState((prev) => prev ?? { locale, dict: ZH_TW });
      });
    return () => {
      alive = false;
    };
    // state 只用來判斷是否已是目前語系；不列入相依避免重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  return useMemo(() => (state ? makeWebPushT(state.dict) : null), [state]);
}

/** 測試用：清掉外語快取。 */
export function _resetWebPushDictForTest(): void {
  cache.clear();
  cache.set('zh-TW', ZH_TW);
  inflight.clear();
}
