import { useEffect, useState } from 'preact/hooks';

export type FontSize = 'small' | 'medium' | 'large';

const STORAGE_KEY = 'toosterx:font-size';
const listeners = new Set<(size: FontSize) => void>();
let current: FontSize = 'medium';

function isFontSize(value: unknown): value is FontSize {
  return value === 'small' || value === 'medium' || value === 'large';
}

function apply(size: FontSize): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-font-size', size);
  }
}

export function getFontSize(): FontSize {
  return current;
}

export function initFontSize(): void {
  let size: FontSize = 'medium';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isFontSize(stored)) size = stored;
  } catch {
    // 儲存不可用時仍提供本次工作階段的字級切換。
  }
  current = size;
  apply(size);
  for (const listener of listeners) listener(size);
}

export function setFontSize(size: FontSize): void {
  current = size;
  apply(size);
  try {
    localStorage.setItem(STORAGE_KEY, size);
  } catch {
    // 偏好寫入失敗不阻擋顯示更新。
  }
  for (const listener of listeners) listener(size);
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
