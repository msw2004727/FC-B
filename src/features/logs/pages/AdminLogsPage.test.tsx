import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { OperationLogDoc } from '../data/operation-logs';
import AdminLogsPage from './AdminLogsPage';

const mockGoBack = vi.fn<(fallbackPath: string) => void>();
vi.mock('@/core/back-guard', () => ({
  useGoBack: (fallbackPath: string) => () => mockGoBack(fallbackPath),
}));

const mockUseViewer = vi.fn<() => ViewerView>();
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => mockUseViewer(),
}));

const mockToast = vi.fn<(arg: { message: string; tone?: string }) => void>();
vi.mock('@/ui/Toast', () => ({
  toast: { show: (arg: { message: string; tone?: string }) => mockToast(arg) },
}));

// 頁面不查操作者角色（照 A）；mock 只為了斷言它從未被呼叫。
const mockUseUserRoles = vi.fn<(uids: readonly string[]) => Record<string, string>>();
vi.mock('@/data/user-roles', () => ({
  useUserRoles: (uids: readonly string[]) => mockUseUserRoles(uids),
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

// 直接讀真正的 zh-TW.json（前綴 logs.），不在測試裡手抄字典；斷言裡的中文即 A 的原文，順便驗證 JSON 與 A 一致。
function flattenDict(
  obj: Record<string, unknown>,
  prefix: string,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = `${prefix}${k}`;
    if (v && typeof v === 'object') flattenDict(v as Record<string, unknown>, `${key}.`, out);
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

// 相對路徑放變數：Vite 會把 new URL 的字面相對路徑改寫成開發資源網址（照 qa-login/QaBanner.test.tsx）。
const zhTwRelativePath = '../locales/zh-TW.json';
const zhTwDict: Record<string, string> = flattenDict(
  JSON.parse(readFileSync(new URL(zhTwRelativePath, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >,
  'logs.',
);

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

/** 依 index 產生可穩定排序的日誌：index 越大越新；文件 ID 帶 13 位毫秒時間戳。 */
function makeLog(i: number, over: Partial<OperationLogDoc> = {}): OperationLogDoc {
  const ms = 1_700_000_000_000 + i * 60_000;
  return {
    _docId: `op_${ms}_${i}`,
    actorUid: `u_actor_${i}`,
    operator: `操作者${i}`,
    type: 'event_edit',
    typeName: '編輯活動',
    content: `內容${i}`,
    time: `05/10 10:${String(i % 60).padStart(2, '0')}`,
    createdAt: { seconds: ms / 1000 },
    ...over,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function logList(): HTMLElement {
  return document.getElementById('operation-log-list') as HTMLElement;
}

function rowCount(): number {
  return logList().querySelectorAll('.log-item').length;
}

async function typeKeyword(value: string): Promise<void> {
  const input = document.getElementById('oplog-search') as HTMLInputElement;
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// L-42：原生 <select> 的 onChange 要在 act 內派送原生 change 事件。
async function chooseType(value: string): Promise<void> {
  const select = document.getElementById('oplog-type-filter') as HTMLSelectElement;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('AdminLogsPage（操作日誌，照 A 外觀）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseViewer.mockReturnValue(makeViewer());
    mockFetchOperationLogs.mockResolvedValue([]);
    mockCopyDiagnostic.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  describe('權限矩陣（入口只認 admin.logs.entry）', () => {
    const cases: ReadonlyArray<{ who: string; role: string; allowed: boolean }> = [
      { who: 'user（無權限碼）', role: 'user', allowed: false },
      { who: 'coach（無權限碼）', role: 'coach', allowed: false },
      { who: 'captain（無權限碼）', role: 'captain', allowed: false },
      { who: 'admin（無權限碼）', role: 'admin', allowed: false },
      { who: 'admin（有權限碼）', role: 'admin', allowed: true },
      { who: 'super_admin（有權限碼）', role: 'super_admin', allowed: true },
      { who: 'super_admin（被撤權限碼）', role: 'super_admin', allowed: false },
    ];

    for (const c of cases) {
      it(`${c.who}：${c.allowed ? '可看到日誌並讀取' : '顯示權限不足且不讀取'}`, async () => {
        mockUseViewer.mockReturnValue(
          makeViewer({
            role: c.role,
            hasPermission: (code: string) => c.allowed && code === 'admin.logs.entry',
          }),
        );
        mockFetchOperationLogs.mockResolvedValue([makeLog(1)]);

        render(<AdminLogsPage />);

        if (c.allowed) {
          await waitFor(() => {
            expect(screen.getByText('操作者1：內容1')).toBeTruthy();
          });
          expect(mockFetchOperationLogs).toHaveBeenCalledTimes(1);
          expect(screen.queryByText('權限不足')).toBeNull();
        } else {
          expect(screen.getByText('權限不足')).toBeTruthy();
          const deniedPage = document.getElementById('page-admin-logs');
          expect(deniedPage?.parentElement?.classList.contains('legacy-ui')).toBe(true);
          expect(deniedPage?.classList.contains('active')).toBe(true);
          expect(document.getElementById('oplog-search')).toBeNull();
          expect(mockFetchOperationLogs).not.toHaveBeenCalled();
        }
      });
    }
  });

  describe('頁首與篩選列（逐項照 A pages/admin-system.html）', () => {
    it('頁首只有返回鍵與「操作日誌」，沒有「一鍵清除」、頁籤列與任何寫入入口', async () => {
      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(screen.getByText('沒有符合條件的紀錄')).toBeTruthy();
      });

      const page = document.getElementById('page-admin-logs') as HTMLElement;
      expect(page.parentElement?.classList.contains('legacy-ui')).toBe(true);
      const header = page.querySelector('.page-header') as HTMLElement;
      expect(Array.from(header.children).map((el) => el.tagName)).toEqual(['BUTTON', 'H2']);
      expect(header.querySelector('.back-btn')?.getAttribute('aria-label')).toBe('返回');
      expect(header.querySelector('h2')?.textContent).toBe('操作日誌');

      expect(screen.queryByText('一鍵清除')).toBeNull();
      expect(screen.queryByText('清空資料')).toBeNull();
      expect(page.querySelector('.header-action-btn')).toBeNull();
      expect(page.querySelector('#admin-log-tabs')).toBeNull();
      expect(screen.queryByRole('tab')).toBeNull();
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(page.querySelector('#admin-log-refresh-btn')).toBeNull();
      expect(page.querySelector('#admin-log-info-btn')).toBeNull();
    });

    it('搜尋框 placeholder 與類型下拉（optgroup 與選項順序）逐字照 A', async () => {
      render(<AdminLogsPage />);

      const input = document.getElementById('oplog-search') as HTMLInputElement;
      expect(input.type).toBe('text');
      expect(input.getAttribute('placeholder')).toBe('搜尋操作者、UID、類型、內容、活動或文件 ID');
      expect(input.parentElement?.classList.contains('admin-search')).toBe(true);

      const select = document.getElementById('oplog-type-filter') as HTMLSelectElement;
      expect(select.parentElement?.classList.contains('admin-filters')).toBe(true);
      expect(select.firstElementChild?.tagName).toBe('OPTION');
      expect(select.firstElementChild?.textContent).toBe('全部類型');
      expect(select.firstElementChild?.getAttribute('value')).toBe('');

      const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => ({
        label: g.getAttribute('label'),
        values: Array.from(g.querySelectorAll('option')).map((o) => o.getAttribute('value')),
      }));
      expect(groups).toEqual([
        { label: '用戶', values: ['exp', 'team_exp', 'role'] },
        {
          label: '活動',
          values: [
            'event_create',
            'event_edit',
            'event_end',
            'event_cancel',
            'event_reopen',
            'event_delete',
          ],
        },
        {
          label: '賽事',
          values: [
            'tourn_create',
            'tourn_edit',
            'tourn_end',
            'tourn_reopen',
            'tourn_delete',
            'tourn_approve',
          ],
        },
        {
          label: '俱樂部',
          values: ['team_create', 'team_edit', 'team_delete', 'team_position', 'team_approve'],
        },
        { label: '成就', values: ['ach_create', 'ach_edit', 'ach_toggle', 'ach_delete'] },
        { label: '公告', values: ['ann_create', 'ann_edit', 'ann_toggle', 'ann_delete'] },
        { label: '系統', values: ['system_clear'] },
      ]);
      expect(
        Array.from(select.querySelectorAll('option')).map((o) => o.textContent),
      ).toEqual([
        '全部類型',
        '手動EXP',
        '俱樂部積分',
        '角色變更',
        '建立活動',
        '編輯活動',
        '結束活動',
        '取消活動',
        '重開活動',
        '刪除活動',
        '建立賽事',
        '編輯賽事',
        '結束賽事',
        '重開賽事',
        '刪除賽事',
        '賽事審批',
        '建立俱樂部',
        '編輯俱樂部',
        '刪除俱樂部',
        '職位變更',
        '入隊審批',
        '建立成就',
        '編輯成就',
        '成就上下架',
        '刪除成就',
        '建立公告',
        '編輯公告',
        '公告上下架',
        '刪除公告',
        '系統清除',
      ]);
    });

    it('返回鍵：能進數據儀表板的人回 /admin/ops，其他人回首頁', async () => {
      mockUseViewer.mockReturnValue(
        makeViewer({
          hasPermission: (code: string) =>
            code === 'admin.logs.entry' || code === 'admin.dashboard.entry',
        }),
      );
      const first = render(<AdminLogsPage />);
      fireEvent.click(screen.getByRole('button', { name: '返回' }));
      expect(mockGoBack).toHaveBeenLastCalledWith('/admin/ops');
      first.unmount();

      mockUseViewer.mockReturnValue(makeViewer());
      render(<AdminLogsPage />);
      fireEvent.click(screen.getByRole('button', { name: '返回' }));
      expect(mockGoBack).toHaveBeenLastCalledWith('/');
      await waitFor(() => {
        expect(mockFetchOperationLogs).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('日誌列（逐項照 A renderOperationLogs）', () => {
    it('每列輸出時間、類型膠囊、操作者：內容、meta、詳細內容，且沒有角色膠囊或個人頁連結', async () => {
      mockFetchOperationLogs.mockResolvedValue([
        makeLog(7, {
          operator: '管理員阿明',
          type: 'event_create',
          typeName: '建立活動',
          content: '週六籃球團',
          eventId: 'ev_101',
          time: '05/10 10:00',
        }),
      ]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(screen.getByText('管理員阿明：週六籃球團')).toBeTruthy();
      });

      const row = logList().querySelector('.log-item') as HTMLElement;
      expect(row.className).toBe('log-item operation-log-item oplog-row-log-tone-green');
      expect(row.querySelector('.operation-log-main .log-time')?.textContent).toBe('05/10 10:00');
      const typePill = row.querySelector('.operation-log-main .log-content .log-type');
      expect(typePill?.className).toBe('log-type log-tone-green');
      expect(typePill?.textContent).toBe('建立活動');
      expect(row.querySelector('.operation-log-action-text')?.textContent).toBe(
        '管理員阿明：週六籃球團',
      );

      const metas = Array.from(row.querySelectorAll('.operation-log-meta > span')).map(
        (el) => el.textContent,
      );
      expect(metas).toEqual([
        '操作者：管理員阿明',
        'UID：u_actor_7',
        '類型：event_create',
        '活動：ev_101',
        `文件：${makeLog(7)._docId}`,
      ]);

      const detailRows = Array.from(row.querySelectorAll('.operation-log-detail-row')).map(
        (el) => [el.querySelector('span')?.textContent, el.querySelector('pre')?.textContent],
      );
      expect(detailRows[1]).toEqual(['類型', '建立活動（event_create）']);
      expect(detailRows[2]).toEqual(['內容', '週六籃球團']);
      expect(detailRows[3]).toEqual(['操作者', '管理員阿明 / u_actor_7']);
      expect(detailRows[4]).toEqual(['活動 ID', 'ev_101']);
      expect(detailRows[5]).toEqual(['文件 ID', makeLog(7)._docId]);

      // 照 A：操作者只顯示文字，不查角色、不放角色膠囊、不放個人頁連結。
      expect(row.querySelector('.ui-user-tag')).toBeNull();
      expect(row.querySelector('a')).toBeNull();
    });

    it('缺欄位時顯示「未標示／未分類／無」，沒有活動 ID 與文件 ID 時不輸出對應 meta 與複製鈕', async () => {
      mockFetchOperationLogs.mockResolvedValue([
        { createdAt: null, type: '', typeName: '', operator: '', content: '', actorUid: '' },
      ]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(rowCount()).toBe(1);
      });

      const row = logList().querySelector('.log-item') as HTMLElement;
      expect(row.className).toBe('log-item operation-log-item oplog-row-log-tone-gray');
      expect(row.querySelector('.log-type')?.textContent).toBe('未分類');
      expect(row.querySelector('.log-time')?.textContent).toBe('未標示');
      expect(row.querySelector('.operation-log-action-text')?.textContent).toBe('未標示：未標示');
      expect(
        Array.from(row.querySelectorAll('.operation-log-meta > span')).map((el) => el.textContent),
      ).toEqual(['操作者：未標示', 'UID：未標示', '類型：未標示']);
      expect(row.querySelector('.operation-log-copy-btn')).toBeNull();
      expect(row.querySelectorAll('.operation-log-detail-row pre')[4]?.textContent).toBe('無');
    });

    it('操作者 UID 容忍兩種欄位：只有 uid 退用 uid；兩者不同用 actorUid；皆缺顯示未標示', async () => {
      mockFetchOperationLogs.mockResolvedValue([
        makeLog(3, { actorUid: undefined, uid: 'u_legacy_3', content: '只有uid' }),
        makeLog(2, { actorUid: 'u_new_2', uid: 'u_other_2', content: '兩者不同' }),
        makeLog(1, { actorUid: undefined, uid: undefined, content: '兩者皆缺' }),
      ]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(rowCount()).toBe(3);
      });

      const metaUid = (content: string): string | null | undefined => {
        const row = Array.from(logList().querySelectorAll('.log-item')).find((r) =>
          r.querySelector('.operation-log-action-text')?.textContent?.endsWith(content),
        );
        return row?.querySelectorAll('.operation-log-meta > span')[1]?.textContent;
      };
      expect(metaUid('只有uid')).toBe('UID：u_legacy_3');
      expect(metaUid('兩者不同')).toBe('UID：u_new_2');
      expect(metaUid('兩者皆缺')).toBe('UID：未標示');

      await typeKeyword('u_legacy_3');
      expect(rowCount()).toBe(1);
      await typeKeyword('u_other_2');
      expect(rowCount()).toBe(0);
    });

    it('只有 operator、沒有 actorUid／uid（Functions 寫的日誌常見）：UID 顯示「未標示」，不查角色、不丟錯', async () => {
      mockFetchOperationLogs.mockResolvedValue([
        makeLog(5, { actorUid: undefined, uid: undefined, operator: '系統排程', content: '自動結算' }),
        makeLog(4, { actorUid: 'u_with_actor', content: '有操作者' }),
      ]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(rowCount()).toBe(2);
      });

      const row = Array.from(logList().querySelectorAll('.log-item')).find((r) =>
        r.querySelector('.operation-log-action-text')?.textContent === '系統排程：自動結算',
      ) as HTMLElement;
      expect(row).toBeTruthy();
      expect(
        Array.from(row.querySelectorAll('.operation-log-meta > span')).map((el) => el.textContent),
      ).toEqual([
        '操作者：系統排程',
        'UID：未標示',
        '類型：event_edit',
        `文件：${makeLog(5)._docId}`,
      ]);
      expect(row.querySelector('.ui-user-tag')).toBeNull();
      expect(mockUseUserRoles).not.toHaveBeenCalled();
    });

    it('與其他日誌重複的類型（cancel_signup 等）不顯示', async () => {
      mockFetchOperationLogs.mockResolvedValue([
        makeLog(1, { type: 'cancel_signup', content: '取消報名' }),
        makeLog(2, { type: 'role', content: '升為教練' }),
        makeLog(3, { type: 'role', content: '甲 → 乙' }),
      ]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(rowCount()).toBe(1);
      });
      expect(screen.getByText('操作者2：升為教練')).toBeTruthy();
    });
  });

  describe('tone 色調對照表（逐 type，獨立抄自 A _getOperationLogToneClass）', () => {
    const TONES: ReadonlyArray<readonly [string, string]> = [
      ['exp', 'log-tone-blue'],
      ['team_exp', 'log-tone-violet'],
      ['role', 'log-tone-purple'],
      ['system_clear', 'log-tone-red'],
      ['audit_backfill', 'log-tone-rose'],
      ['manual_attendance', 'log-tone-cyan'],
      ['participant_removed', 'log-tone-orange'],
      ['unreg_removed', 'log-tone-amber'],
      ['event_create', 'log-tone-green'],
      ['event_edit', 'log-tone-sky'],
      ['event_end', 'log-tone-amber'],
      ['event_cancel', 'log-tone-red'],
      ['event_reopen', 'log-tone-teal'],
      ['event_relist', 'log-tone-indigo'],
      ['event_delete', 'log-tone-red'],
      ['team_create', 'log-tone-orange'],
      ['team_edit', 'log-tone-amber'],
      ['team_delete', 'log-tone-red'],
      ['team_position', 'log-tone-purple'],
      ['team_leave', 'log-tone-gray'],
      ['team_member_remove', 'log-tone-rose'],
      ['team_approve', 'log-tone-indigo'],
      ['tourn_create', 'log-tone-indigo'],
      ['tourn_edit', 'log-tone-violet'],
      ['tourn_end', 'log-tone-amber'],
      ['tourn_reopen', 'log-tone-cyan'],
      ['tourn_delete', 'log-tone-red'],
      ['tourn_approve', 'log-tone-green'],
      ['ann_create', 'log-tone-sky'],
      ['ann_edit', 'log-tone-blue'],
      ['ann_toggle', 'log-tone-amber'],
      ['ann_delete', 'log-tone-red'],
      ['ach_create', 'log-tone-pink'],
      ['ach_edit', 'log-tone-purple'],
      ['ach_toggle', 'log-tone-amber'],
      ['ach_delete', 'log-tone-red'],
      ['shop_create', 'log-tone-amber'],
      ['shop_edit', 'log-tone-orange'],
      ['shop_delist', 'log-tone-gray'],
      ['shop_relist', 'log-tone-cyan'],
      ['shop_delete', 'log-tone-red'],
      ['game_config', 'log-tone-cyan'],
      // 前綴備援
      ['event_unknown', 'log-tone-green'],
      ['team_unknown', 'log-tone-orange'],
      ['tourn_unknown', 'log-tone-indigo'],
      ['audit_unknown', 'log-tone-rose'],
      ['ann_unknown', 'log-tone-sky'],
      ['ach_unknown', 'log-tone-pink'],
      ['shop_unknown', 'log-tone-amber'],
      ['game_unknown', 'log-tone-cyan'],
      // 其餘一律灰色
      ['something_else', 'log-tone-gray'],
    ];

    it('每個 type 的列底色 class 與類型膠囊 class 都對應 A 的色調', async () => {
      const PAGE = 20;
      for (let start = 0; start < TONES.length; start += PAGE) {
        const chunk = TONES.slice(start, start + PAGE);
        mockFetchOperationLogs.mockResolvedValue(
          chunk.map(([type], idx) =>
            makeLog(start + idx + 1, { type, typeName: type, content: '色調測試' }),
          ),
        );

        const view = render(<AdminLogsPage />);
        await waitFor(() => {
          expect(rowCount()).toBe(chunk.length);
        });

        const rows = Array.from(logList().querySelectorAll('.log-item'));
        for (const [type, tone] of chunk) {
          const row = rows.find((r) => r.querySelector('.log-type')?.textContent === type);
          expect(row, `找不到 ${type} 的列`).toBeTruthy();
          expect(row?.className, type).toBe(`log-item operation-log-item oplog-row-${tone}`);
          expect(row?.querySelector('.log-type')?.className, type).toBe(`log-type ${tone}`);
        }
        view.unmount();
      }
    });
  });

  describe('搜尋、類型篩選與分頁', () => {
    it('依操作者、UID、內容、文件 ID 搜尋，並可與類型篩選疊加；清空後恢復', async () => {
      mockFetchOperationLogs.mockResolvedValue([
        makeLog(1, { operator: '阿明', content: '建立週六籃球團', type: 'event_create', typeName: '建立活動' }),
        makeLog(2, { operator: '小華', content: '調整分數', type: 'exp', typeName: '手動EXP', actorUid: 'u_xiaohua' }),
        makeLog(3, { operator: '阿明', content: '刪除賽事', type: 'tourn_delete', typeName: '刪除賽事' }),
      ]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(rowCount()).toBe(3);
      });

      await typeKeyword('阿明');
      expect(rowCount()).toBe(2);

      await chooseType('tourn_delete');
      expect(rowCount()).toBe(1);
      expect(screen.getByText('阿明：刪除賽事')).toBeTruthy();

      await chooseType('');
      await typeKeyword('U_XIAOHUA');
      expect(rowCount()).toBe(1);
      expect(screen.getByText('小華：調整分數')).toBeTruthy();

      await typeKeyword(makeLog(1)._docId as string);
      expect(rowCount()).toBe(1);
      expect(screen.getByText('阿明：建立週六籃球團')).toBeTruthy();

      await typeKeyword('');
      expect(rowCount()).toBe(3);
    });

    it('沒有符合時顯示「沒有符合條件的紀錄」且不出現分頁', async () => {
      mockFetchOperationLogs.mockResolvedValue([makeLog(1), makeLog(2)]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(rowCount()).toBe(2);
      });

      await typeKeyword('不存在的關鍵字');
      expect(screen.getByText('沒有符合條件的紀錄')).toBeTruthy();
      expect(rowCount()).toBe(0);
      expect(screen.queryByText('下一頁 ›')).toBeNull();
    });

    it('每頁 20 筆、最新在前，上一頁／下一頁邊界停用；改搜尋條件回到第 1 頁', async () => {
      mockFetchOperationLogs.mockResolvedValue(
        Array.from({ length: 25 }, (_, idx) => makeLog(idx + 1)),
      );

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(rowCount()).toBe(20);
      });

      const actionTexts = (): string[] =>
        Array.from(logList().querySelectorAll('.operation-log-action-text')).map(
          (el) => el.textContent ?? '',
        );
      expect(actionTexts()[0]).toBe('操作者25：內容25');
      expect(actionTexts()[19]).toBe('操作者6：內容6');
      expect(screen.getByText('1 / 2（共 25 筆）')).toBeTruthy();

      const prev = screen.getByText('‹ 上一頁') as HTMLButtonElement;
      const next = screen.getByText('下一頁 ›') as HTMLButtonElement;
      expect(prev.disabled).toBe(true);
      expect(next.disabled).toBe(false);

      fireEvent.click(next);
      await waitFor(() => {
        expect(rowCount()).toBe(5);
      });
      expect(actionTexts()[0]).toBe('操作者5：內容5');
      expect(screen.getByText('2 / 2（共 25 筆）')).toBeTruthy();
      expect((screen.getByText('下一頁 ›') as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByText('‹ 上一頁') as HTMLButtonElement).disabled).toBe(false);

      await typeKeyword('操作者');
      expect(rowCount()).toBe(20);
      expect(screen.getByText('1 / 2（共 25 筆）')).toBeTruthy();

      fireEvent.click(screen.getByText('下一頁 ›'));
      await waitFor(() => {
        expect(rowCount()).toBe(5);
      });
      await chooseType('event_edit');
      expect(rowCount()).toBe(20);
      expect(screen.getByText('1 / 2（共 25 筆）')).toBeTruthy();

      fireEvent.click(screen.getByText('下一頁 ›'));
      await waitFor(() => {
        expect(rowCount()).toBe(5);
      });
      fireEvent.click(screen.getByText('‹ 上一頁'));
      await waitFor(() => {
        expect(rowCount()).toBe(20);
      });
      expect(actionTexts()[0]).toBe('操作者25：內容25');
      expect(screen.getByText('1 / 2（共 25 筆）')).toBeTruthy();
    });

    it('20 筆以內不出現分頁列', async () => {
      mockFetchOperationLogs.mockResolvedValue(
        Array.from({ length: 20 }, (_, idx) => makeLog(idx + 1)),
      );

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(rowCount()).toBe(20);
      });
      expect(screen.queryByText('下一頁 ›')).toBeNull();
    });
  });

  describe('載入中、空狀態與錯誤重試', () => {
    it('讀取中顯示「載入中...」', async () => {
      const pending = deferred<OperationLogDoc[]>();
      mockFetchOperationLogs.mockReturnValue(pending.promise);

      render(<AdminLogsPage />);
      expect(screen.getByRole('status').textContent).toBe('載入中...');

      await act(async () => {
        pending.resolve([]);
      });
      expect(screen.getByText('沒有符合條件的紀錄')).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('沒有任何紀錄時顯示「沒有符合條件的紀錄」', async () => {
      mockFetchOperationLogs.mockResolvedValue([]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(screen.getByText('沒有符合條件的紀錄')).toBeTruthy();
      });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('讀取失敗顯示錯誤與重試（不假裝成空清單），按重試後重新讀取並顯示資料', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockFetchOperationLogs
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce([makeLog(1)]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeTruthy();
      });
      expect(screen.getByText('無法載入操作日誌，請重試。')).toBeTruthy();
      expect(screen.queryByText('沒有符合條件的紀錄')).toBeNull();
      expect(mockFetchOperationLogs).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: '重試' }));
      await waitFor(() => {
        expect(screen.getByText('操作者1：內容1')).toBeTruthy();
      });
      expect(mockFetchOperationLogs).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).toBeNull();
      errorSpy.mockRestore();
    });

    it('重試再失敗仍停在錯誤畫面，可再次重試', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const second = deferred<OperationLogDoc[]>();
      mockFetchOperationLogs
        .mockRejectedValueOnce(new Error('first'))
        .mockReturnValueOnce(second.promise)
        .mockResolvedValueOnce([makeLog(1)]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeTruthy();
      });
      fireEvent.click(screen.getByRole('button', { name: '重試' }));
      await waitFor(() => {
        expect(screen.getByRole('status').textContent).toBe('載入中...');
      });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(mockFetchOperationLogs).toHaveBeenCalledTimes(2);

      await act(async () => {
        second.reject(new Error('second'));
      });
      expect(screen.getByRole('alert')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '重試' }));
      await waitFor(() => {
        expect(screen.getByText('操作者1：內容1')).toBeTruthy();
      });
      errorSpy.mockRestore();
    });

    it('競態：權限中斷後重新進入時，較早發出但晚到的結果不會蓋掉新結果', async () => {
      const first = deferred<OperationLogDoc[]>();
      const second = deferred<OperationLogDoc[]>();
      mockFetchOperationLogs
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      const view = render(<AdminLogsPage />);
      await waitFor(() => {
        expect(mockFetchOperationLogs).toHaveBeenCalledTimes(1);
      });

      mockUseViewer.mockReturnValue(makeViewer({ hasPermission: () => false }));
      view.rerender(<AdminLogsPage />);
      expect(screen.getByText('權限不足')).toBeTruthy();

      mockUseViewer.mockReturnValue(makeViewer());
      view.rerender(<AdminLogsPage />);
      await waitFor(() => {
        expect(mockFetchOperationLogs).toHaveBeenCalledTimes(2);
      });

      await act(async () => {
        second.resolve([makeLog(2, { content: '新結果' })]);
      });
      await act(async () => {
        first.resolve([makeLog(1, { content: '舊結果' })]);
      });

      expect(screen.getByText('操作者2：新結果')).toBeTruthy();
      expect(screen.queryByText('操作者1：舊結果')).toBeNull();
    });
  });

  describe('唯讀契約', () => {
    it('頁面原始碼沒有任何寫入、刪除、Callable 或角色查詢（不寫日誌、不放一鍵清除）', () => {
      // 相對路徑放變數：理由同檔頭 zhTwRelativePath。
      const pageRelativePath = './AdminLogsPage.tsx';
      const source = readFileSync(new URL(pageRelativePath, import.meta.url), 'utf8');
      for (const forbidden of [
        'writeOpLog',
        'writeAuditLog',
        'setDoc',
        'addDoc',
        'updateDoc',
        'deleteDoc',
        'writeBatch',
        'runTransaction',
        'httpsCallable',
        'useUserRoles',
        'UserTag',
      ]) {
        expect(source, forbidden).not.toContain(forbidden);
      }
    });
  });

  describe('複製診斷包（A 的 details 內按鈕）', () => {
    it('複製成功送出與 A 同格式的診斷文字並 Toast', async () => {
      mockFetchOperationLogs.mockResolvedValue([
        makeLog(3, { operator: '阿明', type: 'role', typeName: '角色變更', content: '升為教練' }),
      ]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(screen.getByText('複製診斷包')).toBeTruthy();
      });

      fireEvent.click(screen.getByText('複製診斷包'));
      await waitFor(() => {
        expect(mockCopyDiagnostic).toHaveBeenCalledTimes(1);
      });
      const text = mockCopyDiagnostic.mock.calls[0]?.[0] ?? '';
      expect(text).toContain('ToosterX 操作日誌診斷包');
      expect(text).toContain('類型：角色變更 (role)');
      expect(text).toContain('操作者：阿明 / u_actor_3');
      expect(text).toContain('內容：升為教練');
      expect(text).toContain(`文件 ID：${makeLog(3)._docId}`);
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ message: '已複製操作日誌診斷包', tone: 'success' });
      });
    });

    it('複製失敗時以 Toast 提示', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockCopyDiagnostic.mockRejectedValue(new Error('denied'));
      mockFetchOperationLogs.mockResolvedValue([makeLog(1)]);

      render(<AdminLogsPage />);
      await waitFor(() => {
        expect(screen.getByText('複製診斷包')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('複製診斷包'));
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ message: '複製操作日誌診斷包失敗', tone: 'error' });
      });
      errorSpy.mockRestore();
    });
  });
});
