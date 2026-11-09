import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/i18n/locales';
import { loadCourseDict, makeCourseT } from './i18n';

describe('課程按需字典', () => {
  it('7 語系都載得到、key 一致；插值照 {name}', async () => {
    const base = Object.keys(await loadCourseDict('zh-TW')).sort();
    for (const locale of LOCALES) {
      const dict = await loadCourseDict(locale);
      expect(Object.keys(dict).sort()).toEqual(base);
    }
    const ct = makeCourseT(await loadCourseDict('zh-TW'));
    expect(ct('fmt.count', { count: 12, max: 16 })).toBe('12/16 人');
    expect(ct('err.COURSE_FULL')).toBe('名額已滿');
    expect(ct('no.such.key')).toBe('no.such.key');
  });
});
