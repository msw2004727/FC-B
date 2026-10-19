import { useEffect, useState } from 'preact/hooks';
import { emit, on } from './events';

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * 照 A `js/core/theme.js#bindTheme` 與 `index.html` 開頁腳本：
 * - 偏好存在 `localStorage['sporthub_theme']`，只存 'dark'／'light'；沒存＝跟隨系統。
 * - `<html data-theme>` 一律設成 'dark' 或 'light'（A 的 CSS 只掛在這兩個屬性值上，不能拿掉）。
 * - 跟隨系統時於套用當下讀 `prefers-color-scheme`（A 不監聽之後的系統變更）。
 * 2026-10-19 改版沿用 A 外觀時改寫，取代原本 B 自訂的 'toosterx:theme' 與「system 移除屬性」。
 */
const STORAGE_KEY = 'sporthub_theme';
/** B 早期使用的 key，讀到時搬到 A 的 key 後刪除。 */
const LEGACY_B_STORAGE_KEY = 'toosterx:theme';

let current: ThemeMode = 'system';

/** 取得偏好主題（使用者選擇，非計算後主題）。 */
export function getTheme(): ThemeMode {
  return current;
}

function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** 套用主題：data-theme 只設在 documentElement，一律是 'dark' 或 'light'。 */
function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const resolved = mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
  document.documentElement.setAttribute('data-theme', resolved);
}

function readPref(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
    const legacy = localStorage.getItem(LEGACY_B_STORAGE_KEY);
    if (legacy !== null) {
      localStorage.removeItem(LEGACY_B_STORAGE_KEY);
      if (legacy === 'light' || legacy === 'dark') {
        localStorage.setItem(STORAGE_KEY, legacy);
        return legacy;
      }
    }
  } catch {
    /* 忽略 */
  }
  return 'system';
}

function writePref(mode: ThemeMode): void {
  try {
    if (mode === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 忽略 */
  }
}

/** 初始化：讀取偏好並套用。 */
export function initTheme(): void {
  current = readPref();
  applyTheme(current);
}

/** 設定主題並觸發事件。 */
export function setTheme(mode: ThemeMode): void {
  current = mode;
  applyTheme(mode);
  writePref(mode);
  emit('theme:changed', { theme: mode });
}

/** 訂閱主題變更的 hook。 */
export function useTheme(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(getTheme());

  useEffect(() => {
    const off = on('theme:changed', ({ theme }) => setMode(theme));
    // 補讀：首次 render 到訂閱之間若主題已改變，避免漏接
    setMode(getTheme());
    return off;
  }, []);

  return mode;
}
