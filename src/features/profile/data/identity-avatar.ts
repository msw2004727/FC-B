// 卡 1C：第二身份頭像上傳／清除。
// 照 A `firebase-crud.js#uploadSecondaryIdentityAvatar` + `_uploadImageWithRef` +
// `_normalizeStorageBucketName` + `clearSecondaryIdentityAvatar`。
//
// - `firebase/storage` 只動態 import，不進首屏。
// - Storage 路徑照 A：`images/users/{uid}/identities/secondary/avatar_{ms}`。
// - FC `storage.rules#isSecondaryIdentityUpload()` 只允許此路徑，且 delete 一律被拒，
//   所以「清除頭像」只呼叫 `commitSecondaryIdentityAvatar({ clear: true })`、不刪 Storage 檔。
// - bucket 依 `getStorageUploadTargets()` 順序嘗試；成功取 url / fullPath / bucket 後呼叫
//   `commitSecondaryIdentityAvatar`（三缺一就 throw，照 A）。

import { getStorageUploadTargets } from '@/data/storage';
import { commitSecondaryIdentityAvatar } from './profile-writes';

/** 照 A `_normalizeStorageBucketName`：去 `gs://` 前綴與結尾斜線。 */
export function normalizeStorageBucketName(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^gs:\/\//i, '')
    .replace(/\/+$/g, '');
}

export const SECONDARY_AVATAR_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif';
export const SECONDARY_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** 照 A `_isAllowedImageFile`：MIME 或副檔名任一符合即可，含 HEIC／HEIF。 */
export function isAllowedSecondaryAvatarFile(file: {
  name?: string | null;
  type?: string | null;
}): boolean {
  const types = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  const extensions = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
  const mime = String(file.type || '').toLowerCase();
  const ext = String(file.name || '').split('.').pop()?.toLowerCase() || '';
  return types.includes(mime) || extensions.includes(ext);
}

interface UploadedAvatar {
  url: string;
  storagePath: string;
  bucket: string;
}

/**
 * 照 A `_uploadImageWithRef` + `uploadSecondaryIdentityAvatar`：
 * 依 bucket 順序嘗試上傳，成功後 commit 三欄；三缺一 throw。
 */
export async function uploadSecondaryIdentityAvatarDataUrl(
  uid: string,
  dataUrl: string,
  now: () => number = Date.now,
): Promise<string> {
  const safeUid = String(uid || '').trim();
  if (!safeUid) throw new Error('Missing current user uid');
  if (!dataUrl) throw new Error('Missing dataUrl');

  const targets = await getStorageUploadTargets();
  if (targets.length === 0) throw new Error('Storage not initialized');

  const ts = now();
  const fullPath = `images/users/${safeUid}/identities/secondary/avatar_${ts}`;

  const contentType = String(/^data:([^;,]+)/.exec(dataUrl)?.[1] || '').trim();
  const metadata: { cacheControl: string; contentType?: string } = {
    cacheControl: 'public, max-age=31536000',
  };
  if (contentType) metadata.contentType = contentType;

  const { ref, uploadString, getDownloadURL } = await import('firebase/storage');

  let uploaded: UploadedAvatar | null = null;
  let lastError: unknown = null;

  for (const target of targets) {
    try {
      const storageRef = ref(target.service, fullPath);
      const snapshot = await uploadString(storageRef, dataUrl, 'data_url', metadata);
      const url = await getDownloadURL(snapshot.ref);
      const avatarStoragePath = snapshot.ref.fullPath;
      const bucket = normalizeStorageBucketName(
        target.bucket || snapshot.ref.bucket || '',
      );
      if (!url || !avatarStoragePath || !bucket) {
        throw new Error('Secondary identity avatar upload metadata missing');
      }
      uploaded = { url, storagePath: avatarStoragePath, bucket };
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!uploaded) {
    throw lastError instanceof Error ? lastError : new Error('Storage upload failed');
  }

  await commitSecondaryIdentityAvatar({
    avatarUrl: uploaded.url,
    avatarStoragePath: uploaded.storagePath,
    avatarStorageBucket: uploaded.bucket,
  });
  return uploaded.url;
}

/** 照 A `clearSecondaryIdentityAvatar`：只呼叫 Callable，不刪 Storage。 */
export async function clearSecondaryIdentityAvatar(): Promise<void> {
  await commitSecondaryIdentityAvatar({ clear: true });
}
