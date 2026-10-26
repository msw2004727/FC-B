import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { useSnapshotExpiry } from './use-snapshot-expiry';

// 首屏快照掛載後的效期重驗：計時器、頁面回到可見（hidden→visible 完整序列）、bfcache 還原（pageshow）、清理。
// 時間一律用假時鐘，不真的等。

const T0 = Date.UTC(2026, 9, 27, 3, 0, 0);

function Probe({ expiresAt, onExpire }: { expiresAt: number | null; onExpire: () => void }): null {
  useSnapshotExpiry(expiresAt, onExpire);
  return null;
}

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
});

describe('useSnapshotExpiry', () => {
  it('計時器：到期前不呼叫，到期時呼叫一次，之後不再呼叫', async () => {
    vi.useFakeTimers({ now: T0 });
    const onExpire = vi.fn();
    render(<Probe expiresAt={T0 + 1000} onExpire={onExpire} />);

    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(onExpire).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('掛載時就已經到期：立刻呼叫一次；沒有要盯的快照（null）永遠不呼叫', async () => {
    vi.useFakeTimers({ now: T0 });
    const due = vi.fn();
    render(<Probe expiresAt={T0 - 1} onExpire={due} />);
    expect(due).toHaveBeenCalledTimes(1);
    cleanup();

    const none = vi.fn();
    render(<Probe expiresAt={null} onExpire={none} />);
    await act(async () => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(none).not.toHaveBeenCalled();
  });

  it('hidden → visible 完整序列：頁面隱藏時就算時間已過也不撤；回到可見才撤，而且只撤一次', async () => {
    // 只假 Date：背景分頁的計時器被瀏覽器延後時，時鐘照走但計時器沒醒
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    const onExpire = vi.fn();
    render(<Probe expiresAt={T0 + 30 * 60 * 1000} onExpire={onExpire} />);

    visibility = 'hidden';
    vi.setSystemTime(T0 + 31 * 60 * 1000);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onExpire).not.toHaveBeenCalled();

    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onExpire).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('回到可見但還沒到期：不撤，之後到期仍會撤', async () => {
    vi.useFakeTimers({ now: T0 });
    const onExpire = vi.fn();
    render(<Probe expiresAt={T0 + 10_000} onExpire={onExpire} />);

    vi.setSystemTime(T0 + 5_000);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onExpire).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('pageshow（從 bfcache 還原）：到期就撤', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    const onExpire = vi.fn();
    render(<Probe expiresAt={T0 + 60_000} onExpire={onExpire} />);

    vi.setSystemTime(T0 + 61_000);
    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('計時器提早醒來（時鐘被調回）：還沒到期就重排，之後到期才撤', async () => {
    vi.useFakeTimers({ now: T0 });
    const onExpire = vi.fn();
    render(<Probe expiresAt={T0 + 60_000} onExpire={onExpire} />);

    // 時鐘被往回調 30 秒；計時器仍照原本的 60 秒醒來，這時其實還差 30 秒
    vi.setSystemTime(T0 - 30_000);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onExpire).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('清理：卸載後移除 listener、清掉計時器，之後不會呼叫', async () => {
    vi.useFakeTimers({ now: T0 });
    const removeDoc = vi.spyOn(document, 'removeEventListener');
    const removeWin = vi.spyOn(window, 'removeEventListener');
    const onExpire = vi.fn();
    const view = render(<Probe expiresAt={T0 + 5_000} onExpire={onExpire} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    view.unmount();
    expect(removeDoc).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeWin).toHaveBeenCalledWith('pageshow', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);

    vi.setSystemTime(T0 + 60_000);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('expiresAt 改成 null（被正式資料取代）：舊計時器與 listener 清掉，不會再撤', async () => {
    vi.useFakeTimers({ now: T0 });
    const onExpire = vi.fn();
    const view = render(<Probe expiresAt={T0 + 5_000} onExpire={onExpire} />);
    view.rerender(<Probe expiresAt={null} onExpire={onExpire} />);
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('到期時呼叫的是最新的 onExpire（不是掛載當時那個）', async () => {
    vi.useFakeTimers({ now: T0 });
    const stale = vi.fn();
    const latest = vi.fn();
    const view = render(<Probe expiresAt={T0 + 5_000} onExpire={stale} />);
    view.rerender(<Probe expiresAt={T0 + 5_000} onExpire={latest} />);
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
