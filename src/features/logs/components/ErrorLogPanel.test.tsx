import { readFileSync } from 'node:fs';

// 相對路徑放變數：Vite 會把 new URL 的字面相對路徑改寫成開發資源網址（同 AdminLogsPage.test.tsx；PM 修正）。
const zhTwRelativePath = '../locales/zh-TW.json';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetErrorRangeCacheForTest } from './useErrorLogRange';
import { ErrorLogPanel } from './ErrorLogPanel';

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
    errorCode: 'E1',
    _label: 'E1',
    _msg: '錯誤一',
    _device: '桌機',
    _where: 'at foo',
    _ms: 1000,
    severity: 'critical',
    page: 'activity',
    appVersion: '1.0.0',
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
  return document.getElementById('error-log-list')?.textContent ?? '';
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

describe('ErrorLogPanel：錯誤日誌面板', () => {
  it('用戶提示（errorCode user-prompt）不出現在錯誤頁', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'e1', errorCode: 'E1', _label: 'E1', _msg: '錯誤訊息' }),
        doc({ _docId: 'p1', errorCode: 'user-prompt', _label: '提示', _msg: '提示訊息' }),
      ],
      truncated: false,
    });

    render(<ErrorLogPanel fetchRange={fetchRange as never} nowMs={NOW} />);

    await waitFor(() => expect(screen.getByText('共 1 筆')).toBeTruthy());
    expect(screen.queryByText('提示訊息')).toBeNull();
    expect(screen.getByText('錯誤訊息')).toBeTruthy();
  });

  it('摘要顯示嚴重 N、警告 N、共 N 筆', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'c1', _label: 'C1', severity: 'critical', _msg: '嚴重一' }),
        doc({ _docId: 'c2', _label: 'C2', severity: 'critical', _msg: '嚴重二' }),
        doc({ _docId: 'w1', _label: 'W1', severity: 'warn', _msg: '警告一' }),
        doc({ _docId: 'i1', _label: 'I1', severity: 'info', _msg: '一般一' }),
        doc({ _docId: 'p1', errorCode: 'user-prompt', _label: '提示', _msg: '提示訊息' }),
      ],
      truncated: false,
    });

    render(<ErrorLogPanel fetchRange={fetchRange as never} nowMs={NOW} />);

    await waitFor(() => expect(document.querySelector('.lc-summary')?.textContent).toContain('嚴重 2'));
    expect(document.querySelector('.lc-summary')?.textContent).toContain('警告 1');
    expect(document.querySelector('.lc-summary')?.textContent).toContain('共 4 筆');
  });

  it('預設分組：同類一列顯示 ×次數與 N 人', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'a1', uid: 'U1111', _label: 'E1', _msg: '錯誤一' }),
        doc({ _docId: 'a2', uid: 'U2222', _label: 'E1', _msg: '錯誤一' }),
        doc({ _docId: 'b1', uid: 'U3333', _label: 'E2', _msg: '錯誤二' }),
      ],
      truncated: false,
    });

    render(<ErrorLogPanel fetchRange={fetchRange as never} nowMs={NOW} />);

    await waitFor(() => expect(screen.getByText('×2')).toBeTruthy());
    expect(screen.getByText('2 人')).toBeTruthy();
    expect(screen.getByText('錯誤一')).toBeTruthy();
  });

  it('點分組展開顯示頁面中文名、組內每筆與複製整組診斷包', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'a1', uid: 'U1111', userName: '小明', _label: 'E1', _msg: '錯誤一', page: 'activity' }),
        doc({ _docId: 'a2', uid: 'U2222', userName: '小華', _label: 'E1', _msg: '錯誤一', page: 'activity' }),
      ],
      truncated: false,
    });

    render(<ErrorLogPanel fetchRange={fetchRange as never} nowMs={NOW} />);
    await waitFor(() => expect(screen.getByText('×2')).toBeTruthy());

    fireEvent.click(document.querySelector('.olc-row') as HTMLElement);
    expect(screen.getByText('頁面')).toBeTruthy();
    expect(screen.getByText('活動')).toBeTruthy();
    expect(screen.getByText('小明')).toBeTruthy();
    expect(screen.getByText('小華')).toBeTruthy();

    fireEvent.click(screen.getByText('複製整組診斷包'));
    await waitFor(() => expect(mocks.copyDiagnostic).toHaveBeenCalledWith('group-diag-E1'));
  });

  it('切「逐筆」顯示每筆且類型文字完整不含省略號', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'a1', _label: 'ERROR_CODE_LONG_NAME', _msg: '錯誤一' }),
        doc({ _docId: 'b1', _label: 'E2', _msg: '錯誤二' }),
      ],
      truncated: false,
    });

    render(<ErrorLogPanel fetchRange={fetchRange as never} nowMs={NOW} />);
    await waitFor(() => expect(document.querySelectorAll('.olc-row').length).toBe(2));

    fireEvent.click(screen.getByText('逐筆'));
    await waitFor(() => expect(document.querySelectorAll('.olc-row').length).toBe(2));

    expect(listText()).toContain('ERROR_CODE_LONG_NAME');
    expect(listText()).not.toContain('…');
  });

  it('逐筆展開：有 diag 才顯示「載入診斷」與原文（顧問 §3.255 D）', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'a1', _label: 'E1', _msg: '錯誤一', diag: '{"sw":"controlled","n":3}' }),
        doc({ _docId: 'b1', _label: 'E2', _msg: '錯誤二' }),
      ],
      truncated: false,
    });

    render(<ErrorLogPanel fetchRange={fetchRange as never} nowMs={NOW} />);
    await waitFor(() => expect(document.querySelectorAll('.olc-row').length).toBe(2));
    fireEvent.click(screen.getByText('逐筆'));
    await waitFor(() => expect(screen.getByText('錯誤一')).toBeTruthy());

    fireEvent.click(screen.getByText('錯誤一'));
    await waitFor(() => expect(screen.getByText('載入診斷')).toBeTruthy());
    expect(screen.getByText('{"sw":"controlled","n":3}')).toBeTruthy();

    fireEvent.click(screen.getByText('錯誤二'));
    await waitFor(() => expect(screen.queryByText('{"sw":"controlled","n":3}')).toBeNull());
    expect(screen.queryByText('載入診斷')).toBeNull();
  });

  it('嚴重度、類型、更多展開頁面／裝置／版本下拉與清除', async () => {
    const fetchRange = vi.fn().mockResolvedValue({
      docs: [
        doc({ _docId: 'a1', errorCode: 'E1', _label: 'E1', severity: 'critical', page: 'activity', _device: '桌機', appVersion: '1.0.0' }),
        doc({ _docId: 'b1', errorCode: 'E2', _label: 'E2', severity: 'warn', page: 'chat', _device: '手機', appVersion: '2.0.0' }),
      ],
      truncated: false,
    });

    render(<ErrorLogPanel fetchRange={fetchRange as never} nowMs={NOW} />);
    await waitFor(() => expect(screen.getByText('共 2 筆')).toBeTruthy());

    const sevSelect = screen.getByLabelText('全部嚴重度') as HTMLSelectElement;
    changeSelect(sevSelect, 'critical');
    await waitFor(() => expect(listText()).not.toContain('E2'));

    fireEvent.click(screen.getByText('清除'));
    await waitFor(() => expect(listText()).toContain('E2'));

    const typeSelect = screen.getByLabelText('全部類型') as HTMLSelectElement;
    changeSelect(typeSelect, 'E2');
    await waitFor(() => expect(listText()).toContain('E2'));
    expect(listText()).not.toContain('E1');

    fireEvent.click(screen.getByText('更多'));
    expect(screen.getByLabelText('全部頁面')).toBeTruthy();
    expect(screen.getByLabelText('全部裝置')).toBeTruthy();
    expect(screen.getByLabelText('全部版本')).toBeTruthy();
    expect((screen.getByLabelText('全部頁面') as HTMLSelectElement).textContent).toContain('活動');

    fireEvent.click(screen.getByText('清除'));
    await waitFor(() => expect(listText()).toContain('E1'));
  });

  it('truncated 時顯示「超過 500 筆，請縮小區間」', async () => {
    const fetchRange = vi.fn().mockResolvedValue({ docs: [doc()], truncated: true });

    render(<ErrorLogPanel fetchRange={fetchRange as never} nowMs={NOW} />);

    await waitFor(() => expect(screen.getByText('超過 500 筆，請縮小區間')).toBeTruthy());
  });

  it('每頁 10 筆分頁', async () => {
    const docs = Array.from({ length: 15 }, (_, i) =>
      doc({ _docId: `d${i}`, errorCode: `E${i}`, _label: `E${i}`, _msg: `錯誤${i}`, _ms: 1000 + i }),
    );
    const fetchRange = vi.fn().mockResolvedValue({ docs, truncated: false });

    render(<ErrorLogPanel fetchRange={fetchRange as never} nowMs={NOW} />);

    await waitFor(() => expect(screen.getByText('第 1 頁')).toBeTruthy());
    expect(document.querySelectorAll('.olc-row').length).toBe(10);
    expect(listText()).toContain('E0');
    expect(listText()).not.toContain('E10');

    fireEvent.click(screen.getByText('下一頁'));
    await waitFor(() => expect(screen.getByText('第 2 頁')).toBeTruthy());
    expect(listText()).toContain('E10');
  });
});
