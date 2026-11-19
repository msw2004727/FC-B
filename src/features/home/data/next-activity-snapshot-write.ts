/**
 * 首頁「我的下一場活動」本機快照的寫入端（延遲載入：讀完資料後才需要，不佔首頁入口 JS）。
 * 只有「這次向伺服器讀完、畫面確定要顯示這場」才寫；確定沒有下一場就刪掉。讀取端與格式說明見 `next-activity-snapshot.ts`。
 * 寫入當下逐欄白名單投影：每欄檢查型別與長度上限，圖片只收 http(s)，報名者名單、黑名單等其他欄位一律不會進快照。
 * 寫入失敗（容量滿、被停用）就盡量刪掉舊的，免得留著比剛取得的資料還舊的快照。
 */
import type { EventDoc } from '@/features/events/data/types';
import type { NextActivityResult } from './next-activity';
import {
  NEXT_ACTIVITY_SNAPSHOT_FORMAT_V,
  NEXT_ACTIVITY_SNAPSHOT_KEY,
  NEXT_ACTIVITY_SNAPSHOT_MAX_CHARS,
} from './next-activity-snapshot';

const MAX_TEXT = 500;
const MAX_URL = 2000;
const MAX_ID = 200;

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

function httpUrl(value: unknown): string | undefined {
  const raw = text(value, MAX_URL)?.trim();
  return raw && /^https?:\/\//i.test(raw) ? raw : undefined;
}

function projectEvent(row: EventDoc): EventDoc | null {
  const id = text(row.id, MAX_ID)?.trim();
  const date = text(row.date, MAX_TEXT);
  if (!id || !date) return null;
  const event: EventDoc = { id, date };
  const title = text(row.title, MAX_TEXT);
  if (title) event.title = title;
  const location = text(row.location, MAX_TEXT);
  if (location) event.location = location;
  const image = httpUrl(row.image);
  if (image) event.image = image;
  const homeNext = httpUrl(row.imageVariants?.homeNext);
  const cover = httpUrl(row.imageVariants?.cover);
  if (homeNext || cover) event.imageVariants = { ...(homeNext ? { homeNext } : {}), ...(cover ? { cover } : {}) };
  return event;
}

export function removeNextActivitySnapshot(): void {
  try {
    localStorage.removeItem(NEXT_ACTIVITY_SNAPSHOT_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 寫快照；格式不符（例如沒有日期字串或公開 id）就刪掉舊的、不存。 */
export function writeNextActivitySnapshot(owner: string, result: NextActivityResult, nowMs: number = Date.now()): void {
  const safeOwner = String(owner ?? '').trim();
  const event = result?.event ? projectEvent(result.event) : null;
  if (!safeOwner || safeOwner.length > MAX_ID || !event) {
    removeNextActivitySnapshot();
    return;
  }
  const reg = result.registration;
  const status = text(reg?.status, 40);
  const regRole = text(reg?.managedRole, 40);
  const projected = {
    event,
    registration: reg ? { ...(status ? { status } : {}), ...(regRole ? { managedRole: regRole } : {}) } : null,
    managedRole: text(result.managedRole, 40) ?? '',
  };
  try {
    const out = JSON.stringify({ v: NEXT_ACTIVITY_SNAPSHOT_FORMAT_V, owner: safeOwner, savedAt: nowMs, result: projected });
    if (out.length > NEXT_ACTIVITY_SNAPSHOT_MAX_CHARS) {
      removeNextActivitySnapshot();
      return;
    }
    localStorage.setItem(NEXT_ACTIVITY_SNAPSHOT_KEY, out);
  } catch {
    removeNextActivitySnapshot();
  }
}
