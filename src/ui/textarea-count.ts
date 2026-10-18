import type { Locale } from '@/i18n/locales';

const segmenters = new Map<Locale, Intl.Segmenter>();

/**
 * CJK 用 Unicode code point；en/vi/th 用詞。
 * 上限是語意計數上限，不冒充原生 UTF-16 maxlength。
 */
export function countTextarea(value: string, locale: Locale): number {
  if (/^(zh|ja|ko)(-|$)/u.test(locale)) return Array.from(value).length;
  if (!value.trim()) return 0;

  if (typeof Intl.Segmenter === 'function') {
    let segmenter = segmenters.get(locale);
    if (!segmenter) {
      segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
      segmenters.set(locale, segmenter);
    }
    let count = 0;
    for (const segment of segmenter.segment(value)) {
      if (segment.isWordLike) count += 1;
    }
    return count;
  }

  // 舊引擎降級：空白分詞；泰文無空白時退回 code point。
  return locale === 'th'
    ? Array.from(value.trim()).length
    : value.trim().split(/\s+/u).length;
}
