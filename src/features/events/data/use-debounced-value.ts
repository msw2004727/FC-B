import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

export interface DebouncedValueHandle<T> {
  value: T;
  /** 立即套用指定值，並取消目前延遲中的計時器。 */
  setImmediate: (next: T) => void;
}

// U-027：輸入值延遲後才更新，用於活動關鍵字搜尋。
export function useDebouncedValue<T>(input: T, delayMs: number): DebouncedValueHandle<T> {
  const [value, setValue] = useState(input);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setValue(input);
    }, delayMs);
    return clearTimer;
  }, [input, delayMs, clearTimer]);

  const setImmediate = useCallback((next: T) => {
    clearTimer();
    setValue(next);
  }, [clearTimer]);

  return { value, setImmediate };
}
