import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/preact';

const mocks = vi.hoisted(() => ({
  getFirebase: vi.fn(),
  shouldUseEmulator: vi.fn(),
  getStorage: vi.fn(),
  connectStorageEmulator: vi.fn(),
  config: { storageBucket: 'fc-football-6c8dc.firebasestorage.app' },
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: mocks.getFirebase,
  shouldUseEmulator: mocks.shouldUseEmulator,
}));
vi.mock('@/data/firebase-config', () => ({ FIREBASE_CONFIG: mocks.config }));
vi.mock('firebase/storage', () => ({
  getStorage: mocks.getStorage,
  connectStorageEmulator: mocks.connectStorageEmulator,
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  document.documentElement.lang = 'zh-TW';
  mocks.config.storageBucket = 'fc-football-6c8dc.firebasestorage.app';
  mocks.getFirebase.mockResolvedValue({ app: { name: 'test-app' } });
  mocks.shouldUseEmulator.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
});

describe('getStorageUploadTargets', () => {
  it('先上傳 bucket，再補 gs:// 的預設 bucket；正式模式不接 emulator', async () => {
    const upload = { name: 'upload' };
    const fallback = { name: 'default' };
    mocks.getStorage.mockReturnValueOnce(upload).mockReturnValueOnce(fallback);
    const { getStorageUploadTargets, UPLOAD_STORAGE_BUCKET } = await import('./storage');

    expect(await getStorageUploadTargets()).toEqual([
      { bucket: UPLOAD_STORAGE_BUCKET, service: upload },
      { bucket: 'gs://fc-football-6c8dc.firebasestorage.app', service: fallback },
    ]);
    expect(mocks.getStorage.mock.calls.map((call) => call[1])).toEqual([
      UPLOAD_STORAGE_BUCKET,
      'gs://fc-football-6c8dc.firebasestorage.app',
    ]);
    expect(mocks.connectStorageEmulator).not.toHaveBeenCalled();
  });

  it('emulator 模式每個實例先接 127.0.0.1:9199；並行與重複呼叫不重連', async () => {
    const upload = { name: 'upload' };
    const fallback = { name: 'default' };
    mocks.shouldUseEmulator.mockReturnValue(true);
    mocks.getStorage.mockReturnValueOnce(upload).mockReturnValueOnce(fallback);
    const { getStorageUploadTargets } = await import('./storage');

    const first = getStorageUploadTargets();
    expect(getStorageUploadTargets()).toBe(first);
    const targets = await first;
    expect(await getStorageUploadTargets()).toBe(targets);
    expect(mocks.getStorage).toHaveBeenCalledTimes(2);
    expect(mocks.connectStorageEmulator.mock.calls).toEqual([
      [upload, '127.0.0.1', 9199],
      [fallback, '127.0.0.1', 9199],
    ]);
  });

  it('預設 bucket 相同時只建立一個 target，移除空白與尾斜線', async () => {
    mocks.config.storageBucket = ' gs://fc-football-6c8dc-asia-east1/// ';
    mocks.getStorage.mockReturnValue({ name: 'same' });
    const { getStorageUploadTargets } = await import('./storage');

    expect(await getStorageUploadTargets()).toHaveLength(1);
    expect(mocks.getStorage).toHaveBeenCalledTimes(1);
  });

  it('SDK 回傳同一實例時不重複連 emulator', async () => {
    const shared = { name: 'shared' };
    mocks.shouldUseEmulator.mockReturnValue(true);
    mocks.getStorage.mockReturnValue(shared);
    const { getStorageUploadTargets } = await import('./storage');

    expect(await getStorageUploadTargets()).toHaveLength(1);
    expect(mocks.connectStorageEmulator).toHaveBeenCalledTimes(1);
  });

  it('初始化第一次失敗後可重新載入', async () => {
    mocks.getFirebase.mockRejectedValueOnce(new Error('initialization failed'));
    mocks.getStorage.mockReturnValue({ name: 'shared' });
    const { getStorageUploadTargets } = await import('./storage');

    await expect(getStorageUploadTargets()).rejects.toThrow('initialization failed');
    await expect(getStorageUploadTargets()).resolves.toHaveLength(1);
    expect(mocks.getFirebase).toHaveBeenCalledTimes(2);
  });

  it('emulator 連線失敗時拒絕回傳 target，不降級到正式 bucket', async () => {
    const upload = { name: 'upload' };
    const fallback = { name: 'default' };
    mocks.shouldUseEmulator.mockReturnValue(true);
    mocks.getStorage.mockImplementation((_app: unknown, bucket: string) =>
      bucket.includes('asia-east1') ? upload : fallback);
    mocks.connectStorageEmulator
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw new Error('emulator unavailable'); });
    const { getStorageUploadTargets } = await import('./storage');

    await expect(getStorageUploadTargets()).rejects.toThrow('emulator unavailable');
    await expect(getStorageUploadTargets()).resolves.toHaveLength(2);
    expect(mocks.connectStorageEmulator.mock.calls).toEqual([
      [upload, '127.0.0.1', 9199],
      [fallback, '127.0.0.1', 9199],
      [fallback, '127.0.0.1', 9199],
    ]);
  });
});
