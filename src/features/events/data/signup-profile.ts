import { getFirebase } from '@/data/firebase';

/**
 * 報名主按鈕需要的使用者個人資料。
 * 照 A `ApiService.getCurrentUser()` 讀 users/{uid}（B 使用者文件 ID == uid）。
 */
export interface SignupProfile {
  /** users/{uid}.gender，非字串視為 '' */
  gender: string;
  /** users/{uid}.birthday，非字串視為 '' */
  birthday: string;
  /** users/{uid}.exp，非有限數字視為 0（ASSUMPTION: A 有 `user.points` fallback，本單只讀 exp） */
  exp: number;
  /** users/{uid}.lineNotify?.bound === true */
  lineNotifyBound: boolean;
  /**
   * 報名必填三欄缺漏（gender、birthday、region 任一為 falsy）。判斷與伺服器同一組：
   * FC functions/index.js registerForEvent 的 Plan C 檢查（缺任一欄回 PROFILE_INCOMPLETE）。
   * 文件不存在時伺服器不擋，這裡也回 false（交給伺服器裁定）。選填：舊呼叫端與測試替身省略＝未缺。
   */
  incomplete?: boolean;
}

/** 與伺服器 Plan C 同一組必填欄位；A3-02 第二段生日欄搬移時要同批改（見驗證文件）。 */
export const SIGNUP_REQUIRED_PROFILE_FIELDS = ['gender', 'birthday', 'region'] as const;

/** 照伺服器 `!data.gender || !data.birthday || !data.region`（falsy 即缺）。 */
export function isSignupProfileIncomplete(data: Record<string, unknown>): boolean {
  return SIGNUP_REQUIRED_PROFILE_FIELDS.some((key) => !data[key]);
}

/**
 * 讀 users/{uid}；文件不存在回空值物件；讀取失敗 reject。
 * Firestore 動態載入照 `companions.ts` 寫法。
 */
export async function loadSignupProfile(uid: string): Promise<SignupProfile> {
  const empty: SignupProfile = { gender: '', birthday: '', exp: 0, lineNotifyBound: false };
  const [{ doc, getDoc }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const snapshot = await getDoc(doc(db, 'users', uid));
  if (!snapshot.exists()) return empty;
  const raw: unknown = snapshot.data();
  if (!raw || typeof raw !== 'object') return empty;
  const data = raw as Record<string, unknown>;

  const gender = typeof data.gender === 'string' ? data.gender : '';
  const birthday = typeof data.birthday === 'string' ? data.birthday : '';
  const rawExp = data.exp;
  const exp = typeof rawExp === 'number' && Number.isFinite(rawExp) ? rawExp : 0;

  const lineNotify = data.lineNotify;
  const lineNotifyBound =
    !!lineNotify
    && typeof lineNotify === 'object'
    && 'bound' in lineNotify
    && (lineNotify as { bound?: unknown }).bound === true;

  return { gender, birthday, exp, lineNotifyBound, incomplete: isSignupProfileIncomplete(data) };
}
