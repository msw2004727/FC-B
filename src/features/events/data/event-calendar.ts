import { parseEventRangeMs } from '@/core/event-time';
import { openExternal } from '@/core/open-external';
import { taipeiParts } from '@/core/taipei-time';
import type { ShareEvent } from './event-share-builders';

interface CalendarEvent {
  title: string;
  location: string;
  description: string;
  start: Date;
  end: Date;
}

interface CalendarOptions {
  signal: AbortSignal;
  showToast: (message: string) => void;
}

let calendarInProgress = false;

// 照 A _parseEventDateRange，不自行增加跨日或日期正規化規則。
export function parseEventDateRange(dateStr: string | undefined): {
  start: Date;
  end: Date;
} | null {
  if (!dateStr) return null;
  const match = String(dateStr).match(
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*[~\uFF5E\-]\s*(\d{1,2}):(\d{2}))?/,
  );
  // P12 例外（PM 補充決議）：沒有時間（只有日期、ISO）一律回 null，由上面的正規式保證。
  if (!match) return null;
  // 消費端保留既有範圍分隔符與分鐘精度；日期運算全部委派共用 helper。
  const range = parseEventRangeMs(
    `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}`
      + (match[6] && match[7] ? `~${match[6]}:${match[7]}` : ''),
  );
  if (!range) return null;
  // Date 僅包裝絕對瞬間；禁用本地 getter，讀欄位用 taipeiParts。
  return { start: new Date(range.startMs), end: new Date(range.endMs) };
}

// 照 A _buildCalendarDescription。
export function buildCalendarDescription(event: ShareEvent): string {
  const lines: string[] = [];
  if (event.type) lines.push('類型：' + event.type);
  if (event.max) lines.push('名額：' + (event.current || 0) + '/' + event.max + ' 人');
  if (event.fee) lines.push('費用：$' + event.fee);
  if (event.notes) lines.push('\n注意事項：\n' + event.notes);
  lines.push('\n— SportHub');
  return lines.join('\n');
}

// 照 A _toGcalDateStr，使用台北牆鐘，不加 Z。
export function toGcalDateStr(date: Date): string {
  const pad = (number: number): string => number < 10 ? '0' + number : '' + number;
  const parts = taipeiParts(date.getTime());
  return parts.year
    + pad(parts.month)
    + pad(parts.day) + 'T'
    + pad(parts.hour)
    + pad(parts.minute)
    + pad(parts.second);
}

export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const dates = toGcalDateStr(event.start) + '/' + toGcalDateStr(event.end);
  const params = [
    'action=TEMPLATE',
    'text=' + encodeURIComponent(event.title),
    'dates=' + dates,
    'location=' + encodeURIComponent(event.location),
    'details=' + encodeURIComponent(event.description),
    'ctz=Asia/Taipei',
  ];
  return 'https://calendar.google.com/calendar/render?' + params.join('&');
}

// 照 A addEventToCalendar／_openGoogleCalendar。
export async function addEventToCalendar(
  event: ShareEvent | null,
  options: CalendarOptions,
): Promise<void> {
  if (calendarInProgress || options.signal.aborted) return;
  calendarInProgress = true;
  const notify = (message: string): void => {
    if (!options.signal.aborted) options.showToast(message);
  };

  try {
    if (!event) {
      notify('找不到活動資料');
      return;
    }
    const parsed = parseEventDateRange(event.date);
    if (!parsed) {
      notify('無法解析活動時間');
      return;
    }
    const url = buildGoogleCalendarUrl({
      title: event.title || '',
      location: event.location || '',
      description: buildCalendarDescription(event),
      ...parsed,
    });
    if (options.signal.aborted) return;
    // 同步開窗，不先 await LIFF。openWindow 丟錯時 openExternal 退回具名分頁，不把錯誤丟給「操作失敗」。
    openExternal(url);
    notify('正在開啟 Google 行事曆…');
  } finally {
    calendarInProgress = false;
  }
}
