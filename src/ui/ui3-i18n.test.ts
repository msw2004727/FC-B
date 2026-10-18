import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/i18n/locales';
import { flattenMessages, loadUi3Messages } from './ui3-test-utils';

describe('ui3 translations', () => {
  it('has identical keys and interpolation parameters across seven locales', async () => {
    const source = await loadUi3Messages();
    const reference = flattenMessages(source['zh-TW']);
    const keys = Object.keys(reference).sort();

    for (const locale of LOCALES) {
      const messages = flattenMessages(source[locale]);
      expect(Object.keys(messages).sort()).toEqual(keys);
      for (const key of keys) {
        const message = messages[key];
        const original = reference[key];
        expect(typeof message).toBe('string');
        expect(message?.trim().length).toBeGreaterThan(0);
        expect(message?.match(/\{\w+\}/gu)?.sort() ?? [])
          .toEqual(original?.match(/\{\w+\}/gu)?.sort() ?? []);
      }
    }
  });
});
