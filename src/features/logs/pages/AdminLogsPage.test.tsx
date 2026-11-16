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

vi.mock('../data/log-center-model', () => ({
  getAvailableAdminLogTabs: (role: string) =>
    role === 'super_admin'
      ? [
          { key: 'operation', titleKey: 'logs.tabs.operation.title' },
          { key: 'chat', titleKey: 'logs.tabs.chat.title' },
        ]
      : [{ key: 'operation', titleKey: 'logs.tabs.operation.title' }],
}));

vi.mock('@/i18n/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    let tmpl = dictHolder.dict[key] ?? key;
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
    it('admin：頁首只有返回鍵與「操作日誌」，沒有頁籤與一鍵清除，操作面板預設掛載', () => {
      mocks.mockUseViewer.mockReturnValue(makeViewer({ role: 'admin' }));
      render(<AdminLogsPage />);

      const page = document.getElementById('page-admin-logs') as HTMLElement;
      expect(page.parentElement?.classList.contains('legacy-ui')).toBe(true);
      const header = page.querySelector('.page-header') as HTMLElement;
      expect(Array.from(header.children).map((el) => el.tagName)).toEqual(['BUTTON', 'H2']);
      expect(header.querySelector('.back-btn')?.getAttribute('aria-label')).toBe('返回');
      expect(header.querySelector('h2')?.textContent).toBe('操作日誌');

      expect(screen.queryByText('一鍵清除')).toBeNull();
      expect(screen.queryByText('清空資料')).toBeNull();
      expect(page.querySelector('#admin-log-tabs')).toBeNull();
      expect(screen.queryByRole('tab')).toBeNull();
      expect(screen.getByTestId('operation-panel')).toBeTruthy();
      expect(screen.queryByTestId('pm-audit-panel')).toBeNull();
    });

    it('super_admin：標題「日誌中心」與兩頁籤；聊天室稽核點頁籤前不掛載，切換後隱藏但不卸載', () => {
      render(<AdminLogsPage />);

      const page = document.getElementById('page-admin-logs') as HTMLElement;
      expect(page.querySelector('.page-header h2')?.textContent).toBe('日誌中心');
      expect(page.querySelector('#admin-log-tabs')?.className).toBe('tab-bar admin-log-tabs');
      expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(['操作日誌', '聊天室稽核']);
      expect(screen.getByTestId('operation-panel')).toBeTruthy();
      expect(screen.queryByTestId('pm-audit-panel')).toBeNull();

      const operationSection = page.querySelector('[data-admin-log-panel="operation"]') as HTMLElement;
      expect(operationSection.hidden).toBe(false);

      fireEvent.click(screen.getByRole('tab', { name: '聊天室稽核' }));
      const chatSection = page.querySelector('[data-admin-log-panel="chat"]') as HTMLElement;
      expect(chatSection).not.toBeNull();
      expect(chatSection.hidden).toBe(false);
      expect(operationSection.hidden).toBe(true);
      expect(screen.getByTestId('pm-audit-panel')).toBeTruthy();

      fireEvent.click(screen.getByRole('tab', { name: '操作日誌' }));
      expect(chatSection.hidden).toBe(true);
      expect(operationSection.hidden).toBe(false);
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
      // 契約看的是可執行原始碼；註解中的說明（例如「不實作 clearAllData」）不列入。
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const token of forbidden) {
        expect(code.includes(token), `${rel} 不得出現 ${token}`).toBe(false);
      }
    }
  });
});
