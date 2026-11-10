// 頁面文字跟著 chunk 延遲載入。規則同 check:i18n：7 語系 key 一致、值非空、插值參數一致。
// 新文字同時放 locales/*.json（check:i18n）與 ops-strings.ts（頁面實際讀這份）。
import { afterAll, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import { LOCALES, type Locale } from '@/i18n/locales';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import th from './locales/th.json';
import vi from './locales/vi.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import { OPS_STRINGS, opsT, type OpsStringKey } from './ops-strings';

const LOCALE_FILES: Record<Locale, Record<string, string>> = {
  'zh-TW': zhTW,
  'zh-CN': zhCN,
  en,
  ja,
  vi,
  th,
  ko,
};

const PAGE_KEYS = [
  'kpi.active', 'kpi.new', 'kpi.held', 'kpi.regs', 'kpi.attend', 'kpi.noshow',
  'shareOf', 'totalUsers', 'openNow', 'perEvent', 'countedN', 'noshowN',
  'flat', 'deltaPoints', 'attnLow', 'attnStuck', 'attnCost', 'attnHost',
  'attnLine', 'attnReconcile', 'attnDays', 'moreEvents', 'moreItems', 'hostFallback',
  'active7', 'active30',
  'rankEvents', 'rankHosts', 'rankHostVal', 'costMtd', 'costProjected', 'costPrev', 'noDay',
] as const satisfies readonly OpsStringKey[];

const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('ops-strings', () => {
  it('7 語系 key 集合與 zh-TW 相同、值非空、插值參數一致', () => {
    const base = OPS_STRINGS['zh-TW'];
    for (const locale of LOCALES) {
      const dict = OPS_STRINGS[locale];
      expect(Object.keys(dict).sort()).toEqual(Object.keys(base).sort());
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), `${locale}.${key}`).not.toBe('');
        expect(params(value), `${locale}.${key}`).toEqual(params(base[key as keyof typeof base]));
      }
    }
  });

  it('新文字與 locales/*.json 逐字相同，且沒有手動斷行', () => {
    for (const locale of LOCALES) {
      const file = LOCALE_FILES[locale];
      for (const key of PAGE_KEYS) {
        expect(file[key], `${locale}.${key}`).toBe(OPS_STRINGS[locale][key]);
        expect(OPS_STRINGS[locale][key].includes('\n'), `${locale}.${key}`).toBe(false);
      }
    }
  });

  it('跟著全站語系切換', async () => {
    await setLocale('en');
    expect(opsT('times', { count: 3 })).toBe('3×');
    await setLocale('zh-TW');
    expect(opsT('times', { count: 3 })).toBe('3 次');
  });

  afterAll(async () => {
    await setLocale('zh-TW');
  });
});
