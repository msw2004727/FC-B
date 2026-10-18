/**
 * O 階段 Firestore 邊界；不修改 V 階段 viewer / visibility。
 * 文件缺失可採用 A defaults；讀取拒絕不可偽裝成文件缺失。
 * 所有必要讀取成功後才提交完整快照。
 */

import { useEffect, useState } from 'preact/hooks';
import { collection, doc, getDoc, getDocs, type Firestore } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { getCurrentUser } from '@/data/auth';
import { on } from '@/core/events';
import type {
  OperateContext,
  OperateUserGrant,
} from '@/features/events/data/operate-permissions';

import {
  getDefaultRoleActivityCapabilities,
  sanitizePermissionCodeList,
  sanitizeRoleActivityCapabilities,
  type CustomRole,
} from './permissions';

export type { OperateContext } from '@/features/events/data/operate-permissions';

export function createMinimalOperateContext(uid: string | null = null): OperateContext {
  return {
    uid,
    // role=null 保證 scope-only canManageEvent 也不會在載入期間放行。
    role: null,
    rolePermissions: [],
    userGrants: null,
    capabilities: [],
    customRoles: [],
  };
}

function parseCustomRole(data: Record<string, unknown>): CustomRole | null {
  if (typeof data.key !== 'string' || !data.key.trim()) return null;
  return {
    key: data.key,
    label: typeof data.label === 'string' && data.label ? data.label : data.key,
    color: typeof data.color === 'string' && data.color ? data.color : '#6366f1',
    afterRole: typeof data.afterRole === 'string' && data.afterRole
      ? data.afterRole
      : 'captain',
  };
}

function parseGrant(data: Record<string, unknown> | null): OperateUserGrant | null {
  if (!data) return null;
  return {
    uid: data.uid,
    enabled: data.enabled,
    permissions: Array.isArray(data.permissions) ? [...data.permissions] : [],
  };
}

export async function loadOperateContext(uid: string): Promise<OperateContext> {
  if (!uid) return createMinimalOperateContext();

  const firebase = await getFirebase();
  const db = firebase.db as unknown as Firestore;

  const userSnapshot = await getDoc(doc(db, 'users', uid));
  // ASSUMPTION: users 文件不存在表示尚無完整使用者快照；保持最小權限直到下次載入。
  if (!userSnapshot.exists()) return createMinimalOperateContext(uid);

  const user = userSnapshot.data() as Record<string, unknown>;
  // A 活動 helper 使用原 role；permission 層才另外 trim role。
  const role = typeof user.role === 'string' && user.role ? user.role : 'user';
  const permissionRole = role.trim() || 'user';

  const [roleSnapshot, grantSnapshot, capabilitySnapshot, customSnapshot] = await Promise.all([
    getDoc(doc(db, 'rolePermissions', permissionRole)),
    getDoc(doc(db, 'userPermissionGrants', uid)),
    getDoc(doc(db, 'roleActivityCapabilities', 'user')),
    getDocs(collection(db, 'customRoles')),
  ]);

  const roleData = roleSnapshot.exists()
    ? roleSnapshot.data() as Record<string, unknown>
    : null;
  const grantData = grantSnapshot.exists()
    ? grantSnapshot.data() as Record<string, unknown>
    : null;
  const capabilityData = capabilitySnapshot.exists()
    ? capabilitySnapshot.data() as Record<string, unknown>
    : null;

  const customRoles: CustomRole[] = [];
  for (const snapshot of customSnapshot.docs) {
    const parsed = parseCustomRole(snapshot.data() as Record<string, unknown>);
    // A37 儲存 key 欄位；不把 document ID 靜默當作缺失 key 的替代值。
    if (parsed) customRoles.push(parsed);
  }

  return {
    uid,
    role,
    // A 的 array-cache 角色文件沒有 permissions 欄位時，視為未儲存權限。
    rolePermissions: roleData && Object.prototype.hasOwnProperty.call(roleData, 'permissions')
      ? sanitizePermissionCodeList(roleData.permissions)
      : null,
    userGrants: parseGrant(grantData),
    // A35 的 storage 是文件 { capabilities }，不是 cache 的 { user: [...] }。
    // defaultCapabilities 是管理設定，A getter 不用它覆蓋 runtime defaults。
    capabilities: capabilityData && Array.isArray(capabilityData.capabilities)
      ? sanitizeRoleActivityCapabilities(capabilityData.capabilities)
      : getDefaultRoleActivityCapabilities('user'),
    customRoles,
  };
}

export interface OperateLoader {
  (uid: string | null): void;
  dispose(): void;
}

/**
 * UID 改變立即撤回舊快照；同 UID 失敗保留最後完整快照。
 * dispose 與新請求都使舊 Promise 失效。
 */
export function createOperateLoader(
  load: (uid: string) => Promise<OperateContext>,
  onChange: (context: OperateContext) => void,
  onError: (error: unknown) => void = () => {
    // 不輸出原始 Firestore error，避免把路徑／UID 帶進紀錄。
    // eslint-disable-next-line no-console
    console.warn('[viewer-operate] 權限載入失敗；下次身分更新時重試。');
  },
): OperateLoader {
  let sequence = 0;
  let lastUid: string | null = null;
  let disposed = false;

  const loader = (uid: string | null): void => {
    if (disposed) return;
    const current = ++sequence;

    if (!uid) {
      lastUid = null;
      onChange(createMinimalOperateContext());
      return;
    }

    if (uid !== lastUid) {
      lastUid = uid;
      onChange(createMinimalOperateContext(uid));
    }

    const run = async (): Promise<void> => {
      try {
        const next = await load(uid);
        if (disposed || current !== sequence) return;
        if (next.uid !== uid) throw new Error('Operate context UID mismatch');
        onChange(next);
      } catch (error: unknown) {
        if (disposed || current !== sequence) return;
        try {
          onError(error);
        } catch {
          // 錯誤回報本身不能製造未處理的 Promise rejection。
        }
      }
    };

    // run 在內部處理同步 throw 與 Promise rejection。
    void run();
  };

  return Object.assign(loader, {
    dispose(): void {
      disposed = true;
      sequence += 1;
    },
  });
}

/** 先訂閱後補讀，補讀不得覆蓋較新的 auth:changed。 */
export function useOperateContext(): OperateContext {
  const [context, setContext] = useState<OperateContext>(() => createMinimalOperateContext());

  useEffect(() => {
    let active = true;
    let authVersion = 0;
    const loader = createOperateLoader(loadOperateContext, setContext);

    const off = on('auth:changed', ({ uid }) => {
      if (!active) return;
      authVersion += 1;
      loader(uid);
    });

    const initialVersion = authVersion;
    const readInitial = async (): Promise<void> => {
      try {
        const user = await getCurrentUser();
        if (!active || authVersion !== initialVersion) return;
        loader(user ? user.uid : null);
      } catch {
        if (!active || authVersion !== initialVersion) return;
        loader(null);
      }
    };
    void readInitial();

    return () => {
      active = false;
      authVersion += 1;
      loader.dispose();
      off();
    };
  }, []);

  return context;
}
