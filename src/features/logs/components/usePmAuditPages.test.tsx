import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LogRange, PageSizeOption } from '../data/log-range';
import type { PmAuditFilter } from '../data/pm-audit-view';
import type { PmAuditLog } from '../data/pm-audit';

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));

vi.mock('../data/pm-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/pm-audit')>();
  return { ...actual, loadPmAuditLogs: loadMock };
});

import {
  PM_AUDIT_INFINITE_LIMIT,
  PM_AUDIT_RANGE_CAP,
  usePmAuditPages,
} from './usePmAuditPages';

const RANGE: LogRange = { unit: 'day', startMs: 1000, endMs: 5000 };
const FILTER_ALL: PmAuditFilter = { kind: 'all' };

function makeLog(ms: number): PmAuditLog {
  return { action: 'send', createdAt: ms } as unknown as PmAuditLog;
}

let moreFn: (() => Promise<boolean>) | null = null;

function Probe({
  filter = FILTER_ALL,
  range = RANGE,
  pageSize = 10,
}: {
  filter?: PmAuditFilter;
  range?: LogRange;
  pageSize?: PageSizeOption;
}) {
  const { state, more } = usePmAuditPages(filter, range, pageSize, () => undefined);
  moreFn = more;
  const total = state.chunks.reduce((n, c) => n + c.length, 0);
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="done">{String(state.done)}</span>
      <span data-testid="truncated">{String(state.truncated)}</span>
      <span data-testid="chunks">{state.chunks.length}</span>
      <span data-testid="total">{total}</span>
    </div>
  );
}

afterEach(() => {
  cleanup(); // 每條測試後卸載，避免上一條的元件殘留（PM 修正）
});

beforeEach(() => {
  loadMock.mockReset();
  moreFn = null;
});

describe('usePmAuditPages - 第一批與每頁筆數', () => {
  it('第一批 cursor 為 range.endMs、limit 為每頁筆數', async () => {
    loadMock.mockResolvedValue({ logs: [makeLog(2000)], hasMore: false, nextCursorMs: null });

    render(<Probe pageSize={10} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(1));
    expect(loadMock).toHaveBeenCalledWith(FILTER_ALL, RANGE.endMs, 10);
  });

  it('每頁筆數選「無限」時 limit 為 100', async () => {
    loadMock.mockResolvedValue({ logs: [makeLog(2000)], hasMore: false, nextCursorMs: null });

    render(<Probe pageSize={'infinite'} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(1));
    expect(loadMock).toHaveBeenCalledWith(FILTER_ALL, RANGE.endMs, PM_AUDIT_INFINITE_LIMIT);
  });
});

describe('usePmAuditPages - 區間裁剪', () => {
  it('早於 startMs 的筆數丟棄並視為結束', async () => {
    loadMock.mockResolvedValue({
      logs: [makeLog(500), makeLog(2000)],
      hasMore: true,
      nextCursorMs: 400,
    });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    expect(screen.getByTestId('total').textContent).toBe('1');
    expect(screen.getByTestId('done').textContent).toBe('true');
  });
});

describe('usePmAuditPages - 累計上限', () => {
  it('累計 500 筆時 truncated:true、done:true，more() 不再呼叫後端', async () => {
    loadMock.mockImplementation(() =>
      Promise.resolve({
        logs: Array.from({ length: 100 }, (_, i) => makeLog(2000 + i)),
        hasMore: true,
        nextCursorMs: 1500,
      }),
    );

    render(<Probe pageSize={'infinite'} />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('total').textContent).toBe('100');

    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await moreFn!();
      });
    }

    await waitFor(() => {
      expect(screen.getByTestId('total').textContent).toBe(String(PM_AUDIT_RANGE_CAP));
      expect(screen.getByTestId('truncated').textContent).toBe('true');
      expect(screen.getByTestId('done').textContent).toBe('true');
    });

    const callCountBefore = loadMock.mock.calls.length;
    let result: boolean | undefined;
    await act(async () => {
      result = await moreFn!();
    });
    expect(result).toBe(false);
    expect(loadMock.mock.calls.length).toBe(callCountBefore);
  });
});

describe('usePmAuditPages - more 成功與失敗', () => {
  it('more() 成功回 true 並追加 chunk', async () => {
    loadMock
      .mockResolvedValueOnce({ logs: [makeLog(2000)], hasMore: true, nextCursorMs: 2000 })
      .mockResolvedValueOnce({ logs: [makeLog(1500)], hasMore: false, nextCursorMs: null });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    let result: boolean | undefined;
    await act(async () => {
      result = await moreFn!();
    });
    expect(result).toBe(true);
    await waitFor(() => expect(screen.getByTestId('chunks').textContent).toBe('2'));
  });

  it('more() 失敗回 false 且 chunks 不變', async () => {
    loadMock
      .mockResolvedValueOnce({ logs: [makeLog(2000)], hasMore: true, nextCursorMs: 2000 })
      .mockRejectedValueOnce(new Error('boom'));

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    let result: boolean | undefined;
    await act(async () => {
      result = await moreFn!();
    });
    expect(result).toBe(false);
    expect(screen.getByTestId('chunks').textContent).toBe('1');
    expect(screen.getByTestId('status').textContent).toBe('ready');
  });
});

describe('usePmAuditPages - 篩選與區間變更', () => {
  it('篩選變更時晚到的舊回應被丟棄', async () => {
    let resolveA!: (v: unknown) => void;
    let resolveB!: (v: unknown) => void;
    const pA = new Promise<any>((r) => {
      resolveA = r;
    });
    const pB = new Promise<any>((r) => {
      resolveB = r;
    });
    loadMock.mockImplementationOnce(() => pA).mockImplementationOnce(() => pB);

    const { rerender } = render(<Probe filter={{ kind: 'all' }} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(1));

    rerender(<Probe filter={{ kind: 'action', action: 'send' }} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveB({ logs: [makeLog(2000)], hasMore: false, nextCursorMs: null });
      await pB;
    });
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('1'));

    await act(async () => {
      resolveA({ logs: [makeLog(3000), makeLog(3100), makeLog(3200)], hasMore: false, nextCursorMs: null });
      await pA;
    });
    expect(screen.getByTestId('total').textContent).toBe('1');
  });

  it('filter 原物件傳入 loadPmAuditLogs', async () => {
    loadMock.mockResolvedValue({ logs: [], hasMore: false, nextCursorMs: null });
    const filter: PmAuditFilter = { kind: 'actor', uid: 'U1' };

    render(<Probe filter={filter} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    expect(loadMock.mock.calls[0]![0]).toEqual(filter);
  });
});
