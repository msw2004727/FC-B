import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { OperationLogDoc } from '../data/operation-logs';
import AdminLogsPage from './AdminLogsPage';

const mockRoute = vi.fn();
vi.mock('preact-iso', () => ({
  useLocation: () => ({ route: mockRoute, path: '/admin/logs' }),
}));

const mockUseViewer = vi.fn<() => ViewerView>();
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => mockUseViewer(),
}));

const mockUseUserRoles = vi.fn<(uids: readonly string[]) => Record<string, string>>();
vi.mock('@/data/user-roles', () => ({
  useUserRoles: (uids: readonly string[]) => mockUseUserRoles(uids),
  getCachedUserLevel: () => undefined,
}));

const mockFetchOperationLogs = vi.fn<() => Promise<OperationLogDoc[]>>();
const mockCopyDiagnostic = vi.fn<(text: string) => Promise<void>>();

vi.mock('../data/operation-logs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/operation-logs')>();
  return {
    ...actual,
    fetchOperationLogs: () => mockFetchOperationLogs(),
    copyDiagnosticTextToClipboard: (text: string) => mockCopyDiagnostic(text),
  };
});

const zhTwDict: Record<string, string> = {
  'logs.title': '日誌',
  'logs.nav': '日誌',
  'logs.centerTitle': '日誌中心',
  'logs.back': '返回',
  'logs.permissionDenied': '權限不足',
  'logs.permissionDeniedBody': '您沒有權限檢視日誌中心。',
  'logs.actions.refresh': '重新整理',
  'logs.actions.info': '功能說明',
  'logs.actions.closeInfo': '關閉',
  'logs.tabs.operation.title': '操作日誌',
  'logs.tabs.operation.desc': '查看後台與系統操作紀錄，可依類型、UID、活動或文件 ID 篩選，並可複製診斷包。',
  'logs.tabs.audit.title': '稽核日誌',
  'logs.tabs.audit.desc': '查看敏感行為與關鍵操作紀錄，可依日期、時段與動作條件過濾。',
  'logs.tabs.error.title': '錯誤日誌',
  'logs.tabs.error.desc': '集中查看前端與系統錯誤，可依錯誤代碼與關鍵字過濾。',
  'logs.tabs.prompt.title': '用戶提示',
  'logs.tabs.prompt.desc': '集中查看用戶實際看到的登入、session、權限提示，可追蹤受影響用戶並複製診斷包。',
  'logs.tabs.chat.title': '聊天室稽核',
  'logs.tabs.chat.desc': '僅限 super_admin 查看私訊使用紀錄與指定用戶的稽核對話內容。',
  'logs.legacyFallback.body': '此分頁將於下一階段開放，請先前往舊版查看。',
  'logs.legacyFallback.linkLabel': '前往舊版查看',
  'logs.operation.searchPlaceholder': '搜尋操作者、UID、類型、內容、活動或文件 ID',
  'logs.operation.allTypes': '全部類型',
  'logs.operation.loading': '載入中...',
  'logs.operation.empty': '沒有符合條件的紀錄',
  'logs.operation.uncategorized': '未分類',
  'logs.operation.unmarked': '未標示',
  'logs.operation.none': '無',
  'logs.operation.viewDetails': '查看詳細內容',
  'logs.operation.copyDiagnostic': '複製診斷包',
  'logs.operation.copySuccess': '已複製操作日誌診斷包',
  'logs.operation.copyError': '複製操作日誌診斷包失敗',
  'logs.operation.copyNotFound': '找不到這筆操作日誌',
  'logs.operation.refreshSuccess': '已重新整理操作日誌',
  'logs.operation.refreshError': '重新整理操作日誌失敗',
  'logs.operation.prevPage': '‹ 上一頁',
  'logs.operation.nextPage': '下一頁 ›',
  'logs.operation.pageSummary': '{page} / {totalPages}（共 {total} 筆）',
  'logs.operation.diagnostic.header': 'ToosterX 操作日誌診斷包',
  'logs.operation.meta.operator': '操作者',
  'logs.operation.meta.uid': 'UID',
  'logs.operation.meta.type': '類型',
  'logs.operation.meta.event': '活動',
  'logs.operation.meta.doc': '文件',
  'logs.operation.detail.time': '時間',
  'logs.operation.detail.type': '類型',
  'logs.operation.detail.content': '內容',
  'logs.operation.detail.operator': '操作者',
  'logs.operation.detail.eventId': '活動 ID',
  'logs.operation.detail.docId': '文件 ID',
  'logs.operation.typeGroups.user': '用戶',
  'logs.operation.typeGroups.event': '活動',
  'logs.operation.typeGroups.tournament': '賽事',
  'logs.operation.typeGroups.team': '俱樂部',
  'logs.operation.typeGroups.achievement': '成就',
  'logs.operation.typeGroups.announcement': '公告',
  'logs.operation.typeGroups.system': '系統',
  'logs.operation.types.exp': '手動EXP',
  'logs.operation.types.team_exp': '俱樂部積分',
  'logs.operation.types.role': '角色變更',
  'logs.operation.types.event_create': '建立活動',
  'logs.operation.types.event_edit': '編輯活動',
  'logs.operation.types.event_end': '結束活動',
  'logs.operation.types.event_cancel': '取消活動',
  'logs.operation.types.event_reopen': '重開活動',
  'logs.operation.types.event_delete': '刪除活動',
  'logs.operation.types.tourn_create': '建立賽事',
  'logs.operation.types.tourn_edit': '編輯賽事',
  'logs.operation.types.tourn_end': '結束賽事',
  'logs.operation.types.tourn_reopen': '重開賽事',
  'logs.operation.types.tourn_delete': '刪除賽事',
  'logs.operation.types.tourn_approve': '賽事審批',
  'logs.operation.types.team_create': '建立俱樂部',
  'logs.operation.types.team_edit': '編輯俱樂部',
  'logs.operation.types.team_delete': '刪除俱樂部',
  'logs.operation.types.team_position': '職位變更',
  'logs.operation.types.team_approve': '入隊審批',
  'logs.operation.types.ach_create': '建立成就',
  'logs.operation.types.ach_edit': '編輯成就',
  'logs.operation.types.ach_toggle': '成就上下架',
  'logs.operation.types.ach_delete': '刪除成就',
  'logs.operation.types.ann_create': '建立公告',
  'logs.operation.types.ann_edit': '編輯公告',
  'logs.operation.types.ann_toggle': '公告上下架',
  'logs.operation.types.ann_delete': '刪除公告',
  'logs.operation.types.system_clear': '系統清除',
  'ui.userTag.role.admin': '管理員',
  'ui.userTag.role.user': '一般用戶',
  'ui.userTag.openProfile': '開啟 {name}',
};

vi.mock('@/i18n/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    let tmpl = zhTwDict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        tmpl = tmpl.replace(`{${k}}`, String(v));
      }
    }
    return tmpl;
  },
  formatNumber: (n: number) => String(n),
  getCurrentLocale: () => 'zh-TW',
}));

function makeViewer(overrides: Partial<ViewerView> = {}): ViewerView {
  return {
    uid: 'u_admin',
    role: 'super_admin',
    roleLevel: 99,
    teamIds: new Set(),
    capabilities: [],
    displayName: '站長',
    pictureUrl: null,
    hasPermission: (code: string) => code === 'admin.logs.entry',
    ...overrides,
  };
}

describe('AdminLogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUserRoles.mockReturnValue({ u_actor_1: 'admin' });
    mockCopyDiagnostic.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows permission denied EmptyState and does not fetch logs when viewer lacks admin.logs.entry', () => {
    mockUseViewer.mockReturnValue(
      makeViewer({ hasPermission: () => false }),
    );

    render(<AdminLogsPage />);

    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(mockFetchOperationLogs).not.toHaveBeenCalled();
  });

  it('renders tabs in legacy order, filters logs by keyword and type, and renders UserTag only when actorUid exists', async () => {
    mockUseViewer.mockReturnValue(makeViewer());
    mockFetchOperationLogs.mockResolvedValue([
      {
        _docId: 'op_1',
        actorUid: 'u_actor_1',
        operator: '管理員阿明',
        type: 'event_create',
        typeName: '建立活動',
        content: '週六籃球團',
        eventId: 'ev_101',
        time: '05/10 10:00',
        createdAt: { seconds: 2000 },
      },
      {
        _docId: 'op_2',
        actorUid: '',
        operator: '系統排程',
        type: 'system_clear',
        typeName: '系統清除',
        content: '排程清理',
        time: '05/09 03:00',
        createdAt: { seconds: 1000 },
      },
    ]);

    render(<AdminLogsPage />);

    await waitFor(() => {
      expect(mockFetchOperationLogs).toHaveBeenCalledTimes(1);
    });

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((el) => el.textContent)).toEqual([
      '操作日誌',
      '稽核日誌',
      '錯誤日誌',
      '用戶提示',
      '聊天室稽核',
    ]);

    await waitFor(() => {
      expect(screen.getByText('管理員阿明：週六籃球團')).toBeTruthy();
      expect(screen.getByText('系統排程：排程清理')).toBeTruthy();
    });

    // 有 actorUid 的顯示 UserTag，沒有的不顯示 UserTag（R-ID-002）
    const userTags = document.querySelectorAll('.ui-user-tag');
    expect(userTags).toHaveLength(1);
    expect(userTags[0]?.getAttribute('data-uid')).toBe('u_actor_1');

    // 篩選類型（L-42：使用原生 change Event）
    const selectEl = document.getElementById('oplog-type-filter') as HTMLSelectElement;
    await act(async () => {
      selectEl.value = 'system_clear';
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(screen.queryByText('管理員阿明：週六籃球團')).toBeNull();
    expect(screen.getByText('系統排程：排程清理')).toBeTruthy();
  });

  it('copies diagnostic text when clicking copy button and opens info modal / legacy tab link', async () => {
    mockUseViewer.mockReturnValue(makeViewer());
    mockFetchOperationLogs.mockResolvedValue([
      {
        _docId: 'op_diag_1',
        actorUid: 'u_actor_1',
        operator: '阿明',
        type: 'role',
        typeName: '角色變更',
        content: '升為教練',
        time: '05/12 12:00',
      },
    ]);

    render(<AdminLogsPage />);

    await waitFor(() => {
      expect(screen.getByText('複製診斷包')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('複製診斷包'));
    await waitFor(() => {
      expect(mockCopyDiagnostic).toHaveBeenCalledTimes(1);
    });
    expect(mockCopyDiagnostic.mock.calls[0]?.[0]).toContain('ToosterX 操作日誌診斷包');
    expect(mockCopyDiagnostic.mock.calls[0]?.[0]).toContain('文件 ID：op_diag_1');

    // 點擊說明按鈕開啟 modal
    const infoBtn = document.getElementById('admin-log-info-btn') as HTMLButtonElement;
    fireEvent.click(infoBtn);
    expect(screen.getByRole('dialog')).toBeTruthy();

    // 切換到稽核日誌分頁，檢查前往舊版連結
    fireEvent.click(screen.getByRole('tab', { name: '稽核日誌' }));
    const legacyLinks = screen.getAllByText('前往舊版查看');
    expect(legacyLinks.length).toBeGreaterThan(0);
    const anchor = legacyLinks[0]?.closest('a');
    expect(anchor?.getAttribute('href')).toBe('https://toosterx.com/');
    expect(anchor?.getAttribute('target')).toBe('_blank');
  });
});
