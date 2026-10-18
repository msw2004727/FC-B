// 個人頁寫入。
//
// 契約：
// - A29：`users/{uid}.update({...patch, updatedAt: serverTimestamp()})`。
//   B 以明確白名單寫入（S02），禁寫 role／exp 等同步欄位。
// - A31 / A32：`{ companions | eduChildren, updatedAt }`。
// - A30：身分設定與次身分頭像全部走 Callable，B 不得直寫。
//
// L-32／L-33：逐動作白名單；serverTimestamp 僅套用於各動作清單中的 updatedAt。

import type { Firestore } from 'firebase/firestore';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { callFn } from '@/data/callables';
import { getFirebase } from '@/data/firebase';
import { users } from '@/data/paths';
import { assertAllowedFields, assertNoDerivedFields } from '@/data/write-guard';

/**
 * A29 個人資料白名單（來源逐欄標註）。
 * 不含 role / exp / level / totalGames 等同步或衍生統計。
 */
export const PROFILE_FIELD_ALLOWLIST = [
  // A `saveFirstLoginProfile`（首次登入表單）：必填 / 選填
  'gender',
  'birthday',
  'region',
  'email',
  // A 個人資料編輯表單（gender / phone / sports 由 `renderProfileData` 顯示為可編輯欄位）
  'phone',
  'sports',
  // A `profile-card.js#saveSocialLink`（社交連結）
  'socialLinks',
] as const;

export type ProfileField = (typeof PROFILE_FIELD_ALLOWLIST)[number];

/** A31：companions 直寫，含 updatedAt。 */
const COMPANIONS_ALLOWLIST = ['companions', 'updatedAt'] as const;

/** A32：eduChildren 直寫，含 updatedAt。 */
const EDU_CHILDREN_ALLOWLIST = ['eduChildren', 'updatedAt'] as const;

/** A 首次登入表單提交的欄位子集（gender / birthday / region / email）。 */
const FIRST_LOGIN_ALLOWLIST = ['gender', 'birthday', 'region', 'email'] as const;

function assertValidUid(uid: string): string {
  const safe = String(uid || '').trim();
  if (!safe) throw new Error('[profile-writes] uid is required');
  return safe;
}

async function getUsersDb(): Promise<Firestore> {
  const firebase = await getFirebase();
  return firebase.db as unknown as Firestore;
}

// ── 社交連結正規化（A `_normalizeLineContactUrl`） ─────

/**
 * A `profile-card.js#_normalizeLineContactUrl`：
 *   - 空字串 → ''
 *   - 已是 http(s):// 或 line:// → 原樣
 *   - 其他 → `https://line.me/ti/p/{encodeURIComponent(raw.replace(/^@/, ''))}`
 */
export function normalizeLineContactUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || /^line:\/\//i.test(raw)) return raw;
  return `https://line.me/ti/p/${encodeURIComponent(raw.replace(/^@/, ''))}`;
}

function normalizeSocialLinkValue(platform: string, raw: unknown): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  if (platform === 'line') return normalizeLineContactUrl(trimmed);
  return trimmed;
}

// ── A29 ───────────────────────────────────────────────

/**
 * A29：寫入個人資料（明確欄位白名單；updatedAt 由 serverTimestamp 覆寫）。
 * 呼叫前會先 `assertAllowedFields` + `assertNoDerivedFields`。
 */
export async function updateProfileFields(
  uid: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const safeUid = assertValidUid(uid);
  assertAllowedFields('updateProfileFields', patch, PROFILE_FIELD_ALLOWLIST);
  assertNoDerivedFields(patch);

  const db = await getUsersDb();
  await updateDoc(doc(db, users, safeUid), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export interface FirstLoginInput {
  gender: string;
  birthday: string;
  region: string;
  email?: string;
}

/**
 * A `saveFirstLoginProfile`（首次登入表單）：
 * 只寫 gender / birthday / region（必填）；email 僅於有值時寫入。
 *
 * 注意：A 版還包含 `_buildFirstLoginLegalUpdates('profile_completion_submit')`，
 * 本 B 資料層未移植該函式，法律同意欄位屬 UI 端另一個提交路徑，這裡不寫入。
 */
export async function saveFirstLoginProfile(
  uid: string,
  input: FirstLoginInput,
): Promise<void> {
  const safeUid = assertValidUid(uid);
  const patch: Record<string, unknown> = {
    gender: input.gender,
    birthday: input.birthday,
    region: input.region,
  };
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (email) patch['email'] = email;

  assertAllowedFields('saveFirstLoginProfile', patch, FIRST_LOGIN_ALLOWLIST);
  assertNoDerivedFields(patch);

  const db = await getUsersDb();
  await updateDoc(doc(db, users, safeUid), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

// ── A31 / A32 ─────────────────────────────────────────

/** A31：`{ companions, updatedAt }`。 */
export async function saveCompanions(
  uid: string,
  companions: readonly unknown[],
): Promise<void> {
  const safeUid = assertValidUid(uid);
  const payload = { companions: [...companions] };
  assertAllowedFields('saveCompanions', payload, COMPANIONS_ALLOWLIST);
  assertNoDerivedFields(payload);

  const db = await getUsersDb();
  await updateDoc(doc(db, users, safeUid), {
    companions: payload.companions,
    updatedAt: serverTimestamp(),
  });
}

/** A32：`{ eduChildren, updatedAt }`。 */
export async function saveEduChildren(
  uid: string,
  children: readonly unknown[],
): Promise<void> {
  const safeUid = assertValidUid(uid);
  const payload = { eduChildren: [...children] };
  assertAllowedFields('saveEduChildren', payload, EDU_CHILDREN_ALLOWLIST);
  assertNoDerivedFields(payload);

  const db = await getUsersDb();
  await updateDoc(doc(db, users, safeUid), {
    eduChildren: payload.eduChildren,
    updatedAt: serverTimestamp(),
  });
}

// ── 社交連結（A profile-card） ────────────────────────

async function readExistingSocialLinks(
  db: Firestore,
  uid: string,
): Promise<Record<string, string>> {
  try {
    const snap = await getDoc(doc(db, users, uid));
    if (!snap.exists()) return {};
    const data = snap.data() as Record<string, unknown>;
    const raw = data['socialLinks'];
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[profile-writes] read socialLinks failed', err);
    return {};
  }
}

/**
 * A `saveSocialLink`：整個 `socialLinks` 物件覆寫，platform 值寫 `normalized || ''`。
 * 保留其他平台值。
 */
export async function saveSocialLink(
  uid: string,
  platform: string,
  url: string,
): Promise<void> {
  const safeUid = assertValidUid(uid);
  const safePlatform = String(platform || '').trim();
  if (!safePlatform) throw new Error('[profile-writes] platform is required');

  const db = await getUsersDb();
  const existing = await readExistingSocialLinks(db, safeUid);
  const normalized = normalizeSocialLinkValue(safePlatform, url);
  const next: Record<string, string> = { ...existing, [safePlatform]: normalized || '' };

  const payload = { socialLinks: next };
  assertAllowedFields('saveSocialLink', payload, PROFILE_FIELD_ALLOWLIST);
  assertNoDerivedFields(payload);

  await updateDoc(doc(db, users, safeUid), {
    socialLinks: next,
    updatedAt: serverTimestamp(),
  });
}

/** A `clearSocialLink`：把該平台值覆寫成 ''。 */
export async function clearSocialLink(uid: string, platform: string): Promise<void> {
  await saveSocialLink(uid, platform, '');
}

// ── A30：Callable ─────────────────────────────────────

export interface CommitIdentitySettingsInput {
  [field: string]: unknown;
}

/**
 * A30 `updateCurrentIdentitySettings`：以 Callable 送出。
 * B 端不直寫 identity 設定欄位；input 由呼叫端依 A 的 form 值組好。
 */
export async function commitIdentitySettings(
  input: CommitIdentitySettingsInput,
): Promise<void> {
  await callFn('commitIdentitySettings', input);
}

export interface SecondaryAvatarUploadInput {
  avatarUrl: string;
  avatarStoragePath: string;
  avatarStorageBucket: string;
}

export interface SecondaryAvatarClearInput {
  clear: true;
}

/**
 * A30 `uploadSecondaryIdentityAvatar` / `clearSecondaryIdentityAvatar`：
 * 以 Callable 送出（upload 需先完成 Storage 上傳；此處僅負責送 metadata）。
 */
export async function commitSecondaryIdentityAvatar(
  input: SecondaryAvatarUploadInput | SecondaryAvatarClearInput,
): Promise<void> {
  await callFn('commitSecondaryIdentityAvatar', input);
}
