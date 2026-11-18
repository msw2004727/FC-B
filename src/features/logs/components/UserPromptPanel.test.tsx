import { readFileSync } from 'node:fs';

// 相對路徑放變數：Vite 會把 new URL 的字面相對路徑改寫成開發資源網址（同 AdminLogsPage.test.tsx；PM 修正）。
const zhTwRelativePath = '../locales/zh-TW.json';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetErrorRangeCacheForTest } from './useErrorLogRange';
import { ErrorLogPanel } from './ErrorLogPanel';
import { UserPromptPanel } from './UserPromptPanel';

const dictHolder = vi.hoisted(() => ({ dict: {} as Record<string, string> }));

const mocks = vi.hoisted(() => ({
  copyDiagnostic: vi.fn(),
}));

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

vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));

vi.mock('../data/error-log-model', () => ({
  isUserPrompt: (d: { errorCode?: string }) =>
    d.errorCode === 'user-prompt' || d.errorCode === 'client-prompt',
  severityOf: (d: { severity?: string }) => d.severity ?? 'info',
  codeLabel: (d: { _label?: string; errorCode?: string }) => d._label ?? d.errorCode ?? '未知錯誤',
  chineseMessage: (d: { _msg?: string; errorMessage?: string }) => d._msg ?? d.errorMessage ?? '錯誤',
  deviceLabel: (d: { _device?: string }) => d._device ?? '桌機',
  errorWhere: (d: { _where?: string }) => d._where ?? 'func',
  errorMs: (d: { _ms?: number; createdAtMs?: number }) => d._ms ?? d.createdAtMs ?? 0,
  groupErrors: (list: Array<Record<string, unknown>>) => {
    const map = new Map<string, Record<string, unknown> & { _uids: Set<string> }>();
    for (const d of list) {
      const label = (d._label as string | undefined) ?? (d.errorCode as string | undefined) ?? '未知錯誤';
      let g = map.get(label);
      if (!g) {
        g = {
          key: label,
          label,
          severity: (d.severity as string | undefined) ?? 'info',
          logs: [],
          users: 0,
          lastMs: 0,
          message: (d._msg as string | undefined) ?? (d.errorMessage as string | undefined) ?? '',
          page: (d.page as string | undefined) ?? 'unknown',
          where: (d._where as string | undefined) ?? 'func',
          _uids: new Set<string>(),
        };
        map.set(label, g);
      }
      (g.logs as Array<Record<string, unknown>>).push(d);
      if (d.uid) g._uids.add(String(d.uid));
      g.lastMs = Math.max(g.lastMs as number, ((d._ms as number | undefined) ?? (d.createdAtMs as number | undefined) ?? 0));
    }
    return [...map.values()].map(({ _uids, ...g }) => ({ ...g, users: _uids.size }));
  },
  promptCategory: (d: { _category?: string }) => ({ label: d._category ?? '一般' }),
  promptMessage: (d: { _promptMsg?: string; errorMessage?: string }) => d._promptMsg ?? d.errorMessage ?? '',
  promptSurface: (d: { _surface?: string }) => ({ label: d._surface ?? '其他' }),
}));

vi.mock('../data/log-range', () => ({
  INFINITE_CHUNK: 10,
  PAGE_SIZE_OPTIONS: [10, 20, 30, 'infinite'],
  rangeContaining: (unit: string) => {
    if (unit === 'day') return { unit, startMs: 1000, endMs: 2000 };
    if (unit === 'month') return { unit, startMs: 3000, endMs: 4000 };
    return { unit, startMs: 2000, endMs: 3000 };
  },
  formatRangeLabel: () => '本週',
  isLatestRange: () => true,
  shiftRange: (r: { startMs: number; endMs: number }, n: number) => ({
    ...r,
    startMs: r.startMs + n,
    endMs: r.endMs + n,
  }),
}));

vi.mock('../data/log-diagnostics', () => ({
  buildErrorDiagnostic: (d: { _docId?: string }) => `err-diag-${d._docId}`,
  buildErrorGroupDiagnostic: (g: { key?: string }) => `group-diag-${g.key}`,
}));

vi.mock('../data/operation-logs', () => ({
  copyDiagnosticTextToClipboard: mocks.copyDiagnostic,
}));

vi.mock('../data/page-names', () => ({
  pageLabel: (p: string) => (p === 'activity' ? '活動' : p === 'unknown' ? '未知頁面' : p),
}));

vi.mock('../data/pm-audit-view', () => ({
  shortUid: (uid: string) => uid.slice(0, 4),
  uidTail: (uid: string) => uid.slice(-4),
}));

vi.mock('../data/pm-audit', () => ({
  pmFormatTime: (ms: number) => `時間-${ms}`,
}));

vi.mock('./InfiniteSentinel', () => ({
  InfiniteSentinel: () => null,
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

const zhTwDict = flattenDict(
  JSON.parse(readFileSync(new URL(zhTwRelativePath, import.meta.url), 'utf8')) as Record<string, unknown>,
  'logs.',
);
dictHolder.dict = zhTwDict;

const NOW = Date.parse('2026-11-19T04:00:00Z');

function doc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _docId: 'd0',
    uid: 'U11111111111111111111111111111111',
    userName: '小明',
    errorCode: 'user-prompt',
    _promptMsg: '提示A',
    _surface: '登入頁',
    _category: '帳號',
    page: 'activity',
    _ms: 1000,
    ...over,
  };
}

function changeSelect(el: HTMLSelectElement, value: string): void {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function listText(): string {
  return document.getElementById('user-prompt-log-list')?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetErrorRangeCacheForTest();
  mocks.copyDiagnostic.mockReset();
  mocks.copyDiagnostic.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('UserPromptPanel：用戶提示面板', () => {
  it('只顯示提示，不顯示一般錯誤', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'e1', errorCode: 'E1', _msg: '錯誤訊息' }),
        doc({ _docId: 'p1', _promptMsg: '提示A' }),
        doc({ _docId: 'p2', _promptMsg: '提示B' }),
      ],
      truncated: false,
    });

    render(<UserPromptPanel fetchRange={fetchRange as never} nowMs={NOW} />);

    await waitFor(() => expect(screen.getByText('共 2 筆・2 種提示')).toBeTruthy());
    expect(screen.queryByText('錯誤訊息')).toBeNull();
    expect(screen.getByText('提示A')).toBeTruthy();
  });

  it('依提示文字分組顯示 ×次數與 N 人', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'p1', uid: 'U1111', _promptMsg: '提示A' }),
        doc({ _docId: 'p2', uid: 'U2222', _promptMsg: '提示A' }),
        doc({ _docId: 'p3', uid: 'U3333', _promptMsg: '提示B' }),
      ],
      truncated: false,
    });

    render(<UserPromptPanel fetchRange={fetchRange as never} nowMs={NOW} />);

    await waitFor(() => expect(screen.getByText('×2')).toBeTruthy());
    expect(screen.getByText('2 人')).toBeTruthy();
    expect(screen.getByText('提示A')).toBeTruthy();
  });

  it('來源、分類下拉篩選', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'p1', _promptMsg: '提示A', _surface: '登入頁', _category: '帳號' }),
        doc({ _docId: 'p2', _promptMsg: '提示B', _surface: '聊天頁', _category: '訊息' }),
      ],
      truncated: false,
    });

    render(<UserPromptPanel fetchRange={fetchRange as never} nowMs={NOW} />);
    await waitFor(() => expect(screen.getByText('共 2 筆・2 種提示')).toBeTruthy());

    const surfaceSelect = screen.getByLabelText('全部來源') as HTMLSelectElement;
    changeSelect(surfaceSelect, '登入頁');
    await waitFor(() => expect(listText()).toContain('提示A'));
    expect(listText()).not.toContain('提示B');

    fireEvent.click(screen.getByText('清除'));
    await waitFor(() => expect(listText()).toContain('提示B'));

    const categorySelect = screen.getByLabelText('全部分類') as HTMLSelectElement;
    changeSelect(categorySelect, '訊息');
    await waitFor(() => expect(listText()).toContain('提示B'));
    expect(listText()).not.toContain('提示A');
  });

  it('展開清單每列顯示暱稱、UID 短碼、頁面中文名，不含「提示訊息」；診斷包複製', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'p1', uid: 'U1111', userName: '小明', _promptMsg: '提示A', page: 'activity' }),
        doc({ _docId: 'p2', uid: 'U2222', userName: '小華', _promptMsg: '提示A', page: 'activity' }),
      ],
      truncated: false,
    });

    render(<UserPromptPanel fetchRange={fetchRange as never} nowMs={NOW} />);
    await waitFor(() => expect(screen.getByText('×2')).toBeTruthy());

    fireEvent.click(document.querySelector('.olc-row') as HTMLElement);
    expect(screen.getByText('小明')).toBeTruthy();
    expect(screen.getByText('U111')).toBeTruthy();
    const firstSubrow = document.querySelector('.lc-subrow') as HTMLElement;
    expect(firstSubrow).toBeTruthy();
    expect(within(firstSubrow).getByText('活動')).toBeTruthy();
    expect(screen.queryByText('提示訊息')).toBeNull();

    const copyButtons = screen.getAllByText('診斷包');
    fireEvent.click(copyButtons[0] as HTMLElement);
    await waitFor(() => expect(mocks.copyDiagnostic).toHaveBeenCalledWith('err-diag-p1'));
  });

  it('與 ErrorLogPanel 同時掛載時 fetchRange 只被呼叫一次', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'e1', errorCode: 'E1', _msg: '錯誤訊息' }),
        doc({ _docId: 'p1', _promptMsg: '提示A' }),
      ],
      truncated: false,
    });

    render(
      <>
        <ErrorLogPanel fetchRange={fetchRange as never} nowMs={NOW} />
        <UserPromptPanel fetchRange={fetchRange as never} nowMs={NOW} />
      </>,
    );

    await waitFor(() => expect(screen.getByText('錯誤訊息')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('共 1 筆・1 種提示')).toBeTruthy());
    expect(fetchRange).toHaveBeenCalledTimes(1);
  });
});
