import type { ShareEvent } from './event-share-builders';

interface CalendarEvent {
  title: string;
  location: string;
  description: string;
  start: Date;
  end: Date;
}

type CalendarLiff = Pick<typeof import('@line/liff').default, 'isInClient' | 'openWindow'>;

interface CalendarOptions {
  signal: AbortSignal;
  showToast: (message: string) => void;
  loadLiff?: () => Promise<CalendarLiff | null>;
  openWindow?: (url: string) => void;
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
  if (!match) return null;
  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10) - 1;
  const day = parseInt(match[3]!, 10);
  const start = new Date(year, month, day, parseInt(match[4]!, 10), parseInt(match[5]!, 10), 0);
  const end = match[6] && match[7]
    ? new Date(year, month, day, parseInt(match[6], 10), parseInt(match[7], 10), 0)
    : new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { start, end };
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

// 照 A _toGcalDateStr，使用本地時間，不加 Z。
export function toGcalDateStr(date: Date): string {
  const pad = (number: number): string => number < 10 ? '0' + number : '' + number;
  return date.getFullYear()
    + pad(date.getMonth() + 1)
    + pad(date.getDate()) + 'T'
    + pad(date.getHours())
    + pad(date.getMinutes())
    + pad(date.getSeconds());
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
    let liff: CalendarLiff | null = null;
    try {
      liff = options.loadLiff
        ? await options.loadLiff()
        : (await import('@line/liff')).default;
    } catch {
      // 照 A：一般瀏覽器不依賴 LIFF。
    }
    if (options.signal.aborted) return;

    let inClient = false;
    try {
      inClient = Boolean(liff?.isInClient());
    } catch {
      inClient = false;
    }
    if (liff && inClient) {
      liff.openWindow({ url, external: true });
    } else if (options.openWindow) {
      options.openWindow(url);
    } else {
      window.open(url, '_blank');
    }
    notify('正在開啟 Google 行事曆…');
  } finally {
    calendarInProgress = false;
  }
}
