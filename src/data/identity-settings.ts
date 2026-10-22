/**
 * 登入者第二身份設定的 store，照 A `firebase-service.js#_setupIdentityPrivateListener`。
 * 讀 `users/{uid}/identityPrivate/settings`，用 `onSnapshot` 監聽；文件不存在 → null。
 * 全部大型模組（firebase/firestore、@/data/firebase）都動態 import，不進首屏。
 */
import { useEffect, useState } from 'preact/hooks';
import { normalizeIdentitySettings, type IdentitySettings } from './identity-resolver';

type Listener = (s: IdentitySettings | null) => void;
type Unsubscribe = () => void;

let currentSettings: IdentitySettings | null = null;
let currentJson = '';
let currentUid: string | null = null;
let startingUid: string | null = null;
let currentUnsubscribe: Unsubscribe | null = null;
/** 遞增序號，擋掉 import 完成回來時已 stop／已換 uid 的情境（L-01／L-02）。 */
let generation = 0;
const listeners = new Set<Listener>();

/** 照 A `_applyIdentityPrivateSettingsSnapshot`：JSON 相同就不通知。 */
function applyNext(next: IdentitySettings | null): void {
  const nextJson = JSON.stringify(next ?? null);
  if (currentJson === nextJson) return;
  currentSettings = next;
  currentJson = nextJson;
  // L-15：快照後逐一隔離 listener 例外。
  const snapshot = currentSettings;
  const currentListeners = Array.from(listeners);
  for (const listener of currentListeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error('[identity-settings] listener failed', err);
    }
  }
}

export function getIdentitySettings(): IdentitySettings | null {
  return currentSettings;
}

/**
 * 樂觀更新（照 A profile-data-render.js 寫入前先改 cache、失敗還原）。
 * 下一次 snapshot 會覆蓋。
 */
export function setIdentitySettingsLocal(next: IdentitySettings | null): void {
  applyNext(next);
}

export function subscribeIdentitySettings(listener: Listener): Unsubscribe {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 退訂、清成 null、通知訂閱者（照 A `_stopIdentityPrivateListener`）。 */
export function stopIdentitySettings(): void {
  generation += 1;
  if (currentUnsubscribe) {
    try {
      currentUnsubscribe();
    } catch {
      // A：忽略退訂錯誤
    }
    currentUnsubscribe = null;
  }
  currentUid = null;
  startingUid = null;
  if (currentSettings !== null) {
    currentSettings = null;
    currentJson = '';
    const snapshot: IdentitySettings | null = null;
    const currentListeners = Array.from(listeners);
    for (const listener of currentListeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[identity-settings] listener failed', err);
      }
    }
  } else {
    currentJson = '';
  }
}

/**
 * 照 A `_setupIdentityPrivateListener`：同 uid 不重開；換 uid 先停舊的。
 * 非同步 import 回來時若已 stop 或 uid 已換，立刻退訂丟棄。
 */
export function startIdentitySettings(uid: string): void {
  const safeUid = String(uid || '').trim();
  if (!safeUid) {
    stopIdentitySettings();
    return;
  }
  if (currentUid === safeUid && (currentUnsubscribe !== null || startingUid === safeUid)) {
    return;
  }
  stopIdentitySettings();
  currentUid = safeUid;
  startingUid = safeUid;
  const myGen = ++generation;

  const run = async (): Promise<void> => {
    try {
      const [firestoreMod, firebaseMod] = await Promise.all([
        import('firebase/firestore'),
        import('@/data/firebase'),
      ]);
      if (myGen !== generation || currentUid !== safeUid) return;
      const { db } = await firebaseMod.getFirebase();
      if (myGen !== generation || currentUid !== safeUid) return;
      const ref = firestoreMod.doc(db, 'users', safeUid, 'identityPrivate', 'settings');
      const unsub = firestoreMod.onSnapshot(
        ref,
        (snap) => {
          if (myGen !== generation || currentUid !== safeUid) return;
          if (!snap.exists()) {
            applyNext(null);
            return;
          }
          const data = snap.data() ?? {};
          applyNext(normalizeIdentitySettings({ ...data, _docId: snap.id }));
        },
        (err) => {
          // 監聽錯誤只 warn，不清空既有值（照 A）。
          console.warn('[identity-settings] listener failed', err);
        },
      );
      if (myGen !== generation || currentUid !== safeUid) {
        try {
          unsub();
        } catch {
          // 忽略
        }
        return;
      }
      currentUnsubscribe = unsub;
      startingUid = null;
    } catch (err) {
      console.warn('[identity-settings] start failed', err);
    }
  };
  run().catch((err) => {
    console.warn('[identity-settings] start fatal', err);
  });
}

/**
 * Preact hook。照 L-04：render 先讀一次、effect 訂閱後再補讀目前值。
 */
export function useIdentitySettings(): IdentitySettings | null {
  const [settings, setSettings] = useState<IdentitySettings | null>(getIdentitySettings());
  useEffect(() => {
    const unsubscribe = subscribeIdentitySettings(setSettings);
    setSettings(getIdentitySettings());
    return unsubscribe;
  }, []);
  return settings;
}

export function _resetIdentitySettingsForTest(): void {
  if (currentUnsubscribe) {
    try {
      currentUnsubscribe();
    } catch {
      // 忽略
    }
    currentUnsubscribe = null;
  }
  currentUid = null;
  startingUid = null;
  currentSettings = null;
  currentJson = '';
  listeners.clear();
  generation += 1;
}
