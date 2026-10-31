/**
 * M-118(c)：對應 A _buildTeamDetailV2WeekStrip、
 * _renderTeamDetailV2WeekDays、_extendTeamDetailV2WeekRange、
 * _loadTeamDetailV2WeekNext／Previous、_wheelTeamDetailV2Week，
 * 以及 _start／_move／_endTeamDetailV2WeekDrag。
 * 日期節點由 Preact 管理；往前補齊日期後以 layout effect 補償捲動位置。
 */
import type { JSX } from 'preact';
import { addTaipeiDays, formatTaipei, taipeiParts, taipeiStartOfDay } from '@/core/taipei-time';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface TeamDetailWeekStripProps {
  /** 有活動的日期集合，格式 YYYY-MM-DD；父層可能傳入新的 Set。 */
  eventDays: ReadonlySet<string>;
  /** 測試用：固定「今天」，預設 new Date()。 */
  today?: Date;
}

interface DragState {
  pointerId: number;
  startX: number;
  startScroll: number;
}

interface PendingPrepend {
  previousWidth: number;
  drag: DragState | null;
}

const BLOCK_SIZE = 14;
const MIN_RANGE_START = -182;
const LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

export function TeamDetailWeekStrip({
  eventDays,
  today,
}: TeamDetailWeekStripProps): JSX.Element {
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(13);
  const elementRef = useRef<HTMLDivElement>(null);
  const loading = useRef(false);
  const frame = useRef<number | null>(null);
  const drag = useRef<DragState | null>(null);
  const pendingPrepend = useRef<PendingPrepend | null>(null);

  useLayoutEffect(() => {
    const el = elementRef.current;
    const pending = pendingPrepend.current;

    if (el && pending) {
      const compensation = Math.max(0, el.scrollWidth - pending.previousWidth);
      el.scrollLeft += compensation;

      // 拖曳起點也必須包含新插入日期的寬度，避免下一次移動跳回舊位置。
      if (pending.drag && drag.current === pending.drag) {
        pending.drag.startScroll += compensation;
      }
      pendingPrepend.current = null;
    }

    if (loading.current && frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        loading.current = false;
      });
    }
  }, [rangeStart, rangeEnd]);

  useLayoutEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      loading.current = false;
      pendingPrepend.current = null;
      drag.current = null;
    };
  }, []);

  function loadNext(el: HTMLDivElement): void {
    if (loading.current) return;

    const threshold = Math.max(80, el.clientWidth * 0.65);
    const scrollRight = el.scrollLeft + el.clientWidth;
    if (scrollRight < el.scrollWidth - threshold) return;

    loading.current = true;
    setRangeEnd((previous) => previous + BLOCK_SIZE);
  }

  function loadPrevious(el: HTMLDivElement, activeDrag: DragState | null = null): boolean {
    if (loading.current || rangeStart <= MIN_RANGE_START || el.scrollLeft > 1) {
      return false;
    }

    loading.current = true;
    pendingPrepend.current = {
      previousWidth: el.scrollWidth,
      drag: activeDrag,
    };
    setRangeStart((previous) => Math.max(MIN_RANGE_START, previous - BLOCK_SIZE));
    return true;
  }

  function handleWheel(event: JSX.TargetedWheelEvent<HTMLDivElement>): void {
    if (event.deltaX < -12) {
      loadPrevious(event.currentTarget);
    } else if (event.deltaX > 12) {
      loadNext(event.currentTarget);
    }
  }

  function startDrag(event: JSX.TargetedPointerEvent<HTMLDivElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (drag.current) return;

    const el = event.currentTarget;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: el.scrollLeft,
    };
    el.classList.add('dragging');
    try {
      el.setPointerCapture?.(event.pointerId);
    } catch {
      // 瀏覽器或測試環境可能不支援捕捉，仍可處理送達的指標事件。
    }
  }

  function moveDrag(event: JSX.TargetedPointerEvent<HTMLDivElement>): void {
    const activeDrag = drag.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;

    const el = event.currentTarget;
    const dragDistance = event.clientX - activeDrag.startX;
    el.scrollLeft = activeDrag.startScroll - dragDistance;
    event.preventDefault?.();

    if (dragDistance > 24 && loadPrevious(el, activeDrag)) {
      activeDrag.startX = event.clientX;
      activeDrag.startScroll = el.scrollLeft;
      return;
    }
    loadNext(el);
  }

  function endDrag(event: JSX.TargetedPointerEvent<HTMLDivElement>): void {
    const activeDrag = drag.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;

    drag.current = null;
    const el = event.currentTarget;
    el.classList.remove('dragging');
    try {
      el.releasePointerCapture?.(activeDrag.pointerId);
    } catch {
      // 捕捉可能已由瀏覽器自動釋放，或測試環境未提供此 API。
    }
  }

  const now = today ?? new Date();
  const todayStart = taipeiStartOfDay(now.getTime());
  const todayKey = formatTaipei(todayStart, 'YYYY-MM-DD');
  const days: JSX.Element[] = [];

  for (let offset = rangeStart; offset <= rangeEnd; offset += 1) {
    const ms = addTaipeiDays(todayStart, offset);
    const key = formatTaipei(ms, 'YYYY-MM-DD');
    const date = taipeiParts(ms);
    const weekday = date.weekday;
    const weekendClass = weekday === 6 ? ' weekend-sat' : weekday === 0 ? ' weekend-sun' : '';
    const activeClass = key === todayKey ? ' active' : '';

    days.push(
      <div
        key={key}
        class={`td-v2-day${weekendClass}${activeClass}`}
        data-date={key}
        role="listitem"
      >
        <span>{LABELS[weekday]}</span>
        <strong>{date.day}</strong>
        {eventDays.has(key) ? <i /> : null}
      </div>,
    );
  }

  return (
    <div
      ref={elementRef}
      class="td-v2-week"
      role="list"
      tabIndex={0}
      aria-label="Activity calendar"
      data-range-start={rangeStart}
      data-range-end={rangeEnd}
      data-event-days={Array.from(eventDays).join('|')}
      onScroll={(event) => loadNext(event.currentTarget)}
      onWheel={handleWheel}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
    >
      {days}
    </div>
  );
}
