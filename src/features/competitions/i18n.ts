// 賽事畫面的翻譯：字典放 locales-lazy/，跟著賽事頁或站內賽事區按需載入，不進首頁主程式
// （i18n.ts 會把每個功能 locales/zh-TW.json 直接打包進主程式。賽事文案約 7.8 KB，不能放進去）。
// locales/ 只留空物件：有 index.ts 的功能必須有 7 語檔，但空物件沒有文案，開關關閉時入口包不含賽事句子。
// 7 語系一致性由 scripts/check-i18n.mjs 一併檢查（namespace「competitions:lazy」）。
import { useEffect, useMemo, useState } from 'preact/hooks';
import { getCurrentLocale, useT } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';

type Dict = Record<string, string>;
export type CompetitionsT = (key: string, params?: Record<string, string | number>) => string;

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

export function loadCompetitionsDict(locale: Locale): Promise<Dict> {
  const cached = cache.get(locale);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(locale);
  if (existing) return existing;
  const loader = loaders[`./locales-lazy/${locale}.json`] ?? loaders['./locales-lazy/zh-TW.json'];
  if (!loader) return Promise.reject(new Error(`[competitions-i18n] 缺字典：${locale}`));
  const p = loader()
    .then((data) => {
      const dict = flatten(data);
      cache.set(locale, dict);
      return dict;
    })
    .finally(() => {
      // 成功、失敗都清掉，失敗才能重試。
      inflight.delete(locale);
    });
  inflight.set(locale, p);
  return p;
}

function lookup(dict: Dict, key: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  // reasonText 仍傳 competitions.reason.*（與 cpReasonKey 相同）。字典本身不加功能前綴。
  if (key.startsWith('competitions.')) {
    const bare = key.slice('competitions.'.length);
    if (Object.prototype.hasOwnProperty.call(dict, bare)) return dict[bare];
  }
  return undefined;
}

export function makeCompetitionsT(dict: Dict): CompetitionsT {
  return (key, params) => {
    const raw = lookup(dict, key);
    if (raw === undefined) return key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
      const v = params[name];
      return v !== undefined && v !== null ? String(v) : match;
    });
  };
}

export interface CompetitionsTState {
  ct: CompetitionsT | null;
  failed: boolean;
  retry: () => void;
}

/** 字典未到時回傳鍵名，讓閘門之前的型別仍是 CompetitionsT。畫面應在 ct 為 null 時先顯示等待。 */
export function ctOrKey(state: CompetitionsTState): CompetitionsT {
  return state.ct ?? ((key) => key);
}

/** 依目前語系載入賽事字典；切換語系時重載，載入失敗保留上一份並可重試。 */
export function useCompetitionsT(): CompetitionsTState {
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
    loadCompetitionsDict(locale)
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

  const ct = useMemo(() => (state ? makeCompetitionsT(state.dict) : null), [state]);
  return { ct, failed: failed && !state, retry: () => setAttempt((n) => n + 1) };
}

/** 測試用：清掉字典快取。 */
export function _resetCompetitionsDictForTest(): void {
  cache.clear();
  inflight.clear();
}
