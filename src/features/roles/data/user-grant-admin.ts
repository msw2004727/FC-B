import { doc, getDocFromServer } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { requireRoleAdmin, requireSameRoleActor } from './role-auth';
import { assertGrantUid, type UserGrantSnapshot } from './user-grant-model';

/** 只讀指定用戶單筆；保留完整原始文件供寫前確認，不將失敗當成不存在。 */
export async function loadUserGrant(uid: string, targetName: string): Promise<UserGrantSnapshot> {
  const actor = await requireRoleAdmin();
  requireSameRoleActor(actor.uid);
  assertGrantUid(uid);
  const { db } = await getFirebase();
  requireSameRoleActor(actor.uid);
  const snap = await getDocFromServer(doc(db, 'userPermissionGrants', uid));
  requireSameRoleActor(actor.uid);
  return { uid, targetName, document: snap.exists() ? snap.data() : null };
}
