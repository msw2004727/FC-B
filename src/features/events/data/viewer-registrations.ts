/**
 * 檢視者報名資料存取。
 *
 * 選擇新增獨立模組而非放進 events-repo：
 * events-repo 只負責活動列表／分頁快取；報名查詢是 viewer 維度、生命週期由頁面控制，
 * 獨立模組可避免把 viewer 狀態混進活動 repo 的 singleton 快取。
 *
 * R-ID-003：registrations 的身分欄位是 userId。
 * R-REG-014：collectionGroup 查詢結果一律先過濾，排除 legacy root 文件。
 */
import {
  collectionGroup,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { getFirebase as defaultGetFirebase } from '@/data/firebase';
import { filterSubcollectionDocs } from '@/data/paths';
import type { RegistrationDoc } from './types';

const REGISTRATIONS_COLLECTION = 'registrations';

/**
 * 載入指定使用者在所有活動下的報名紀錄，包含 confirmed／cancelled／removed 等所有狀態。
 * 查詢失敗時直接 reject，由呼叫端決定如何降級。
 */
export async function loadViewerRegistrations(uid: string): Promise<RegistrationDoc[]> {
  const { db } = await defaultGetFirebase();
  return loadViewerRegistrationsWithDb(db, uid);
}

async function loadViewerRegistrationsWithDb(
  db: Firestore,
  uid: string,
): Promise<RegistrationDoc[]> {
  const snapshot = await getDocs(
    query(
      collectionGroup(db, REGISTRATIONS_COLLECTION),
      where('userId', '==', uid),
    ),
  );

  return filterSubcollectionDocs(snapshot.docs).map((doc) => ({
    ...(doc.data() as Record<string, unknown>),
    _docId: doc.id,
  } as RegistrationDoc));
}
