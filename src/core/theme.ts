import { useEffect, useState } from 'preact/hooks';
import { emit, on } from './events';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'toosterx:theme';

let current: ThemeMode = 'system';

/** 取得偏好主題（使用者選擇，非計算後主題）。 */
export function getTheme(): ThemeMode {
  return current;
}

/** 套用主題：data-theme 只設在 documentElement；system 時移除屬性。 */
function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

function readPref(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* 忽略 */
  }
  return 'system';
}

function writePref(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
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
