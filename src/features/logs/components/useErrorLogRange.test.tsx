import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ErrorLogsRangeResult } from '../data/error-logs';
import type { LogRange } from '../data/log-range';

vi.mock('../data/error-logs', () => ({
  fetchErrorLogsInRange: vi.fn(),
}));

import {
  _resetErrorRangeCacheForTest,
  useErrorLogRange,
  type ErrorRangeFetcher,
} from './useErrorLogRange';

const RANGE_A: LogRange = { unit: 'day', startMs: 1000, endMs: 2000 };
const RANGE_B: LogRange = { unit: 'day', startMs: 3000, endMs: 4000 };

function mockResult(ids: string[]): ErrorLogsRangeResult {
  return { docs: ids.map((id) => ({ _docId: id })), truncated: false } as ErrorLogsRangeResult;
}

function Probe({
  range,
  fetcher,
  label,
}: {
  range: LogRange;
  fetcher: ErrorRangeFetcher;
  label: string;
}) {
  const { load, refresh } = useErrorLogRange(range, fetcher);
  const firstDocId = load.status === 'ready' ? load.docs[0]?._docId ?? '' : '';
  return (
    <div data-testid={`probe-${label}`}>
      <span data-testid={`status-${label}`}>{load.status}</span>
      <span data-testid={`first-${label}`}>{firstDocId}</span>
      <button type="button" onClick={() => refresh()}>
        重新整理
      </button>
    </div>
  );
}

beforeEach(() => {
  _resetErrorRangeCacheForTest();
});

afterEach(() => {
  cleanup(); // 每條測試後卸載，避免上一條的元件殘留（PM 修正）
  vi.clearAllMocks();
});

describe('useErrorLogRange - 共用快取', () => {
  it('同一區間兩個元件只呼叫一次 fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockResult(['a'])) as unknown as ErrorRangeFetcher;

    render(
      <>
        <Probe range={RANGE_A} fetcher={fetcher} label="p1" />
        <Probe range={RANGE_A} fetcher={fetcher} label="p2" />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status-p1').textContent).toBe('ready');
      expect(screen.getByTestId('status-p2').textContent).toBe('ready');
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refresh() 會強制重抓', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(mockResult(['a']))
      .mockResolvedValueOnce(mockResult(['b'])) as unknown as ErrorRangeFetcher;

    render(<Probe range={RANGE_A} fetcher={fetcher} label="p1" />);
    await waitFor(() => expect(screen.getByTestId('status-p1').textContent).toBe('ready'));
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByText('重新整理'));
    });
    await waitFor(() => expect(screen.getByTestId('first-p1').textContent).toBe('b'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('useErrorLogRange - 失敗復原', () => {
  it('fetcher 失敗後快取被清、下次渲染會重抓', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(mockResult(['a'])) as unknown as ErrorRangeFetcher;

    const { unmount } = render(<Probe range={RANGE_A} fetcher={fetcher} label="p1" />);
    await waitFor(() => expect(screen.getByTestId('status-p1').textContent).toBe('error'));
    unmount();

    render(<Probe range={RANGE_A} fetcher={fetcher} label="p2" />);
    await waitFor(() => expect(screen.getByTestId('status-p2').textContent).toBe('ready'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('useErrorLogRange - 競態', () => {
  it('換區間時晚到的舊結果不會覆蓋新結果', async () => {
    let resolveA!: (v: ErrorLogsRangeResult) => void;
    let resolveB!: (v: ErrorLogsRangeResult) => void;
    const pA = new Promise<ErrorLogsRangeResult>((r) => {
      resolveA = r;
    });
    const pB = new Promise<ErrorLogsRangeResult>((r) => {
      resolveB = r;
    });

    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => pA)
      .mockImplementationOnce(() => pB) as unknown as ErrorRangeFetcher;

    const { rerender } = render(<Probe range={RANGE_A} fetcher={fetcher} label="p" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    rerender(<Probe range={RANGE_B} fetcher={fetcher} label="p" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveB(mockResult(['B']));
      await pB;
    });
    await waitFor(() => expect(screen.getByTestId('first-p').textContent).toBe('B'));

    await act(async () => {
      resolveA(mockResult(['A']));
      await pA;
    });
    expect(screen.getByTestId('first-p').textContent).toBe('B');
  });
});

describe('useErrorLogRange - 強制重抓後舊請求晚失敗（第二批審查 Flash P2，PM 補）', () => {
  it('舊的那份失敗時不得刪掉 refresh 放進快取的新那份', async () => {
    let rejectOld: (e: Error) => void = () => undefined;
    const oldP = new Promise<ErrorLogsRangeResult>((_, reject) => { rejectOld = reject; });
    const fetcher = vi.fn()
      .mockReturnValueOnce(oldP)
      .mockResolvedValueOnce(mockResult(['new'])) as unknown as ErrorRangeFetcher;

    render(<Probe range={RANGE_A} fetcher={fetcher} label="x" />);
    fireEvent.click(screen.getByText('重新整理'));
    await waitFor(() => expect(screen.getByTestId('first-x').textContent).toBe('new'));

    await act(async () => { rejectOld(new Error('late')); await Promise.resolve(); });
    cleanup();

    // 新掛載同一區間：快取應仍是新的那份，不再呼叫 fetcher。
    render(<Probe range={RANGE_A} fetcher={fetcher} label="y" />);
    await waitFor(() => expect(screen.getByTestId('first-y').textContent).toBe('new'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
