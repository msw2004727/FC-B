// 卡 1D-1：LINE 推播通知資料層（照 A `profile-data.js` 的 renderLineNotifyCard／toggleLineNotify／
//   unbindLineNotify 與 `firebase-crud.js#updateUser`）。
//
// 寫入格式照 A 鎖定域：只寫 `users/{uid}.lineNotify` 與 `updatedAt`（serverTimestamp）。
// firestore 一律動態 import，首屏不新增大型模組靜態引用。

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
 *   `{ ...lineNotify, settings: { ...settings, [key]: !settings[key] } }`
 */
export function buildToggledLineNotify(
  current: LineNotifyState,
  key: LineNotifyKey,
): LineNotifyState {
  const settings = { ...current.settings };
  settings[key] = !settings[key];
  return { ...current, settings };
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
 */
export async function saveLineNotify(uid: string, lineNotify: LineNotifyState): Promise<void> {
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
