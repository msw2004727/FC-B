import { useCallback, useEffect, useState } from 'preact/hooks';
import { emit, on } from '@/core/events';
import {
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
} from './locales';

// ── 字典來源 ─────────────────────────────────────────────
// 核心：src/i18n/messages/<locale>.json
// 功能：src/features/<id>/locales/<locale>.json（key 加上 `<featureId>.` 前綴）
// 預設語系 zh-TW 直接打包進主程式（eager），首屏不必另外下載字典；其他語系用非 eager 的 glob 依需要載入。
// （2026-10-20 Fable 定案，取代原本「全部語系都延遲載入＋HTML 預載 zh-TW」。glob 路徑必須是字面字串，
// 所以這裡寫死 zh-TW；DEFAULT_LOCALE 若改，這裡要一起改，i18n.test.ts 有檢查。）

type Loader<T> = () => Promise<T>;

function eagerAsLoaders<T>(mods: Record<string, T>): Record<string, Loader<T>> {
  return Object.fromEntries(
    Object.entries(mods).map(([path, data]) => [path, () => Promise.resolve(data)]),
  );
}

const coreLoaders: Record<string, Loader<Record<string, unknown>>> = {
  ...import.meta.glob<Record<string, unknown>>(['./messages/*.json', '!./messages/zh-TW.json'], {
    import: 'default',
  }),
  ...eagerAsLoaders(import.meta.glob<Record<string, unknown>>('./messages/zh-TW.json', {
    import: 'default',
    eager: true,
  })),
};

const featureLoaders: Record<string, Loader<Record<string, unknown>>> = {
  ...import.meta.glob<Record<string, unknown>>(
    ['../features/*/locales/*.json', '!../features/*/locales/zh-TW.json'],
    { import: 'default' },
  ),
  ...eagerAsLoaders(import.meta.glob<Record<string, unknown>>('../features/*/locales/zh-TW.json', {
    import: 'default',
    eager: true,
  })),
};

// 舊版 A 的翻譯包（scripts/import-legacy-i18n.mjs 生成），給改版頁面的 lt() 用；key 加上 `legacy:` 前綴。
const legacyLoaders: Record<string, Loader<Record<string, string>>> = {
  ...import.meta.glob<Record<string, string>>(['./legacy/*.json', '!./legacy/zh-TW.json'], {
    import: 'default',
  }),
  ...eagerAsLoaders(import.meta.glob<Record<string, string>>('./legacy/zh-TW.json', {
    import: 'default',
    eager: true,
  })),
};
const LEGACY_PREFIX = 'legacy:';

// ── 狀態 ────────────────────────────────────────────────

const STORAGE_KEY = 'toosterx:locale';
const dictCache = new Map<Locale, Record<string, string>>();
const inflight = new Map<Locale, Promise<Record<string, string>>>();
const warnedKeys = new Set<string>();
const subscribers = new Set<() => void>();

let currentLocale: Locale = DEFAULT_LOCALE;
let currentDict: Record<string, string> = {};
let pluralRulesCache: { locale: Locale; rules: Intl.PluralRules } | null = null;
let requestSeq = 0;

// ── 工具 ────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

function isDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

function notify(): void {
  for (const fn of Array.from(subscribers)) fn();
}

function readPref(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (LOCALES as readonly string[]).includes(v)) return v as Locale;
  } catch {
    /* 忽略 */
  }
  return null;
}

function writePref(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* 忽略 */
  }
}

function getPluralRules(locale: Locale): Intl.PluralRules {
  if (pluralRulesCache && pluralRulesCache.locale === locale) return pluralRulesCache.rules;
  const rules = new Intl.PluralRules(locale);
  pluralRulesCache = { locale, rules };
  return rules;
}

// ── 語系偵測 ────────────────────────────────────────────

/**
 * 依序解析 BCP 47 候選語系，回傳第一個可辨識的 Locale。
 *
 * 中文：script 為 Hant → zh-TW；Hans → zh-CN。
 * 無 script 時 region 為 TW／HK／MO → zh-TW，CN／SG／MY → zh-CN；
 * 裸 `zh` → zh-TW。其他語言取 language 與 LOCALES 比對。
 * 全部失敗回傳 DEFAULT_LOCALE。
 */
export function resolveLocale(candidates: string[]): Locale {
  for (const raw of candidates) {
    if (!raw) continue;
    const parts = raw.split('-').filter(Boolean);
    const language = (parts[0] ?? '').toLowerCase();
    if (!language) continue;

    let script: string | undefined;
    let region: string | undefined;
    for (const part of parts.slice(1)) {
      const lower = part.toLowerCase();
      // 遇到 extension／private-use 的單字元 singleton（如 -u-、-x-）就停止，避免把 zh-u-nu-hans 的 hans 誤當 script
      if (lower.length === 1) break;
      if (!script && /^[a-z]{4}$/.test(lower)) {
        script = lower;
      } else if (!region && (/^[a-z]{2}$/.test(lower) || /^\d{3}$/.test(lower))) {
        region = lower;
      }
    }

    if (language === 'zh') {
      if (script === 'hant') return 'zh-TW';
      if (script === 'hans') return 'zh-CN';
      if (region === 'tw' || region === 'hk' || region === 'mo') return 'zh-TW';
      if (region === 'cn' || region === 'sg' || region === 'my') return 'zh-CN';
      return 'zh-TW';
    }

    if ((LOCALES as readonly string[]).includes(language)) {
      return language as Locale;
    }
  }
  return DEFAULT_LOCALE;
}

// ── 字典載入 ────────────────────────────────────────────

async function loadDict(locale: Locale): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  // 核心、功能、舊版字典同時下載（原本等核心字典回來才開始下載其他，首屏多一段網路來回）。
  const coreKey = `./messages/${locale}.json`;
  const coreLoader = coreLoaders[coreKey];
  const corePromise = coreLoader ? coreLoader() : Promise.resolve(null);

  const re = new RegExp(`^\\.\\./features/([^/]+)/locales/${escapeRegex(locale)}\\.json$`);
  const tasks: Promise<void>[] = [];
  for (const [path, loader] of Object.entries(featureLoaders)) {
    const m = path.match(re);
    if (!m) continue;
    const featureId = m[1];
    if (!featureId) continue;
    tasks.push(
      loader().then((data) => {
        const flat = flatten(data);
        for (const [k, v] of Object.entries(flat)) {
          result[`${featureId}.${k}`] = v;
        }
      }),
    );
  }
  const legacyLoader = legacyLoaders[`./legacy/${locale}.json`];
  if (legacyLoader) {
    tasks.push(
      legacyLoader().then((data) => {
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === 'string') result[`${LEGACY_PREFIX}${k}`] = v;
        }
      }),
    );
  }
  const [coreData] = await Promise.all([corePromise, ...tasks]);

  // 核心字典放最前面，與原本「先放核心、再放功能與舊版」的合併結果相同。
  return coreData ? { ...flatten(coreData), ...result } : result;
}

type DictLoader = (locale: Locale) => Promise<Record<string, string>>;

let dictLoader: DictLoader = loadDict;

async function getDict(locale: Locale): Promise<Record<string, string>> {
  const cached = dictCache.get(locale);
  if (cached) return cached;

  const existing = inflight.get(locale);
  if (existing) return existing;

  const p = (async () => {
    try {
      const data = await dictLoader(locale);
      dictCache.set(locale, data);
      return data;
    } finally {
      inflight.delete(locale);
    }
  })();

  inflight.set(locale, p);
  return p;
}

/** 測試用：替換字典 loader；傳 null 恢復預設並清空快取／inflight。 */
export function _setDictLoaderForTest(loader: DictLoader | null): void {
  dictLoader = loader ?? loadDict;
  dictCache.clear();
  inflight.clear();
}

// ── 公開 API ────────────────────────────────────────────

export function getCurrentLocale(): Locale {
  return currentLocale;
}

/** 初始化語系：localStorage → navigator.languages 比對 → 預設 zh-TW。 */
export async function initLocale(): Promise<void> {
  const stored = readPref();
  const candidates: string[] = [];
  if (stored) candidates.push(stored);
  if (typeof navigator !== 'undefined' && Array.isArray(navigator.languages)) {
    candidates.push(...navigator.languages);
  }
  const locale = resolveLocale(candidates);
  await setLocaleInternal(locale, { persist: false });
}

/** 切換語系：載入字典、更新 lang、儲存偏好、觸發 locale:changed。 */
export async function setLocale(locale: Locale): Promise<void> {
  const committed = await setLocaleInternal(locale, { persist: true });
  if (committed) emit('locale:changed', { locale });
}

async function setLocaleInternal(locale: Locale, opts: { persist: boolean }): Promise<boolean> {
  const seq = ++requestSeq;
  const dict = await getDict(locale);

  // 已經有更新的請求：只保留 getDict 寫入的快取，不提交任何公開狀態。
  if (seq !== requestSeq) return false;

  currentLocale = locale;
  currentDict = dict;
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', locale);
  }
  if (opts.persist) writePref(locale);
  notify();
  return true;
}

// ── 翻譯 ────────────────────────────────────────────────

function interpolate(str: string, params: Record<string, string | number>): string {
  return str.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = params[name];
    return v !== undefined && v !== null ? String(v) : match;
  });
}

/**
 * 翻譯。缺 key 時：開發模式 console.warn 一次並回傳 key 本身。
 * params.count 存在時使用 Intl.PluralRules 選 key.one / key.other，找不到退回 key。
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let resolved = key;
  if (params && typeof params.count === 'number') {
    const cat = getPluralRules(currentLocale).select(params.count);
    const pluralKey = `${key}.${cat}`;
    if (currentDict[pluralKey] !== undefined) resolved = pluralKey;
  }
  const raw = currentDict[resolved];
  if (raw === undefined) {
    if (isDev() && !warnedKeys.has(key)) {
      warnedKeys.add(key);
      // eslint-disable-next-line no-console
      console.warn(`[i18n] missing key: ${key} (locale: ${currentLocale})`);
    }
    return key;
  }
  return params ? interpolate(raw, params) : raw;
}

/**
 * 改版頁面（照 A 的 DOM）用的翻譯：照 A `_applyStaticI18n`——以 data-i18n 的 key（中文原文或語意 key）
 * 查 A 的翻譯包，查不到就用原文（fallback；沒給時用 key）。簡體中文 A 沒有翻譯包，會顯示原文。
 */
export function lt(key: string, fallback?: string, params?: Record<string, string | number>): string {
  const raw = currentDict[`${LEGACY_PREFIX}${key}`] ?? fallback ?? key;
  return params ? interpolate(raw, params) : raw;
}

/** 同 useT，回傳 lt；語系切換時重新 render。 */
export function useLegacyT(): typeof lt {
  useT();
  return useCallback(lt, []);
}

/** 訂閱語系切換；回傳的 t 為穩定函式，元件會在語系變更時重新 render。 */
export function useT(): typeof t {
  const [, force] = useState(0);
  useEffect(() => {
    const cb = (): void => force((n) => n + 1);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }, []);
  return useCallback(t, []);
}

// ── 格式化 ──────────────────────────────────────────────

export function formatDate(date: Date | number, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(currentLocale, opts).format(date);
}

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLocale, opts).format(n);
}

// 保留對 events 的引用，避免 tree-shaking 拔掉（on 未在此檔使用）
void on;
