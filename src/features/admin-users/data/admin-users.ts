/**
 * 後台「用戶管理」資料層（M-142）：讀取名單、`adminManageUser` 呼叫包裝、稽核與站內信。
 *
 * - 讀取：進頁一次性讀取（不開即時監聽）；先用聚合 count 取人數，≤ ADMIN_USERS_FULL_LOAD_MAX 或人數未知（count 失敗）
 *   就分批讀全部（人數未知時以 maxChunks 為上限），超過則只讀第一批並由使用者按「載入更多」逐批（D1 降級，並回報 partial）。
 * - 寫入：角色／個人資料／限制一律走 Callable `adminManageUser`（Rules 禁止 client 改 role／claims）；
 *   寫入函式內部先用與按鈕相同的 helper 驗呼叫者權限（R-IAM-011），並以欄位 allowlist 擋掉多餘欄位。
 * - 稽核：`writeAuditLog` best-effort（try/catch，失敗只 warn；L-07 不用 void）。
 * - 通知：角色變更後只寫站內信（`deliverToInbox`）；不呼叫 `enqueuePrivilegedLineNotification`（T-062 第 2 批後再補）。
 * - 操作日誌：顧問 2026-10-27 裁定 `operationLogs` 只有 `actorUid`（＝操作者 UID）、沒有 uid 欄位衝突，
 *   角色變更、限制、資料編輯成功後呼叫既有 `writeOpLog`；旗標 ADMIN_USERS_OPLOG_ENABLED 預設開（保留旗標供測試與緊急關閉）。
 */
import {
  collection,
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';

import { emit } from '@/core/events';
import { callFn } from '@/data/callables';
import type { AdminManageUserRequest, AdminManageUserResponse, WriteAuditLogRequest } from '@/data/contract/callables';
import { getFirebase } from '@/data/firebase';
import { deliverInboxMessage } from '@/data/inbox-delivery';
import { DEFAULT_NOTIF_TEMPLATES, loadNotifTemplate, renderTemplate } from '@/data/notify';
import { writeOpLog } from '@/data/op-log';
import { assertAllowedFields } from '@/data/write-guard';
import type { CustomRoleInput } from '@/ui/drawer-menu';

import {
  ADMIN_PROFILE_FIELDS,
  canAssignRole,
  canChangeRoleOf,
  canEditProfileOf,
  canToggleRestrictionOf,
  mapUserDoc,
  type AdminProfileUpdates,
  type AdminUser,
  type AdminUserActor,
  type UserOpLogEntry,
} from './admin-users-model';

export const USERS_COLLECTION = 'users' as const;
export const CUSTOM_ROLES_COLLECTION = 'customRoles' as const;

/** D1：人數超過這個值就不一次讀完。 */
export const ADMIN_USERS_FULL_LOAD_MAX = 5000;
export const ADMIN_USERS_CHUNK_SIZE = 1000;

/** 操作日誌旗標：預設開（顧問 2026-10-27 裁定）。關閉時三個授權動作都不寫 operationLogs，稽核（writeAuditLog）不受影響。 */
export const ADMIN_USERS_OPLOG_ENABLED = true;

// ─── 讀取 ───

export interface UsersChunk {
  users: AdminUser[];
  lastId: string | null;
  done: boolean;
}

/** 依文件 ID 排序的一批；`afterId` 為上一批最後一筆。 */
export async function fetchUsersChunk(
  afterId: string | null,
  size: number = ADMIN_USERS_CHUNK_SIZE,
): Promise<UsersChunk> {
  const { db } = await getFirebase();
  const base = collection(db, USERS_COLLECTION);
  const q = afterId
    ? query(base, orderBy(documentId()), startAfter(afterId), limit(size))
    : query(base, orderBy(documentId()), limit(size));
  const snap = await getDocs(q);
  const users = snap.docs.map((docSnap) =>
    mapUserDoc(docSnap.data() as Record<string, unknown> | undefined, docSnap.id));
  const last = snap.docs[snap.docs.length - 1];
  return { users, lastId: last ? last.id : afterId, done: snap.docs.length < size };
}

/** 聚合 count（只計 1 次讀取費用）；失敗回 null（呼叫端視為人數未知）。 */
export async function countUsers(): Promise<number | null> {
  try {
    const { db } = await getFirebase();
    const snap = await getCountFromServer(collection(db, USERS_COLLECTION));
    const count = snap.data().count;
    return Number.isFinite(count) ? count : null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[admin-users] countUsers failed', err);
    return null;
  }
}

export interface AdminUsersLoad {
  users: AdminUser[];
  /** 伺服器回報的總人數；未知為 null。 */
  total: number | null;
  /** true＝只載入一部分（人數超過全讀上限，或人數未知且讀滿 maxChunks 批仍未讀完）；旗標開啟時畫面提示並提供「載入更多用戶」。 */
  partial: boolean;
  lastId: string | null;
  done: boolean;
}

function mergeUsers(existing: readonly AdminUser[], incoming: readonly AdminUser[]): AdminUser[] {
  const byId = new Map<string, AdminUser>();
  for (const user of existing) byId.set(user._docId, user);
  for (const user of incoming) byId.set(user._docId, user);
  return [...byId.values()];
}

export async function loadAdminUsers(): Promise<AdminUsersLoad> {
  const total = await countUsers();
  // 人數未知（count 失敗）也比照全讀，只受 maxChunks 上限約束；否則會靜默只讀 1,000 人、搜尋找不到其餘的人。
  const readAll = total === null || total <= ADMIN_USERS_FULL_LOAD_MAX;
  let users: AdminUser[] = [];
  let lastId: string | null = null;
  let done = false;
  // 防呆：即使讀取期間人數成長，最多多讀 2 批。
  const maxChunks = Math.ceil(ADMIN_USERS_FULL_LOAD_MAX / ADMIN_USERS_CHUNK_SIZE) + 2;
  for (let i = 0; i < maxChunks; i += 1) {
    const chunk = await fetchUsersChunk(lastId);
    users = mergeUsers(users, chunk.users);
    lastId = chunk.lastId;
    done = chunk.done;
    if (done || !readAll) break;
  }
  return { users, total, partial: !done, lastId, done };
}

export async function loadMoreAdminUsers(prev: AdminUsersLoad): Promise<AdminUsersLoad> {
  if (prev.done) return prev;
  const chunk = await fetchUsersChunk(prev.lastId);
  return {
    ...prev,
    users: mergeUsers(prev.users, chunk.users),
    lastId: chunk.lastId,
    done: chunk.done,
    partial: !chunk.done,
  };
}

/** 自訂角色（影響角色選單與標籤）；失敗回空陣列，只剩內建角色。 */
export async function fetchCustomRoles(): Promise<CustomRoleInput[]> {
  try {
    const { db } = await getFirebase();
    const snap = await getDocs(collection(db, CUSTOM_ROLES_COLLECTION));
    const roles: CustomRoleInput[] = [];
    for (const docSnap of snap.docs) {
      const data = (docSnap.data() as Record<string, unknown> | undefined) ?? {};
      const rawKey = data['key'] ?? data['roleKey'] ?? docSnap.id;
      const key = typeof rawKey === 'string' ? rawKey.trim() : '';
      if (!key) continue;
      roles.push({
        key,
        label: typeof data['label'] === 'string' ? data['label'] : undefined,
        color: typeof data['color'] === 'string' ? data['color'] : undefined,
        afterRole: typeof data['afterRole'] === 'string' ? data['afterRole'] : undefined,
      });
    }
    return roles;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[admin-users] fetchCustomRoles failed', err);
    return [];
  }
}

// ─── 寫入：adminManageUser ───

/** 前端先擋下（伺服器仍是最終裁判）。code 與 Callable 的 permission-denied 同值，錯誤訊息映射共用。 */
export class AdminUserGuardError extends Error {
  readonly code: string;
  constructor(code: 'permission-denied' | 'invalid-argument', message: string) {
    super(message);
    this.name = 'AdminUserGuardError';
    this.code = code;
  }
}

export interface ManageAdminUserInput {
  actor: AdminUserActor;
  target: AdminUser;
  profileUpdates?: AdminProfileUpdates;
  /** 下一個 isRestricted 值；伺服器重算 restrictedAt／ByUid／ByName。 */
  restriction?: boolean;
  /** 新角色（manualRole 同步設為同值，A 後台手動指派語意）。 */
  role?: string;
  /** 自訂角色清單：用來判斷自訂角色的插入層級（非 super_admin 不得指派排在 admin 之後的自訂角色）。 */
  customRoles?: readonly CustomRoleInput[];
}

/** 組出 Callable 請求（只含有要改的區塊）；權限不足或無變更時丟 AdminUserGuardError。 */
export function buildManageUserRequest(input: ManageAdminUserInput): AdminManageUserRequest {
  const { actor, target } = input;
  // 送文件 ID（同 A `updateAdminUser`：`user._docId || user.uid || user.lineUserId`，js/api-service.js:1639）。
  // 伺服器 `findUserDocByUidOrLineUserId` 先直接讀 `users/{傳入值}`、找不到才查 `uid ==`；
  // 若舊資料有隨機 ID 的文件與正式文件 `users/{uid}` 並存，送 uid 會命中另一份文件，前端對「目標角色」的守衛就對錯文件。
  // 身份仍以 UID 為準（R-ID-002）：伺服器回傳的 `targetUid` 是文件內 uid，稽核、站內信、forceRefreshToken 判斷都用回傳值。
  const targetUid = (target._docId || target.uid || '').trim();
  if (!targetUid) throw new AdminUserGuardError('invalid-argument', '[admin-users] target document id is required');

  const request: AdminManageUserRequest = { targetUid };

  const profile = input.profileUpdates ?? {};
  if (Object.keys(profile).length > 0) {
    assertAllowedFields('adminManageUser.profileUpdates', profile as Record<string, unknown>, ADMIN_PROFILE_FIELDS);
    if (!canEditProfileOf(actor, target)) {
      throw new AdminUserGuardError('permission-denied', '[admin-users] missing admin.users.edit_profile');
    }
    request.profileUpdates = { ...profile };
  }

  if (input.restriction !== undefined) {
    if (!canToggleRestrictionOf(actor, target)) {
      throw new AdminUserGuardError('permission-denied', '[admin-users] restriction not allowed for this target');
    }
    request.restrictionUpdate = { isRestricted: input.restriction === true };
  }

  if (input.role !== undefined) {
    const role = String(input.role).trim();
    if (!canChangeRoleOf(actor, target) || !canAssignRole(actor, role, input.customRoles ?? [])) {
      throw new AdminUserGuardError('permission-denied', '[admin-users] role change not allowed');
    }
    request.roleChange = { role, manualRole: role };
  }

  if (!request.profileUpdates && !request.restrictionUpdate && !request.roleChange) {
    throw new AdminUserGuardError('invalid-argument', '[admin-users] no supported updates requested');
  }
  return request;
}

/** 自己的角色被改時，Auth custom claim 已更新，需強制換新 ID token 並通知 viewer 重讀。best-effort。 */
export async function refreshOwnSession(): Promise<void> {
  try {
    const { auth } = await getFirebase();
    await auth.currentUser?.getIdToken(true);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[admin-users] refresh id token failed', err);
  }
  emit('viewer:refresh', {});
}

export async function manageAdminUser(input: ManageAdminUserInput): Promise<AdminManageUserResponse> {
  const request = buildManageUserRequest(input);
  const response = await callFn('adminManageUser', request);
  if (response?.forceRefreshToken) await refreshOwnSession();
  return response ?? {};
}

/** 伺服器／守衛錯誤分類，給畫面轉成白話訊息。 */
export type AdminUserErrorKind = 'permission' | 'not_found' | 'precondition' | 'unauthenticated' | 'other';

export function classifyAdminUserError(err: unknown): AdminUserErrorKind {
  const raw = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  const code = typeof raw === 'string' ? raw.replace(/^functions\//, '') : '';
  switch (code) {
    case 'permission-denied': return 'permission';
    case 'not-found': return 'not_found';
    case 'failed-precondition': return 'precondition';
    case 'unauthenticated': return 'unauthenticated';
    default: return 'other';
  }
}

// ─── 稽核（best-effort） ───

export interface UserAuditEntry {
  action: 'admin_user_edit' | 'role_change';
  target: Pick<AdminUser, 'uid' | 'name'>;
  statusFrom: string;
  statusTo: string;
}

export async function writeUserAudit(entry: UserAuditEntry): Promise<void> {
  const payload: WriteAuditLogRequest = {
    action: entry.action,
    targetType: 'user',
    targetId: entry.target.uid || '',
    targetLabel: entry.target.name,
    result: 'success',
    source: 'web',
    meta: { statusFrom: entry.statusFrom, statusTo: entry.statusTo },
  };
  try {
    await callFn('writeAuditLog', payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[admin-users] writeAuditLog failed', err);
  }
}

// ─── 操作日誌（operationLogs；actorUid ＝操作者自己的 UID，被改的對象只出現在 content） ───

export interface UserOpLogInput extends UserOpLogEntry {
  /** 操作者（呼叫者）的 UID；不是被修改的用戶。 */
  actorUid: string | null;
  /** A `_writeOpLog` 的 operator：顯示名稱 → 角色中文名 → 系統（由呼叫端組裝）。 */
  operator: string;
  /** 測試注入；未傳用 ADMIN_USERS_OPLOG_ENABLED。 */
  enabled?: boolean;
}

export async function recordUserOpLog(input: UserOpLogInput): Promise<void> {
  if (!(input.enabled ?? ADMIN_USERS_OPLOG_ENABLED)) return;
  try {
    await writeOpLog({
      type: input.type,
      typeName: input.typeName,
      content: input.content,
      actorUid: input.actorUid,
      operator: input.operator,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[admin-users] opLog failed', err);
  }
}

// ─── 站內信：role_upgrade（只寫收件匣，不發 LINE） ───

export interface RoleUpgradeNotice {
  targetUid: string;
  userName: string;
  roleName: string;
  senderUid: string | null;
}

/** A `_sendNotifFromTemplate('role_upgrade', {userName, roleName}, uid, 'private', '私訊')` 的收件匣部分；失敗只 warn。 */
export async function sendRoleUpgradeInbox(notice: RoleUpgradeNotice): Promise<boolean> {
  const targetUid = notice.targetUid.trim();
  if (!targetUid) return false;
  try {
    const custom = await loadNotifTemplate('role_upgrade');
    const fallback = DEFAULT_NOTIF_TEMPLATES['role_upgrade'];
    const tpl = custom?.title && custom?.body ? { title: custom.title, body: custom.body } : fallback;
    if (!tpl) {
      // eslint-disable-next-line no-console
      console.warn('[admin-users] role_upgrade template missing');
      return false;
    }
    const vars = { userName: notice.userName, roleName: notice.roleName };
    const message = await deliverInboxMessage({
      title: renderTemplate(tpl.title, vars),
      body: renderTemplate(tpl.body, vars),
      category: 'private',
      categoryName: '私訊',
      targetUid,
      senderName: '系統',
      senderUid: notice.senderUid,
    });
    return message !== null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[admin-users] role_upgrade inbox failed', err);
    return false;
  }
}
