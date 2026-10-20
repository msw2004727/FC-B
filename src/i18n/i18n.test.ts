import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _setDictLoaderForTest,
  getCurrentLocale,
  resolveLocale,
  setLocale,
  t,
} from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';

beforeEach(async () => {
  localStorage.clear();
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(() => {
  _setDictLoaderForTest(null);
  localStorage.clear();
});

describe('i18n', () => {
  describe('resolveLocale', () => {
    it('依 BCP 47 子標籤解析語系', () => {
      expect(resolveLocale(['zh-Hant-TW', 'en'])).toBe('zh-TW');
      expect(resolveLocale(['zh-Hans-CN'])).toBe('zh-CN');
      expect(resolveLocale(['zh-Hans-SG'])).toBe('zh-CN');
      expect(resolveLocale(['ZH-hk'])).toBe('zh-TW');
      expect(resolveLocale(['zh'])).toBe('zh-TW');
      expect(resolveLocale(['xx', 'ja-JP'])).toBe('ja');
      expect(resolveLocale(['fr-FR'])).toBe('zh-TW');
    });

    it('保留既有對應表行為', () => {
      expect(resolveLocale(['zh-Hant'])).toBe('zh-TW');
      expect(resolveLocale(['zh-HK'])).toBe('zh-TW');
      expect(resolveLocale(['zh-Hans'])).toBe('zh-CN');
      expect(resolveLocale(['zh-CN'])).toBe('zh-CN');
      expect(resolveLocale(['ja-JP'])).toBe('ja');
      expect(resolveLocale(['vi'])).toBe('vi');
      expect(resolveLocale(['th-TH'])).toBe('th');
      expect(resolveLocale(['ko-KR'])).toBe('ko');
      expect(resolveLocale(['en-US'])).toBe('en');
      expect(resolveLocale([])).toBe('zh-TW');
      expect(resolveLocale(['fr', 'ja'])).toBe('ja');
    });
  });

  describe('t', () => {
    it('字典載入後可以插值、處理複數，缺 key 時回傳 key 本身', async () => {
      await setLocale('en');

      expect(t('common.loading')).toBe('Loading…');

      expect(t('common.count', { count: 1 })).toBe('1 item');
      expect(t('common.count', { count: 2 })).toBe('2 items');

      expect(t('missing.key')).toBe('missing.key');
    });
  });

  describe('競態與失敗', () => {
    it('較舊請求晚完成時不覆蓋最新語系', async () => {
      type Deferred = {
        resolve: (dict: Record<string, string>) => void;
        reject: (error: unknown) => void;
      };
      const pending = new Map<Locale, Deferred>();

      _setDictLoaderForTest(
        (locale) =>
          new Promise<Record<string, string>>((resolve, reject) => {
            pending.set(locale, { resolve, reject });
          }),
      );

      const enPromise = setLocale('en');
      const jaPromise = setLocale('ja');

      const jaDeferred = pending.get('ja');
      const enDeferred = pending.get('en');
      expect(jaDeferred).toBeDefined();
      expect(enDeferred).toBeDefined();

      jaDeferred!.resolve({
        'app.title': 'JA',
        'locale.loadFailed': 'ja failed',
        'common.error': 'ja error',
        'notFound.home': 'ja home',
      });
      await jaPromise;

      enDeferred!.resolve({
        'app.title': 'EN',
        'locale.loadFailed': 'en failed',
        'common.error': 'en error',
        'notFound.home': 'en home',
      });
      await enPromise;

      expect(getCurrentLocale()).toBe('ja');
      expect(document.documentElement.lang).toBe('ja');
      expect(t('app.title')).toBe('JA');
    });

    it('loader 第一次 reject、第二次成功時會重新呼叫', async () => {
      let calls = 0;
      _setDictLoaderForTest(() => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve({
          'app.title': 'EN',
          'locale.loadFailed': 'en failed',
          'common.error': 'en error',
          'notFound.home': 'en home',
        });
      });

      await expect(setLocale('en')).rejects.toThrow('boom');
      expect(getCurrentLocale()).toBe('zh-TW');
      expect(document.documentElement.lang).toBe('zh-TW');

      await setLocale('en');
      expect(calls).toBe(2);
      expect(getCurrentLocale()).toBe('en');
      expect(t('app.title')).toBe('EN');
    });
  });
});

describe('resolveLocale：extension／private-use 子標籤', () => {
  it('不把 -u- extension 內的 hans 當成 script', () => {
    expect(resolveLocale(['zh-u-nu-hans'])).toBe('zh-TW');
    expect(resolveLocale(['zh-x-hans'])).toBe('zh-TW');
    expect(resolveLocale(['zh-Hans-u-nu-latn'])).toBe('zh-CN');
  });
});

describe('預設語系字典打包方式', () => {
  it('i18n.ts 以字面字串 eager 打包 zh-TW，DEFAULT_LOCALE 必須仍是 zh-TW', async () => {
    const { DEFAULT_LOCALE } = await import('./locales');
    expect(DEFAULT_LOCALE).toBe('zh-TW');
  });
});
