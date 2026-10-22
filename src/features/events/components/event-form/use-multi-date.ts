import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

export interface MultiDateView {
  dates: readonly string[];
  isMultiDate: boolean;
  countText: string;
  onRemove(date: string): void;
}

interface MultiDateInput {
  mode: 'create' | 'edit';
  dateVal: string;
  onDateValChange(next: string): void;
}

interface MultiDateResult {
  view: MultiDateView;
  dateInputHandlers: {
    onFocus(): void;
    onChange(value: string): void;
    onBlur(): void;
  };
  reset(): void;
  dates: readonly string[];
}

/** 照 A _initMultiDatePicker／_addMultiDate／_removeMultiDate。 */
export function useMultiDate(input: MultiDateInput): MultiDateResult {
  const lt = useLegacyT();
  const [dates, setDates] = useState<readonly string[]>([]);
  const datesRef = useRef<readonly string[]>([]);
  const latest = useRef(input);
  latest.current = input;
  const mounted = useRef(true);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
      clearTimer();
    };
  }, [clearTimer]);

  useEffect(() => {
    if (input.mode === 'edit') {
      pending.current = null;
      clearTimer();
    }
  }, [input.mode, clearTimer]);

  const publish = useCallback((next: readonly string[]) => {
    if (!mounted.current) return;
    datesRef.current = next;
    setDates(next);
    latest.current.onDateValChange(next.length === 1 ? next[0] ?? '' : '');
  }, []);

  const onFocus = useCallback(() => {
    clearTimer();
    pending.current = null;
  }, [clearTimer]);

  const onChange = useCallback((value: string) => {
    if (!mounted.current) return;
    latest.current.onDateValChange(value);
    pending.current = latest.current.mode === 'create' && value ? value : null;
  }, []);

  const onBlur = useCallback(() => {
    clearTimer();
    if (!mounted.current || latest.current.mode !== 'create') return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const value = pending.current;
      pending.current = null;
      if (!mounted.current || latest.current.mode !== 'create' || !value) return;
      if (datesRef.current.includes(value)) {
        toast.show(lt('此日期已加入', '此日期已加入'));
        return;
      }
      if (datesRef.current.length >= 30) {
        toast.show(lt('最多選擇 30 個日期', '最多選擇 30 個日期'));
        return;
      }
      publish([...datesRef.current, value].sort());
    }, 150);
  }, [clearTimer, lt, publish]);

  const onRemove = useCallback((date: string) => {
    if (!mounted.current || latest.current.mode !== 'create') return;
    publish(datesRef.current.filter(value => value !== date));
  }, [publish]);

  const reset = useCallback(() => {
    clearTimer();
    pending.current = null;
    publish([]);
  }, [clearTimer, publish]);

  const isMultiDate = input.mode === 'create' && dates.length >= 2;
  return {
    dates,
    view: {
      dates,
      isMultiDate,
      countText: isMultiDate
        ? lt('已選 {N} 個日期（上限 30）', '已選 {N} 個日期（上限 30）', { N: dates.length })
        : '',
      onRemove,
    },
    dateInputHandlers: { onFocus, onChange, onBlur },
    reset,
  };
}
