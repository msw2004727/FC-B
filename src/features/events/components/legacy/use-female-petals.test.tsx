import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'preact/hooks';
import { cleanup, render } from '@testing-library/preact';
import { useFemalePetals } from './use-female-petals';

function PetalHost({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useFemalePetals(ref, active);
  return <canvas ref={ref} />;
}

function makeCtx(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    restore: vi.fn(),
    globalAlpha: 0,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useFemalePetals', () => {
  it('prefers-reduced-motion: reduce 時不啟動', () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    render(
      <div id="page-activities" class="activity-female-theme">
        <PetalHost active={true} />
      </div>,
    );
    expect(getContextSpy).not.toHaveBeenCalled();
  });

  it('getContext 回 null 時安靜跳過、不拋錯', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(() => {
      render(
        <div id="page-activities" class="activity-female-theme">
          <PetalHost active={true} />
        </div>,
      );
    }).not.toThrow();
  });

  it('active 且有 2D context 時啟動動畫，卸載後清理 rAF 與 resize 監聽', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(makeCtx());

    const { unmount } = render(
      <div id="page-activities" class="activity-female-theme">
        <PetalHost active={true} />
      </div>,
    );

    expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function), { passive: true });
    expect(rafSpy).toHaveBeenCalled();
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('active 為 false 時不啟動', () => {
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    render(
      <div id="page-activities">
        <PetalHost active={false} />
      </div>,
    );
    expect(getContextSpy).not.toHaveBeenCalled();
  });
});
