import {
  collection, getCountFromServer, getDocsFromServer, orderBy, query, where,
} from 'firebase/firestore';
import type { Query } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { BUILTIN_ROLE_KEYS, type CustomRole } from '@/features/profile/data/permissions';
import type { RoleDocument } from './role-defaults';
import { capabilitySource, type RolesData } from './role-model';
import type { CatalogCategory } from './permission-catalog';

/**
 * Q6：total - orderBy(role) 的存在欄位計數＝缺 role 的數量。
 * 不能用 total - 已知角色合計，否則未知但有效角色也會被算進 user。
 * A 使用 u.role || 'user'，故另補 null／空字串／false／0；不下載用戶文件。
 */
export async function loadRoleCounts(keys: readonly string[]): Promise<Record<string, number>> {
  const { db } = await getFirebase();
  const users = collection(db, 'users');
  const count = async (q: Query): Promise<number> =>
    (await getCountFromServer(q)).data().count;
  const unique = [...new Set(keys)];
  const [total, withRole, counts, emptyRoles] = await Promise.all([
    count(users), count(query(users, orderBy('role'))),
    Promise.all(unique.map(async key => [key, await count(query(users, where('role', '==', key)))] as const)),
    Promise.all([null, '', false, 0].map(value => count(query(users, where('role', '==', value))))),
  ]);
  if (total < withRole) throw new Error('roles-count-changed');
  const result = Object.fromEntries(counts);
  result['user'] = (result['user'] ?? 0) + total - withRole + emptyRoles.reduce((sum, n) => sum + n, 0);
  return result;
}

/** 進頁一次性讀取；不開監聽，也不從舊快取補成可寫資料。任一集合失敗則整體失敗。 */
export async function loadRolesData(): Promise<RolesData> {
  const { db } = await getFirebase();
  const [roles, custom, catalog, capabilities] = await Promise.all(
    ['rolePermissions', 'customRoles', 'permissions', 'roleActivityCapabilities']
      .map(name => getDocsFromServer(collection(db, name))),
  );
  if (!roles || !custom || !catalog || !capabilities) throw new Error('roles-load-failed');
  const rolePermissions: Record<string, RoleDocument> = Object.fromEntries(
    roles.docs.map(item => [item.id, item.data()]),
  );
  const roleActivityDocuments: Record<string, RoleDocument> = Object.fromEntries(
    capabilities.docs.map(item => [item.id, item.data()]),
  );
  const customRoles: CustomRole[] = custom.docs.map(item => {
    const raw = item.data();
    const key = raw['key'] ?? raw['roleKey'] ?? item.id;
    return {
      key: typeof key === 'string' ? key.trim() : '',
      label: typeof raw['label'] === 'string' ? raw['label'] : undefined,
      color: typeof raw['color'] === 'string' && /^#[0-9a-f]{6}$/i.test(raw['color']) ? raw['color'] : undefined,
      afterRole: typeof raw['afterRole'] === 'string' ? raw['afterRole'] : undefined,
    };
  }).filter(item => item.key && !BUILTIN_ROLE_KEYS.some(key => key === item.key));
  const permissions: CatalogCategory[] = catalog.docs.map(item => {
    const raw = item.data();
    const items: unknown[] = Array.isArray(raw['items']) ? raw['items'] : [];
    return {
      cat: typeof raw['cat'] === 'string' ? raw['cat'] : '',
      items: items.flatMap(value => {
        if (!value || typeof value !== 'object') return [];
        const entry = value as Record<string, unknown>;
        return typeof entry['code'] === 'string'
          ? [{ code: entry['code'], name: typeof entry['name'] === 'string' ? entry['name'] : entry['code'] }]
          : [];
      }),
    };
  });
  const counts = await loadRoleCounts([...BUILTIN_ROLE_KEYS, ...customRoles.map(item => item.key)]);
  return {
    rolePermissions, roleActivityDocuments, customRoles, permissions, counts,
    roleActivityCapabilities: capabilitySource(roleActivityDocuments['user'] ?? null),
  };
}
