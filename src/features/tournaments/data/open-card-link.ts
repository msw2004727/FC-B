/**
 * 開賽事卡片連結：一般瀏覽器開新分頁；LINE 內用外部瀏覽器。
 * 沿用活動「加入行事曆」的開法（`event-calendar.ts`）：先同步判斷 UA，不在 LINE 內就不等 LIFF，
 * 讓瀏覽器保留使用者手勢、新分頁不被擋；LINE 內用 `liff.openWindow({ url, external: true })`。
 */
import { normalizeHttpsUrl } from './card-model';

type LinkLiff = Pick<typeof import('@line/liff').default, 'isInClient' | 'openWindow'>;

export interface OpenCardLinkOptions {
  userAgent?: string;
  loadLiff?: () => Promise<LinkLiff | null>;
  openWindow?: (url: string) => void;
}

export function isLineUserAgent(userAgent: string): boolean {
  return /\bLine\//i.test(userAgent);
}

/**
 * 回傳 true 表示已由 LIFF 處理（呼叫端要 preventDefault 連結預設行為）；
 * false 表示交給瀏覽器預設的 `<a target="_blank">`。連結不合格（非 https）一律擋下並回 true。
 */
export function shouldHandleCardLink(url: string, userAgent: string): boolean {
  return !normalizeHttpsUrl(url) || isLineUserAgent(userAgent);
}

/** LINE 內：載入 LIFF 用外部瀏覽器開；LIFF 不可用時退回 window.open。 */
export async function openCardLinkInLine(url: string, options: OpenCardLinkOptions = {}): Promise<void> {
  const safe = normalizeHttpsUrl(url);
  if (!safe) return;
  const fallback = options.openWindow ?? ((target: string) => {
    window.open(target, '_blank', 'noopener,noreferrer');
  });
  let liff: LinkLiff | null = null;
  try {
    liff = options.loadLiff ? await options.loadLiff() : (await import('@line/liff')).default;
  } catch {
    liff = null;
  }
  let inClient = false;
  try {
    inClient = Boolean(liff?.isInClient());
  } catch {
    inClient = false;
  }
  if (liff && inClient) {
    try {
      liff.openWindow({ url: safe, external: true });
      return;
    } catch {
      // LIFF 尚未初始化等狀況：退回一般開法。
    }
  }
  fallback(safe);
}
