// 個人頁 QR。
//
// - R-SHARE-004：身分 QR 內容必須是 raw LINE UID，不得包成分享 URL。
// - R-SHARE-013：禁止任何第三方 QR 服務或外部 URL；一律本機 `qrcode` 產生，
//   本機失敗時丟錯，不 fallback 到外部服務。
//
// 對應 A `_generateQrCode` / `renderQrCodePage` 的資料契約部分（不含 A 的圖片快取與外部 CDN）。

const QR_RENDER_OPTIONS = {
  width: 400,
  margin: 2,
  errorCorrectionLevel: 'M' as const,
};

/**
 * 建構身分 QR 內容（A `_generateQrCode` 呼叫的 data 值）。
 * 只回傳正規化後的 UID 字串；空值直接丟錯，避免 `unknown` 之類的假 payload 被掃出。
 */
export function buildIdentityQrPayload(uid: string): string {
  const safe = String(uid || '').trim();
  if (!safe) throw new Error('[qr] buildIdentityQrPayload requires a non-empty uid');
  return safe;
}

type ToCanvasFn = (
  canvas: HTMLCanvasElement,
  text: string,
  options: typeof QR_RENDER_OPTIONS,
  cb: (err: Error | null) => void,
) => void;

/**
 * 以本機 `qrcode` 套件把 `text` 畫上 canvas。
 * 任何失敗一律 reject；不嘗試外部 QR 服務（R-SHARE-013）。
 */
export async function renderQrToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
): Promise<void> {
  if (!canvas) throw new Error('[qr] canvas is required');
  const safeText = String(text || '');
  if (!safeText) throw new Error('[qr] text is required');

  const mod = (await import('qrcode')) as unknown as {
    toCanvas?: ToCanvasFn;
    default?: { toCanvas?: ToCanvasFn };
  };
  const toCanvas = mod.toCanvas || mod.default?.toCanvas;
  if (typeof toCanvas !== 'function') {
    throw new Error('[qr] qrcode.toCanvas not available');
  }

  await new Promise<void>((resolve, reject) => {
    try {
      toCanvas(canvas, safeText, QR_RENDER_OPTIONS, (err) => {
        if (err) reject(err);
        else resolve();
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
