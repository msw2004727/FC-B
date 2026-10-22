import type { FirebaseStorage } from 'firebase/storage';
import { getFirebase, shouldUseEmulator } from '@/data/firebase';
import { FIREBASE_CONFIG } from '@/data/firebase-config';

export const UPLOAD_STORAGE_BUCKET = 'gs://fc-football-6c8dc-asia-east1';

export interface StorageUploadTarget {
  bucket: string;
  service: FirebaseStorage;
}

let targetsPromise: Promise<StorageUploadTarget[]> | null = null;
const connectedInstances = new WeakSet<FirebaseStorage>();

/** 照 A initFirebaseStorageServices：上傳 bucket 優先，其次預設 bucket。 */
export function getStorageUploadTargets(): Promise<StorageUploadTarget[]> {
  if (targetsPromise) return targetsPromise;

  const pending = initializeTargets();
  targetsPromise = pending;
  void pending.catch(() => {
    if (targetsPromise === pending) targetsPromise = null;
  });
  return pending;
}

async function initializeTargets(): Promise<StorageUploadTarget[]> {
  const [{ getStorage, connectStorageEmulator }, { app }] = await Promise.all([
    import('firebase/storage'),
    getFirebase(),
  ]);
  // 照 A _normalizeStorageBucketUrl。
  const trimmed = FIREBASE_CONFIG.storageBucket.trim().replace(/\/+$/, '');
  const defaultBucket = trimmed.startsWith('gs://') ? trimmed : `gs://${trimmed}`;
  const buckets = [...new Set([UPLOAD_STORAGE_BUCKET, defaultBucket])];
  const targets: StorageUploadTarget[] = [];
  const useEmulator = shouldUseEmulator();

  for (const bucket of buckets) {
    const service = getStorage(app, bucket);
    if (useEmulator && !connectedInstances.has(service)) {
      // 連線失敗即拒絕初始化，不得降級到正式 bucket。
      connectStorageEmulator(service, '127.0.0.1', 9199);
      connectedInstances.add(service);
    }
    if (!targets.some((target) => target.service === service)) {
      targets.push({ bucket, service });
    }
  }

  return targets;
}
