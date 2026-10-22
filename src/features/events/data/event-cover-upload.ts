import { getStorageUploadTargets } from '@/data/storage';
import { lt } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { EventImageVariants } from './event-create';

export const DEFAULT_EVENT_COVER_URL =
  'https://toosterx.com/LOGO/Nocoverimage%20set.png';

/** 照 A _uploadImage：依 bucket 順序上傳，全部失敗時提示並回 null。 */
export async function uploadImageDataUrl(
  dataUrl: string,
  path: string,
  now: () => number = Date.now,
): Promise<string | null> {
  try {
    const [{ ref, uploadString, getDownloadURL }, targets] = await Promise.all([
      import('firebase/storage'),
      getStorageUploadTargets(),
    ]);
    const metadata: { cacheControl: string; contentType?: string } = {
      cacheControl: 'public, max-age=31536000',
    };
    const contentType = /^data:([^;,]+)/.exec(dataUrl)?.[1]?.trim();
    if (contentType) metadata.contentType = contentType;

    for (const target of targets) {
      try {
        const imageRef = ref(target.service, `images/${path}_${now()}`);
        const snapshot = await uploadString(imageRef, dataUrl, 'data_url', metadata);
        return await getDownloadURL(snapshot.ref);
      } catch {
        // 照 A _uploadImage：目前 bucket 失敗後試下一個。
      }
    }
  } catch {
    // 照 A _uploadImage：SDK／初始化錯誤同樣回 null。
  }

  toast.show({
    message: lt('圖片上傳失敗，請稍後重試', '圖片上傳失敗，請稍後重試'),
    tone: 'error',
  });
  return null;
}

/** 照 A _uploadEventImageVariants，只保留 cover 與 homeNext。 */
export async function uploadEventImageVariants(
  eventId: string,
  variants: EventImageVariants | undefined,
): Promise<EventImageVariants | undefined> {
  if (!variants) return undefined;
  const uploaded: EventImageVariants = {};

  for (const key of ['cover', 'homeNext'] as const) {
    const value = variants[key];
    if (!value) continue;
    if (value.startsWith('data:')) {
      const url = await uploadImageDataUrl(value, `events/${eventId}_${key}`);
      if (url) uploaded[key] = url;
    } else {
      uploaded[key] = value;
    }
  }

  return uploaded.cover || uploaded.homeNext ? uploaded : undefined;
}

/** 照 A handleCreateEvent：cover → 現有主圖 → homeNext。 */
export function pickEventImage(
  image: string,
  variants: EventImageVariants | undefined,
): string {
  return variants?.cover || image || variants?.homeNext || '';
}

/**
 * 照 A _resolveEventCoverImage。
 * 刻意偏離 A：不用 document.baseURI，避免 next 子網域收掉後壞圖。
 */
export function resolveEventCoverImage(image: string): string {
  return image.trim() || DEFAULT_EVENT_COVER_URL;
}
