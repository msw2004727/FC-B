import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/preact';

const mocks = vi.hoisted(() => ({
  targets: vi.fn(),
  ref: vi.fn(),
  uploadString: vi.fn(),
  getDownloadURL: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/data/storage', () => ({ getStorageUploadTargets: mocks.targets }));
vi.mock('firebase/storage', () => ({
  ref: mocks.ref,
  uploadString: mocks.uploadString,
  getDownloadURL: mocks.getDownloadURL,
}));
vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.toast } }));

import {
  DEFAULT_EVENT_COVER_URL,
  pickEventImage,
  resolveEventCoverImage,
  uploadEventImageVariants,
  uploadImageDataUrl,
} from './event-cover-upload';

beforeEach(() => {
  vi.resetAllMocks();
  document.documentElement.lang = 'zh-TW';
  mocks.targets.mockResolvedValue([
    { bucket: 'upload', service: 'upload-service' },
    { bucket: 'default', service: 'default-service' },
  ]);
  mocks.ref.mockImplementation((service: unknown, path: string) => ({ service, path }));
  mocks.uploadString.mockImplementation(async (ref: unknown) => ({ ref }));
  mocks.getDownloadURL.mockResolvedValue('https://example.com/uploaded.webp');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('uploadImageDataUrl', () => {
  it('使用 A 路徑、data_url 格式與 metadata；成功後不試下一個 bucket', async () => {
    const result = await uploadImageDataUrl(
      'data:image/webp;base64,AA',
      'events/ce_1_cover',
      () => 123,
    );

    expect(result).toBe('https://example.com/uploaded.webp');
    expect(mocks.ref).toHaveBeenCalledWith(
      'upload-service',
      'images/events/ce_1_cover_123',
    );
    expect(mocks.uploadString).toHaveBeenCalledWith(
      { service: 'upload-service', path: 'images/events/ce_1_cover_123' },
      'data:image/webp;base64,AA',
      'data_url',
      { cacheControl: 'public, max-age=31536000', contentType: 'image/webp' },
    );
    expect(mocks.getDownloadURL).toHaveBeenCalledWith({
      service: 'upload-service',
      path: 'images/events/ce_1_cover_123',
    });
    expect(mocks.uploadString).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('第一個 bucket 失敗時照順序改用預設 bucket', async () => {
    mocks.uploadString.mockRejectedValueOnce(new Error('bucket failed'));
    await expect(uploadImageDataUrl('data:image/png;base64,AA', 'events/ce_1', () => 456))
      .resolves.toBe('https://example.com/uploaded.webp');
    expect(mocks.ref.mock.calls).toEqual([
      ['upload-service', 'images/events/ce_1_456'],
      ['default-service', 'images/events/ce_1_456'],
    ]);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('取得下載網址失敗也會嘗試下一個 bucket', async () => {
    mocks.getDownloadURL.mockRejectedValueOnce(new Error('download URL failed'));
    await expect(uploadImageDataUrl('data:image/png;base64,AA', 'events/ce_1'))
      .resolves.toBe('https://example.com/uploaded.webp');
    expect(mocks.uploadString).toHaveBeenCalledTimes(2);
  });

  it('沒有 MIME 時不補 contentType', async () => {
    await uploadImageDataUrl('data:;base64,AA', 'events/ce_1', () => 1);
    expect(mocks.uploadString.mock.calls[0]?.[3]).toEqual({
      cacheControl: 'public, max-age=31536000',
    });
  });

  it('所有 bucket 失敗只提示一次並回 null', async () => {
    mocks.uploadString.mockRejectedValue(new Error('failed'));
    await expect(uploadImageDataUrl('data:image/png;base64,AA', 'events/ce_1'))
      .resolves.toBeNull();
    expect(mocks.uploadString).toHaveBeenCalledTimes(2);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      message: '圖片上傳失敗，請稍後重試',
      tone: 'error',
    });
  });

  it('初始化失敗與空 targets 同樣回 null', async () => {
    mocks.targets.mockRejectedValueOnce(new Error('initialization failed'));
    await expect(uploadImageDataUrl('data:image/png;base64,AA', 'events/ce_1'))
      .resolves.toBeNull();
    expect(mocks.uploadString).not.toHaveBeenCalled();

    mocks.targets.mockResolvedValueOnce([]);
    await expect(uploadImageDataUrl('data:image/png;base64,AA', 'events/ce_1'))
      .resolves.toBeNull();
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });
});

describe('uploadEventImageVariants', () => {
  it('未提供、空物件或空字串時回 undefined', async () => {
    expect(await uploadEventImageVariants('ce_1', undefined)).toBeUndefined();
    expect(await uploadEventImageVariants('ce_1', {})).toBeUndefined();
    expect(await uploadEventImageVariants('ce_1', { cover: '', homeNext: '' }))
      .toBeUndefined();
    expect(mocks.uploadString).not.toHaveBeenCalled();
  });

  it('只認 cover／homeNext，保留既有網址且不修改輸入', async () => {
    const input = {
      cover: 'https://example.com/cover',
      homeNext: 'https://example.com/next',
      unknown: 'data:image/png;base64,AA',
    };
    expect(await uploadEventImageVariants('ce_1', input)).toEqual({
      cover: input.cover,
      homeNext: input.homeNext,
    });
    expect(input.unknown).toBe('data:image/png;base64,AA');
    expect(mocks.uploadString).not.toHaveBeenCalled();
  });

  it('兩個 variants 使用 public event id 與各自 key', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(99);
    const input = {
      cover: 'data:image/webp;base64,COVER',
      homeNext: 'data:image/webp;base64,NEXT',
    };
    mocks.getDownloadURL
      .mockResolvedValueOnce('https://example.com/cover')
      .mockResolvedValueOnce('https://example.com/next');

    expect(await uploadEventImageVariants('ce_public', input)).toEqual({
      cover: 'https://example.com/cover',
      homeNext: 'https://example.com/next',
    });
    expect(mocks.ref.mock.calls.map((call) => call[1])).toEqual([
      'images/events/ce_public_cover_99',
      'images/events/ce_public_homeNext_99',
    ]);
    expect(input.cover).toBe('data:image/webp;base64,COVER');
  });

  it('失敗的 key 被刪除，其餘成功值仍保留', async () => {
    mocks.uploadString
      .mockRejectedValueOnce(new Error('upload bucket failed'))
      .mockRejectedValueOnce(new Error('default bucket failed'));
    expect(await uploadEventImageVariants('ce_1', {
      cover: 'data:image/png;base64,COVER',
      homeNext: 'data:image/png;base64,NEXT',
    })).toEqual({ homeNext: 'https://example.com/uploaded.webp' });
  });

  it('全部失敗時回 undefined', async () => {
    mocks.uploadString.mockRejectedValue(new Error('failed'));
    expect(await uploadEventImageVariants('ce_1', {
      cover: 'data:image/png;base64,COVER',
      homeNext: 'data:image/png;base64,NEXT',
    })).toBeUndefined();
  });
});

describe('封面選擇與預設封面', () => {
  it('照 A cover → image → homeNext → 空字串', () => {
    expect(pickEventImage('main', { cover: 'cover', homeNext: 'next' })).toBe('cover');
    expect(pickEventImage('main', { homeNext: 'next' })).toBe('main');
    expect(pickEventImage('', { homeNext: 'next' })).toBe('next');
    expect(pickEventImage('', undefined)).toBe('');
  });

  it('trim 後空值使用固定主站網址，不帶版本參數', () => {
    expect(resolveEventCoverImage(' https://example.com/image ')).toBe('https://example.com/image');
    expect(resolveEventCoverImage('')).toBe(DEFAULT_EVENT_COVER_URL);
    expect(resolveEventCoverImage(' \n ')).toBe(
      'https://toosterx.com/LOGO/Nocoverimage%20set.png',
    );
    expect(DEFAULT_EVENT_COVER_URL).not.toContain('?');
  });
});
