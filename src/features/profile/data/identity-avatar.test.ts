// 卡 1C-3：`identity-avatar.ts` 純函式與上傳流程單元測試。
// - storage 路徑照 A：`images/users/{uid}/identities/secondary/avatar_{ms}`
// - 第一個 bucket 失敗改試第二個
// - commit payload 三欄
// - bucket 名去 `gs://` 與結尾斜線
// - clear 只送 `{ clear: true }`

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ref: vi.fn(),
  uploadString: vi.fn(),
  getDownloadURL: vi.fn(),
  getStorageUploadTargets: vi.fn(),
  commitSecondaryIdentityAvatar: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: mocks.ref,
  uploadString: mocks.uploadString,
  getDownloadURL: mocks.getDownloadURL,
}));

vi.mock('@/data/storage', () => ({
  getStorageUploadTargets: mocks.getStorageUploadTargets,
}));

vi.mock('./profile-writes', () => ({
  commitSecondaryIdentityAvatar: mocks.commitSecondaryIdentityAvatar,
}));

import {
  clearSecondaryIdentityAvatar,
  normalizeStorageBucketName,
  uploadSecondaryIdentityAvatarDataUrl,
} from './identity-avatar';

interface ServiceTag {
  tag: string;
}

function service(tag: string): ServiceTag {
  return { tag };
}

function wireRefReturns(): void {
  mocks.ref.mockImplementation((_svc: unknown, path: string) => ({
    fullPath: path,
    bucket: 'never-used',
  }));
  mocks.uploadString.mockImplementation((refObj: unknown) =>
    Promise.resolve({ ref: refObj }),
  );
  mocks.getDownloadURL.mockResolvedValue('https://cdn.example/avatar.png');
  mocks.commitSecondaryIdentityAvatar.mockResolvedValue(undefined);
}

describe('normalizeStorageBucketName', () => {
  it('去 gs:// 前綴與結尾斜線，並 trim', () => {
    expect(normalizeStorageBucketName('gs://my-bucket/')).toBe('my-bucket');
    expect(normalizeStorageBucketName('gs://my-bucket')).toBe('my-bucket');
    expect(normalizeStorageBucketName('my-bucket///')).toBe('my-bucket');
    expect(normalizeStorageBucketName(' gs://abc ')).toBe('abc');
    expect(normalizeStorageBucketName('')).toBe('');
  });
});

describe('uploadSecondaryIdentityAvatarDataUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireRefReturns();
  });

  it('路徑照 A、commit 三欄、bucket 名去 gs://', async () => {
    const s1 = service('primary');
    mocks.getStorageUploadTargets.mockResolvedValue([
      { bucket: 'gs://primary-bucket/', service: s1 },
    ]);

    const url = await uploadSecondaryIdentityAvatarDataUrl(
      'U1',
      'data:image/webp;base64,AAAA',
      () => 12345,
    );

    expect(url).toBe('https://cdn.example/avatar.png');
    expect(mocks.ref).toHaveBeenCalledWith(
      s1,
      'images/users/U1/identities/secondary/avatar_12345',
    );
    expect(mocks.commitSecondaryIdentityAvatar).toHaveBeenCalledTimes(1);
    expect(mocks.commitSecondaryIdentityAvatar).toHaveBeenCalledWith({
      avatarUrl: 'https://cdn.example/avatar.png',
      avatarStoragePath: 'images/users/U1/identities/secondary/avatar_12345',
      avatarStorageBucket: 'primary-bucket',
    });
  });

  it('第一個 bucket 失敗改試第二個', async () => {
    const s1 = service('primary');
    const s2 = service('default');
    mocks.getStorageUploadTargets.mockResolvedValue([
      { bucket: 'gs://primary-bucket', service: s1 },
      { bucket: 'gs://default-bucket', service: s2 },
    ]);
    mocks.uploadString
      .mockRejectedValueOnce(new Error('primary bucket denied'))
      .mockImplementationOnce((refObj: unknown) =>
        Promise.resolve({ ref: refObj }),
      );

    const url = await uploadSecondaryIdentityAvatarDataUrl(
      'U2',
      'data:image/webp;base64,BBBB',
      () => 99999,
    );

    expect(url).toBe('https://cdn.example/avatar.png');
    expect(mocks.ref).toHaveBeenNthCalledWith(
      1,
      s1,
      'images/users/U2/identities/secondary/avatar_99999',
    );
    expect(mocks.ref).toHaveBeenNthCalledWith(
      2,
      s2,
      'images/users/U2/identities/secondary/avatar_99999',
    );
    expect(mocks.commitSecondaryIdentityAvatar).toHaveBeenCalledWith({
      avatarUrl: 'https://cdn.example/avatar.png',
      avatarStoragePath: 'images/users/U2/identities/secondary/avatar_99999',
      avatarStorageBucket: 'default-bucket',
    });
  });

  it('uid 空白時 throw', async () => {
    await expect(
      uploadSecondaryIdentityAvatarDataUrl('', 'data:image/png;base64,xx'),
    ).rejects.toThrow();
  });
});

describe('clearSecondaryIdentityAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('只送 { clear: true }', async () => {
    mocks.commitSecondaryIdentityAvatar.mockResolvedValue(undefined);
    await clearSecondaryIdentityAvatar();
    expect(mocks.commitSecondaryIdentityAvatar).toHaveBeenCalledTimes(1);
    expect(mocks.commitSecondaryIdentityAvatar).toHaveBeenCalledWith({
      clear: true,
    });
  });
});
