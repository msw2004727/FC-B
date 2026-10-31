/**
 * @vitest-environment jsdom
 */

/**
 * M-118(c)：驗證 A 週曆建立、前後延伸、滾輪與拖曳函式的 Preact 對應行為。
 * 以可控制的版面尺寸與動畫幀驗證捲動補償及同幀去重。
 * 此交付環境未執行測試；實際結果以專案 Vitest 執行為準。
 */
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamDetailWeekStrip } from './TeamDetailWeekStrip';

const TODAY = new Date(Date.parse('2026-10-26T00:00:00+08:00'));
let frameId = 0;
let frames: Map<number, FrameRequestCallback>;

function nextFrame(): void {
  act(() => {
    const callbacks = Array.from(frames.values());
    frames.clear();
    for (const callback of callbacks) callback(0);
  });
}

function setLayout(
  el: HTMLElement,
  scrollWidth: number,
  clientWidth: number,
  scrollLeft: number,
): void {
  for (const [property, value] of [
    ['scrollWidth', scrollWidth],
    ['clientWidth', clientWidth],
    ['scrollLeft', scrollLeft],
  ] as const) {
    Object.defineProperty(el, property, {
      configurable: true,
      writable: true,
      value,
    });
  }
}

function getStrip(container: HTMLElement): HTMLDivElement {
  const el = container.querySelector<HTMLDivElement>('.td-v2-week');
  if (!el) throw new Error('找不到週曆');
  return el;
}

function getDay(el: HTMLElement, date: string): HTMLDivElement {
  const day = el.querySelector<HTMLDivElement>(`.td-v2-day[data-date="${date}"]`);
  if (!day) throw new Error(`找不到日期：${date}`);
  return day;
}

function dayCount(el: HTMLElement): number {
  return el.querySelectorAll('.td-v2-day').length;
}

function renderStrip(eventDays: ReadonlySet<string> = new Set<string>()) {
  const result = render(<TeamDetailWeekStrip today={TODAY} eventDays={eventDays} />);
  return { ...result, el: getStrip(result.container as HTMLElement) };
}

interface PointerOptions {
  clientX?: number;
  pointerId?: number;
  pointerType?: string;
  button?: number;
}

function pointer(
  el: HTMLElement,
  type: string,
  {
    clientX = 100,
    pointerId = 1,
    pointerType = 'mouse',
    button = 0,
  }: PointerOptions = {},
): Event {
  // jsdom 可能沒有 PointerEvent；明確提供處理器所需的指標欄位。
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
    button: { value: button },
  });
  fireEvent(el, event);
  return event;
}

describe('俱樂部詳情延伸週曆', () => {
  beforeEach(() => {
    frameId = 0;
    frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['2026-10-19T00:30:00+08:00', '2026-10-19', 'MON', '19'],
    ['2026-11-01T00:30:00+08:00', '2026-11-01', 'SUN', '1'],
    ['2026-10-31T23:30:00+08:00', '2026-10-31', 'SAT', '31'],
  ])('W1–W3：%s 的今天、星期與活動小點同格', (now, key, label, day) => {
    const { container } = render(
      <TeamDetailWeekStrip today={new Date(Date.parse(now))} eventDays={new Set([key])} />,
    );
    const el = getStrip(container as HTMLElement);
    const cell = getDay(el, key);
    expect(el.querySelectorAll('.active')).toHaveLength(1);
    expect(cell.classList.contains('active')).toBe(true);
    expect(cell.querySelector('span')?.textContent).toBe(label);
    expect(cell.querySelector('strong')?.textContent).toBe(day);
    expect(cell.querySelector('i')).not.toBeNull();
    expect(el.querySelectorAll('.td-v2-day i')).toHaveLength(1);
  });

  it('初始顯示台北今日起十四格，保留屬性、週末樣式與活動圓點', () => {
    const eventDays = new Set(['2026-10-26', '2026-11-01']);
    const { el } = renderStrip(eventDays);

    expect(dayCount(el)).toBe(14);
    expect(el.getAttribute('role')).toBe('list');
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute('aria-label')).toBe('Activity calendar');
    expect(el.dataset.rangeStart).toBe('0');
    expect(el.dataset.rangeEnd).toBe('13');
    expect(el.dataset.eventDays).toBe(Array.from(eventDays).join('|'));
    expect(el.firstElementChild).toBe(getDay(el, '2026-10-26'));
    expect(el.lastElementChild).toBe(getDay(el, '2026-11-08'));
    expect(getDay(el, '2026-10-26').classList.contains('active')).toBe(true);
    expect(el.querySelectorAll('.active').length).toBe(1);
    expect(getDay(el, '2026-10-26').querySelector('span')?.textContent).toBe('MON');
    expect(getDay(el, '2026-10-26').querySelector('strong')?.textContent).toBe('26');
    expect(getDay(el, '2026-10-31').classList.contains('weekend-sat')).toBe(true);
    expect(getDay(el, '2026-11-01').classList.contains('weekend-sun')).toBe(true);
    expect(getDay(el, '2026-10-26').classList.contains('weekend-sat')).toBe(false);
    expect(getDay(el, '2026-10-26').querySelector('i')).not.toBeNull();
    expect(getDay(el, '2026-11-01').querySelector('i')).not.toBeNull();
    expect(getDay(el, '2026-10-27').querySelector('i')).toBeNull();
    expect(el.querySelectorAll('i').length).toBe(2);
    expect(el.querySelectorAll('[role="listitem"]').length).toBe(14);
  });

  it('捲到尾端附近延伸十四天，離尾端遠時不延伸', () => {
    const { el } = renderStrip();
    setLayout(el, 1400, 300, 0);
    fireEvent.scroll(el);
    expect(dayCount(el)).toBe(14);

    el.scrollLeft = 1000;
    fireEvent.scroll(el);
    expect(dayCount(el)).toBe(28);
    expect(el.dataset.rangeEnd).toBe('27');
    expect(el.scrollLeft).toBe(1000);
  });

  it('同一幀的捲動與滾輪只延伸一次，下一幀可以繼續往後', () => {
    const { el } = renderStrip();
    setLayout(el, 1400, 300, 1000);

    fireEvent.scroll(el);
    fireEvent.wheel(el, { deltaX: 20 });
    fireEvent.scroll(el);
    expect(dayCount(el)).toBe(28);
    expect(el.dataset.rangeEnd).toBe('27');

    nextFrame();
    fireEvent.scroll(el);
    expect(dayCount(el)).toBe(42);
    expect(el.dataset.rangeEnd).toBe('41');
  });

  it('滾輪向右超過門檻且接近尾端時延伸', () => {
    const { el } = renderStrip();
    setLayout(el, 1400, 300, 1000);

    fireEvent.wheel(el, { deltaX: 12 });
    expect(dayCount(el)).toBe(14);
    fireEvent.wheel(el, { deltaX: 20 });
    expect(dayCount(el)).toBe(28);
    expect(el.dataset.rangeEnd).toBe('27');
  });

  it('窄容器仍使用至少八十像素的尾端門檻', () => {
    const { el } = renderStrip();
    setLayout(el, 1400, 100, 1219);

    fireEvent.scroll(el);
    expect(dayCount(el)).toBe(14);

    el.scrollLeft = 1220;
    fireEvent.scroll(el);
    expect(dayCount(el)).toBe(28);
  });

  it('最左側向左滾輪每次補十四天，到負一百八十二天停止', () => {
    const { el } = renderStrip();
    setLayout(el, 1400, 300, 0);

    for (let count = 1; count <= 13; count += 1) {
      el.scrollLeft = 0;
      fireEvent.wheel(el, { deltaX: -20 });
      expect(el.dataset.rangeStart).toBe(String(-14 * count));
      expect(dayCount(el)).toBe(14 + 14 * count);
      expect(el.dataset.rangeEnd).toBe('13');
      nextFrame();
    }

    el.scrollLeft = 0;
    fireEvent.wheel(el, { deltaX: -20 });
    expect(el.dataset.rangeStart).toBe('-182');
    expect(dayCount(el)).toBe(196);
  });

  it('尚未到最左側或向左滾輪未超過門檻時不延伸', () => {
    const { el } = renderStrip();
    setLayout(el, 1400, 300, 50);
    fireEvent.wheel(el, { deltaX: -20 });
    expect(dayCount(el)).toBe(14);

    el.scrollLeft = 0;
    fireEvent.wheel(el, { deltaX: -5 });
    fireEvent.wheel(el, { deltaX: -12 });
    expect(dayCount(el)).toBe(14);
    expect(el.dataset.rangeStart).toBe('0');
  });

  it('往前延伸後以新增寬度補償捲動位置並保留既有日期節點', () => {
    const { el } = renderStrip();
    const originalToday = getDay(el, '2026-10-26');
    setLayout(el, 1400, 300, 0);
    Object.defineProperty(el, 'scrollWidth', {
      configurable: true,
      get: () => dayCount(el) * 100,
    });

    fireEvent.wheel(el, { deltaX: -20 });

    expect(dayCount(el)).toBe(28);
    expect(el.dataset.rangeStart).toBe('-14');
    expect(el.scrollLeft).toBe(1400);
    expect(getDay(el, '2026-10-26')).toBe(originalToday);
  });

  it('拖曳依起點移動捲軸，放開後移除拖曳狀態', () => {
    const { el } = renderStrip();
    setLayout(el, 1400, 300, 500);

    pointer(el, 'pointerdown', { clientX: 100 });
    expect(el.classList.contains('dragging')).toBe(true);
    const move = pointer(el, 'pointermove', { clientX: 160 });
    expect(el.scrollLeft).toBe(440);
    expect(move.defaultPrevented).toBe(true);
    expect(dayCount(el)).toBe(14);

    pointer(el, 'pointerup', { clientX: 160 });
    expect(el.classList.contains('dragging')).toBe(false);
    pointer(el, 'pointermove', { clientX: 200 });
    expect(el.scrollLeft).toBe(440);
  });

  it('拖曳到最左側向右超過二十四像素時補前十四天並重設起點', () => {
    const { el } = renderStrip();
    setLayout(el, 1400, 300, 60);
    Object.defineProperty(el, 'scrollWidth', {
      configurable: true,
      get: () => dayCount(el) * 100,
    });

    pointer(el, 'pointerdown', { clientX: 100 });
    pointer(el, 'pointermove', { clientX: 160 });
    expect(el.dataset.rangeStart).toBe('-14');
    expect(dayCount(el)).toBe(28);
    expect(el.scrollLeft).toBe(1400);

    nextFrame();
    pointer(el, 'pointermove', { clientX: 170 });
    expect(el.scrollLeft).toBe(1390);
    expect(dayCount(el)).toBe(28);
  });

  it('向右拖曳未超過二十四像素時不往前延伸', () => {
    const { el } = renderStrip();
    setLayout(el, 1400, 300, 24);

    pointer(el, 'pointerdown', { clientX: 100 });
    pointer(el, 'pointermove', { clientX: 124 });

    expect(el.scrollLeft).toBe(0);
    expect(el.dataset.rangeStart).toBe('0');
    expect(dayCount(el)).toBe(14);
  });

  it('拖曳接近尾端時往後延伸', () => {
    const { el } = renderStrip();
    setLayout(el, 1400, 300, 900);

    pointer(el, 'pointerdown', { clientX: 100 });
    pointer(el, 'pointermove', { clientX: 0 });

    expect(el.scrollLeft).toBe(1000);
    expect(el.dataset.rangeEnd).toBe('27');
    expect(dayCount(el)).toBe(28);
  });

  it('滑鼠右鍵不會開始拖曳', () => {
    const { el } = renderStrip();
    setLayout(el, 1400, 300, 500);

    pointer(el, 'pointerdown', { clientX: 100, button: 2 });
    pointer(el, 'pointermove', { clientX: 160 });

    expect(el.classList.contains('dragging')).toBe(false);
    expect(el.scrollLeft).toBe(500);
    expect(dayCount(el)).toBe(14);
  });

  it.each(['pointercancel', 'pointerleave'])('%s 會結束拖曳並釋放指標捕捉', (type) => {
    const { el } = renderStrip();
    setLayout(el, 1400, 300, 500);
    const capture = vi.fn();
    const release = vi.fn();
    Object.defineProperties(el, {
      setPointerCapture: { configurable: true, value: capture },
      releasePointerCapture: { configurable: true, value: release },
    });

    pointer(el, 'pointerdown', { pointerId: 7 });
    expect(capture).toHaveBeenCalledWith(7);
    pointer(el, type, { pointerId: 7 });
    expect(release).toHaveBeenCalledWith(7);
    expect(el.classList.contains('dragging')).toBe(false);

    pointer(el, 'pointermove', { clientX: 160, pointerId: 7 });
    expect(el.scrollLeft).toBe(500);
  });

  it('指標捕捉拋出例外時仍可開始及結束拖曳', () => {
    const { el } = renderStrip();
    Object.defineProperties(el, {
      setPointerCapture: {
        configurable: true,
        value: () => {
          throw new Error('無法捕捉');
        },
      },
      releasePointerCapture: {
        configurable: true,
        value: () => {
          throw new Error('已經釋放');
        },
      },
    });

    expect(() => pointer(el, 'pointerdown')).not.toThrow();
    expect(el.classList.contains('dragging')).toBe(true);
    expect(() => pointer(el, 'pointerup')).not.toThrow();
    expect(el.classList.contains('dragging')).toBe(false);
  });

  it('活動集合換新後更新圓點，保留延伸範圍與既有日期節點', () => {
    const { el, rerender, container } = renderStrip(new Set(['2026-10-26']));
    setLayout(el, 1400, 300, 0);
    fireEvent.wheel(el, { deltaX: -20 });
    nextFrame();
    el.scrollLeft = 1000;
    fireEvent.scroll(el);
    nextFrame();

    const todayNode = getDay(el, '2026-10-26');
    const previousNode = getDay(el, '2026-10-12');
    const nextNode = getDay(el, '2026-11-22');

    rerender(
      <TeamDetailWeekStrip
        today={TODAY}
        eventDays={new Set(['2026-10-12', '2026-11-22'])}
      />,
    );

    expect(el.dataset.rangeStart).toBe('-14');
    expect(el.dataset.rangeEnd).toBe('27');
    expect(el.dataset.eventDays).toBe('2026-10-12|2026-11-22');
    expect(container.querySelectorAll('.td-v2-day').length).toBe(42);
    expect(getDay(el, '2026-10-26')).toBe(todayNode);
    expect(getDay(el, '2026-10-12')).toBe(previousNode);
    expect(getDay(el, '2026-11-22')).toBe(nextNode);
    expect(todayNode.querySelector('i')).toBeNull();
    expect(previousNode.querySelector('i')).not.toBeNull();
    expect(nextNode.querySelector('i')).not.toBeNull();
    expect(el.querySelectorAll('i').length).toBe(2);
  });

  it('卸載時取消尚未完成的動畫幀', () => {
    const { el, unmount } = renderStrip();
    setLayout(el, 1400, 300, 1000);
    fireEvent.scroll(el);
    expect(frames.size).toBe(1);

    unmount();
    expect(frames.size).toBe(0);
  });
});
