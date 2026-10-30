import { describe, expect, it } from 'vitest';
import { getDefaultRolePermissions, BUILTIN_ROLE_KEYS } from '@/features/profile/data/permissions';
import { getARolePermissionDefaults } from './role-defaults';

describe('M21 內建角色預設權限兩份實作一致', () => {
  it.each([...BUILTIN_ROLE_KEYS])('%s：角色頁預設與個人頁權限預設相同', role => {
    const roles = getARolePermissionDefaults(role, {}, []);
    const profile = getDefaultRolePermissions(role, []);
    expect(roles).not.toBeNull();
    expect([...(roles ?? [])].sort()).toEqual([...(profile ?? [])].sort());
  });
});
