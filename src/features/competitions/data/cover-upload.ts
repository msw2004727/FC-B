// 賽事封面上傳（計畫書「賽事封面圖」做法甲、第 1 題與第 3 題）。只由 ui/cover-field.tsx 在選圖後動態載入，不進首頁入口。
//
// 流程：ImageCropper 已裁成 8:3、1200×450（WebP 0.72，不支援 WebP 的舊 WebView 退 JPEG）→ 這裡取正中央 4:3
// 縮成 224×168 清單縮圖（WebP 0.72，退 JPEG 0.8，同 core/image-compress.ts 的參數）→ 兩張傳到同一個
// images/competitions/c_{16 碼}/ 資料夾 → 拿兩個下載網址，交給 cpHost 驗證後寫入。
// - 資料夾鍵前端亂數產生：不放 cid（建立前還沒有）、不放 uid（根文件刻意不存建立者，§3.251 (c)）。
// - 路徑格式與後端 functions-cp validate.ts#coverOf 的 COVER_PATH_RE 相同，兩張必須同一個資料夾。
// - 每張都要 < 2MB（Storage 規則 images/** 的上限，另要求 image/*）；格式只會是 webp 或 jpg（後端只收這兩種）。
// - 上傳方式沿用活動封面與外部賽事卡：getStorageUploadTargets 依序試上傳 bucket、預設 bucket，一年快取。
// - 第一階段不刪舊圖（用戶端規則刪不掉）：換圖、建立失敗、放棄表單都會留下孤兒物件（計畫書第 5 題）。

import type { CompetitionCover } from './types';

export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 450;
export const THUMB_WIDTH = 224;
export const THUMB_HEIGHT = 168;
export const COVER_QUALITY = 0.72;
export const COVER_JPEG_QUALITY = 0.8;
/** Storage 規則 images/**：request.resource.size < 2MB。 */
export const COVER_MAX_BYTES = 2 * 1024 * 1024;

const FOLDER_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const COVER_FOLDER_RE = /^c_[a-z0-9]{16}$/;
export const COVER_PATH_RE = /^images\/competitions\/(c_[a-z0-9]{16})\/(cover|thumb)_[0-9]{13}\.(webp|jpg)$/;

export type CoverUploadErrorCode = 'format' | 'too-large' | 'image' | 'upload' | 'timeout';

export class CoverUploadError extends Error {
  readonly code: CoverUploadErrorCode;

  constructor(code: CoverUploadErrorCode, message: string) {
    super(message);
    this.name = 'CoverUploadError';
    this.code = code;
  }
}

export interface UploadedCover extends CompetitionCover {
  /** 本機縮圖（data URL），上傳後立刻顯示，不必再下載一次。 */
  thumbSrc: string;
}

/** 把一張 data URL 傳到某個物件路徑，回下載網址；失敗丟錯。 */
export type CoverPut = (dataUrl: string, path: string) => Promise<string>;

export interface CoverImageLike {
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface CoverCanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): {
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: string;
    drawImage(image: never, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  } | null;
  toDataURL(type: string, quality?: number): string;
}

export interface CoverUploadDeps {
  now?: () => number;
  /** 回 n 個 0～255 的亂數。 */
  randomBytes?: (n: number) => Uint8Array;
  loadImage?: (src: string) => Promise<CoverImageLike>;
  createCanvas?: () => CoverCanvasLike;
  /** 依序嘗試的上傳目標（每個目標一支 put）；預設是 getStorageUploadTargets 的兩個 bucket。 */
  targets?: () => Promise<CoverPut[]>;
  /** 整次上傳的上限（毫秒），預設 COVER_UPLOAD_TIMEOUT_MS。 */
  timeoutMs?: number;
}

/**
 * 整次上傳（縮圖＋兩張＋換 bucket）最多等 60 秒，超過丟 CoverUploadError('timeout')，封面欄可重選。
 * 不用 SDK 的 maxUploadRetryTime：它設在 FirebaseStorage instance 上（預設約 10 分鐘），而 getStorage(app, bucket)
 * 對同一個 bucket 回同一個 instance，活動封面、外部賽事卡也共用，改了會影響全站其他上傳。所以在這裡自己計時；
 * 代價是 uploadString 無法取消，逾時後背景那支請求可能稍後才傳完而成為孤兒（第一階段本來就接受孤兒，計畫書第 5 題）。
 */
export const COVER_UPLOAD_TIMEOUT_MS = 60_000;

function defaultRandomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** `c_` ＋ 16 碼 a-z0-9。 */
export function newCoverFolder(randomBytes: (n: number) => Uint8Array = defaultRandomBytes): string {
  const bytes = randomBytes(16);
  let key = 'c_';
  for (let i = 0; i < 16; i++) key += FOLDER_CHARS[(bytes[i] ?? 0) % FOLDER_CHARS.length];
  return key;
}

/** data URL 的格式對到副檔名；只收 WebP、JPEG。 */
export function coverExt(dataUrl: string): 'webp' | 'jpg' | null {
  if (/^data:image\/webp[;,]/i.test(dataUrl)) return 'webp';
  if (/^data:image\/jpe?g[;,]/i.test(dataUrl)) return 'jpg';
  return null;
}

/** data URL 解碼後的位元組數（base64 每 4 字 3 bytes，扣掉補位）。 */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  if (!/;base64,/i.test(dataUrl.slice(0, comma + 1))) return body.length;
  const pad = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.floor((body.length * 3) / 4) - pad;
}

export function coverPath(folder: string, kind: 'cover' | 'thumb', at: number, ext: 'webp' | 'jpg'): string {
  return `images/competitions/${folder}/${kind}_${at}.${ext}`;
}

function defaultLoadImage(src: string): Promise<CoverImageLike> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new CoverUploadError('image', 'cover decode failed'));
    img.src = src;
  });
}

function defaultCreateCanvas(): CoverCanvasLike {
  return document.createElement('canvas') as unknown as CoverCanvasLike;
}

/** 封面正中央 4:3 那一塊縮成 224×168；WebP 0.72，環境不支援 WebP 時退 JPEG 0.8。 */
export async function makeCoverThumb(coverDataUrl: string, deps: CoverUploadDeps = {}): Promise<string> {
  let image: CoverImageLike;
  try {
    image = await (deps.loadImage ?? defaultLoadImage)(coverDataUrl);
  } catch {
    throw new CoverUploadError('image', 'cover decode failed');
  }
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  if (!(w > 0 && h > 0)) throw new CoverUploadError('image', 'cover size invalid');
  // 取正中央、比例 4:3 的最大區塊（橫圖切左右、直圖切上下）。
  const sw = Math.min(w, (h * 4) / 3);
  const sh = (sw * 3) / 4;
  const canvas = (deps.createCanvas ?? defaultCreateCanvas)();
  try {
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new CoverUploadError('image', 'canvas 2d unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image as never, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    const webp = canvas.toDataURL('image/webp', COVER_QUALITY);
    return coverExt(webp) === 'webp' ? webp : canvas.toDataURL('image/jpeg', COVER_JPEG_QUALITY);
  } finally {
    // 同 image-compress.ts：Safari／舊 WebView 的 canvas 記憶體不會立刻釋放，用完歸零。
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function defaultTargets(): Promise<CoverPut[]> {
  const [{ ref, uploadString, getDownloadURL }, { getStorageUploadTargets }] = await Promise.all([
    import('firebase/storage'),
    import('@/data/storage'),
  ]);
  const targets = await getStorageUploadTargets();
  return targets.map((target) => async (dataUrl: string, path: string) => {
    const contentType = /^data:([^;,]+)/.exec(dataUrl)?.[1]?.trim();
    const metadata = { cacheControl: 'public, max-age=31536000', ...(contentType ? { contentType } : {}) };
    const snapshot = await uploadString(ref(target.service, path), dataUrl, 'data_url', metadata);
    return getDownloadURL(snapshot.ref);
  });
}

/** 檢查格式與大小：不合格丟 CoverUploadError，回副檔名。 */
function checkedExt(dataUrl: string): 'webp' | 'jpg' {
  const ext = coverExt(dataUrl);
  if (!ext) throw new CoverUploadError('format', 'cover must be webp or jpeg');
  if (dataUrlBytes(dataUrl) >= COVER_MAX_BYTES) throw new CoverUploadError('too-large', 'cover exceeds 2MB');
  return ext;
}

/**
 * 裁好的封面 → 產生縮圖 → 兩張傳到同一個資料夾、同一個 bucket。第一個 bucket 有任一張失敗就整組改試下一個；
 * 全部失敗丟 CoverUploadError('upload')；整次超過 COVER_UPLOAD_TIMEOUT_MS 丟 CoverUploadError('timeout')。
 * 已傳上去的那張成為孤兒（第一階段不刪）。
 */
export async function uploadCompetitionCover(coverDataUrl: string, deps: CoverUploadDeps = {}): Promise<UploadedCover> {
  const coverType = checkedExt(coverDataUrl);
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new CoverUploadError('timeout', 'cover upload timed out'));
    }, deps.timeoutMs ?? COVER_UPLOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([uploadBoth(coverDataUrl, coverType, deps, () => expired), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function uploadBoth(
  coverDataUrl: string,
  coverType: 'webp' | 'jpg',
  deps: CoverUploadDeps,
  expired: () => boolean,
): Promise<UploadedCover> {
  const thumbSrc = await makeCoverThumb(coverDataUrl, deps);
  const thumbType = checkedExt(thumbSrc);
  const folder = newCoverFolder(deps.randomBytes);
  const at = (deps.now ?? Date.now)();
  const coverAt = coverPath(folder, 'cover', at, coverType);
  const thumbAt = coverPath(folder, 'thumb', at, thumbType);
  let targets: CoverPut[];
  try {
    targets = await (deps.targets ?? defaultTargets)();
  } catch {
    throw new CoverUploadError('upload', 'storage unavailable');
  }
  for (const put of targets) {
    // 逾時後已經回報失敗：不再開下一張或下一個 bucket（背景那張 SDK 請求無法取消，由它自己結束）。
    if (expired()) break;
    try {
      const url = await put(coverDataUrl, coverAt);
      if (expired()) break;
      const thumb = await put(thumbSrc, thumbAt);
      return { url, thumb, thumbSrc };
    } catch {
      // 同活動封面：這個 bucket 失敗就試下一個。
    }
  }
  throw new CoverUploadError('upload', 'cover upload failed');
}
