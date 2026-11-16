/** 聊天室稽核「動作」篩選選項順序（A `pm-audit.js` 原順序，補上後端也會寫的 `settings_view`）。 */
export const PM_AUDIT_FILTER_ACTIONS = [
  'send',
  'read',
  'edit',
  'recall',
  'audit_view_conversation',
  'search_user',
  'audit_view_thread',
  'audit_search_logs',
  'settings_view',
  'settings_update',
] as const;
