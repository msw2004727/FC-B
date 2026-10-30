import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  COMPRESS_DEFAULT_MAX_WIDTH,
  COMPRESS_JPEG_FALLBACK_QUALITY,
  COMPRESS_WEBP_QUALITY,
  ImageCompressError,
  compressToWebp,
  scaledSize,
  type CompressCanvasLike,
  type CompressImageLike,
} from './image-compress';

const JPEG_URL = 'data:image/jpeg;base64,AAAA';
const JPG_URL = 'data:image/jpg;base64,AAAA';
const PNG_URL = 'data:image/png;base64,AAAA';
const WEBP_URL = 'data:image/webp;base64,AAAA';

type FakeCanvas = CompressCanvasLike & { toDataURL: Mock };

function fakeCanvas(webpSupported: boolean) {
  const drawImage = vi.fn();
  const ctx = { imageSmoothingEnabled: false, imageSmoothingQuality: '', drawImage };
  // 編碼當下的畫布尺寸（用完會歸零，所以要在編碼時記錄）。
  const sizesAtEncode: Array<[number, number]> = [];
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn((type: string, quality?: number) => {
      sizesAtEncode.push([canvas.width, canvas.height]);
      // 不支援 WebP 編碼的環境（舊 LINE WebView）：canvas 對 image/webp 回 PNG。
      if (type === 'image/webp' && !webpSupported) return 'data:image/png;base64,PNG';
      return `data:${type};base64,Q${quality}`;
    }),
  };
  return { canvas, ctx, drawImage, toDataURL: canvas.toDataURL, sizesAtEncode };
}

function deps(image: CompressImageLike, canvas: CompressCanvasLike) {
  return {
    loadImage: vi.fn(async () => image),
    createCanvas: vi.fn(() => canvas),
  };
}

describe('scaledSize', () => {
  it('寬度沒超過上限就原尺寸（不放大）', () => {
    expect(scaledSize(800, 400, 1200)).toEqual({ width: 800, height: 400 });
    expect(scaledSize(1200, 545, 1200)).toEqual({ width: 1200, height: 545 });
  });

  it('寬度超過上限才等比縮小並四捨五入', () => {
    expect(scaledSize(2400, 1090, 1200)).toEqual({ width: 1200, height: 545 });
    expect(scaledSize(1601, 900, 1200)).toEqual({ width: 1200, height: 675 });
  });

  it('尺寸不合法丟 invalid-input', () => {
    const bad: Array<[number, number]> = [
      [0, 10],
      [10, 0],
      [-1, 5],
      [Number.NaN, 5],
      [5, Number.POSITIVE_INFINITY],
    ];
    for (const [w, h] of bad) {
      expect(() => scaledSize(w, h, 1200)).toThrowError(ImageCompressError);
    }
  });
});

describe('compressToWebp', () => {
  it('預設值：尺寸上限 1200、WebP 品質 0.72（T-046）、降級 JPEG 0.8（D2）', () => {
    expect(COMPRESS_DEFAULT_MAX_WIDTH).toBe(1200);
    expect(COMPRESS_WEBP_QUALITY).toBe(0.72);
    expect(COMPRESS_JPEG_FALLBACK_QUALITY).toBe(0.8);
  });

  it('輸出 WebP，品質參數預設 0.72', async () => {
    const { canvas, toDataURL } = fakeCanvas(true);
    const out = await compressToWebp(PNG_URL, {}, deps({ width: 1200, height: 545 }, canvas));
    expect(out).toBe('data:image/webp;base64,Q0.72');
    expect(toDataURL).toHaveBeenCalledTimes(1);
    expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.72);
  });

  it('品質參數可指定，並夾在 0.5～1；非數字退回預設', async () => {
    const cases: Array<[unknown, number]> = [
      [0.9, 0.9],
      [0.2, 0.5],
      [5, 1],
      [Number.NaN, 0.72],
      [undefined, 0.72],
    ];
    for (const [input, expected] of cases) {
      const { canvas, toDataURL } = fakeCanvas(true);
      await compressToWebp(
        PNG_URL,
        { quality: input as number },
        deps({ width: 1000, height: 500 }, canvas),
      );
      expect(toDataURL).toHaveBeenCalledWith('image/webp', expected);
    }
  });

  it('寬度超過 1200 等比縮小到 1200×545，drawImage 用縮小後尺寸', async () => {
    const { canvas, drawImage, ctx, sizesAtEncode } = fakeCanvas(true);
    const image = { width: 2400, height: 1090 };
    await compressToWebp(JPEG_URL, { maxWidth: 1200 }, deps(image, canvas));
    expect(sizesAtEncode).toEqual([[1200, 545]]);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 1200, 545);
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe('high');
  });

  it('寬度沒超過上限不放大', async () => {
    const { canvas, sizesAtEncode } = fakeCanvas(true);
    await compressToWebp(PNG_URL, {}, deps({ width: 800, height: 400 }, canvas));
    expect(sizesAtEncode).toEqual([[800, 400]]);
  });

  it('優先使用 naturalWidth／naturalHeight', async () => {
    const { canvas, sizesAtEncode } = fakeCanvas(true);
    await compressToWebp(
      PNG_URL,
      {},
      deps({ width: 10, height: 10, naturalWidth: 3000, naturalHeight: 1500 }, canvas),
    );
    expect(sizesAtEncode).toEqual([[1200, 600]]);
  });

  it('環境不支援 WebP 時降級 JPEG 0.8', async () => {
    const { canvas, toDataURL } = fakeCanvas(false);
    const out = await compressToWebp(PNG_URL, {}, deps({ width: 1200, height: 545 }, canvas));
    expect(out).toBe('data:image/jpeg;base64,Q0.8');
    expect(toDataURL).toHaveBeenNthCalledWith(1, 'image/webp', 0.72);
    expect(toDataURL).toHaveBeenNthCalledWith(2, 'image/jpeg', 0.8);
  });

  it('降級品質可指定', async () => {
    const { canvas, toDataURL } = fakeCanvas(false);
    await compressToWebp(PNG_URL, { fallbackQuality: 0.6 }, deps({ width: 1200, height: 545 }, canvas));
    expect(toDataURL).toHaveBeenLastCalledWith('image/jpeg', 0.6);
  });

  it.each([
    ['WebP', WEBP_URL],
    ['JPEG', JPEG_URL],
    ['JPG', JPG_URL],
  ])('已經是 %s 且寬度沒超過上限：原樣回傳，不重編（F8）', async (_name, url) => {
    const { canvas, toDataURL } = fakeCanvas(true);
    const d = deps({ width: 1200, height: 545 }, canvas);
    const out = await compressToWebp(url, {}, d);
    expect(out).toBe(url);
    expect(d.createCanvas).not.toHaveBeenCalled();
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('PNG 沒超寬仍要重編（PNG 不是有損壓縮格式）', async () => {
    const { canvas, toDataURL } = fakeCanvas(true);
    await compressToWebp(PNG_URL, {}, deps({ width: 1200, height: 545 }, canvas));
    expect(toDataURL).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['WebP', WEBP_URL],
    ['JPEG', JPEG_URL],
  ])('%s 但寬度超過上限：仍要縮小重編', async (_name, url) => {
    const { canvas, toDataURL } = fakeCanvas(true);
    const out = await compressToWebp(url, {}, deps({ width: 2400, height: 1090 }, canvas));
    expect(out).toBe('data:image/webp;base64,Q0.72');
    expect(toDataURL).toHaveBeenCalledTimes(1);
  });

  it('編碼完成後 canvas 寬高歸零（F14）', async () => {
    const { canvas } = fakeCanvas(true);
    await compressToWebp(PNG_URL, {}, deps({ width: 1200, height: 545 }, canvas));
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('編碼失敗或取不到 context 時 canvas 也會歸零', async () => {
    const failing = fakeCanvas(true);
    failing.toDataURL.mockImplementation(() => {
      throw new Error('toDataURL failed');
    });
    await expect(
      compressToWebp(PNG_URL, {}, deps({ width: 1200, height: 545 }, failing.canvas)),
    ).rejects.toThrow('toDataURL failed');
    expect(failing.canvas.width).toBe(0);
    expect(failing.canvas.height).toBe(0);

    const noCtx = { width: 5, height: 5, getContext: () => null, toDataURL: vi.fn() };
    await expect(
      compressToWebp(PNG_URL, {}, deps({ width: 100, height: 100 }, noCtx)),
    ).rejects.toMatchObject({ code: 'canvas-unavailable' });
    expect(noCtx.width).toBe(0);
    expect(noCtx.height).toBe(0);
  });

  it('非圖片 data URL 丟 invalid-input，且不載入圖片', async () => {
    const { canvas } = fakeCanvas(true);
    const d = deps({ width: 10, height: 10 }, canvas);
    for (const bad of ['', 'https://example.com/a.png', 'data:text/plain;base64,AAAA', 'javascript:alert(1)']) {
      await expect(compressToWebp(bad, {}, d)).rejects.toMatchObject({ code: 'invalid-input' });
    }
    expect(d.loadImage).not.toHaveBeenCalled();
  });

  it('圖片解碼失敗丟 decode-failed', async () => {
    const { canvas } = fakeCanvas(true);
    const d = {
      loadImage: vi.fn(async () => {
        throw new Error('boom');
      }),
      createCanvas: vi.fn(() => canvas),
    };
    await expect(compressToWebp(PNG_URL, {}, d)).rejects.toMatchObject({ code: 'decode-failed' });
  });
});
