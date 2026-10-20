// 個人頁寫入。
// A29：users/{uid} 明確白名單 patch + updatedAt。
// A31 / A32：companions／eduChildren + updatedAt。
// A30：身分設定與次身分頭像走 Callable，不直寫。
// L-32／L-33：逐動作白名單；serverTimestamp 僅用於 updatedAt。

import type { Firestore } from 'firebase/firestore';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { callFn } from '@/data/callables';
import type { CommitIdentitySettingsRequest } from '@/data/contract/callables';
import { getFirebase } from '@/data/firebase';
import { users } from '@/data/paths';
import { assertAllowedFields, assertNoDerivedFields } from '@/data/write-guard';

export const PROFILE_FIELD_ALLOWLIST = [
  'gender',
  'birthday',
  'region',
  'email',
  'phone',
  'sports',
  'socialLinks',
] as const;

export type ProfileField = (typeof PROFILE_FIELD_ALLOWLIST)[number];

const COMPANIONS_ALLOWLIST = ['companions', 'updatedAt'] as const;
const EDU_CHILDREN_ALLOWLIST = ['eduChildren', 'updatedAt'] as const;

// A HTML 的三個生日 select 合成既有 birthday 字串，不新增年月日儲存欄位。
// 法律同意欄位照 A `_buildFirstLoginLegalUpdates`（profile-form.js），Rules 限定版本值。
const FIRST_LOGIN_ALLOWLIST = [
  'gender', 'birthday', 'region', 'email', 'updatedAt',
  'termsVersion', 'privacyVersion', 'legalAcceptedSource', 'termsAcceptedAt', 'privacyAcceptedAt',
] as const;

/** 必須與 A `_legalTermsVersion`／`_legalPrivacyVersion` 及 firestore.rules 一致。 */
export const LEGAL_TERMS_VERSION = '2026-05-19';
export const LEGAL_PRIVACY_VERSION = '2026-05-19';

// legalConsent 是提交條件本身不落地；落地的是上方的法律同意欄位。
const FIRST_LOGIN_INPUT_ALLOWLIST = ['gender', 'birthday', 'region', 'email', 'legalConsent'] as const;

function assertValidUid(uid: string): string {
  const safe = String(uid || '').trim();
  if (!safe) throw new Error('[profile-writes] uid is required');
  return safe;
}

async function getUsersDb(): Promise<Firestore> {
  const firebase = await getFirebase();
  return firebase.db as unknown as Firestore;
}

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

/** A 生日格式：`YYYY/MM/DD`（補零）。驗證通過後才呼叫。 */
function toLegacyBirthday(value: string): string {
  return value.replace(/-/g, '/');
}

export interface FirstLoginInput {
  gender: string;
  birthday: string;
  region: string;
  email?: string;
  legalConsent: boolean;
}

function assertFirstLoginInput(input: FirstLoginInput): void {
  assertAllowedFields('saveFirstLoginProfile.input', { ...input }, FIRST_LOGIN_INPUT_ALLOWLIST);
  assertNoDerivedFields({ ...input });

  if (input.legalConsent !== true) {
    throw new Error('[profile-writes] legal consent is required');
  }
  if (!['男', '女', '其他'].includes(input.gender)) {
    throw new Error('[profile-writes] invalid gender');
  }
  if (typeof input.region !== 'string' || !input.region.trim()) {
    throw new Error('[profile-writes] region is required');
  }

  // 舊資料或舊呼叫端可能用「-」；寫入一律照 A `_getBirthdayFromSelects` 的 YYYY/MM/DD。
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(input.birthday);
  if (!match) throw new Error('[profile-writes] invalid birthday');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  const now = new Date();
  if (
    year < 1900
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getTime() > new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  ) throw new Error('[profile-writes] invalid birthday');

  const email = input.email?.trim() ?? '';
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email))) {
    throw new Error('[profile-writes] invalid email');
  }
}

/**
 * 對應 A `_buildFirstLoginLegalUpdates(source)`：一律寫版本與來源；
 * 只有尚未同意當前版本時才寫入同意時間（不覆蓋既有同意時間）。
 */
export function buildFirstLoginLegalUpdates(
  current: Record<string, unknown> | null | undefined,
  source: string,
  nowIso: string,
): Record<string, string> {
  const updates: Record<string, string> = {
    termsVersion: LEGAL_TERMS_VERSION,
    privacyVersion: LEGAL_PRIVACY_VERSION,
    legalAcceptedSource: source,
  };
  if (!(current && current['termsVersion'] === LEGAL_TERMS_VERSION && current['termsAcceptedAt'])) {
    updates['termsAcceptedAt'] = nowIso;
  }
  if (!(current && current['privacyVersion'] === LEGAL_PRIVACY_VERSION && current['privacyAcceptedAt'])) {
    updates['privacyAcceptedAt'] = nowIso;
  }
  return updates;
}

/**
 * 首次登入：gender／birthday／region／選填 email，加上 A 同款法律同意欄位（來源 'profile_completion_submit'）。
 * 生日年／月／日合成既有 birthday，沒有另造儲存格式。
 */
export async function saveFirstLoginProfile(
  uid: string,
  input: FirstLoginInput,
): Promise<void> {
  const safeUid = assertValidUid(uid);
  assertFirstLoginInput(input);

  const patch: Record<string, unknown> = {
    gender: input.gender,
    birthday: toLegacyBirthday(input.birthday),
    region: input.region.trim(),
  };
  const email = input.email?.trim() ?? '';
  if (email) patch['email'] = email;

  assertNoDerivedFields(patch);
  const db = await getUsersDb();
  // A 以記憶體中的 currentUser 判斷是否已同意；B 讀一次自己的文件（只在送出首次資料時）。
  const currentSnap = await getDoc(doc(db, users, safeUid));
  const current = currentSnap.exists() ? (currentSnap.data() as Record<string, unknown>) : null;
  const legal = buildFirstLoginLegalUpdates(current, 'profile_completion_submit', new Date().toISOString());
  const payload = { ...legal, ...patch, updatedAt: serverTimestamp() };
  assertAllowedFields('saveFirstLoginProfile', payload, FIRST_LOGIN_ALLOWLIST);
  await updateDoc(doc(db, users, safeUid), payload);
}

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

async function readExistingSocialLinks(
  db: Firestore,
  uid: string,
): Promise<Record<string, string>> {
  const snap = await getDoc(doc(db, users, uid));
  if (!snap.exists()) return {};
  const data = snap.data() as Record<string, unknown>;
  const raw = data['socialLinks'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export async function saveSocialLink(
  uid: string,
  platform: string,
  url: string,
): Promise<void> {
  const safeUid = assertValidUid(uid);
  const safePlatform = String(platform || '').trim();
  if (!safePlatform) throw new Error('[profile-writes] platform is required');

  const db = await getUsersDb();
  // 讀取失敗直接拒絕，避免把既有其他平台連結以空物件覆寫。
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

export async function clearSocialLink(uid: string, platform: string): Promise<void> {
  await saveSocialLink(uid, platform, '');
}

// Callable 型別以 P1 契約為單一來源。
export type {
  CommitIdentitySettingsRequest,
  CommitIdentitySettingsResponse,
  CommitSecondaryIdentityAvatarRequest,
  CommitSecondaryIdentityAvatarResponse,
} from '@/data/contract/callables';

/** UI 表單值；送出時轉成 A 的 Callable wire payload（見 buildIdentitySettingsRequest）。 */
export interface CommitIdentitySettingsInput {
  secondaryEnabled: boolean;
  secondaryDisplayName: string;
}

const IDENTITY_SETTINGS_ALLOWLIST = ['secondaryEnabled', 'secondaryDisplayName'] as const;

/** A 的預設值（profile-data-render.js saveIdentitySettings／_getResolvedSecondaryDisplayName），照存避免 A、B 顯示不一致。 */
const SECONDARY_DEFAULT_NAME = '次身份';
const SECONDARY_ROLE_LABEL = '一般用戶';

/** 對應 A `saveIdentitySettings` → `_buildIdentitySettingsCallablePayload`（updatedAt 由伺服器補）。 */
export function buildIdentitySettingsRequest(
  input: CommitIdentitySettingsInput,
): CommitIdentitySettingsRequest {
  return {
    profileActiveIdentityId: input.secondaryEnabled ? 'secondary' : 'main',
    identities: {
      secondary: {
        identityId: 'secondary',
        enabled: input.secondaryEnabled,
        displayName: input.secondaryDisplayName.trim() || SECONDARY_DEFAULT_NAME,
        displayRoleLabel: SECONDARY_ROLE_LABEL,
        isPrimary: false,
        editable: true,
      },
    },
  };
}

export async function commitIdentitySettings(
  input: CommitIdentitySettingsInput,
): Promise<void> {
  assertAllowedFields('commitIdentitySettings', { ...input }, IDENTITY_SETTINGS_ALLOWLIST);
  assertNoDerivedFields({ ...input });
  // B 比 A 嚴格：啟用時不接受空白名稱（A 會補預設名稱）。
  if (
    typeof input.secondaryEnabled !== 'boolean'
    || typeof input.secondaryDisplayName !== 'string'
    || input.secondaryDisplayName.trim().length > 40
    || (input.secondaryEnabled && !input.secondaryDisplayName.trim())
  ) throw new Error('[profile-writes] invalid identity settings');

  await callFn('commitIdentitySettings', buildIdentitySettingsRequest(input));
}

// 保留原資料層 API 相容性；本批 UI 不使用上傳或清除頭像方法。
// 欄位已對照 A firebase-crud.js uploadSecondaryIdentityAvatar／clearSecondaryIdentityAvatar。
export interface SecondaryAvatarUploadInput {
  avatarUrl: string;
  avatarStoragePath: string;
  avatarStorageBucket: string;
}

export interface SecondaryAvatarClearInput {
  clear: true;
}

export async function commitSecondaryIdentityAvatar(
  input: SecondaryAvatarUploadInput | SecondaryAvatarClearInput,
): Promise<void> {
  const allowed = 'clear' in input
    ? ['clear'] as const
    : ['avatarUrl', 'avatarStoragePath', 'avatarStorageBucket'] as const;
  assertAllowedFields('commitSecondaryIdentityAvatar', { ...input }, allowed);
  await callFn('commitSecondaryIdentityAvatar', input);
}
