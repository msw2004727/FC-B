// M-083：LINE 推播綁定（照 A `bindLineNotify` + `_completeLineBinding` + `_reconcileLineBindingExp`）。
//
// A 寫入鏈：`profile-data.js#bindLineNotify` → `ApiService.updateCurrentUser` → `FirebaseService.updateUser`
//   → `users/{docId}.update({ lineNotify, updatedAt: serverTimestamp() })`。
// 積分：`auto-exp/rules.js#_reconcileLineBindingExp` → `ApiService.adjustUserExp`
//   → `_writeOpLog('exp','自動EXP',...)` + `_callAdjustExpCF({ mode:'auto', ..., requestId:'autoexp_<uid>_line_binding', ruleKey:'line_binding' })`。
//
// 積分或 opLog 失敗只 console.warn；綁定本身視為成功（A 同）。

import { callFn } from '@/data/callables';
import { getFirebase } from '@/data/firebase';
import { writeOpLog } from '@/data/op-log';
import { toast } from '@/ui/Toast';
import { loadSignupProfile } from './signup-profile';

const DISMISS_KEY = '_dismissLineNotifyPrompt';
/** A `LINE_CONFIG.BOT_BASIC_ID`。 */
const LINE_BOT_BASIC_ID = '@830utvza';

/** A `_completeLineBinding`：`YYYY/MM/DD`。 */
export function formatBoundAt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/** A `_completeLineBinding`：寫入 users 的 lineNotify 欄位。 */
export function buildLineNotifyPayload(date: Date = new Date()): {
  lineNotify: {
    bound: true;
    boundAt: string;
    settings: { activity: true; system: true; tournament: false };
  };
} {
  return {
    lineNotify: {
      bound: true,
      boundAt: formatBoundAt(date),
      settings: { activity: true, system: true, tournament: false },
    },
  };
}

/**
 * 照 A `bindLineNotify` + `_completeLineBinding` + `_reconcileLineBindingExp`：
 * 1. `window.open(https://line.me/R/ti/p/@830utvza)`
 * 2. 寫 `users/{uid}.lineNotify` + `updatedAt`
 * 3. 讀 `siteConfig/autoExpRules.line_binding` > 0 才呼叫 `adjustExp` + 寫 opLog（失敗只 warn）
 * 4. 600ms 後 toast
 */
export async function bindLineNotify(
  uid: string,
  displayName?: string,
  options: {
    signal?: AbortSignal;
    notify?: (message: string) => void;
  } = {},
): Promise<void> {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid) throw new Error('bindLineNotify: uid is required');

  // 1. 開啟 LINE 加好友頁
  if (typeof window !== 'undefined') {
    window.open(`https://line.me/R/ti/p/${LINE_BOT_BASIC_ID}`, 'sporthub_line');
  }

  // 2. 寫 users/{uid}.lineNotify + updatedAt
  const [{ doc, updateDoc, serverTimestamp }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  await updateDoc(doc(db, 'users', cleanUid), {
    ...buildLineNotifyPayload(),
    updatedAt: serverTimestamp(),
  });

  // 3. 積分 + opLog（失敗只 warn）
  try {
    await grantLineBindingExp(cleanUid, displayName);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[line-notify-bind] exp or opLog failed', err);
  }

  // 照 A _completeLineBinding；卸載只取消提示，不中斷已開始的綁定副作用。
  if (options.signal?.aborted) return;
  const cancel = (): void => {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  };
  const timer = setTimeout(() => {
    options.signal?.removeEventListener('abort', cancel);
    if (options.signal?.aborted) return;
    const message = '已啟用 LINE 通知，請確認已加入官方帳號好友';
    if (options.notify) options.notify(message);
    else toast.show({ message });
  }, 600);
  options.signal?.addEventListener('abort', cancel, { once: true });
}

async function grantLineBindingExp(uid: string, displayName?: string): Promise<void> {
  const [{ doc, getDoc }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const snap = await getDoc(doc(db, 'siteConfig', 'autoExpRules'));
  if (!snap.exists()) return;
  const data = snap.data() as Record<string, unknown> | undefined;
  const raw = data?.line_binding;
  const amount = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
  if (amount <= 0) return;

  const reason = '自動：綁定 LINE 推播';
  await callFn('adjustExp', {
    mode: 'auto',
    targets: [uid],
    amount,
    reason,
    operatorLabel: '系統',
    requestId: `autoexp_${uid}_line_binding`,
    // A `_reconcileLineBindingExp` 帶 ruleKey；如 AdjustExpRequest 未宣告，依 A 仍應輸出（server 讀此欄做去重分類）。
    ruleKey: 'line_binding',
  });

  const display = (displayName || '').trim() || '系統';
  await writeOpLog({
    type: 'exp',
    typeName: '自動EXP',
    content: `${display} +${amount}「${reason}」`,
    actorUid: uid,
    operator: display,
  });
}

/**
 * 照 A `_maybeShowLineNotifyPrompt`：未綁定且未永久關閉才顯示。
 * 綁定狀態由 3b-1a `loadSignupProfile(uid).lineNotifyBound` 提供。
 */
export async function shouldShowLineNotifyPrompt(uid: string): Promise<boolean> {
  if (typeof localStorage === 'undefined') return false;
  try {
    if (localStorage.getItem(DISMISS_KEY) === '1') return false;
  } catch {
    // ignore
  }
  try {
    const profile = await loadSignupProfile(uid);
    return !profile.lineNotifyBound;
  } catch {
    return false;
  }
}

/** 照 A「請別煩我」：寫 `_dismissLineNotifyPrompt='1'`（包 try/catch）。 */
export function dismissLineNotifyPrompt(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // ignore
  }
}
