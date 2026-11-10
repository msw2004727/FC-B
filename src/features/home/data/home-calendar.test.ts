import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventDoc } from '@/features/events/data/types';

const addEventToCalendar = vi.hoisted(() => vi.fn(async (_event: unknown, _options: unknown) => undefined));
vi.mock('@/features/events/data/event-calendar', () => ({ addEventToCalendar }));

import {
  _resetCalendarModuleForTest,
  addNextActivityToCalendar,
  preloadCalendarModule,
  toCalendarShareEvent,
} from './home-calendar';

const options = () => ({ signal: new AbortController().signal, showToast: vi.fn() });

afterEach(() => {
  _resetCalendarModuleForTest();
  addEventToCalendar.mockClear();
});

describe('toCalendarShareEvent', () => {
  it('只帶行事曆需要的欄位，數字逐一驗證', () => {
    const event = {
      id: 'e1', title: '夜跑', date: '2099/06/03 19:30~21:30', location: '公園', type: 'play',
      max: 20, current: 'x', fee: Number.NaN, notes: 123, secret: 'ignored',
    } as unknown as EventDoc;
    expect(toCalendarShareEvent(event)).toEqual({
      id: 'e1', title: '夜跑', date: '2099/06/03 19:30~21:30', location: '公園', type: 'play',
      max: 20, current: undefined, fee: undefined, notes: undefined,
    });
  });
});

describe('addNextActivityToCalendar', () => {
  it('已預載：同一個呼叫堆疊內直接呼叫 addEventToCalendar（保持在點擊手勢內）', async () => {
    await preloadCalendarModule();
    const opts = options();
    const pending = addNextActivityToCalendar({ id: 'e1', title: 't' } as EventDoc, opts);
    expect(addEventToCalendar).toHaveBeenCalledTimes(1);
    await pending;
    expect(addEventToCalendar.mock.calls[0]?.[1]).toBe(opts);
  });

  it('尚未預載：先載入再呼叫', async () => {
    await addNextActivityToCalendar({ id: 'e2', title: 't' } as EventDoc, options());
    expect(addEventToCalendar).toHaveBeenCalledTimes(1);
  });

  it('預載只做一次（重複呼叫回傳同一個 Promise）', async () => {
    const first = preloadCalendarModule();
    expect(preloadCalendarModule()).toBe(first);
    await first;
  });
});
