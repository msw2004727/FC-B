import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/i18n/locales';
import { loadCompetitionsDict, makeCompetitionsT } from './i18n';

describe('賽事按需字典', () => {
  it('7 語系都載得到、key 一致；插值照 {name}', async () => {
    const base = Object.keys(await loadCompetitionsDict('zh-TW')).sort();
    expect(base.length).toBeGreaterThan(10);
    for (const locale of LOCALES) {
      const dict = await loadCompetitionsDict(locale);
      expect(Object.keys(dict).sort(), locale).toEqual(base);
    }
    const ct = makeCompetitionsT(await loadCompetitionsDict('zh-TW'));
    expect(ct('needMore', { n: 2, min: 7 })).toBe('還需 2 人才能確認（最少 7 人）');
    expect(ct('reason.UNKNOWN')).toBe('操作失敗，請稍後再試');
    expect(ct('competitions.reason.UNKNOWN')).toBe('操作失敗，請稍後再試');
    expect(ct('no.such.key')).toBe('no.such.key');
  });

  it('eager 的 locales 是空物件，文案只在 locales-lazy', () => {
    for (const locale of LOCALES) {
      const eager = JSON.parse(readFileSync(resolve(__dirname, `locales/${locale}.json`), 'utf8')) as unknown;
      expect(eager, locale).toEqual({});
    }
    const lazy = readFileSync(resolve(__dirname, 'locales-lazy/zh-TW.json'), 'utf8');
    expect(lazy).toContain('站內賽事');
    expect(lazy).not.toContain('官方');
  });
});
