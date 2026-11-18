import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import AdminLogsPage from './AdminLogsPage';

const dictHolder = vi.hoisted(() => ({ dict: {} as Record<string, string> }));

const mocks = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockUseViewer: vi.fn(),
  authState: { lastUid: null as string | null | undefined },
}));

vi.mock('@/core/back-guard', () => ({
  useGoBack: (fallbackPath: string) => () => mocks.mockGoBack(fallbackPath),
}));

vi.mock('@/data/auth', () => ({
  getLastKnownAuthUid: () => mocks.authState.lastUid,
}));

vi.mock('@/features/profile/data/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  return {
    ...actual,
    useViewer: () => mocks.mockUseViewer(),
  };
});

vi.mock('../components/OperationLogPanel', () => ({
  OperationLogPanel: () => <div data-testid="operation-panel">操作面板</div>,
}));

vi.mock('../components/PmAuditPanel', () => ({
  PmAuditPanel: () => <div data-testid="pm-audit-panel">聊天室稽核面板</div>,
}));

vi.mock('../components/AuditLogPanel', () => ({
  AuditLogPanel: () => <div data-testid="audit-panel">稽核面板</div>,
}));

vi.mock('../components/ErrorLogPanel', () => ({
  ErrorLogPanel: () => <div data-testid="error-panel">錯誤面板</div>,
}));

vi.mock('../components/UserPromptPanel', () => ({
  UserPromptPanel: () => <div data-testid="prompt-panel">提示面板</div>,
}));

vi.mock('../data/log-center-model', () => {
  const all = [
    { key: 'operation', titleKey: 'logs.tabs.operation.title' },
    { key: 'audit', titleKey: 'logs.tabs.audit.title' },
    { key: 'error', titleKey: 'logs.tabs.error.title' },
    { key: 'prompt', titleKey: 'logs.tabs.prompt.title' },
    { key: 'chat', titleKey: 'logs.tabs.chat.title' },
  ];
  return {
    getAvailableAdminLogTabs: (role: string) => {
      if (role === 'super_admin') return all;
      if (role === 'admin') return all.filter((tab) => tab.key !== 'chat');
      return [{ key: 'operation', titleKey: 'logs.tabs.operation.title' }];
    },
  };
});

vi.mock('@/i18n/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    let tmpl = dictHolder.dict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        tmpl = tmpl.split(`{${k}}`).join(String(v));
      }
    }
    return tmpl;
  },
  formatNumber: (n: number) => String(n),
  getCurrentLocale: () => 'zh-TW',
}));

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

const zhTwRelativePath = '../locales/zh-TW.json';
const zhTwDict = flattenDict(
  JSON.parse(readFileSync(new URL(zhTwRelativePath, import.meta.url), 'utf8')) as Record<string, unknown>,
  'logs.',
);
dictHolder.dict = zhTwDict;

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authState.lastUid = null;
  mocks.mockUseViewer.mockReturnValue(makeViewer());
});

afterEach(() => {
  cleanup();
});

describe('AdminLogsPage：日誌中心外框', () => {
  describe('權限矩陣（入口只認 admin.logs.entry）', () => {
    const cases: ReadonlyArray<{ who: string; role: ViewerView['role']; allowed: boolean }> = [
      { who: 'user（無權限碼）', role: 'user', allowed: false },
      { who: 'coach（無權限碼）', role: 'coach', allowed: false },
      { who: 'captain（無權限碼）', role: 'captain', allowed: false },
      { who: 'admin（無權限碼）', role: 'admin', allowed: false },
      { who: 'admin（有權限碼）', role: 'admin', allowed: true },
      { who: 'super_admin（有權限碼）', role: 'super_admin', allowed: true },
      { who: 'super_admin（被撤權限碼）', role: 'super_admin', allowed: false },
    ];

    for (const c of cases) {
      it(`${c.who}：${c.allowed ? '可看到日誌面板' : '顯示權限不足且不掛載面板'}`, () => {
        mocks.mockUseViewer.mockReturnValue(
          makeViewer({
            role: c.role,
            hasPermission: (code: string) => c.allowed && code === 'admin.logs.entry',
          }),
        );

        render(<AdminLogsPage />);

        if (c.allowed) {
          expect(screen.getByTestId('operation-panel')).toBeTruthy();
          expect(screen.queryByText('權限不足')).toBeNull();
        } else {
          expect(screen.getByText('權限不足')).toBeTruthy();
          expect(screen.queryByTestId('operation-panel')).toBeNull();
          const deniedPage = document.getElementById('page-admin-logs');
          expect(deniedPage?.parentElement?.classList.contains('legacy-ui')).toBe(true);
          expect(deniedPage?.classList.contains('active')).toBe(true);
        }
      });
    }

    it('viewer 未到位顯示轉圈；到位無權限才顯示權限不足；到位有權限顯示內容', () => {
      mocks.authState.lastUid = 'u_admin';
      mocks.mockUseViewer.mockReturnValue(createMinimalViewer('u_admin'));
      const view = render(<AdminLogsPage />);
      expect(document.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();
      expect(screen.queryByText('權限不足')).toBeNull();
      expect(screen.queryByTestId('operation-panel')).toBeNull();

      mocks.mockUseViewer.mockReturnValue(makeViewer({ hasPermission: () => false }));
      view.rerender(<AdminLogsPage />);
      expect(document.querySelector('.ui-page-spinner')).toBeNull();
      expect(screen.getByText('權限不足')).toBeTruthy();
      expect(screen.queryByTestId('operation-panel')).toBeNull();

      mocks.mockUseViewer.mockReturnValue(makeViewer());
      view.rerender(<AdminLogsPage />);
      expect(screen.getByTestId('operation-panel')).toBeTruthy();
      expect(screen.queryByText('權限不足')).toBeNull();
    });
  });

  describe('頁首與頁籤', () => {
    it('super_admin：標題「日誌中心」與五頁籤，順序為操作日誌、稽核日誌、錯誤日誌、用戶提示、聊天室稽核', () => {
      render(<AdminLogsPage />);

      const page = document.getElementById('page-admin-logs') as HTMLElement;
      expect(page.querySelector('.page-header h2')?.textContent).toBe('日誌中心');
      expect(page.querySelector('#admin-log-tabs')?.className).toBe('tab-bar admin-log-tabs');
      expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual([
        '操作日誌',
        '稽核日誌',
        '錯誤日誌',
        '用戶提示',
        '聊天室稽核',
      ]);
      expect(screen.getByTestId('operation-panel')).toBeTruthy();
      expect(screen.queryByTestId('audit-panel')).toBeNull();
      expect(screen.queryByTestId('error-panel')).toBeNull();
      expect(screen.queryByTestId('prompt-panel')).toBeNull();
      expect(screen.queryByTestId('pm-audit-panel')).toBeNull();
    });

    it('admin 只有 admin.logs.entry：只有操作日誌，無頁籤列', () => {
      mocks.mockUseViewer.mockReturnValue(
        makeViewer({
          role: 'admin',
          hasPermission: (code: string) => code === 'admin.logs.entry',
        }),
      );

      render(<AdminLogsPage />);

      const page = document.getElementById('page-admin-logs') as HTMLElement;
      expect(page.querySelector('.page-header h2')?.textContent).toBe('操作日誌');
      expect(page.querySelector('#admin-log-tabs')).toBeNull();
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      expect(screen.getByTestId('operation-panel')).toBeTruthy();
      expect(screen.queryByTestId('audit-panel')).toBeNull();
      expect(screen.queryByTestId('error-panel')).toBeNull();
      expect(screen.queryByTestId('prompt-panel')).toBeNull();
      expect(screen.queryByTestId('pm-audit-panel')).toBeNull();
    });

    it('admin＋admin.logs.audit_read：操作日誌＋稽核日誌；稽核第一次點才掛載', () => {
      mocks.mockUseViewer.mockReturnValue(
        makeViewer({
          role: 'admin',
          hasPermission: (code: string) =>
            code === 'admin.logs.entry' || code === 'admin.logs.audit_read',
        }),
      );

      render(<AdminLogsPage />);

      expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(['操作日誌', '稽核日誌']);
      expect(screen.getByTestId('operation-panel')).toBeTruthy();
      expect(screen.queryByTestId('audit-panel')).toBeNull();

      fireEvent.click(screen.getByRole('tab', { name: '稽核日誌' }));
      expect(screen.getByTestId('audit-panel')).toBeTruthy();
    });

    it('admin＋admin.logs.error_read：操作日誌＋錯誤日誌＋用戶提示', () => {
      mocks.mockUseViewer.mockReturnValue(
        makeViewer({
          role: 'admin',
          hasPermission: (code: string) =>
            code === 'admin.logs.entry' || code === 'admin.logs.error_read',
        }),
      );

      render(<AdminLogsPage />);

      expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual([
        '操作日誌',
        '錯誤日誌',
        '用戶提示',
      ]);
      expect(screen.getByTestId('operation-panel')).toBeTruthy();
      expect(screen.queryByTestId('error-panel')).toBeNull();
      expect(screen.queryByTestId('prompt-panel')).toBeNull();

      fireEvent.click(screen.getByRole('tab', { name: '錯誤日誌' }));
      expect(screen.getByTestId('error-panel')).toBeTruthy();

      fireEvent.click(screen.getByRole('tab', { name: '用戶提示' }));
      expect(screen.getByTestId('prompt-panel')).toBeTruthy();
    });

    it('viewer 權限未到位（waiting）時不顯示任何頁籤、不掛任何面板 stub', () => {
      mocks.authState.lastUid = 'u_admin';
      mocks.mockUseViewer.mockReturnValue(createMinimalViewer('u_admin'));

      render(<AdminLogsPage />);

      expect(document.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      expect(screen.queryByTestId('operation-panel')).toBeNull();
      expect(screen.queryByTestId('audit-panel')).toBeNull();
      expect(screen.queryByTestId('error-panel')).toBeNull();
      expect(screen.queryByTestId('prompt-panel')).toBeNull();
      expect(screen.queryByTestId('pm-audit-panel')).toBeNull();
    });

    it('新頁籤第一次點才掛載、切走 hidden 不卸載', () => {
      render(<AdminLogsPage />);

      const page = document.getElementById('page-admin-logs') as HTMLElement;
      const operationSection = page.querySelector('[data-admin-log-panel="operation"]') as HTMLElement;
      expect(operationSection.hidden).toBe(false);
      expect(page.querySelector('[data-admin-log-panel="audit"]')).toBeNull();

      fireEvent.click(screen.getByRole('tab', { name: '稽核日誌' }));
      const auditSection = page.querySelector('[data-admin-log-panel="audit"]') as HTMLElement;
      expect(auditSection).not.toBeNull();
      expect(auditSection.hidden).toBe(false);
      expect(operationSection.hidden).toBe(true);
      expect(screen.getByTestId('audit-panel')).toBeTruthy();

      fireEvent.click(screen.getByRole('tab', { name: '錯誤日誌' }));
      const errorSection = page.querySelector('[data-admin-log-panel="error"]') as HTMLElement;
      expect(errorSection).not.toBeNull();
      expect(errorSection.hidden).toBe(false);
      expect(auditSection.hidden).toBe(true);
      expect(screen.getByTestId('error-panel')).toBeTruthy();

      fireEvent.click(screen.getByRole('tab', { name: '用戶提示' }));
      const promptSection = page.querySelector('[data-admin-log-panel="prompt"]') as HTMLElement;
      expect(promptSection).not.toBeNull();
      expect(promptSection.hidden).toBe(false);
      expect(auditSection.hidden).toBe(true);
      expect(errorSection.hidden).toBe(true);
      expect(screen.getByTestId('prompt-panel')).toBeTruthy();

      fireEvent.click(screen.getByRole('tab', { name: '聊天室稽核' }));
      const chatSection = page.querySelector('[data-admin-log-panel="chat"]') as HTMLElement;
      expect(chatSection).not.toBeNull();
      expect(chatSection.hidden).toBe(false);
      expect(screen.getByTestId('pm-audit-panel')).toBeTruthy();

      fireEvent.click(screen.getByRole('tab', { name: '操作日誌' }));
      expect(operationSection.hidden).toBe(false);
      expect(auditSection.hidden).toBe(true);
      expect(errorSection.hidden).toBe(true);
      expect(promptSection.hidden).toBe(true);
      expect(chatSection.hidden).toBe(true);
      expect(screen.getByTestId('audit-panel')).toBeTruthy();
      expect(screen.getByTestId('error-panel')).toBeTruthy();
      expect(screen.getByTestId('prompt-panel')).toBeTruthy();
      expect(screen.getByTestId('pm-audit-panel')).toBeTruthy();
    });
  });

  it('返回鍵：有後台儀表板權限回 /admin/ops，否則回 /', () => {
    mocks.mockUseViewer.mockReturnValue(
      makeViewer({
        hasPermission: (code: string) =>
          code === 'admin.logs.entry' || code === 'admin.dashboard.entry',
      }),
    );
    const view = render(<AdminLogsPage />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(mocks.mockGoBack).toHaveBeenCalledWith('/admin/ops');

    mocks.mockGoBack.mockClear();
    mocks.mockUseViewer.mockReturnValue(
      makeViewer({
        hasPermission: (code: string) => code === 'admin.logs.entry',
      }),
    );
    view.rerender(<AdminLogsPage />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(mocks.mockGoBack).toHaveBeenCalledWith('/');
  });

  it('日誌中心相關原始碼不得包含寫入或角色查詢 API', () => {
    const contractFiles = [
      './AdminLogsPage.tsx',
      '../components/OperationLogPanel.tsx',
      '../components/PmAuditPanel.tsx',
      '../components/usePmAuditPages.ts',
    ];
    const forbidden = [
      'addDoc',
      'setDoc',
      'updateDoc',
      'deleteDoc',
      'writeBatch',
      'runTransaction',
      'clearAllData',
      'useUserRoles',
    ];

    for (const rel of contractFiles) {
      const source = readFileSync(new URL(rel, import.meta.url), 'utf8');
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const token of forbidden) {
        expect(code.includes(token), `${rel} 不得出現 ${token}`).toBe(false);
      }
    }
  });
});
