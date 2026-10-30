/**
 * 橫幅圖片上傳（M-145）：壓縮（WebP 0.72，尺寸上限 1200；不支援時降級 JPEG 0.8）→ 大小守門 → 既有的
 * `uploadImageDataUrl`（路徑 `images/banners/{bannerId}_{時間}`，`cacheControl: public, max-age=31536000`）。
 *
 * Storage Rules `images/**`：create／update 需登入、`size < 2MB`、`contentType image/*`。
 * A 的 UI 寫「5MB」是**輸入檔**上限（裁切前）；上傳的是壓縮後的結果（1200×545 約百 KB），所以另外守住輸出大小，
 * 超過就在送出前擋下，不讓使用者等到 Storage 拒絕。
 */
import {
  COMPRESS_DEFAULT_MAX_WIDTH,
  COMPRESS_WEBP_QUALITY,
  compressToWebp,
} from '@/core/image-compress';
import { uploadImageDataUrl } from '@/features/events/data/event-cover-upload';
import { canManageBanners, type BannerActor } from './banner-admin';

export const BANNER_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const BANNER_ID = /^[A-Za-z0-9_-]{1,120}$/;

export class BannerImageError extends Error {
  readonly code: 'permission-denied' | 'invalid-id' | 'process-failed' | 'too-large';

  constructor(code: BannerImageError['code'], message: string) {
    super(message);
    this.name = 'BannerImageError';
    this.code = code;
  }
}

/** data URL 解碼後的位元組數（不解碼，直接由 base64 長度推算）。 */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const body = dataUrl.slice(comma + 1);
  if (!/;base64,/i.test(dataUrl.slice(0, comma + 1))) return body.length;
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

export interface BannerUploadDeps {
  compress?: (dataUrl: string, options: { maxWidth: number; quality: number }) => Promise<string>;
  upload?: (dataUrl: string, path: string) => Promise<string | null>;
}

/** 成功回網址；上傳失敗回 null（`uploadImageDataUrl` 已經顯示過錯誤提示）；處理失敗丟 `BannerImageError`。 */
export async function uploadBannerImage(
  dataUrl: string,
  bannerId: string,
  actor: BannerActor | null | undefined,
  deps: BannerUploadDeps = {},
): Promise<string | null> {
  if (!canManageBanners(actor)) {
    throw new BannerImageError('permission-denied', 'admin.banners.entry required');
  }
  if (!BANNER_ID.test(bannerId)) throw new BannerImageError('invalid-id', 'invalid banner id');

  let compressed: string;
  try {
    compressed = await (deps.compress ?? compressToWebp)(dataUrl, {
      maxWidth: COMPRESS_DEFAULT_MAX_WIDTH,
      quality: COMPRESS_WEBP_QUALITY,
    });
  } catch (err) {
    throw new BannerImageError(
      'process-failed',
      err instanceof Error ? err.message : 'image processing failed',
    );
  }
  if (dataUrlBytes(compressed) >= BANNER_MAX_UPLOAD_BYTES) {
    throw new BannerImageError('too-large', 'compressed image exceeds 2MB');
  }
  return (deps.upload ?? uploadImageDataUrl)(compressed, `banners/${bannerId}`);
}
