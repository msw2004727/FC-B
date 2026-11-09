/**
 * 後台「推播通知設定」資料層（照 A `js/modules/message/notif-settings.js`）。
 *
 * 資料契約（兩站共用，②a 直寫）：
 * - 文件 `siteConfig/featureFlags`，只寫欄位 `notificationToggles`（map，9 個 key、值一律 boolean）。
 * - 寫法照 A：`set({ notificationToggles }, { merge: true })`，不動 featureFlags 其他欄位。
 * - Rules（FC `firestore.rules#canUpdateNotificationFeatureFlags`）：`hasEffectivePerm('admin.notif.toggle')`、
 *   affectedKeys 只能是 `notificationToggles`、map 的 key 只能是下列 9 個且值為 bool（另有 isAdmin() 通道）。
 * - 未設定的 key 視為開啟（A `currentToggles[key] !== false`）。
 * - 讀取失敗一律丟錯（不可像 `data/notify.ts#loadNotificationToggles` 回 `{}`：那會把全部顯示成開啟，儲存就覆寫掉真實設定）。
 */
import type { Firestore } from 'firebase/firestore';
import { getFirebase as defaultGetFirebase } from '@/data/firebase';
import { loadFirestoreSdk, type FirestoreSdk } from '@/data/firestore-sdk';
import { assertAllowedFields } from '@/data/write-guard';

/** 入口（選單與頁面同一判斷，照 A DRAWER_MENUS `admin.notif.entry`）。 */
export const NOTIF_ENTRY_PERMISSION = 'admin.notif.entry';
/** 修改開關（照 A `saveNotifSettings` 的 `hasPermission('admin.notif.toggle')`；同 Rules）。 */
export const NOTIF_TOGGLE_PERMISSION = 'admin.notif.toggle';

export const NOTIF_DOC_COLLECTION = 'siteConfig';
export const NOTIF_DOC_ID = 'featureFlags';
export const NOTIF_FIELD = 'notificationToggles';

/** A `NOTIF_CATEGORY_TOGGLE_FIELDS`。 */
export const NOTIF_CATEGORY_KEYS = ['category_activity', 'category_system', 'category_tournament'] as const;
/** A `NOTIF_TYPE_TOGGLE_FIELDS`。 */
export const NOTIF_TYPE_KEYS = [
  'type_signup_success',
  'type_cancel_signup',
  'type_waitlist_demoted',
  'type_event_relisted',
  'type_role_upgrade',
  'type_welcome',
] as const;
/** A `NOTIF_TOGGLE_ALLOWED_KEYS`（與 Rules `notificationToggleAllowedKeys()` 相同順序與內容）。 */
export const NOTIF_TOGGLE_ALLOWED_KEYS = [...NOTIF_CATEGORY_KEYS, ...NOTIF_TYPE_KEYS] as const;
/** A `NOTIF_ALWAYS_ON_FIELDS` 的 source（只顯示，不可切換、不寫入）。 */
export const NOTIF_ALWAYS_ON_SOURCES = [
  'template:waitlist_promoted',
  'template:event_cancelled',
  'template:event_changed',
  'target:*',
] as const;

export type NotifToggleKey = (typeof NOTIF_TOGGLE_ALLOWED_KEYS)[number];
export type NotifToggles = Record<NotifToggleKey, boolean>;

export interface NotifActor {
  uid: string | null;
  hasPermission(code: string): boolean;
}

export function canEnterNotifSettings(actor: NotifActor | null | undefined): boolean {
  return !!actor && typeof actor.uid === 'string' && actor.uid.length > 0
    && actor.hasPermission(NOTIF_ENTRY_PERMISSION) === true;
}

/** 開關可否切換與「儲存」按鈕是否出現、寫入函式是否放行，三者共用（R-IAM-011）。 */
export function canToggleNotifSettings(actor: NotifActor | null | undefined): boolean {
  return !!actor && typeof actor.uid === 'string' && actor.uid.length > 0
    && actor.hasPermission(NOTIF_TOGGLE_PERMISSION) === true;
}

/** 把文件上的 `notificationToggles`（可能不存在或格式不對）轉成 9 個開關的畫面值；未設定＝開啟（A 語意）。 */
export function resolveNotifToggles(raw: unknown): NotifToggles {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as NotifToggles;
  for (const key of NOTIF_TOGGLE_ALLOWED_KEYS) out[key] = source[key] !== false;
  return out;
}

export class NotifWriteError extends Error {
  readonly code: 'permission-denied' | 'invalid-payload';

  constructor(code: NotifWriteError['code'], message: string) {
    super(message);
    this.name = 'NotifWriteError';
    this.code = code;
  }
}

/** A `_validateNotifToggles`：物件、key 只能是允許清單、值一律 boolean。 */
export function validateNotifToggles(toggles: unknown): toggles is Partial<NotifToggles> {
  if (!toggles || typeof toggles !== 'object' || Array.isArray(toggles)) return false;
  const allowed = new Set<string>(NOTIF_TOGGLE_ALLOWED_KEYS);
  const entries = Object.entries(toggles as Record<string, unknown>);
  return entries.every(([key, value]) => allowed.has(key) && typeof value === 'boolean');
}

export interface NotifDeps {
  getFirebase?: () => Promise<{ db: Firestore }>;
  loadSdk?: () => Promise<FirestoreSdk>;
}

async function getContext(deps: NotifDeps): Promise<{ db: Firestore; sdk: FirestoreSdk }> {
  const [{ db }, sdk] = await Promise.all([
    (deps.getFirebase ?? defaultGetFirebase)(),
    (deps.loadSdk ?? loadFirestoreSdk)(),
  ]);
  return { db, sdk };
}

/** 讀 `siteConfig/featureFlags.notificationToggles`；文件不存在回 `{}`（全部預設開），讀取失敗丟錯。 */
export async function loadNotifToggles(deps: NotifDeps = {}): Promise<NotifToggles> {
  const { db, sdk } = await getContext(deps);
  const snap = await sdk.getDoc(sdk.doc(db, NOTIF_DOC_COLLECTION, NOTIF_DOC_ID));
  const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
  return resolveNotifToggles(data[NOTIF_FIELD]);
}

/** A `saveNotifSettings` 的寫入：權限 → 驗值 → 欄位白名單 → `setDoc(merge)`，只帶 `notificationToggles`。 */
export async function saveNotifToggles(
  toggles: NotifToggles,
  actor: NotifActor | null | undefined,
  deps: NotifDeps = {},
): Promise<void> {
  if (!canToggleNotifSettings(actor)) {
    throw new NotifWriteError('permission-denied', `${NOTIF_TOGGLE_PERMISSION} required`);
  }
  if (!validateNotifToggles(toggles)) {
    throw new NotifWriteError('invalid-payload', 'invalid notificationToggles');
  }
  const map: Record<string, boolean> = {};
  for (const key of NOTIF_TOGGLE_ALLOWED_KEYS) map[key] = toggles[key] !== false;
  const payload: Record<string, unknown> = { [NOTIF_FIELD]: map };
  assertAllowedFields('notif.save', payload, [NOTIF_FIELD]);
  const { db, sdk } = await getContext(deps);
  await sdk.setDoc(sdk.doc(db, NOTIF_DOC_COLLECTION, NOTIF_DOC_ID), payload, { merge: true });
}
