import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { toast } from '@/ui/Toast';
import {
  DOM_RECYCLE_THRESHOLD,
  addMonthKey,
  getWindowedMonthKeys,
  minimumMonthKey,
  monthKeyFromDate,
} from '../../data/calendar-model';

interface PositionRequest {
  month: string;
  today: boolean;
  anchor: string | null;
  offset: number;
}

/** 照 A _bindCalendarScrollObserver、_renderCalendarMonths、_ensureCalendarBuffer。 */
export function useCalendarNav() {
  const initial = useRef(monthKeyFromDate(new Date()));
  const [current, setCurrent] = useState(initial.current);
  const [months, setMonths] = useState(() => getWindowedMonthKeys(initial.current, new Date()));
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef(current);
  const guarded = useRef(true);
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frames = useRef(new Set<number>());
  const position = useRef<PositionRequest | null>({
    month: initial.current, today: true, anchor: null, offset: 0,
  });

  function frame(callback: () => void): void {
    const id = requestAnimationFrame(() => {
      frames.current.delete(id);
      callback();
    });
    frames.current.add(id);
  }

  function setScrollTopGuarded(element: HTMLElement, top: number): void {
    guarded.current = true;
    element.scrollTop = Math.max(0, top);
    if (guardTimer.current !== null) clearTimeout(guardTimer.current);
    guardTimer.current = setTimeout(() => {
      guardTimer.current = null;
      guarded.current = false;
    }, 250);
  }

  function go(delta: number): void {
    const target = addMonthKey(currentRef.current, delta);
    if (target < minimumMonthKey(new Date())) {
      toast.show({ message: '無更早資料' });
      return;
    }
    guarded.current = true;
    position.current = { month: target, today: false, anchor: null, offset: 0 };
    currentRef.current = target;
    setCurrent(target);
    setMonths(getWindowedMonthKeys(target, new Date()));
  }

  useLayoutEffect(() => {
    const request = position.current;
    position.current = null;
    if (!request) return;
    let disposed = false;
    frame(() => frame(() => {
      if (disposed) return;
      const element = scrollRef.current;
      if (!element) return;
      const anchor = request.anchor
        ? element.querySelector<HTMLElement>(`[data-month="${request.anchor}"]`) : null;
      if (anchor) {
        setScrollTopGuarded(element, anchor.offsetTop + request.offset);
        return;
      }
      const today = request.today
        ? element.querySelector<HTMLElement>('[data-today="1"]') : null;
      const month = element.querySelector<HTMLElement>(`[data-month="${request.month}"]`);
      setScrollTopGuarded(element, today
        ? today.offsetTop - element.clientHeight * 0.2
        : month?.offsetTop ?? 0);
    }));
    return () => { disposed = true; };
  }, [months]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let ticking = false;

    function update(): void {
      ticking = false;
      if (!element || !element.isConnected || guarded.current) return;
      const sections = Array.from(element.querySelectorAll<HTMLElement>('.evt-cal-month'));
      const viewCenter = element.scrollTop + element.clientHeight / 2;
      let best: HTMLElement | undefined;
      let distance = Infinity;
      for (const section of sections) {
        const nextDistance = Math.abs(section.offsetTop + section.offsetHeight / 2 - viewCenter);
        if (nextDistance < distance) {
          distance = nextDistance;
          best = section;
        }
      }
      const key = best?.dataset.month;
      if (!key || key === currentRef.current) return;
      currentRef.current = key;
      setCurrent(key);

      const keys = sections.flatMap((section) => section.dataset.month ? [section.dataset.month] : []);
      const nextKeys = [...keys];
      if (key === keys.at(-1)) nextKeys.push(addMonthKey(key, 1));
      if (key === keys[0]) {
        const previous = addMonthKey(key, -1);
        if (previous >= minimumMonthKey(new Date())) nextKeys.unshift(previous);
      }
      // ASSUMPTION: A 宣告回收門檻但附件未執行；保留當前月並回收距離最遠月。
      while (nextKeys.length > DOM_RECYCLE_THRESHOLD) {
        const index = nextKeys.indexOf(key);
        if (index > nextKeys.length - 1 - index) nextKeys.shift();
        else nextKeys.pop();
      }
      if (nextKeys.join(',') === keys.join(',')) return;
      const anchor = best;
      if (!anchor) return;
      guarded.current = true;
      position.current = {
        month: key, today: false, anchor: key,
        offset: element.scrollTop - anchor.offsetTop,
      };
      setMonths(nextKeys);
    }

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      frame(update);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => () => {
    if (guardTimer.current !== null) clearTimeout(guardTimer.current);
    for (const id of frames.current) cancelAnimationFrame(id);
    frames.current.clear();
  }, []);

  /** 照 A _handleCalendarKeydown。 */
  function onKeyDown(event: KeyboardEvent): void {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    if (event.key === 'Enter' || event.key === ' ') {
      const action = target.closest<HTMLElement>(
        '.evt-cal-sport-summary[data-jump-date], .evt-cal-event[data-id], .evt-cal-more[data-jump-date]',
      );
      if (action) {
        event.preventDefault();
        action.click();
        return;
      }
    }
    if (event.key === 'Escape') {
      document.querySelector<HTMLElement>('[data-atab="calendar"]')?.focus();
      event.preventDefault();
      return;
    }
    const cell = target.closest<HTMLElement>('.evt-cal-day[role="gridcell"]');
    if (!cell) return;
    const row = Number(cell.getAttribute('aria-rowindex') ?? 1);
    const col = Number(cell.getAttribute('aria-colindex') ?? 1);
    let nextRow = row;
    let nextCol = col;
    switch (event.key) {
      case 'ArrowUp': nextRow--; break;
      case 'ArrowDown': nextRow++; break;
      case 'ArrowLeft': nextCol--; break;
      case 'ArrowRight': nextCol++; break;
      case 'Home': nextCol = 1; break;
      case 'End': nextCol = 7; break;
      case 'PageUp': go(-1); event.preventDefault(); return;
      case 'PageDown': go(1); event.preventDefault(); return;
      case 'Enter':
      case ' ': {
        const action = cell.querySelector<HTMLElement>(
          '.evt-cal-sport-summary[data-jump-date], .evt-cal-event[data-id]',
        );
        if (action) { action.click(); event.preventDefault(); }
        return;
      }
      default: return;
    }
    if (nextCol < 1) nextCol = 7;
    if (nextCol > 7) nextCol = 1;
    const next = cell.closest('.evt-cal-month')?.querySelector<HTMLElement>(
      `[aria-rowindex="${nextRow}"][aria-colindex="${nextCol}"]`,
    );
    if (next) { next.focus(); event.preventDefault(); }
  }

  return {
    scrollRef, current, months, go, onKeyDown,
    previousDisabled: current <= minimumMonthKey(new Date()),
  };
}
