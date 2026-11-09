// 頁面文字跟著 chunk 延遲載入（不進首頁主程式），規則同 check:i18n：7 語系 key 一致、值非空、插值參數一致。
import { afterAll, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import { LOCALES } from '@/i18n/locales';
import { OPS_STRINGS, opsT } from './ops-strings';

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
