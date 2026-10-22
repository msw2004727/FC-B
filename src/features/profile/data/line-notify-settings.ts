// 卡 1D-1：LINE 推播通知資料層（照 A `profile-data.js` 的 renderLineNotifyCard／toggleLineNotify／
//   unbindLineNotify 與 `firebase-crud.js#updateUser`）。
//
// 寫入格式照 A 鎖定域：只寫 `users/{uid}.lineNotify` 與 `updatedAt`（serverTimestamp）。
// firestore 一律動態 import，首屏不新增大型模組靜態引用。
//
// fix-1：顯示用正規化（readLineNotify）與寫入來源（buildToggledLineNotifyFromRaw）分離。
//   照 A `toggleLineNotify`，切換時要以 users 文件上「原始 lineNotify」為基準展開，
//   保留所有未知 settings key 與其他根欄位。

import { getFirebase } from '@/data/firebase';

export type LineNotifyKey = 'activity' | 'system' | 'tournament';

export interface LineNotifyState {
  bound: boolean;
  boundAt?: string;
  settings: Partial<Record<LineNotifyKey, boolean>>;
}

const TOGGLE_KEYS: readonly LineNotifyKey[] = ['activity', 'system', 'tournament'];

/**
 * 照 A `renderLineNotifyCard`：`user.lineNotify || { bound:false, settings:{} }`。
 * 非物件（含 null／array／primitive）一律視為未綁定；物件則保留其他欄位（如 boundAt），
 * 只把 `bound`／`settings` 正規化。
 *
 * 注意：這只是「顯示用」正規化，不得拿正規化結果回寫 Firestore。
 * 寫入請用 buildToggledLineNotifyFromRaw 以原始資料為基準。
 */
export function readLineNotify(profile: Record<string, unknown>): LineNotifyState {
  const raw = profile['lineNotify'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { bound: false, settings: {} };
  }
  const src = raw as Record<string, unknown>;

  const settings: Partial<Record<LineNotifyKey, boolean>> = {};
  const rawSettings = src['settings'];
  if (rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)) {
    const so = rawSettings as Record<string, unknown>;
    for (const k of TOGGLE_KEYS) {
      const v = so[k];
      if (typeof v === 'boolean') settings[k] = v;
    }
  }

  const state = {
    ...src,
    bound: src['bound'] === true,
    settings,
  } as unknown as LineNotifyState;

  if (typeof state.boundAt !== 'string') {
    delete state.boundAt;
  }
  return state;
}

/**
 * 照 A `toggleLineNotify`：
 *   `const settings = user.lineNotify.settings;`
 *   `const newSettings = { ...settings, [key]: !settings[key] };`
 *   `{ ...user.lineNotify, settings: newSettings }`
 *
 * 以原始 `lineNotify` 物件為基準，保留所有根欄位與所有 settings key（不論型別）。
 * raw 非物件時視為未綁定、不得寫入，回傳 null 由呼叫端擋下。
 */
export function buildToggledLineNotifyFromRaw(
  raw: unknown,
  key: LineNotifyKey,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;

  // ASSUMPTION: A 直接 `{ ...settings }`；若 settings 非物件，JS 行為對 primitive 不一。
  // 這裡照「非物件視為空 settings」處理，僅新增本次切換的 key。
  const rawSettings = src['settings'];
  const settings: Record<string, unknown> =
    rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
      ? { ...(rawSettings as Record<string, unknown>) }
      : {};

  settings[key] = !settings[key];
  return { ...src, settings };
}

/**
 * 照 A `unbindLineNotify` payload：
 *   `{ bound:false, settings:{ activity:true, system:true, tournament:false } }`
 * （不帶 boundAt）。
 */
export function buildUnboundLineNotify(): LineNotifyState {
  return {
    bound: false,
    settings: { activity: true, system: true, tournament: false },
  };
}

/**
 * 照 A `ApiService.updateCurrentUser({ lineNotify })` →
 *   `FirebaseService.updateUser` → `users/{docId}.update({ ...updates, updatedAt: serverTimestamp() })`。
 * 只帶 `lineNotify` 與 `updatedAt` 兩個 key。
 *
 * fix-1：參數放寬為原始 Record，讓呼叫端可保留 A 會保留的未知欄位。
 */
export async function saveLineNotify(
  uid: string,
  lineNotify: Record<string, unknown> | LineNotifyState,
): Promise<void> {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid) throw new Error('saveLineNotify: uid is required');

  const [{ doc, updateDoc, serverTimestamp }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  await updateDoc(doc(db, 'users', cleanUid), {
    lineNotify,
    updatedAt: serverTimestamp(),
  });
}
