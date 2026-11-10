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
  collection,
  collectionGroup,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { getFirebase as defaultGetFirebase } from '@/data/firebase';
import { filterSubcollectionDocs, registrations } from '@/data/paths';
import type { RegistrationDoc } from './types';

const REGISTRATIONS_COLLECTION = 'registrations';

/**
 * 載入指定使用者的報名紀錄，包含 confirmed／cancelled／removed 等所有狀態。
 * 有 `eventDocId` 時只查 `events/{eventDocId}/registrations`（單一 `userId` 等式）。
 * 不加 status、不加 limit：黑名單放行要保留取消與移除；一人一場的筆數不大。
 * Rules `allow read: if isAuth()` 允許這筆查詢，單欄索引是自動的，不必新複合索引。
 * Firestore 以索引或權限拒絕時退回全歷史；拒絕不留快取。其他錯誤照舊 reject。
 * 查詢失敗時直接 reject，由呼叫端決定如何降級。
 */
export async function loadViewerRegistrations(
  uid: string,
  eventDocId?: string,
): Promise<RegistrationDoc[]> {
  const { db } = await defaultGetFirebase();
  const parent = typeof eventDocId === 'string' ? eventDocId : '';
  if (parent.length > 0 && !parent.includes('/')) {
    try {
      return await loadViewerEventRegistrationsWithDb(db, uid, parent);
    } catch (error) {
      if (!isUnsupportedEventQuery(error)) throw error;
      return loadViewerRegistrationsWithDb(db, uid);
    }
  }
  return loadViewerRegistrationsWithDb(db, uid);
}

function isUnsupportedEventQuery(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  return code === 'failed-precondition'
    || code === 'permission-denied'
    || code.endsWith('/failed-precondition')
    || code.endsWith('/permission-denied');
}

async function loadViewerEventRegistrationsWithDb(
  db: Firestore,
  uid: string,
  eventDocId: string,
): Promise<RegistrationDoc[]> {
  const snapshot = await getDocs(
    query(
      collection(db, registrations(eventDocId)),
      where('userId', '==', uid),
    ),
  );
  return snapshot.docs.map((doc) => ({
    ...(doc.data() as Record<string, unknown>),
    _docId: doc.id,
  } as RegistrationDoc));
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
