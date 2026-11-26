import { useEffect, useMemo, useState } from 'preact/hooks';
import { getCurrentLocale, useT } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import { getSportOption } from '@/features/events/data/sports';
import zhTW from './locales-lazy/zh-TW.json';

type Dict = Record<string, string>;
export type SportPrefsT = (key: string, params?: Record<string, string | number>) => string;

const loaders = import.meta.glob<Record<string, unknown>>(
  ['./locales-lazy/*.json', '!./locales-lazy/zh-TW.json'],
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

export function loadSportPrefsDict(locale: Locale): Promise<Dict> {
  const cached = cache.get(locale);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(locale);
  if (existing) return existing;
  const loader = loaders[`./locales-lazy/${locale}.json`];
  if (!loader) return Promise.resolve(ZH_TW);
  const p = loader()
    .then((data) => {
      const dict = flatten(data as Record<string, unknown>);
      cache.set(locale, dict);
      return dict;
    })
    .finally(() => {
      inflight.delete(locale);
    });
  inflight.set(locale, p);
  return p;
}

export function makeSportPrefsT(dict: Dict): SportPrefsT {
  return (key, params) => {
    const raw = dict[key] ?? ZH_TW[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (m: string, name: string) => {
      const v = params[name];
      return v === undefined ? m : String(v);
    });
  };
}

export function useSportPrefsT(): SportPrefsT {
  useT();
  const locale = getCurrentLocale();
  const [state, setState] = useState<{ locale: Locale; dict: Dict } | null>(() => {
    const cached = cache.get(locale);
    return cached ? { locale, dict: cached } : null;
  });

  useEffect(() => {
    if (state?.locale === locale) return undefined;
    const cached = cache.get(locale);
    if (cached) {
      setState({ locale, dict: cached });
      return undefined;
    }
    let alive = true;
    loadSportPrefsDict(locale)
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

  return useMemo(() => makeSportPrefsT(state?.dict ?? ZH_TW), [state]);
}

export function sportName(t: SportPrefsT, key: string): string {
  const translated = t(`sport.${key}`);
  if (translated === `sport.${key}`) return getSportOption(key)?.label ?? key;
  return translated;
}

export function _resetSportPrefsDictForTest(): void {
  cache.clear();
  cache.set('zh-TW', ZH_TW);
  inflight.clear();
}
