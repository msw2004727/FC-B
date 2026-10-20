// 管理員隱身模式讀寫（M-016），照 A `profile-core.js` 與 `user-roles.ts`（`users/{uid}.stealth` 布林欄位）。
// R-ID-002：只依 UID 讀寫 `users/{uid}`，且只寫 `stealth` 單一欄位（L-32 allowlist）。

import { getFirebase } from './firebase';

// A `profile-core.js#_toggleAdminStealth`（已核對）：localStorage `admin_stealth`，開啟存 '1'、關閉刪除；並寫 Firestore `users/{uid}.stealth`。
const STEALTH_STORAGE_KEY = 'admin_stealth';

export interface StealthTogglePayload {
  readonly stealth: boolean;
}

function buildStealthPayload(stealth: boolean): StealthTogglePayload {
  return { stealth: Boolean(stealth) };
}

export function readLocalAdminStealth(): boolean {
  try {
    return localStorage.getItem(STEALTH_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeLocalAdminStealth(stealth: boolean): void {
  try {
    if (stealth) localStorage.setItem(STEALTH_STORAGE_KEY, '1');
    else localStorage.removeItem(STEALTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 從 Firestore `users/{uid}.stealth` 同步隱身狀態至 localStorage。 */
export async function syncAdminStealthFromUser(uid: string): Promise<boolean> {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid) return readLocalAdminStealth();
  try {
    const [firebase, fs] = await Promise.all([getFirebase(), import('firebase/firestore')]);
    const snap = await fs.getDoc(fs.doc(firebase.db, 'users', cleanUid));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown> | undefined;
      if (typeof data?.stealth === 'boolean') {
        writeLocalAdminStealth(data.stealth);
        return data.stealth;
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[stealth] failed to read stealth state', err);
  }
  return readLocalAdminStealth();
}

/** 切換管理員隱身狀態並寫回 `users/{uid}` 的 `stealth` 欄位。回傳切換後的布林值。 */
export function toggleAdminStealth(uid: string | null | undefined, current?: boolean): boolean {
  const base = typeof current === 'boolean' ? current : readLocalAdminStealth();
  const next = !base;
  writeLocalAdminStealth(next);

  const cleanUid = String(uid || '').trim();
  if (cleanUid) {
    const payload = buildStealthPayload(next);
    Promise.all([getFirebase(), import('firebase/firestore')])
      .then(([firebase, fs]) => fs.updateDoc(fs.doc(firebase.db, 'users', cleanUid), { stealth: payload.stealth }))
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[stealth] failed to persist stealth state', err);
      });
  }
  return next;
}
