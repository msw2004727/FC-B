/**
 * 圖片壓縮（M-145，A `image-upload.js#_compressImage` 與 T-046 的 B 版）。
 *
 * 純前端 canvas：把 data URL 重新編碼成 WebP。
 * - 寬度上限預設 1200（超過才等比縮小，不放大）；T-046 規定橫幅尺寸 1200×545 不變，裁切由 ImageCropper 負責。
 * - WebP 品質預設 0.72（T-046：約 70～95 KB，原 0.9 約 140～190 KB）。
 * - 環境不支援 WebP 編碼（舊 LINE WebView 的 canvas 會回 PNG）時，降級為 JPEG，品質預設 0.8（顧問 D2）。
 * - 已經是 WebP 或 JPEG 且寬度沒超過上限的輸入原樣回傳，不重編（ImageCropper 已用 0.72 輸出，不支援 WebP 的環境
 *   則已降級成 JPEG；再編一次只會多一層失真）。體積由呼叫端的輸出大小檢查把關（橫幅：Storage Rules 的 2MB）。
 * - canvas 用完把寬高歸零，讓瀏覽器盡早釋放記憶體。
 *
 * 依賴可注入（loadImage／createCanvas），單元測試不需要真的 canvas。
 */

export const COMPRESS_DEFAULT_MAX_WIDTH = 1200;
export const COMPRESS_WEBP_QUALITY = 0.72;
export const COMPRESS_JPEG_FALLBACK_QUALITY = 0.8;

export interface CompressOptions {
  maxWidth?: number;
  /** WebP 品質（0.5～1）。 */
  quality?: number;
  /** 降級為 JPEG 時的品質（0.5～1）。 */
  fallbackQuality?: number;
}

export interface CompressImageLike {
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface CompressContextLike {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  drawImage(image: never, dx: number, dy: number, dw: number, dh: number): void;
}

export interface CompressCanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): CompressContextLike | null;
  toDataURL(type: string, quality?: number): string;
}

export interface CompressDeps {
  loadImage?: (src: string) => Promise<CompressImageLike>;
  createCanvas?: () => CompressCanvasLike;
}

export class ImageCompressError extends Error {
  readonly code: 'invalid-input' | 'decode-failed' | 'canvas-unavailable';

  constructor(code: ImageCompressError['code'], message: string) {
    super(message);
    this.name = 'ImageCompressError';
    this.code = code;
  }
}

function clampQuality(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0.5, Math.min(1, num)) : fallback;
}

/** 寬度超過上限才等比縮小；尺寸不合法（非正數、非有限數）丟 invalid-input。 */
export function scaledSize(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ImageCompressError('invalid-input', 'image size is invalid');
  }
  if (!Number.isFinite(maxWidth) || maxWidth <= 0 || width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

function defaultLoadImage(src: string): Promise<CompressImageLike> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageCompressError('decode-failed', 'image decode failed'));
    img.src = src;
  });
}

function defaultCreateCanvas(): CompressCanvasLike {
  return document.createElement('canvas') as unknown as CompressCanvasLike;
}

const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]+[;,]/i;
const WEBP_DATA_URL = /^data:image\/webp[;,]/i;
/** 已經是有損壓縮格式（WebP／JPEG）：沒超寬就不再編碼，避免多一層失真（F8）。 */
const LOSSY_DATA_URL = /^data:image\/(?:webp|jpe?g)[;,]/i;

export async function compressToWebp(
  dataUrl: string,
  options: CompressOptions = {},
  deps: CompressDeps = {},
): Promise<string> {
  if (typeof dataUrl !== 'string' || !IMAGE_DATA_URL.test(dataUrl)) {
    throw new ImageCompressError('invalid-input', 'input must be an image data URL');
  }
  const maxWidth = options.maxWidth ?? COMPRESS_DEFAULT_MAX_WIDTH;
  const quality = clampQuality(options.quality, COMPRESS_WEBP_QUALITY);
  const fallbackQuality = clampQuality(options.fallbackQuality, COMPRESS_JPEG_FALLBACK_QUALITY);
  const loadImage = deps.loadImage ?? defaultLoadImage;
  const createCanvas = deps.createCanvas ?? defaultCreateCanvas;

  let image: CompressImageLike;
  try {
    image = await loadImage(dataUrl);
  } catch (err) {
    if (err instanceof ImageCompressError) throw err;
    throw new ImageCompressError('decode-failed', 'image decode failed');
  }
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const size = scaledSize(naturalWidth, naturalHeight, maxWidth);

  if (LOSSY_DATA_URL.test(dataUrl) && size.width === naturalWidth) return dataUrl;

  const canvas = createCanvas();
  try {
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageCompressError('canvas-unavailable', 'canvas 2d context unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image as never, 0, 0, size.width, size.height);

    const webp = canvas.toDataURL('image/webp', quality);
    if (WEBP_DATA_URL.test(webp)) return webp;
    return canvas.toDataURL('image/jpeg', fallbackQuality);
  } finally {
    // F14：Safari／舊 WebView 的 canvas 記憶體不會立刻釋放，用完把寬高歸零。
    canvas.width = 0;
    canvas.height = 0;
  }
}
