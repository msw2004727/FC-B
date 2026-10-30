/** 權限管理專用錯誤；畫面只顯示翻譯訊息，不輸出原始文件。 */
export class RoleAdminGuardError extends Error {
  constructor(readonly code: 'permission-denied' | 'invalid-argument' | 'locked-role' | 'no-defaults' | 'stale-document' | 'confirmation-required' | 'grant-disabled') {
    super(code);
    this.name = 'RoleAdminGuardError';
  }
}
