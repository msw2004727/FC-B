import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogPanel } from './AuditLogPanel';

const dictHolder = vi.hoisted(() => ({ dict: {} as Record<string, string> }));

const mocks = vi.hoisted(() => ({
  readDay: vi.fn(),
  resolveNames: vi.fn(),
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

vi.mock('../data/audit-log-model', () => {
  const dayKeys20 = ['20261119', ...Array.from({ length: 19 }, (_, i) => `day-${i + 1}`)];
  return {
    AUDIT_ACTIONS: [
      ['act1', '登入'],
      ['act2', '刪除'],
    ],
    auditActionLabel: (k: string) => (k === 'act1' ? '登入' : '刪除'),
    auditTargetLabel: (e: { targetName?: string }) => e.targetName ?? '',
    auditMetaKeyLabel: (k: string) => ({ reason: '原因', flag: '標記' }[k] ?? k),
    auditMetaPairs: (m: Record<string, unknown> | undefined) =>
      m ? Object.entries(m).map(([k, v]) => [k, String(v)] as [string, string]) : [],
    auditResultLabel: (r: string) => (r === 'success' ? '成功' : '失敗'),
    auditSourceLabel: (s: string) => (s === 'admin' ? '後台' : '系統'),
    auditSearchText: (e: Record<string, unknown>, name: string) =>
      [name, e.action, e.actorUid, e.targetName, e._docId].join(' ').toLowerCase(),
    taipeiDayKey: () => '20261119',
    dayKeysDesc: (startMs: number) => (startMs === 1000 ? ['20261119'] : dayKeys20),
    toAuditEntry: (id: string, data: Record<string, unknown>) => ({ ...data, _docId: id }),
  };
});

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
  buildAuditDiagnostic: (e: { _docId?: string }) => `diag-${e._docId}`,
}));

vi.mock('../data/operation-logs', () => ({
  copyDiagnosticTextToClipboard: mocks.copyDiagnostic,
}));

vi.mock('../data/pm-audit', () => ({
  pmFormatTime: (ms: number) => `時間-${ms}`,
}));

vi.mock('../data/pm-audit-view', () => ({
  shortUid: (uid: string) => uid.slice(0, 4),
}));

vi.mock('../data/pm-audit-names', () => ({
  resolvePmUserNames: vi.fn(),
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
  JSON.parse(readFileSync(new URL('../locales/zh-TW.json', import.meta.url), 'utf8')) as Record<string, unknown>,
  'logs.',
);
dictHolder.dict = zhTwDict;

const NOW = Date.parse('2026-11-19T04:00:00Z');

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'act1',
    actorUid: 'U11111111111111111111111111111111',
    actorName: '小明',
    createdAtMs: 1000,
    result: 'success',
    source: 'admin',
    targetName: '對象A',
    meta: { reason: '測試原因', flag: 'true' },
    ...over,
  };
}

function doc(id: string, data: Record<string, unknown>) {
  return { id, data, snap: { id } };
}

function changeSelect(el: HTMLSelectElement, value: string): void {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readDay.mockReset();
  mocks.resolveNames.mockReset();
  mocks.copyDiagnostic.mockReset();
  mocks.resolveNames.mockResolvedValue({});
  mocks.copyDiagnostic.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('AuditLogPanel：稽核日誌面板', () => {
  it('初次載入只查最新日並湊滿 10 筆；每列顯示行為中文、暱稱、UID 短碼、時間', async () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      doc(`doc-${i}`, entry({ actorName: `用戶${i}`, createdAtMs: 1000 + i })),
    );
    mocks.readDay.mockImplementation(async () => ({ docs, hasMore: false }));

    render(<AuditLogPanel readDay={mocks.readDay as never} resolveNames={mocks.resolveNames as never} nowMs={NOW} />);

    await waitFor(() => expect(document.querySelectorAll('.olc-row').length).toBe(10));
    expect(mocks.readDay).toHaveBeenCalledTimes(1);
    expect(mocks.readDay.mock.calls[0]?.[0]).toBe('20261119');

    expect(screen.getAllByText('登入').length).toBeGreaterThan(0);
    expect(screen.getByText('用戶0')).toBeTruthy();
    expect(screen.getByText('U111')).toBeTruthy();
    expect(screen.getByText('時間-1000')).toBeTruthy();
  });

  it('actorName 缺值才呼叫 resolveNames 且只帶缺名 UID；查不到顯示未知用戶', async () => {
    const docs = [
      doc('doc-1', entry({ actorName: '小明', actorUid: 'U11111111111111111111111111111111' })),
      doc('doc-2', entry({ actorName: '', actorUid: 'U22222222222222222222222222222222' })),
    ];
    mocks.readDay.mockImplementation(async () => ({ docs, hasMore: false }));
    mocks.resolveNames.mockResolvedValue({});

    render(<AuditLogPanel readDay={mocks.readDay as never} resolveNames={mocks.resolveNames as never} nowMs={NOW} />);

    await waitFor(() => expect(mocks.resolveNames).toHaveBeenCalledTimes(1));
    expect(mocks.resolveNames).toHaveBeenCalledWith(['U22222222222222222222222222222222']);
    expect(screen.getByText('小明')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('未知用戶')).toBeTruthy());
  });

  it('行為下拉與關鍵字在已讀資料中篩選；清除恢復', async () => {
    const docs = [
      ...Array.from({ length: 5 }, (_, i) =>
        doc(`doc-a-${i}`, entry({ action: 'act1', actorName: '小明', createdAtMs: 1000 + i })),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        doc(`doc-b-${i}`, entry({ action: 'act2', actorName: '小華', createdAtMs: 2000 + i })),
      ),
    ];
    mocks.readDay.mockImplementation(async () => ({ docs, hasMore: false }));

    render(<AuditLogPanel readDay={mocks.readDay as never} resolveNames={mocks.resolveNames as never} nowMs={NOW} />);
    await waitFor(() => expect(document.querySelectorAll('.olc-row').length).toBe(10));

    const actionSelect = screen.getByLabelText('全部行為') as HTMLSelectElement;
    changeSelect(actionSelect, 'act1');
    await waitFor(() => expect(document.querySelectorAll('.olc-row').length).toBe(5));
    expect(screen.queryByText('小華')).toBeNull();

    fireEvent.click(screen.getByText('清除'));
    await waitFor(() => expect(document.querySelectorAll('.olc-row').length).toBe(10));

    const keywordInput = screen.getByLabelText('搜尋操作者、UID、對象、內容') as HTMLInputElement;
    fireEvent.input(keywordInput, { target: { value: '小華' } });
    await waitFor(() => expect(document.querySelectorAll('.olc-row').length).toBe(5));
    expect(screen.queryByText('小明')).toBeNull();

    fireEvent.click(screen.getByText('清除'));
    await waitFor(() => expect(document.querySelectorAll('.olc-row').length).toBe(10));
  });

  it('點列展開顯示中文鍵名、文件 ID；複製診斷包呼叫剪貼簿函式', async () => {
    const docs = [doc('doc-1', entry({ meta: { reason: '測試原因', flag: 'true' } }))];
    mocks.readDay.mockImplementation(async () => ({ docs, hasMore: false }));

    render(<AuditLogPanel readDay={mocks.readDay as never} resolveNames={mocks.resolveNames as never} nowMs={NOW} />);
    await waitFor(() => expect(document.querySelectorAll('.olc-row').length).toBe(1));

    fireEvent.click(document.querySelector('.olc-row') as HTMLElement);
    expect(screen.getByText('原因')).toBeTruthy();
    expect(screen.getByText('測試原因')).toBeTruthy();
    expect(screen.getByText('是')).toBeTruthy();
    expect(screen.getByText('doc-1')).toBeTruthy();

    fireEvent.click(screen.getByText('複製診斷包'));
    await waitFor(() => expect(mocks.copyDiagnostic).toHaveBeenCalledWith('diag-doc-1'));
  });

  it('成功／失敗統計只在全部讀完時出現', async () => {
    const docs = [
      doc('doc-ok', entry({ result: 'success', createdAtMs: 1000 })),
      doc('doc-bad', entry({ result: 'failure', createdAtMs: 2000 })),
    ];
    mocks.readDay.mockImplementation(async () => ({ docs, hasMore: false }));

    render(<AuditLogPanel readDay={mocks.readDay as never} resolveNames={mocks.resolveNames as never} nowMs={NOW} />);
    await waitFor(() => expect(document.querySelectorAll('.olc-row').length).toBe(10));
    expect(screen.queryByText('成功 1')).toBeNull();
    expect(screen.queryByText('失敗 1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '日' }));
    await waitFor(() => expect(screen.getByText('成功 1')).toBeTruthy());
    expect(screen.getByText('失敗 1')).toBeTruthy();
  });

  it('查滿 7 天未湊滿時出現「加載更多」，按下才繼續查', async () => {
    mocks.readDay.mockImplementation(async () => ({ docs: [], hasMore: false }));

    render(<AuditLogPanel readDay={mocks.readDay as never} resolveNames={mocks.resolveNames as never} nowMs={NOW} />);
    await waitFor(() => expect(mocks.readDay.mock.calls.length).toBeGreaterThanOrEqual(7));

    const sizeSelect = screen.getByLabelText('每頁筆數') as HTMLSelectElement;
    changeSelect(sizeSelect, 'infinite');
    await waitFor(() => expect(screen.getByText('加載更多')).toBeTruthy());

    const before = mocks.readDay.mock.calls.length;
    fireEvent.click(screen.getByText('加載更多'));
    await waitFor(() => expect(mocks.readDay.mock.calls.length).toBeGreaterThan(before));
  });

  it('換區間時晚到的舊回應不覆蓋新結果', async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    const oldPromise = new Promise((resolve) => {
      resolveOld = resolve;
    });
    let call = 0;
    mocks.readDay.mockImplementation(() => {
      call += 1;
      if (call === 1) return oldPromise;
      return Promise.resolve({
        docs: [doc('doc-new', entry({ actorName: '新資料', action: 'act1' }))],
        hasMore: false,
      });
    });

    render(<AuditLogPanel readDay={mocks.readDay as never} resolveNames={mocks.resolveNames as never} nowMs={NOW} />);
    await waitFor(() => expect(call).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: '日' }));
    await waitFor(() => expect(screen.getByText('新資料')).toBeTruthy());

    await act(async () => {
      resolveOld?.({
        docs: [doc('doc-old', entry({ actorName: '舊資料', action: 'act1' }))],
        hasMore: false,
      });
    });

    expect(screen.queryByText('舊資料')).toBeNull();
    expect(screen.getByText('新資料')).toBeTruthy();
  });
});
