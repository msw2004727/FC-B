import { describe, expect, it, vi } from 'vitest';
import {
  BANNER_MAX_UPLOAD_BYTES,
  BannerImageError,
  dataUrlBytes,
  uploadBannerImage,
} from './banner-upload';
import type { BannerActor } from './banner-admin';

const ADMIN: BannerActor = { uid: 'u_admin', hasPermission: (code) => code === 'admin.banners.entry' };
const NO_PERM: BannerActor = { uid: 'u_admin', hasPermission: () => false };
const DATA_URL = 'data:image/png;base64,AAAA';

function bytesToBase64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

describe('dataUrlBytes', () => {
  it('由 base64 長度推算位元組數（含 padding）', () => {
    expect(dataUrlBytes('data:image/webp;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/webp;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:image/webp;base64,AA==')).toBe(1);
    expect(dataUrlBytes('data:image/webp;base64,')).toBe(0);
    expect(dataUrlBytes('no comma')).toBe(0);
  });
});

describe('uploadBannerImage', () => {
  it('壓縮參數：寬度上限 1200、WebP 品質 0.72；路徑 banners/{bannerId}；回傳網址', async () => {
    const compress = vi.fn().mockResolvedValue('data:image/webp;base64,BBBB');
    const upload = vi.fn().mockResolvedValue('https://storage.example/banner.webp');
    const url = await uploadBannerImage(DATA_URL, 'ban1', ADMIN, { compress, upload });
    expect(compress).toHaveBeenCalledWith(DATA_URL, { maxWidth: 1200, quality: 0.72 });
    expect(upload).toHaveBeenCalledWith('data:image/webp;base64,BBBB', 'banners/ban1');
    expect(url).toBe('https://storage.example/banner.webp');
  });

  it('上傳失敗（uploadImageDataUrl 回 null）：回 null，呼叫端不寫 Firestore', async () => {
    const upload = vi.fn().mockResolvedValue(null);
    const url = await uploadBannerImage(DATA_URL, 'ban1', ADMIN, {
      compress: vi.fn().mockResolvedValue(DATA_URL),
      upload,
    });
    expect(url).toBeNull();
  });

  it('沒有 admin.banners.entry：拒絕，不壓縮也不上傳', async () => {
    const compress = vi.fn();
    const upload = vi.fn();
    for (const who of [NO_PERM, null, undefined, { uid: null, hasPermission: () => true } as BannerActor]) {
      await expect(uploadBannerImage(DATA_URL, 'ban1', who, { compress, upload })).rejects.toMatchObject({
        code: 'permission-denied',
      });
    }
    expect(compress).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(['', 'a/b', '../x', 'ban 1', 'x'.repeat(121)])('bannerId「%s」不合法：拒絕', async (id) => {
    const upload = vi.fn();
    await expect(
      uploadBannerImage(DATA_URL, id, ADMIN, { compress: vi.fn(), upload }),
    ).rejects.toMatchObject({ code: 'invalid-id' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('壓縮失敗：丟 process-failed，不上傳', async () => {
    const upload = vi.fn();
    const compress = vi.fn().mockRejectedValue(new Error('decode failed'));
    await expect(uploadBannerImage(DATA_URL, 'ban1', ADMIN, { compress, upload })).rejects.toMatchObject({
      code: 'process-failed',
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('壓縮後仍 >= 2MB（Storage Rules size < 2MB）：丟 too-large，不上傳', async () => {
    const upload = vi.fn();
    const base64 = 'A'.repeat(bytesToBase64Length(BANNER_MAX_UPLOAD_BYTES));
    const compress = vi.fn().mockResolvedValue(`data:image/webp;base64,${base64}`);
    const error = await uploadBannerImage(DATA_URL, 'ban1', ADMIN, { compress, upload }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BannerImageError);
    expect(error).toMatchObject({ code: 'too-large' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('剛好小於 2MB 可以上傳', async () => {
    const upload = vi.fn().mockResolvedValue('https://storage.example/ok.webp');
    const base64 = 'A'.repeat(bytesToBase64Length(BANNER_MAX_UPLOAD_BYTES - 3));
    const compress = vi.fn().mockResolvedValue(`data:image/webp;base64,${base64}`);
    await expect(uploadBannerImage(DATA_URL, 'ban1', ADMIN, { compress, upload })).resolves.toBe(
      'https://storage.example/ok.webp',
    );
  });
});
