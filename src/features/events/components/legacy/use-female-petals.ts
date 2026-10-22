import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

interface Petal {
  x: number;
  y: number;
  size: number;
  speed: number;
  drift: number;
  angle: number;
  spin: number;
  alpha: number;
  seed: number;
}

interface PetalState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  petals: Petal[];
  raf: number;
  running: boolean;
  last: number;
  cssWidth: number;
  cssHeight: number;
}

function createPetal(state: PetalState, randomY: boolean): Petal {
  const width = state.cssWidth || 360;
  const height = state.cssHeight || 640;
  return {
    x: Math.random() * width,
    y: randomY ? Math.random() * height : -18 - Math.random() * 120,
    size: 5 + Math.random() * 6,
    speed: 0.0365 + Math.random() * 0.07,
    drift: -0.12 + Math.random() * 0.24,
    angle: Math.random() * Math.PI * 2,
    spin: -0.012 + Math.random() * 0.024,
    alpha: 0.38 + Math.random() * 0.32,
    seed: Math.random() * 1000,
  };
}

function drawPetal(state: PetalState, petal: Petal): void {
  const ctx = state.ctx;
  ctx.save();
  ctx.translate(petal.x, petal.y);
  ctx.rotate(petal.angle);
  ctx.globalAlpha = petal.alpha;
  ctx.fillStyle = '#f9a8d4';
  ctx.strokeStyle = 'rgba(236,72,153,.34)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, petal.size * 0.55, petal.size, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function resizePetals(state: PetalState): void {
  const page = state.canvas.closest('#page-activities') as HTMLElement | null;
  const rect = page?.getBoundingClientRect?.();
  const width = Math.max(1, Math.round(rect?.width || page?.clientWidth || 360));
  const height = Math.max(1, Math.round(rect?.height || page?.clientHeight || window.innerHeight || 640));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  state.cssWidth = width;
  state.cssHeight = height;
  state.canvas.width = Math.round(width * dpr);
  state.canvas.height = Math.round(height * dpr);
  state.canvas.style.width = `${width}px`;
  state.canvas.style.height = `${height}px`;
  state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// M-074：照 A `_startActivityFemalePetals` 移植花瓣動畫。
export function useFemalePetals(
  canvasRef: RefObject<HTMLCanvasElement>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const page = canvas.closest('#page-activities') as HTMLElement | null;
    if (!page) return;

    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext?.('2d') ?? null;
    } catch {
      return;
    }
    if (!ctx) return; // jsdom 無 2D context：安靜跳過

    const state: PetalState = {
      canvas,
      ctx,
      petals: [],
      raf: 0,
      running: true,
      last: 0,
      cssWidth: 0,
      cssHeight: 0,
    };

    const resizeHandler = () => resizePetals(state);
    window.addEventListener('resize', resizeHandler, { passive: true });
    resizePetals(state);

    const count = Math.max(14, Math.min(34, Math.round(((state.cssWidth || 360) / 14) * 0.8)));
    state.petals = Array.from({ length: count }, () => createPetal(state, true));

    const stop = () => {
      state.running = false;
      if (state.raf) window.cancelAnimationFrame(state.raf);
      window.removeEventListener('resize', resizeHandler);
      try {
        ctx?.clearRect(0, 0, state.cssWidth || canvas.width, state.cssHeight || canvas.height);
      } catch {
        // 忽略清除失敗
      }
    };

    const animate = (timestamp: number) => {
      if (
        !state.running
        || !page.classList.contains('activity-female-theme')
        || !document.body.contains(page)
      ) {
        stop();
        return;
      }

      const delta = Math.min(32, timestamp - (state.last || timestamp));
      state.last = timestamp;
      ctx.clearRect(0, 0, state.cssWidth, state.cssHeight);

      for (const petal of state.petals) {
        petal.y += petal.speed * delta;
        petal.x += (petal.drift + Math.sin((petal.y + petal.seed) * 0.016) * 0.22) * delta;
        petal.angle += petal.spin * delta;

        if (petal.y > state.cssHeight + 24 || petal.x < -36 || petal.x > state.cssWidth + 36) {
          Object.assign(petal, createPetal(state, false));
        }

        drawPetal(state, petal);
      }

      state.raf = window.requestAnimationFrame(animate);
    };

    state.raf = window.requestAnimationFrame(animate);

    return () => {
      stop();
    };
  }, [canvasRef, active]);
}
