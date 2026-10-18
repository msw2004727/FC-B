import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('qrcode', () => ({
  toCanvas: vi.fn(
    (
      _canvas: unknown,
      _text: string,
      _opts: unknown,
      cb: (err: Error | null) => void,
    ): void => {
      cb(null);
    },
  ),
}));

import { buildIdentityQrPayload, renderQrToCanvas } from './qr';

describe('buildIdentityQrPayload（R-SHARE-004）', () => {
  it('回傳 raw UID（不包成任何 URL）', () => {
    const uid = 'U0123456789abcdef';
    const out = buildIdentityQrPayload(uid);
    expect(out).toBe(uid);
    expect(out).not.toContain('http');
    expect(out).not.toContain('line.me');
    expect(out.startsWith('U')).toBe(true);
  });

  it('前後空白會被 trim', () => {
    expect(buildIdentityQrPayload('  U123 ')).toBe('U123');
  });

  it('空值丟錯', () => {
    expect(() => buildIdentityQrPayload('')).toThrow();
    expect(() => buildIdentityQrPayload('   ')).toThrow();
  });
});

describe('renderQrToCanvas（R-SHARE-013：本機、無網路）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('清除 qrcode 寫入的 inline 尺寸，讓外框 CSS 控制顯示大小（窄螢幕不裁切）', async () => {
    const qr = await import('qrcode');
    vi.mocked(qr.toCanvas).mockImplementationOnce(((canvas: HTMLCanvasElement, _t: string, _o: unknown, cb: (e: Error | null) => void) => {
      canvas.style.width = '400px';
      canvas.style.height = '400px';
      cb(null);
    }) as never);
    const canvas = document.createElement('canvas');
    await renderQrToCanvas(canvas, 'U123');
    expect(canvas.style.width).toBe('');
    expect(canvas.style.height).toBe('');
  });

  it('呼叫本機 qrcode.toCanvas；不觸發 fetch 或 Image', async () => {
    const qr = await import('qrcode');
    const fetchSpy = vi.fn((): never => {
      throw new Error('fetch should not be called');
    });
    const ImageSpy = vi.fn((): never => {
      throw new Error('Image should not be called');
    });
    const originalFetch = globalThis.fetch;
    const originalImage = (globalThis as unknown as { Image?: unknown }).Image;

    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    (globalThis as unknown as { Image: unknown }).Image = ImageSpy;

    try {
      const canvas = document.createElement('canvas');
      await renderQrToCanvas(canvas, 'U123');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(ImageSpy).not.toHaveBeenCalled();
      expect(qr.toCanvas).toHaveBeenCalledTimes(1);

      const call = vi.mocked(qr.toCanvas).mock.calls[0]!;
      expect(call[1]).toBe('U123');
      expect(call[2]).toEqual({
        width: 400,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as unknown as { Image?: unknown }).Image = originalImage;
    }
  });

  it('本機產生失敗時丟錯（不 fallback 外部服務）', async () => {
    const qr = await import('qrcode');
    vi.mocked(qr.toCanvas).mockImplementationOnce(((...args: unknown[]) => {
      const cb = args[3] as (err: Error | null) => void;
      cb(new Error('local failure'));
    }) as unknown as typeof qr.toCanvas);

    const canvas = document.createElement('canvas');
    await expect(renderQrToCanvas(canvas, 'U123')).rejects.toThrow('local failure');
  });

  it('text 為空字串丟錯', async () => {
    const canvas = document.createElement('canvas');
    await expect(renderQrToCanvas(canvas, '')).rejects.toThrow();
  });
});
