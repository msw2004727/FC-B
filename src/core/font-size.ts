import { useEffect, useState } from 'preact/hooks';

export type FontSize = 'small' | 'medium' | 'large';

/**
 * M-055：照 A `index.html:941` 與 `js/core/theme.js#cycleFontSize`：
 * - 字級偏好存在 `localStorage['sporthub_font_size']`（15 / 16.5 / 18），開站時由 `index.html` 立即套用至 `documentElement.style.fontSize`。
 * - 移除原本 B 自訂卻無入口的 `toosterx:font-size` 與 `data-font-size` 機制。
 * // ASSUMPTION: 保留既有匯出簽章與同步至 A 的 `sporthub_font_size`（small=15, medium=16.5, large=18），避免其他未在範圍內的檔案引用時發生編譯錯誤。
 */
const STORAGE_KEY = 'sporthub_font_size';
const LEGACY_B_STORAGE_KEY = 'toosterx:font-size';

const SIZE_TO_PX: Record<FontSize, number> = {
  small: 15,
  medium: 16.5,
  large: 18,
};

const listeners = new Set<(size: FontSize) => void>();
let current: FontSize = 'small';

function pxToFontSize(px: number): FontSize {
  if (px === 18) return 'large';
  if (px === 16.5) return 'medium';
  return 'small';
}

function readStoredFontSize(): FontSize {
  try {
    localStorage.removeItem(LEGACY_B_STORAGE_KEY);
    const raw = localStorage.getItem(STORAGE_KEY);
    const num = raw ? parseFloat(raw) : NaN;
    return pxToFontSize(num);
  } catch {
    return 'small';
  }
}

function apply(size: FontSize): void {
  if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute('data-font-size');
    document.documentElement.style.fontSize = `${SIZE_TO_PX[size]}px`;
  }
}

function notify(size: FontSize): void {
  for (const listener of [...listeners]) {
    try {
      listener(size);
    } catch {
      /* L-15：隔離單一 listener 例外 */
    }
  }
}

export function getFontSize(): FontSize {
  return current;
}

export function initFontSize(): void {
  current = readStoredFontSize();
  apply(current);
  notify(current);
}

export function setFontSize(size: FontSize): void {
  current = size;
  apply(size);
  try {
    localStorage.removeItem(LEGACY_B_STORAGE_KEY);
    const px = SIZE_TO_PX[size];
    if (px === SIZE_TO_PX.small) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(px));
    }
  } catch {
    // 偏好寫入失敗不阻擋顯示更新。
  }
  notify(size);
}

export function nextFontSize(size: FontSize): FontSize {
  return size === 'small' ? 'medium' : size === 'medium' ? 'large' : 'small';
}

export function useFontSize(): FontSize {
  const [size, setSize] = useState(getFontSize);
  useEffect(() => {
    listeners.add(setSize);
    setSize(getFontSize());
    return () => {
      listeners.delete(setSize);
    };
  }, []);
  return size;
}
