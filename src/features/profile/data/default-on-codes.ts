/**
 * 預設開的權限碼（站內賽事主辦）。顧問 §3.612：這兩個碼永遠不放進 permissions／capabilities 陣列，
 * 只看角色文件頂層的 disabledCodes（只記「關」）。舊站 saveRolePermissions 會用自己的碼清單過濾陣列，
 * 放進陣列會被舊站無聲洗掉，所以另開欄位。
 *
 * 真值表與後端 functions-cp/src/cp/host-permission.ts 一字不差：
 * - undefined（文件或欄位不存在）→ 開
 * - 陣列且含 code → 關；陣列且不含 code（含 []）→ 開
 * - 其他（null、字串、物件、數字…）→ 關（fail-closed）
 *
 * 本檔被權限頁與賽事頁兩個延遲載入的 chunk 共用，不得 import firebase 或其他大型模組。
 */

/** 教練以上（rolePermissions 系統）的主辦賽事碼。 */
export const COMPETITION_HOST_CODE = 'competition.host';
/** 一般用戶（roleActivityCapabilities 系統）的主辦賽事碼。 */
export const USER_COMPETITION_HOST_CODE = 'user.competition.host';

export const DEFAULT_ON_ROLE_CODES: readonly string[] = Object.freeze([COMPETITION_HOST_CODE]);
export const DEFAULT_ON_CAPABILITY_CODES: readonly string[] = Object.freeze([USER_COMPETITION_HOST_CODE]);

/** disabledRaw 是文件的 disabledCodes 原始值；整個欄位被刪掉時回到預設開（接受的行為）。 */
export function isDefaultOnCodeEnabled(disabledRaw: unknown, code: string): boolean {
  if (disabledRaw === undefined) return true;
  if (!Array.isArray(disabledRaw)) return false;
  return !disabledRaw.includes(code);
}

/**
 * 能否主辦站內賽事（只決定前端是否顯示建立入口；後端 createCompetition 另行守門）。
 * permissionSources.disabledCodes：null＝讀取失敗或壞值（→ 關）；undefined＝沒有這個欄位（→ 開）。
 * permissionSources 缺省（測試替身）→ 開。個別授權（userPermissionGrants）不納入。
 */
export function canHostCompetition(v: {
  uid: string | null;
  role: string;
  permissionSources?: { disabledCodes?: readonly string[] | null };
}): boolean {
  if (!v.uid || !v.role || v.role === 'guest') return false;
  if (v.role === 'super_admin') return true;
  const code = v.role === 'user' ? USER_COMPETITION_HOST_CODE : COMPETITION_HOST_CODE;
  if (!v.permissionSources) return true;
  return isDefaultOnCodeEnabled(v.permissionSources.disabledCodes, code);
}
