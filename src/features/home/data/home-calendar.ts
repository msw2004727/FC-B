import type { EventDoc } from '@/features/events/data/types';
import type { ShareEvent } from '@/features/events/data/event-share-builders';

// 首頁「我的下一場」的「加入行事曆」：重用活動頁同一個 addEventToCalendar（開啟預填標題、時間、地點與說明的
// Google 行事曆，Android、iOS、電腦通用）。模組在頁面載入後閒置時才預載，不進首頁入口；
// 預載完成後點擊會同步走到 openExternal（必須在使用者點擊的同一個呼叫堆疊內開窗，否則 iOS 會被擋）。

type CalendarModule = typeof import('@/features/events/data/event-calendar');

let loaded: CalendarModule | null = null;
let loading: Promise<CalendarModule> | null = null;

export function preloadCalendarModule(): Promise<CalendarModule> {
  if (!loading) {
    loading = import('@/features/events/data/event-calendar')
      .then((mod) => {
        loaded = mod;
        return mod;
      })
      .catch((error: unknown) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

export function _resetCalendarModuleForTest(): void {
  loaded = null;
  loading = null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** EventDoc → 行事曆需要的欄位（只挑用得到的，數字欄位逐一驗證）。 */
export function toCalendarShareEvent(event: EventDoc): ShareEvent {
  const raw = event as unknown as Record<string, unknown>;
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    location: event.location,
    type: event.type,
    max: finiteNumber(raw.max),
    current: finiteNumber(raw.current),
    fee: finiteNumber(raw.fee),
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
  };
}

export interface HomeCalendarOptions {
  signal: AbortSignal;
  showToast: (message: string) => void;
}

export async function addNextActivityToCalendar(event: EventDoc, options: HomeCalendarOptions): Promise<void> {
  // 已預載：同步走到 openExternal（保持在點擊的呼叫堆疊內）；還沒載完才等載入。
  const mod = loaded ?? (await preloadCalendarModule());
  await mod.addEventToCalendar(toCalendarShareEvent(event), options);
}
