// 換站當天同 origin 的一次性清理（舊站 A → 新站 B）。
// 必須在 initLocale 與任何快照寫入之前同步跑完；Cache Storage 清理是盡力而為，不在這條同步路徑上等。
// 全程失敗都吞掉，不阻擋啟動。
// 不刪 sporthub_lang（回退舊站還要用），不碰其他 sporthub_／firebase:／fcb:／LIFF 鍵，
// 也不碰 IndexedDB、sessionStorage、cookie。

import { LOCALES, type Locale } from '@/i18n/locales';

/** 與 src/i18n/i18n.ts 的 STORAGE_KEY 相同（該常數未匯出）。 */
const LOCALE_STORAGE_KEY = 'toosterx:locale';
const LEGACY_LANG_KEY = 'sporthub_lang';
const MIGRATION_FLAG_KEY = 'fcb:legacy-migrated:v1';

/**
 * A 的語系值 → 要寫進 toosterx:locale 的值。
 * 支援清單用 LOCALES（與 i18n 同一份）。不支援或空值回傳 null。
 * M-012：與 i18n.readPref、initLocale 相同，zh-CN 改存 zh-TW。
 */
export function legacyLangToStoredLocale(raw: string | null): Locale | null {
  if (raw === null || raw === '') return null;
  if (raw === 'zh-CN') return 'zh-TW';
  if ((LOCALES as readonly string[]).includes(raw)) return raw as Locale;
  return null;
}

/** 舊站集合快取：前綴 shub_c_、前綴 shub_ts_、精確 shub_cache_ts。 */
export function isLegacyCollectionStorageKey(key: string): boolean {
  return key.startsWith('shub_c_') || key.startsWith('shub_ts_') || key === 'shub_cache_ts';
}

/** 舊站 Cache Storage。B 的 workbox-*、fcb-pages 不以這個前綴開頭。 */
export function isLegacyCacheName(name: string): boolean {
  return name.startsWith('sporthub-');
}

/**
 * 同步遷移。旗標已在則完全不動並回傳 false。
 * 成功寫入旗標回傳 true（呼叫端接著盡力清 Cache Storage，不等待）。
 * 先刪可能吃滿配額的集合快取，再寫語系與旗標。
 */
export function migrateLegacyStorage(storage: Storage): boolean {
  if (storage.getItem(MIGRATION_FLAG_KEY) !== null) return false;

  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && isLegacyCollectionStorageKey(key)) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);

  // 只有完全沒有這個鍵才寫。空字串也算已有值，不覆寫。
  if (storage.getItem(LOCALE_STORAGE_KEY) === null) {
    const mapped = legacyLangToStoredLocale(storage.getItem(LEGACY_LANG_KEY));
    if (mapped !== null) storage.setItem(LOCALE_STORAGE_KEY, mapped);
  }

  storage.setItem(MIGRATION_FLAG_KEY, '1');
  return true;
}

function purgeLegacyCaches(): void {
  try {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    const cacheStorage = window.caches;
    void cacheStorage
      .keys()
      .then((names) => {
        for (const name of names) {
          if (!isLegacyCacheName(name)) continue;
          try {
            void Promise.resolve(cacheStorage.delete(name)).catch(() => {
              /* 這個快取刪不掉就略過 */
            });
          } catch {
            /* delete 同步拋錯：略過，繼續下一個 */
          }
        }
      })
      .catch(() => {
        /* keys() 失敗略過 */
      });
  } catch {
    /* 沒有 Cache Storage，或讀取時拋錯 */
  }
}

/** 換站一次性遷移：同步做完就寫旗標；Cache Storage 清理不等待。絕不拋錯、不阻擋啟動。 */
export function runLegacyMigrationOnce(): void {
  let purge = false;
  try {
    purge = migrateLegacyStorage(localStorage);
  } catch {
    return;
  }
  if (purge) purgeLegacyCaches();
}
