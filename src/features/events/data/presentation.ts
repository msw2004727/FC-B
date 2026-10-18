import { eventStartMs } from './terminal';
import type { EventDoc } from './types';

export function publicEventHref(event: EventDoc): string | null {
  const id = event.id?.trim();
  return id ? `/events/${encodeURIComponent(id)}` : null;
}

export function sortEvents(events: readonly EventDoc[]): EventDoc[] {
  return [...events].sort((a, b) => {
    const aStart = eventStartMs(a) || Number.MAX_SAFE_INTEGER;
    const bStart = eventStartMs(b) || Number.MAX_SAFE_INTEGER;
    return aStart - bStart || (a.id ?? '').localeCompare(b.id ?? '');
  });
}

export function eventCapacity(event: EventDoc): {
  current: number | null;
  max: number | null;
} {
  // 已核實：A 的人數欄位為 current／max（資料契約 events 主文件）。
  // 原 EventDoc 尚未列出欄位，僅做局部唯讀驗證，不擴張寫入契約。
  const fields = event as EventDoc & { current?: unknown; max?: unknown };
  const count = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : null;
  return { current: count(fields.current), max: count(fields.max) };
}

export function eventStatusKey(status: string | undefined): string {
  switch (status) {
    case 'open':
    case 'full':
    case 'upcoming':
    case 'ended':
    case 'cancelled':
      return status;
    default:
      return 'unknown';
  }
}
