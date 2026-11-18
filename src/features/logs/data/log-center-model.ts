import {
  getOperationLogDocId,
  getOperationLogSortMs,
  getVisibleOperationLogs,
  matchesOperationLogKeyword,
  type OperationLogDoc,
} from './operation-logs';

export type AdminLogTabKey = 'operation' | 'audit' | 'error' | 'prompt' | 'chat';

export interface AdminLogTabConfig {
  key: AdminLogTabKey;
  titleKey: string;
  descKey: string;
  superAdminOnly?: boolean;
}

/** 照 A `_adminLogInfoMap` 順序：操作日誌、稽核日誌、錯誤日誌、用戶提示、聊天室稽核。 */
export const ADMIN_LOG_TABS: readonly AdminLogTabConfig[] = [
  {
    key: 'operation',
    titleKey: 'logs.tabs.operation.title',
    descKey: 'logs.tabs.operation.desc',
  },
  {
    key: 'audit',
    titleKey: 'logs.tabs.audit.title',
    descKey: 'logs.tabs.audit.desc',
  },
  {
    key: 'error',
    titleKey: 'logs.tabs.error.title',
    descKey: 'logs.tabs.error.desc',
  },
  {
    key: 'prompt',
    titleKey: 'logs.tabs.prompt.title',
    descKey: 'logs.tabs.prompt.desc',
  },
  {
    key: 'chat',
    titleKey: 'logs.tabs.chat.title',
    descKey: 'logs.tabs.chat.desc',
    superAdminOnly: true,
  },
];

export interface OpLogTypeOption {
  value: string;
  labelKey: string;
}

export interface OpLogTypeOptGroup {
  groupKey: string;
  labelKey: string;
  options: readonly OpLogTypeOption[];
}

/** 照 A `a-page-admin-logs.html` `#oplog-type-filter` 的 optgroup 與 option 順序。 */
export const OPLOG_TYPE_GROUPS: readonly OpLogTypeOptGroup[] = [
  {
    groupKey: 'user',
    labelKey: 'logs.operation.typeGroups.user',
    options: [
      { value: 'exp', labelKey: 'logs.operation.types.exp' },
      { value: 'team_exp', labelKey: 'logs.operation.types.team_exp' },
      { value: 'role', labelKey: 'logs.operation.types.role' },
    ],
  },
  {
    groupKey: 'event',
    labelKey: 'logs.operation.typeGroups.event',
    options: [
      { value: 'event_create', labelKey: 'logs.operation.types.event_create' },
      { value: 'event_edit', labelKey: 'logs.operation.types.event_edit' },
      { value: 'event_end', labelKey: 'logs.operation.types.event_end' },
      { value: 'event_cancel', labelKey: 'logs.operation.types.event_cancel' },
      { value: 'event_reopen', labelKey: 'logs.operation.types.event_reopen' },
      { value: 'event_delete', labelKey: 'logs.operation.types.event_delete' },
    ],
  },
  {
    groupKey: 'tournament',
    labelKey: 'logs.operation.typeGroups.tournament',
    options: [
      { value: 'tourn_create', labelKey: 'logs.operation.types.tourn_create' },
      { value: 'tourn_edit', labelKey: 'logs.operation.types.tourn_edit' },
      { value: 'tourn_end', labelKey: 'logs.operation.types.tourn_end' },
      { value: 'tourn_reopen', labelKey: 'logs.operation.types.tourn_reopen' },
      { value: 'tourn_delete', labelKey: 'logs.operation.types.tourn_delete' },
      { value: 'tourn_approve', labelKey: 'logs.operation.types.tourn_approve' },
    ],
  },
  {
    groupKey: 'team',
    labelKey: 'logs.operation.typeGroups.team',
    options: [
      { value: 'team_create', labelKey: 'logs.operation.types.team_create' },
      { value: 'team_edit', labelKey: 'logs.operation.types.team_edit' },
      { value: 'team_delete', labelKey: 'logs.operation.types.team_delete' },
      { value: 'team_position', labelKey: 'logs.operation.types.team_position' },
      { value: 'team_approve', labelKey: 'logs.operation.types.team_approve' },
    ],
  },
  {
    groupKey: 'achievement',
    labelKey: 'logs.operation.typeGroups.achievement',
    options: [
      { value: 'ach_create', labelKey: 'logs.operation.types.ach_create' },
      { value: 'ach_edit', labelKey: 'logs.operation.types.ach_edit' },
      { value: 'ach_toggle', labelKey: 'logs.operation.types.ach_toggle' },
      { value: 'ach_delete', labelKey: 'logs.operation.types.ach_delete' },
    ],
  },
  {
    groupKey: 'announcement',
    labelKey: 'logs.operation.typeGroups.announcement',
    options: [
      { value: 'ann_create', labelKey: 'logs.operation.types.ann_create' },
      { value: 'ann_edit', labelKey: 'logs.operation.types.ann_edit' },
      { value: 'ann_toggle', labelKey: 'logs.operation.types.ann_toggle' },
      { value: 'ann_delete', labelKey: 'logs.operation.types.ann_delete' },
    ],
  },
  {
    groupKey: 'system',
    labelKey: 'logs.operation.typeGroups.system',
    options: [{ value: 'system_clear', labelKey: 'logs.operation.types.system_clear' }],
  },
];

export const OPERATION_LOG_PAGE_SIZE = 20;

/** A `_ensureAdminLogCenterLayout` & `_normalizeAdminLogTab`：chat 分頁僅對 super_admin 開放。 */
export function getAvailableAdminLogTabs(role: string): AdminLogTabConfig[] {
  return ADMIN_LOG_TABS.filter((tab) => !tab.superAdminOnly || role === 'super_admin');
}

export function normalizeAdminLogTab(tabKey: string, role: string): AdminLogTabKey {
  const available = getAvailableAdminLogTabs(role).map((t) => t.key);
  return available.includes(tabKey as AdminLogTabKey) ? (tabKey as AdminLogTabKey) : 'operation';
}

export interface FilterOperationLogsOptions {
  keyword?: string;
  typeFilter?: string;
}

/** A `filterOperationLogs`：先取可見日誌，再依 keyword 與 typeFilter 過濾。 */
export function filterOperationLogsList(
  logs: readonly OperationLogDoc[] | null | undefined,
  options: FilterOperationLogsOptions = {},
): OperationLogDoc[] {
  const keyword = String(options.keyword || '').trim().toLowerCase();
  const typeFilter = String(options.typeFilter || '').trim();

  let result = getVisibleOperationLogs(logs);
  if (keyword) {
    result = result.filter((l) => matchesOperationLogKeyword(l, keyword));
  }
  if (typeFilter) {
    result = result.filter((l) => l.type === typeFilter);
  }
  return result;
}

export interface PaginatedOperationLogs {
  sorted: OperationLogDoc[];
  pageItems: OperationLogDoc[];
  safePage: number;
  totalPages: number;
  totalCount: number;
}

/** A `renderOperationLogs` 的排序與分頁計算（PAGE_SIZE = 20）。 */
export function paginateOperationLogs(
  logs: readonly OperationLogDoc[] | null | undefined,
  page = 1,
  pageSize = OPERATION_LOG_PAGE_SIZE,
): PaginatedOperationLogs {
  const visible = getVisibleOperationLogs(logs);
  const sorted = [...visible].sort(
    (a, b) => getOperationLogSortMs(b) - getOperationLogSortMs(a),
  );
  const size = Math.max(1, pageSize);
  const p = Math.max(1, page || 1);
  const totalPages = Math.max(1, Math.ceil(sorted.length / size));
  const safePage = Math.min(p, totalPages);
  const pageItems = sorted.slice((safePage - 1) * size, safePage * size);

  return {
    sorted,
    pageItems,
    safePage,
    totalPages,
    totalCount: sorted.length,
  };
}

/** A `_findOperationLogByDocId` */
export function findOperationLogByDocId(
  docId: string,
  filteredLogs: readonly OperationLogDoc[],
  allLogs: readonly OperationLogDoc[] = [],
): OperationLogDoc | null {
  const targetId = String(docId || '').trim();
  if (!targetId) return null;
  const source = [...filteredLogs, ...getVisibleOperationLogs(allLogs)];
  return source.find((log) => getOperationLogDocId(log) === targetId) || null;
}
