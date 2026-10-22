import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useSwipeTabs } from './use-swipe-tabs';

interface TestCompProps {
  onSwitch: (key: string) => void;
  getKey?: (btn: HTMLElement) => string | null;
}

function TestComp({ onSwitch, getKey }: TestCompProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  useSwipeTabs({
    contentRef,
    tabsRef,
    onSwitch,
    getKey: getKey ?? ((btn) => btn.dataset['atab'] ?? null),
  });
  return (
    <div>
      <div id="tabs" ref={tabsRef}>
        <button data-atab="a">A</button>
        <button class="active" data-atab="b">B</button>
        <button data-atab="c">C</button>
      </div>
      <div id="content" ref={contentRef}>content</div>
    </div>
  );
}

interface TouchPoint {
  clientX: number;
  clientY: number;
}

function makeTouchEvent(
  type: string,
  opts: { touches?: TouchPoint[]; changedTouches?: TouchPoint[] },
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: TouchPoint[];
    changedTouches: TouchPoint[];
  };
  ev.touches = opts.touches ?? [];
  ev.changedTouches = opts.changedTouches ?? [];
  return ev;
}

async function waitMount(content: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(content.dataset['swipeBound']).toBe('1');
  });
}

afterEach(() => {
  cleanup();
});

describe('useSwipeTabs', () => {
  it('swipes left past threshold and switches to next tab', async () => {
    const onSwitch = vi.fn();
    const { container } = render(<TestComp onSwitch={onSwitch} />);
    const content = container.querySelector('#content') as HTMLElement;
    await waitMount(content);

    // 主動從 b（中間）→ c（dx = -50，left）
    await act(async () => {
      content.dispatchEvent(
        makeTouchEvent('touchstart', { touches: [{ clientX: 200, clientY: 100 }] }),
      );
      content.dispatchEvent(
        makeTouchEvent('touchmove', { touches: [{ clientX: 150, clientY: 100 }] }),
      );
      content.dispatchEvent(
        makeTouchEvent('touchend', { changedTouches: [{ clientX: 150, clientY: 100 }] }),
      );
    });
    // 350ms exit fallback → onSwitch
    await waitFor(
      () => {
        expect(onSwitch).toHaveBeenCalledWith('c');
      },
      { timeout: 1500 },
    );
  });

  it('does not switch when getKey returns null', async () => {
    const onSwitch = vi.fn();
    const { container } = render(<TestComp onSwitch={onSwitch} getKey={() => null} />);
    const content = container.querySelector('#content') as HTMLElement;
    await waitMount(content);

    await act(async () => {
      content.dispatchEvent(
        makeTouchEvent('touchstart', { touches: [{ clientX: 200, clientY: 100 }] }),
      );
      content.dispatchEvent(
        makeTouchEvent('touchmove', { touches: [{ clientX: 150, clientY: 100 }] }),
      );
      content.dispatchEvent(
        makeTouchEvent('touchend', { changedTouches: [{ clientX: 150, clientY: 100 }] }),
      );
    });
    await new Promise((r) => setTimeout(r, 700));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('does not switch under 20px even when fast (A threshold)', async () => {
    const onSwitch = vi.fn();
    const { container } = render(<TestComp onSwitch={onSwitch} />);
    const content = container.querySelector('#content') as HTMLElement;
    await waitMount(content);

    await act(async () => {
      content.dispatchEvent(
        makeTouchEvent('touchstart', { touches: [{ clientX: 200, clientY: 100 }] }),
      );
      content.dispatchEvent(
        makeTouchEvent('touchmove', { touches: [{ clientX: 185, clientY: 100 }] }),
      );
      content.dispatchEvent(
        makeTouchEvent('touchend', { changedTouches: [{ clientX: 185, clientY: 100 }] }),
      );
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('binds once and unbinds on unmount', async () => {
    const onSwitch = vi.fn();
    const { container, unmount } = render(<TestComp onSwitch={onSwitch} />);
    const content = container.querySelector('#content') as HTMLElement;
    await waitMount(content);
    expect(content.dataset['swipeBound']).toBe('1');

    unmount();
    expect(content.dataset['swipeBound']).toBeUndefined();
  });

  it('locks out horizontal swipe when vertical movement dominates', async () => {
    const onSwitch = vi.fn();
    const { container } = render(<TestComp onSwitch={onSwitch} />);
    const content = container.querySelector('#content') as HTMLElement;
    await waitMount(content);

    await act(async () => {
      content.dispatchEvent(
        makeTouchEvent('touchstart', { touches: [{ clientX: 200, clientY: 100 }] }),
      );
      // 垂直位移大於水平 → 鎖定為垂直捲動
      content.dispatchEvent(
        makeTouchEvent('touchmove', { touches: [{ clientX: 190, clientY: 200 }] }),
      );
      content.dispatchEvent(
        makeTouchEvent('touchend', { changedTouches: [{ clientX: 190, clientY: 200 }] }),
      );
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
