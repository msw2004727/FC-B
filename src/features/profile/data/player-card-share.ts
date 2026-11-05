/**
 * T-092 分享球員卡 PNG 的三條路：
 * 1. `navigator.canShare({ files })` 可用 → `navigator.share`（系統分享表）。
 * 2. LINE 內建瀏覽器（UA 含 `Line/`；LIFF 在 LINE 內開啟時 UA 同樣含 `Line/`）且不能分享檔案 → 圖片覆蓋層長按存圖。
 * 3. 其他（多半是桌機）→ 直接下載 PNG。
 * 系統分享被拒（例如產圖太久讓瀏覽器判定失去使用者手勢）時退回覆蓋層，讓使用者在覆蓋層內再存圖；
 * 使用者自己取消（AbortError）則什麼都不做。
 */

export type PlayerCardShareRoute = 'share' | 'overlay' | 'download';

export interface ShareNavigatorLike {
  userAgent?: string;
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}

export const PLAYER_CARD_FILE_NAME = 'toosterx-player-card.png';

export function isLineInAppBrowser(userAgent: string | undefined): boolean {
  return /\bLine\//i.test(userAgent ?? '');
}

export function canShareFile(nav: ShareNavigatorLike, file: File): boolean {
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [file] }) === true;
  } catch {
    return false;
  }
}

export function choosePlayerCardShareRoute(nav: ShareNavigatorLike, file: File): PlayerCardShareRoute {
  if (canShareFile(nav, file)) return 'share';
  if (isLineInAppBrowser(nav.userAgent)) return 'overlay';
  return 'download';
}

export type PlayerCardShareOutcome = 'shared' | 'cancelled' | 'overlay' | 'downloaded';

export interface SharePlayerCardDeps {
  nav: ShareNavigatorLike;
  download: (blob: Blob, fileName: string) => void;
}

function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError');
}

/** 回傳 'overlay' 時由呼叫端顯示圖片覆蓋層。 */
export async function sharePlayerCardBlob(
  blob: Blob,
  deps: SharePlayerCardDeps,
): Promise<PlayerCardShareOutcome> {
  const file = new File([blob], PLAYER_CARD_FILE_NAME, { type: 'image/png' });
  const route = choosePlayerCardShareRoute(deps.nav, file);
  if (route === 'share' && deps.nav.share) {
    try {
      await deps.nav.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (isAbortError(err)) return 'cancelled';
      return 'overlay';
    }
  }
  if (route === 'overlay') return 'overlay';
  deps.download(blob, PLAYER_CARD_FILE_NAME);
  return 'downloaded';
}

export function browserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 覆蓋層用 data URL（LINE 內建瀏覽器長按 blob: 網址的圖可能存不下來）。 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}
