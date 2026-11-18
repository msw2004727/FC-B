import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperationLogDoc, OperationLogsRangeResult } from '../data/operation-logs';
import { shortUid } from '../data/pm-audit-view';
import { OperationLogPanel } from './OperationLogPanel';

const NOW_MS = Date.parse('2026-11-19T04:00:00Z');
const WEEK_START = Date.parse('2026-11-15T16:00:00Z');
const WEEK_END = Date.parse('2026-11-22T16:00:00Z');
const DAY_START = Date.parse('2026-11-18T16:00:00Z');
const DAY_END = Date.parse('2026-11-19T16:00:00Z');
const MONTH_START = Date.parse('2026-10-31T16:00:00Z');
const MONTH_END = Date.parse('2026-11-30T16:00:00Z');
const PREV_WEEK_START = Date.parse('2026-11-08T16:00:00Z');
const PREV_WEEK_END = Date.parse('2026-11-15T16:00:00Z');

const LONG_UID = 'U1111aaaa2222bbbb3333cccc4444dddd';
const ACTOR_A = 'UAAAAaaaa2222bbbb3333cccc4444dddd';
const ACTOR_B = 'UBBBBbbbb2222cccc3333dddd4444eeee';

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

const toastState = vi.hoisted(() => ({
  show: vi.fn<(arg: { message: string; tone?: string }) => void>(),
}));
vi.mock('@/ui/Toast', () => ({
  toast: {
    show: (arg: { message: string; tone?: string }) => toastState.show(arg),
  },
}));

const copyState = vi.hoisted(() => ({
  fn: vi.fn<(text: string) => Promise<void>>(),
}));
vi.mock('../data/operation-logs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/operation-logs')>();
  return {
    ...actual,
    copyDiagnosticTextToClipboard: (text: string) => copyState.fn(text),
  };
});

const BASE_MS = Date.parse('2026-11-19T02:00:00Z');

function makeLog(i: number, over: Partial<OperationLogDoc> = {}): OperationLogDoc {
  const ms = BASE_MS + i * 60_000;
  return {
    _docId: `op_${i}`,
    actorUid: `u_actor_${i}`,
    operator: `操作者${i}`,
    type: 'event_edit',
    typeName: '編輯活動',
    content: `內容${i}`,
    createdAt: { toDate: () => new Date(ms), seconds: ms / 1000 },
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

function rowCount(container: Element): number {
  return container.querySelectorAll('.olc-row').length;
}

async function typeKeyword(value: string): Promise<void> {
  const input = document.getElementById('oplog-search') as HTMLInputElement;
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function chooseType(value: string): Promise<void> {
  const select = document.getElementById('oplog-type-filter') as HTMLSelectElement;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function choosePageSize(value: string): Promise<void> {
  const select = screen.getByLabelText('每頁筆數') as HTMLSelectElement;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  private readonly cb: IntersectionObserverCallback;
  disconnected = false;

  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  trigger(isIntersecting: boolean): void {
    this.cb(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

describe('OperationLogPanel（操作日誌面板）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    copyState.fn.mockReset();
    copyState.fn.mockResolvedValue(undefined);
    toastState.show.mockReset();
    FakeIntersectionObserver.instances = [];
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('初次載入本週，切日、切月、上一週都呼叫正確區間，本週下一段停用', async () => {
    const fetchRange = vi.fn(async (_start: number, _end: number): Promise<OperationLogsRangeResult> => ({
      docs: [],
      truncated: false,
    }));

    render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(fetchRange).toHaveBeenCalledWith(WEEK_START, WEEK_END));

    fireEvent.click(screen.getByRole('button', { name: '日' }));
    await waitFor(() => expect(fetchRange).toHaveBeenCalledWith(DAY_START, DAY_END));

    fireEvent.click(screen.getByRole('button', { name: '月' }));
    await waitFor(() => expect(fetchRange).toHaveBeenCalledWith(MONTH_START, MONTH_END));

    cleanup();
    const second = vi.fn(async (_start: number, _end: number): Promise<OperationLogsRangeResult> => ({
      docs: [],
      truncated: false,
    }));
    render(<OperationLogPanel fetchRange={second} nowMs={NOW_MS} />);
    await waitFor(() => expect(second).toHaveBeenCalledWith(WEEK_START, WEEK_END));
    // 本週是最新一段：下一段停用；回到上一週後才可按（測試同步更新：原斷言把兩個狀態寫反）。
    expect((screen.getByLabelText('下一段') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('上一段'));
    await waitFor(() => expect(second).toHaveBeenCalledWith(PREV_WEEK_START, PREV_WEEK_END));
    expect((screen.getByLabelText('下一段') as HTMLButtonElement).disabled).toBe(false);
  });

  it('預設每頁 10 筆，下一頁到第 3 頁顯示 5 列，上一頁邊界停用', async () => {
    const docs = Array.from({ length: 25 }, (_, i) => makeLog(i));
    const fetchRange = vi.fn(async (): Promise<OperationLogsRangeResult> => ({ docs, truncated: false }));

    const view = render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(rowCount(view.container)).toBe(10));
    expect(screen.getByText('第 1 頁')).toBeTruthy();
    expect((screen.getByRole('button', { name: '上一頁' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    await waitFor(() => expect(screen.getByText('第 2 頁')).toBeTruthy());
    expect(rowCount(view.container)).toBe(10);

    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    await waitFor(() => expect(screen.getByText('第 3 頁')).toBeTruthy());
    expect(rowCount(view.container)).toBe(5);
    expect((screen.getByRole('button', { name: '下一頁' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '上一頁' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('每頁筆數切 20、30 立即生效並回第 1 頁；無限不顯示上下一頁', async () => {
    const docs = Array.from({ length: 25 }, (_, i) => makeLog(i));
    const fetchRange = vi.fn(async (): Promise<OperationLogsRangeResult> => ({ docs, truncated: false }));

    const view = render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(rowCount(view.container)).toBe(10));

    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    await waitFor(() => expect(screen.getByText('第 2 頁')).toBeTruthy());

    await choosePageSize('20');
    await waitFor(() => expect(rowCount(view.container)).toBe(20));
    expect(screen.getByText('第 1 頁')).toBeTruthy();

    await choosePageSize('30');
    await waitFor(() => expect(rowCount(view.container)).toBe(25));

    await choosePageSize('infinite');
    await waitFor(() => expect(screen.queryByRole('button', { name: '上一頁' })).toBeNull());
    expect(screen.queryByRole('button', { name: '下一頁' })).toBeNull();
    expect(rowCount(view.container)).toBe(25);
  });

  it('無限模式：第一次進入多 30 筆，在畫面內不連續增加，離開再進入才再加 30', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const docs = Array.from({ length: 100 }, (_, i) => makeLog(i));
    const fetchRange = vi.fn(async (): Promise<OperationLogsRangeResult> => ({ docs, truncated: false }));

    const view = render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(rowCount(view.container)).toBe(10));

    await choosePageSize('infinite');
    await waitFor(() => expect(rowCount(view.container)).toBe(30));

    const io = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1]!;
    await act(async () => {
      io.trigger(true);
    });
    await waitFor(() => expect(rowCount(view.container)).toBe(60));

    await act(async () => {
      io.trigger(true);
    });
    expect(rowCount(view.container)).toBe(60);

    await act(async () => {
      io.trigger(false);
      io.trigger(true);
    });
    await waitFor(() => expect(rowCount(view.container)).toBe(90));
  });

  it('每列顯示類型、操作者暱稱與 UID 短碼、時間、內容；缺暱稱顯示未標示', async () => {
    const log = makeLog(0, {
      _docId: 'op_detail',
      actorUid: LONG_UID,
      operator: '小明',
      typeName: '編輯活動',
      content: '調整活動內容',
      createdAt: { toDate: () => new Date(Date.parse('2026-11-19T02:05:00Z')) },
    });
    const unnamed = makeLog(1, {
      _docId: 'op_unnamed',
      actorUid: LONG_UID,
      operator: '',
      content: '沒有暱稱',
      createdAt: { toDate: () => new Date(Date.parse('2026-11-19T01:05:00Z')) },
    });
    const fetchRange = vi.fn(async (): Promise<OperationLogsRangeResult> => ({
      docs: [log, unnamed],
      truncated: false,
    }));

    render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(screen.getByText('編輯活動')).toBeTruthy());

    expect(screen.getByText('小明')).toBeTruthy();
    expect(screen.getAllByText(shortUid(LONG_UID)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('11/19 10:05')).toBeTruthy();
    expect(screen.getByText('調整活動內容')).toBeTruthy();
    expect(screen.getByText('未標示')).toBeTruthy();
  });

  it('搜尋 UID、內容、類型下拉、操作者標籤與清除都回第 1 頁', async () => {
    const aDocs = Array.from({ length: 15 }, (_, i) =>
      makeLog(100 + i, {
        actorUid: ACTOR_A,
        operator: '小明',
        type: 'event_edit',
        typeName: '編輯活動',
        content: `共同內容 ${i}`,
      }),
    );
    const bDocs = Array.from({ length: 10 }, (_, i) =>
      makeLog(i, {
        actorUid: ACTOR_B,
        operator: '小華',
        type: 'team_edit',
        typeName: '編輯俱樂部',
        content: `其他內容 ${i}`,
      }),
    );
    const docs = [...aDocs, ...bDocs];
    const fetchRange = vi.fn(async (): Promise<OperationLogsRangeResult> => ({ docs, truncated: false }));

    const view = render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(rowCount(view.container)).toBe(10));
    expect(screen.getByText('共 25 筆')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    await waitFor(() => expect(screen.getByText('第 2 頁')).toBeTruthy());

    await typeKeyword('UAAAAaaa');
    await waitFor(() => expect(screen.getByText('第 1 頁')).toBeTruthy());
    expect(rowCount(view.container)).toBe(10);

    await typeKeyword('');
    await waitFor(() => expect(screen.getByText('共 25 筆')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    await waitFor(() => expect(screen.getByText('第 2 頁')).toBeTruthy());

    await chooseType('event_edit');
    await waitFor(() => expect(screen.getByText('第 1 頁')).toBeTruthy());
    expect(rowCount(view.container)).toBe(10);

    await chooseType('');
    await waitFor(() => expect(screen.getByText('共 25 筆')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
    await waitFor(() => expect(screen.getByText('第 2 頁')).toBeTruthy());

    const person = screen.getAllByRole('button', { name: /只看此人操作：小明/ })[0]!;
    fireEvent.click(person);
    await waitFor(() => expect(screen.getByText(/操作者：小明/)).toBeTruthy());
    expect(screen.getByText('第 1 頁')).toBeTruthy();
    expect(rowCount(view.container)).toBe(10);

    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    await waitFor(() => expect(screen.queryByText(/操作者：小明/)).toBeNull());
    expect(screen.getByText('共 25 筆')).toBeTruthy();
    expect(screen.getByText('第 1 頁')).toBeTruthy();
  });

  it('隱藏與其他日誌重複的 cancel_signup，共 N 筆只算可見資料', async () => {
    const docs = [
      makeLog(0, { type: 'event_edit', typeName: '編輯活動' }),
      makeLog(1, { type: 'event_edit', typeName: '編輯活動' }),
      makeLog(2, { type: 'event_edit', typeName: '編輯活動' }),
      makeLog(3, { type: 'cancel_signup', typeName: '取消報名' }),
    ];
    const fetchRange = vi.fn(async (): Promise<OperationLogsRangeResult> => ({ docs, truncated: false }));

    const view = render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(rowCount(view.container)).toBe(3));
    expect(screen.queryByText('取消報名')).toBeNull();
    expect(screen.getByText('共 3 筆')).toBeTruthy();
  });

  it('truncated 為 true 時顯示縮小區間提示', async () => {
    const fetchRange = vi.fn(async (): Promise<OperationLogsRangeResult> => ({
      docs: [makeLog(0)],
      truncated: true,
    }));

    render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(screen.getByText('超過 500 筆，請縮小區間')).toBeTruthy());
  });

  it('點列展開顯示文件 ID 與複製診斷包，成功時 toast success', async () => {
    const fetchRange = vi.fn(async (): Promise<OperationLogsRangeResult> => ({
      docs: [makeLog(0, { _docId: 'op_copy_ok' })],
      truncated: false,
    }));

    const view = render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(rowCount(view.container)).toBe(1));

    fireEvent.click(view.container.querySelector('.olc-row') as HTMLElement);
    await waitFor(() => expect(screen.getByText('文件 ID')).toBeTruthy());
    expect(screen.getByText('op_copy_ok')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '複製診斷包' }));
    await waitFor(() => expect(copyState.fn).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastState.show).toHaveBeenCalledWith({
        message: '已複製操作日誌診斷包',
        tone: 'success',
      }),
    );
  });

  it('複製失敗時 toast error', async () => {
    copyState.fn.mockRejectedValueOnce(new Error('boom'));
    const fetchRange = vi.fn(async (): Promise<OperationLogsRangeResult> => ({
      docs: [makeLog(0, { _docId: 'op_copy_fail' })],
      truncated: false,
    }));

    const view = render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(rowCount(view.container)).toBe(1));

    fireEvent.click(view.container.querySelector('.olc-row') as HTMLElement);
    await waitFor(() => expect(screen.getByRole('button', { name: '複製診斷包' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '複製診斷包' }));
    await waitFor(() =>
      expect(toastState.show).toHaveBeenCalledWith({
        message: '複製操作日誌診斷包失敗',
        tone: 'error',
      }),
    );
  });

  it('載入失敗顯示錯誤，按重試再次呼叫後成功顯示資料', async () => {
    const fetchRange = vi
      .fn<(startMs: number, endMs: number) => Promise<OperationLogsRangeResult>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ docs: [makeLog(0, { content: '重試成功' })], truncated: false });

    render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(screen.getByText('無法載入操作日誌，請重試。')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await waitFor(() => expect(fetchRange).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('重試成功')).toBeTruthy());
  });

  it('競態：晚到的月資料不得蓋掉先到的日資料', async () => {
    const monthDeferred = deferred<OperationLogsRangeResult>();
    const dayDeferred = deferred<OperationLogsRangeResult>();
    const fetchRange = vi.fn((start: number, end: number): Promise<OperationLogsRangeResult> => {
      if (start === MONTH_START && end === MONTH_END) return monthDeferred.promise;
      if (start === DAY_START && end === DAY_END) return dayDeferred.promise;
      return Promise.resolve({ docs: [], truncated: false });
    });

    render(<OperationLogPanel fetchRange={fetchRange} nowMs={NOW_MS} />);
    await waitFor(() => expect(fetchRange).toHaveBeenCalledWith(WEEK_START, WEEK_END));
    await waitFor(() => expect(screen.queryByText('載入中...')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '月' }));
    await waitFor(() => expect(fetchRange).toHaveBeenCalledWith(MONTH_START, MONTH_END));

    // 本月含「現在」：切「日」＝今天（LogRangeBar 切換單位規則）。
    fireEvent.click(screen.getByRole('button', { name: '日' }));
    await waitFor(() => expect(fetchRange).toHaveBeenCalledWith(DAY_START, DAY_END));

    await act(async () => {
      dayDeferred.resolve({ docs: [makeLog(1, { content: '日資料' })], truncated: false });
    });
    await waitFor(() => expect(screen.getByText('日資料')).toBeTruthy());

    await act(async () => {
      monthDeferred.resolve({ docs: [makeLog(2, { content: '月資料' })], truncated: false });
    });
    expect(screen.getByText('日資料')).toBeTruthy();
    expect(screen.queryByText('月資料')).toBeNull();
  });
});
