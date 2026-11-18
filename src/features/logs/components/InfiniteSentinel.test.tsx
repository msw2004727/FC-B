import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InfiniteSentinel } from './InfiniteSentinel';

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

describe('InfiniteSentinel（無限捲動觸發點）', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('進入畫面只呼叫一次；之後在畫面內或 enabled 重設都不再呼叫', () => {
    const onReach = vi.fn();
    const { rerender } = render(<InfiniteSentinel enabled={true} onReach={onReach} />);
    const io = FakeIntersectionObserver.instances[0]!;

    act(() => {
      io.trigger(true);
    });
    expect(onReach).toHaveBeenCalledTimes(1);

    act(() => {
      io.trigger(true);
    });
    expect(onReach).toHaveBeenCalledTimes(1);

    rerender(<InfiniteSentinel enabled={false} onReach={onReach} />);
    rerender(<InfiniteSentinel enabled={true} onReach={onReach} />);
    expect(onReach).toHaveBeenCalledTimes(1);
  });

  it('先離開畫面再進入才第二次呼叫', () => {
    const onReach = vi.fn();
    render(<InfiniteSentinel enabled={true} onReach={onReach} />);
    const io = FakeIntersectionObserver.instances[0]!;

    act(() => {
      io.trigger(true);
    });
    expect(onReach).toHaveBeenCalledTimes(1);

    act(() => {
      io.trigger(false);
    });
    expect(onReach).toHaveBeenCalledTimes(1);

    act(() => {
      io.trigger(true);
    });
    expect(onReach).toHaveBeenCalledTimes(2);
  });

  it('enabled=false 時進入畫面不呼叫；改 true 且仍在畫面內補呼叫一次', async () => {
    const onReach = vi.fn();
    const { rerender } = render(<InfiniteSentinel enabled={false} onReach={onReach} />);
    const io = FakeIntersectionObserver.instances[0]!;

    act(() => {
      io.trigger(true);
    });
    expect(onReach).not.toHaveBeenCalled();

    await act(async () => {
      rerender(<InfiniteSentinel enabled={true} onReach={onReach} />);
    });
    expect(onReach).toHaveBeenCalledTimes(1);

    act(() => {
      io.trigger(true);
    });
    expect(onReach).toHaveBeenCalledTimes(1);
  });

  it('卸載時呼叫 disconnect', () => {
    const onReach = vi.fn();
    const { unmount } = render(<InfiniteSentinel enabled={true} onReach={onReach} />);
    const io = FakeIntersectionObserver.instances[0]!;

    unmount();

    expect(io.disconnected).toBe(true);
  });

  it('沒有 IntersectionObserver 時不丟錯、不呼叫', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onReach = vi.fn();

    expect(() => {
      render(<InfiniteSentinel enabled={true} onReach={onReach} />);
    }).not.toThrow();
    expect(onReach).not.toHaveBeenCalled();
  });
});
