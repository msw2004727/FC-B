import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALES } from '@/i18n/locales';
import {
  isLegacyCacheName,
  isLegacyCollectionStorageKey,
  legacyLangToStoredLocale,
  runLegacyMigrationOnce,
} from './legacy-migration';

const FLAG = 'fcb:legacy-migrated:v1';
const LOCALE_KEY = 'toosterx:locale';
const LANG_KEY = 'sporthub_lang';

function stubCaches(cacheStorage: Pick<CacheStorage, 'keys' | 'delete'>): void {
  vi.stubGlobal('caches', cacheStorage);
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = 'sporthub_lang=; Max-Age=0';
});

describe('legacyLangToStoredLocale', () => {
  it('支援清單跟 LOCALES，zh-CN 對成 zh-TW', () => {
    expect(legacyLangToStoredLocale(null)).toBeNull();
    expect(legacyLangToStoredLocale('')).toBeNull();
    expect(legacyLangToStoredLocale('fr')).toBeNull();
    expect(legacyLangToStoredLocale('zh')).toBeNull();
    expect(legacyLangToStoredLocale('zh-CN')).toBe('zh-TW');
    for (const locale of LOCALES) {
      if (locale === 'zh-CN') continue;
      expect(legacyLangToStoredLocale(locale)).toBe(locale);
    }
  });
});

describe('isLegacyCollectionStorageKey / isLegacyCacheName', () => {
  it('只認三種 shub_ 鍵與 sporthub- 快取名', () => {
    expect(isLegacyCollectionStorageKey('shub_c_uid_users')).toBe(true);
    expect(isLegacyCollectionStorageKey('shub_ts_uid')).toBe(true);
    expect(isLegacyCollectionStorageKey('shub_cache_ts')).toBe(true);
    expect(isLegacyCollectionStorageKey('shub_c')).toBe(false);
    expect(isLegacyCollectionStorageKey('shub_ts')).toBe(false);
    expect(isLegacyCollectionStorageKey('shub_cache_ts_extra')).toBe(false);
    expect(isLegacyCollectionStorageKey('sporthub_theme')).toBe(false);
    expect(isLegacyCollectionStorageKey('sporthub_lang')).toBe(false);
    expect(isLegacyCacheName('sporthub-0.20261030a')).toBe(true);
    expect(isLegacyCacheName('sporthub-images-v2')).toBe(true);
    expect(isLegacyCacheName('sporthub')).toBe(false);
    expect(isLegacyCacheName('workbox-precache-v2')).toBe(false);
    expect(isLegacyCacheName('fcb-pages')).toBe(false);
  });
});

describe('runLegacyMigrationOnce', () => {
  it('沒有 toosterx:locale 時，把支援的 sporthub_lang 寫入；zh-CN 寫成 zh-TW；不刪 sporthub_lang', () => {
    for (const lang of LOCALES) {
      localStorage.clear();
      localStorage.setItem(LANG_KEY, lang);
      runLegacyMigrationOnce();
      expect(localStorage.getItem(LOCALE_KEY)).toBe(lang === 'zh-CN' ? 'zh-TW' : lang);
      expect(localStorage.getItem(LANG_KEY)).toBe(lang);
      expect(localStorage.getItem(FLAG)).toBe('1');
    }
  });

  it('已有 toosterx:locale（含空字串與非支援值）時不覆寫，仍清集合快取並寫旗標', () => {
    for (const existing of ['ja', 'zh-CN', 'fr', '']) {
      localStorage.clear();
      localStorage.setItem(LOCALE_KEY, existing);
      localStorage.setItem(LANG_KEY, 'en');
      localStorage.setItem('shub_c_u_users', 'blob');
      runLegacyMigrationOnce();
      expect(localStorage.getItem(LOCALE_KEY)).toBe(existing);
      expect(localStorage.getItem(LANG_KEY)).toBe('en');
      expect(localStorage.getItem('shub_c_u_users')).toBeNull();
      expect(localStorage.getItem(FLAG)).toBe('1');
    }
  });

  it('sporthub_lang 不是支援語系或缺少時，不寫 toosterx:locale，仍寫旗標', () => {
    for (const lang of ['fr', 'de', 'zh', 'ZH-TW', 'en-US', 'zh-tw', ' en', '']) {
      localStorage.clear();
      localStorage.setItem(LANG_KEY, lang);
      runLegacyMigrationOnce();
      expect(localStorage.getItem(LOCALE_KEY)).toBeNull();
      expect(localStorage.getItem(LANG_KEY)).toBe(lang);
      expect(localStorage.getItem(FLAG)).toBe('1');
    }

    localStorage.clear();
    runLegacyMigrationOnce();
    expect(localStorage.getItem(LOCALE_KEY)).toBeNull();
    expect(localStorage.getItem(LANG_KEY)).toBeNull();
    expect(localStorage.getItem(FLAG)).toBe('1');
  });

  it('只刪 shub_c_、shub_ts_ 與 shub_cache_ts，其他鍵原封不動', () => {
    const keep: Record<string, string> = {
      sporthub_theme: 'dark',
      sporthub_font_size: '16.5',
      sporthub_active_sport: 'badminton',
      sporthub_lang: 'ja',
      'toosterx:locale': 'en',
      'firebase:authUser:abc': '{"uid":"1"}',
      'fcb:signed-in': '1',
      'fcb:home-banners:v1': '{"v":1}',
      'LIFF_STORE:test-liff-id:accessToken': 'token',
      'toosterx:theme': 'dark',
      shub_c: 'keep',
      shub_ts: 'keep',
      shub_cache: 'keep',
      shub_cache_ts_extra: 'keep',
      prefix_shub_c_hidden: 'keep',
    };
    const drop = [
      'shub_c_uid_users',
      'shub_c_uid_events',
      'shub_ts_uid',
      'shub_ts_uid2',
      'shub_cache_ts',
      'shub_c_',
      'shub_ts_',
    ];
    for (const [key, value] of Object.entries(keep)) localStorage.setItem(key, value);
    for (const key of drop) localStorage.setItem(key, 'drop');

    runLegacyMigrationOnce();

    for (const [key, value] of Object.entries(keep)) {
      expect(localStorage.getItem(key)).toBe(value);
    }
    for (const key of drop) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(FLAG)).toBe('1');
  });

  it('先刪集合快取，再寫語系，最後寫旗標', () => {
    localStorage.setItem('shub_c_u_users', 'big');
    localStorage.setItem('shub_ts_u', '1');
    localStorage.setItem('shub_cache_ts', '2');
    localStorage.setItem(LANG_KEY, 'en');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    runLegacyMigrationOnce();

    expect(removeItem.mock.calls.map((call) => call[0]).sort()).toEqual([
      'shub_c_u_users',
      'shub_cache_ts',
      'shub_ts_u',
    ]);
    expect(setItem.mock.calls.map((call) => call[0])).toEqual([LOCALE_KEY, FLAG]);
    const firstSet = setItem.mock.invocationCallOrder[0];
    const lastRemove = Math.max(...removeItem.mock.invocationCallOrder);
    expect(firstSet).toBeTypeOf('number');
    expect(lastRemove).toBeLessThan(firstSet ?? 0);
  });

  it('不碰 sessionStorage 與 cookie', () => {
    sessionStorage.setItem('shub_c_u', 'keep');
    sessionStorage.setItem(LANG_KEY, 'ja');
    document.cookie = 'sporthub_lang=en';
    localStorage.setItem(LANG_KEY, 'ko');

    runLegacyMigrationOnce();

    expect(sessionStorage.getItem('shub_c_u')).toBe('keep');
    expect(sessionStorage.getItem(LANG_KEY)).toBe('ja');
    expect(document.cookie).toContain('sporthub_lang=en');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('ko');
  });

  it('只刪名稱以 sporthub- 開頭的 Cache Storage，不刪 workbox-* 與 fcb-pages', async () => {
    const deleted: string[] = [];
    const keys = vi.fn(async () => [
      'sporthub-0.20261030a',
      'sporthub-images-v2',
      'sporthub-',
      'workbox-precache-v2',
      'workbox-runtime',
      'fcb-pages',
      'sporthub',
      'SportHub-x',
    ]);
    const deleteCache = vi.fn(async (name: string) => {
      deleted.push(name);
      return true;
    });
    stubCaches({ keys, delete: deleteCache });
    localStorage.setItem(LANG_KEY, 'en');

    runLegacyMigrationOnce();

    expect(localStorage.getItem(FLAG)).toBe('1');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('en');
    await vi.waitFor(() => {
      expect(deleted).toEqual(['sporthub-0.20261030a', 'sporthub-images-v2', 'sporthub-']);
    });
    expect(deleteCache.mock.calls.map((call) => call[0])).toEqual(deleted);
  });

  it('同步寫完旗標後才清 Cache Storage，且不等它完成', async () => {
    let release: (names: string[]) => void = () => {};
    const gate = new Promise<string[]>((resolve) => {
      release = resolve;
    });
    const deleted: string[] = [];
    stubCaches({
      keys: () => gate,
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    localStorage.setItem(LANG_KEY, 'vi');

    runLegacyMigrationOnce();

    expect(localStorage.getItem(FLAG)).toBe('1');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('vi');
    expect(deleted).toEqual([]);
    release(['sporthub-images-v2', 'workbox-precache-v2', 'fcb-pages']);
    await vi.waitFor(() => {
      expect(deleted).toEqual(['sporthub-images-v2']);
    });
  });

  it('旗標已存在時完全不動', () => {
    localStorage.setItem(FLAG, '1');
    localStorage.setItem(LANG_KEY, 'ja');
    localStorage.setItem(LOCALE_KEY, 'en');
    localStorage.setItem('shub_c_u_users', 'blob');
    localStorage.setItem('shub_ts_u', '1');
    localStorage.setItem('shub_cache_ts', '9');
    localStorage.setItem('sporthub_theme', 'dark');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const keys = vi.fn(async () => ['sporthub-0.20261030a']);
    const deleteCache = vi.fn(async () => true);
    stubCaches({ keys, delete: deleteCache });

    runLegacyMigrationOnce();

    expect(getItem.mock.calls.map((call) => call[0])).toEqual([FLAG]);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(keys).not.toHaveBeenCalled();
    expect(deleteCache).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOCALE_KEY)).toBe('en');
    expect(localStorage.getItem(LANG_KEY)).toBe('ja');
    expect(localStorage.getItem('shub_c_u_users')).toBe('blob');
    expect(localStorage.getItem('shub_ts_u')).toBe('1');
    expect(localStorage.getItem('shub_cache_ts')).toBe('9');
    expect(localStorage.getItem('sporthub_theme')).toBe('dark');
  });

  it('旗標值是空字串也算已存在，整個略過', () => {
    localStorage.setItem(FLAG, '');
    localStorage.setItem(LANG_KEY, 'ja');
    localStorage.setItem('shub_cache_ts', '9');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    runLegacyMigrationOnce();

    expect(removeItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(LANG_KEY)).toBe('ja');
    expect(localStorage.getItem('shub_cache_ts')).toBe('9');
    expect(localStorage.getItem(LOCALE_KEY)).toBeNull();
  });

  it('第二次呼叫因旗標略過，新出現的 shub_ 鍵留著', () => {
    localStorage.setItem('shub_c_old', 'x');
    localStorage.setItem(LANG_KEY, 'th');
    runLegacyMigrationOnce();
    expect(localStorage.getItem('shub_c_old')).toBeNull();
    expect(localStorage.getItem(LOCALE_KEY)).toBe('th');

    localStorage.setItem('shub_c_new', 'y');
    localStorage.setItem('shub_cache_ts', '1');
    runLegacyMigrationOnce();

    expect(localStorage.getItem('shub_c_new')).toBe('y');
    expect(localStorage.getItem('shub_cache_ts')).toBe('1');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('th');
    expect(localStorage.getItem(LANG_KEY)).toBe('th');
  });

  it('localStorage.getItem 拋錯時不拋出，也不清 Cache Storage', () => {
    const keys = vi.fn(async () => ['sporthub-0.20261030a']);
    stubCaches({ keys, delete: async () => true });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => runLegacyMigrationOnce()).not.toThrow();
    expect(keys).not.toHaveBeenCalled();
  });

  it('localStorage.setItem 拋錯時不拋出，也不清 Cache Storage', () => {
    localStorage.setItem('shub_c_u', 'x');
    localStorage.setItem(LANG_KEY, 'en');
    const keys = vi.fn(async () => ['sporthub-0.20261030a']);
    stubCaches({ keys, delete: async () => true });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => runLegacyMigrationOnce()).not.toThrow();
    expect(keys).not.toHaveBeenCalled();
  });

  it('localStorage.key 拋錯時不拋出', () => {
    localStorage.setItem('sporthub_theme', 'dark');
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('key failed');
    });

    expect(() => runLegacyMigrationOnce()).not.toThrow();
    expect(localStorage.getItem(FLAG)).toBeNull();
  });

  it('localStorage.removeItem 拋錯時不拋出，也不清 Cache Storage', () => {
    localStorage.setItem('shub_c_u', 'x');
    const keys = vi.fn(async () => ['sporthub-a']);
    stubCaches({ keys, delete: async () => true });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('remove failed');
    });

    expect(() => runLegacyMigrationOnce()).not.toThrow();
    expect(keys).not.toHaveBeenCalled();
    expect(localStorage.getItem(FLAG)).toBeNull();
  });

  it('window 沒有 caches 時不拋錯，仍寫旗標', () => {
    expect('caches' in window).toBe(false);
    localStorage.setItem(LANG_KEY, 'en');

    expect(() => runLegacyMigrationOnce()).not.toThrow();
    expect(localStorage.getItem(FLAG)).toBe('1');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('en');
  });

  it('caches.keys 失敗時不拋錯，旗標已寫', async () => {
    stubCaches({
      keys: async () => {
        throw new Error('keys failed');
      },
      delete: async () => true,
    });
    localStorage.setItem(LANG_KEY, 'en');

    expect(() => runLegacyMigrationOnce()).not.toThrow();
    expect(localStorage.getItem(FLAG)).toBe('1');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('en');
    await Promise.resolve();
    await Promise.resolve();
  });

  it('單一 Cache 刪除失敗時略過並繼續刪其他 sporthub- 快取', async () => {
    const deleted: string[] = [];
    stubCaches({
      keys: async () => ['sporthub-a', 'workbox-precache-v2', 'sporthub-b', 'fcb-pages', 'sporthub-c'],
      delete: (name: string) => {
        if (name === 'sporthub-a') return Promise.reject(new Error('reject'));
        if (name === 'sporthub-b') throw new Error('sync');
        deleted.push(name);
        return Promise.resolve(true);
      },
    });

    expect(() => runLegacyMigrationOnce()).not.toThrow();
    await vi.waitFor(() => {
      expect(deleted).toEqual(['sporthub-c']);
    });
    expect(localStorage.getItem(FLAG)).toBe('1');
  });
});
