// 課程畫面的翻譯：字典放 locales-lazy/，跟著課程程式按需載入，不進首頁主程式
// （i18n.ts 會把每個功能 locales/zh-TW.json 直接打包進主程式，主程式 gzip 上限 60KB，課程字串放不下）。
// 7 語系一致性由 scripts/check-i18n.mjs 一併檢查（namespace「education:lazy」）。
import { useEffect, useMemo, useState } from 'preact/hooks';
import { getCurrentLocale, useT } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';

type Dict = Record<string, string>;
export type CourseT = (key: string, params?: Record<string, string | number>) => string;

const loaders = import.meta.glob<Record<string, unknown>>('./locales-lazy/*.json', { import: 'default' });
const cache = new Map<Locale, Dict>();
const inflight = new Map<Locale, Promise<Dict>>();

function flatten(obj: Record<string, unknown>, prefix = '', out: Dict = {}): Dict {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else out[key] = String(v);
  }
  return out;
}

export function loadCourseDict(locale: Locale): Promise<Dict> {
  const cached = cache.get(locale);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(locale);
  if (existing) return existing;
  const loader = loaders[`./locales-lazy/${locale}.json`] ?? loaders['./locales-lazy/zh-TW.json'];
  if (!loader) return Promise.reject(new Error(`[course-i18n] 缺字典：${locale}`));
  const p = loader()
    .then((data) => {
      const dict = flatten(data);
      cache.set(locale, dict);
      return dict;
    })
    .finally(() => {
      // L-08：成功、失敗都清掉，失敗才能重試。
      inflight.delete(locale);
    });
  inflight.set(locale, p);
  return p;
}

export function makeCourseT(dict: Dict): CourseT {
  return (key, params) => {
    const raw = dict[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
      const v = params[name];
      return v !== undefined && v !== null ? String(v) : match;
    });
  };
}

export interface CourseTState {
  ct: CourseT | null;
  failed: boolean;
  retry: () => void;
}

/** 依目前語系載入課程字典；切換語系時重載，載入失敗保留上一份（L-09）並可重試。 */
export function useCourseT(): CourseTState {
  useT();
  const locale = getCurrentLocale();
  const [state, setState] = useState<{ locale: Locale; dict: Dict } | null>(() => {
    const dict = cache.get(locale);
    return dict ? { locale, dict } : null;
  });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (state?.locale === locale) return undefined;
    let alive = true;
    setFailed(false);
    loadCourseDict(locale)
      .then((dict) => {
        if (alive) setState({ locale, dict });
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
    // state 只用來判斷是否已是目前語系；不列入相依避免重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, attempt]);

  const ct = useMemo(() => (state ? makeCourseT(state.dict) : null), [state]);
  return { ct, failed: failed && !state, retry: () => setAttempt((n) => n + 1) };
}

/** 測試用：清掉字典快取。 */
export function _resetCourseDictForTest(): void {
  cache.clear();
  inflight.clear();
}
