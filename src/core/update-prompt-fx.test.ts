import { describe, expect, it } from 'vitest';
import {
  UPDATE_PROMPT_FX_CSS,
  buildKeyframes,
  computeOrbit,
  computeOrbitMotion,
  sampleBurstOpacity,
  type BurstStop,
} from './update-prompt-fx';

const SIZES: ReadonlyArray<readonly [number, number]> = [
  [200, 100],
  [280, 120],
  [320, 140],
  [360, 150],
  [400, 160],
  [420, 180],
  [420, 80],
  [120, 100],
  [372, 132],
];

function expectIncreasing(pcts: number[]): void {
  expect(pcts.length).toBeGreaterThan(1);
  for (let i = 1; i < pcts.length; i += 1) {
    expect(pcts[i] ?? 0).toBeGreaterThan(pcts[i - 1] ?? 0);
  }
}

function keyframeBody(css: string, name: string): string {
  const token = `@keyframes ${name}{`;
  const start = css.indexOf(token);
  expect(start).toBeGreaterThanOrEqual(0);
  const from = start + token.length;
  let depth = 1;
  let i = from;
  while (i < css.length && depth > 0) {
    const ch = css[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  return css.slice(from, i - 1);
}

function dashStops(css: string, name: string): Array<{ pct: number; offset: number }> {
  const body = keyframeBody(css, name);
  return [...body.matchAll(/([\d.]+)%\{stroke-dashoffset:(-?[\d.]+)\}/g)].map((m) => ({
    pct: Number(m[1]),
    offset: Number(m[2]),
  }));
}

describe('update-prompt-fx 軌道幾何與時序', () => {
  it.each(SIZES)('尺寸 %sx%s：ec 在 0～100，星芒時序嚴格遞增且 p4 < 100', (w, h) => {
    const orbit = computeOrbit(w, h);
    expect(orbit.ec).toBeGreaterThan(0);
    expect(orbit.ec).toBeLessThan(100);

    const motion = computeOrbitMotion(orbit);
    expect(motion.p1).toBeGreaterThan(0);
    expect(motion.p1).toBeLessThan(motion.pTail);
    expect(motion.pTail).toBeLessThan(motion.p4);
    expect(motion.p4).toBeLessThan(100);
    expect(motion.popAt).toBeGreaterThan(motion.p1);
    expect(motion.popAt - motion.p1).toBeCloseTo(0.7, 8);

    for (const layer of motion.layers) {
      expect(layer.offset0 - layer.offset100).toBe(100);
      expect(layer.offset0).toBeCloseTo(layer.len, 8);
      expect(layer.offset100).toBeCloseTo(layer.len - 100, 8);
      expectIncreasing(layer.stops.map((stop) => stop.pct));
    }
    expectIncreasing(motion.burst.map((stop) => stop.pct));
    expectBurstTimeline(motion.burst, motion.p1, motion.pTail, motion.p4);
  });

  it('右上角比例照 wire()：頂邊直線加四分之一圓角的一半', () => {
    const w = 360;
    const h = 140;
    const orbit = computeOrbit(w, h);
    const rw = w - 1;
    const rh = h - 1;
    const r = 16;
    const perimeter = 2 * (rw - 2 * r) + 2 * (rh - 2 * r) + 2 * Math.PI * r;
    const ec = (100 * ((rw - 2 * r) + (Math.PI * r) / 4)) / perimeter;
    expect(orbit.perimeter).toBeCloseTo(perimeter, 10);
    expect(orbit.ec).toBeCloseTo(ec, 10);
    expect(computeOrbitMotion(orbit).p1).toBeCloseTo(orbit.ec, 8);
  });

  it('圈頭與圈尾在 CSS 裡相差剛好 100，百分比單調遞增', () => {
    const orbit = computeOrbit(360, 140);
    const css = buildKeyframes('box', orbit);
    for (const name of ['tail', 'mid', 'head'] as const) {
      const stops = dashStops(css, `boxrun${name}`);
      expectIncreasing(stops.map((stop) => stop.pct));
      expect(stops[0]?.pct).toBe(0);
      expect(stops[stops.length - 1]?.pct).toBe(100);
      const first = stops[0]?.offset ?? 0;
      const last = stops[stops.length - 1]?.offset ?? 0;
      expect(first - last).toBe(100);
    }
    const burstPcts = [...keyframeBody(css, 'boxburst').matchAll(/([\d.]+)%\{/g)].map((m) => Number(m[1]));
    expectIncreasing(burstPcts);
    expect(css).toContain('3.6s linear infinite');
    expect(css).toContain('stroke-dasharray:12 88');
    expect(css).toContain('stroke-dasharray:7.44 92.56');
    expect(css).toContain('stroke-dasharray:1.68 98.32');
  });

  it('不同實例的 keyframes 名稱分開', () => {
    const orbit = computeOrbit(360, 140);
    const a = buildKeyframes('swfxA', orbit);
    const b = buildKeyframes('swfxB', orbit);
    expect(a).toContain('@keyframes swfxAruntail');
    expect(b).toContain('@keyframes swfxBruntail');
    expect(a).not.toContain('swfxB');
  });
});

function expectBurstTimeline(burst: readonly BurstStop[], p1: number, pTail: number, p4: number): void {
  const before = burst.filter((stop) => stop.pct < p1);
  expect(before.length).toBeGreaterThan(0);
  expect(before.every((stop) => stop.opacity === 0)).toBe(true);
  expect(sampleBurstOpacity(burst, 0)).toBe(0);
  expect(sampleBurstOpacity(burst, p1 - 0.02)).toBe(0);

  const lit = burst.filter((stop) => stop.pct > p1 && stop.pct <= pTail);
  expect(lit.some((stop) => stop.opacity === 1)).toBe(true);
  expect(lit.every((stop) => stop.opacity >= 0.95)).toBe(true);
  expect(lit[0]?.transform).toContain('scale(1.18)');
  expect(sampleBurstOpacity(burst, lit[0]?.pct ?? p1)).toBe(1);
  expect(sampleBurstOpacity(burst, pTail)).toBe(1);

  const fadeEnd = burst.find((stop) => stop.pct === p4);
  expect(fadeEnd?.opacity).toBe(0);
  expect(sampleBurstOpacity(burst, p4)).toBe(0);
  expect(sampleBurstOpacity(burst, 100)).toBe(0);
}

describe('update-prompt-fx 靜態 CSS', () => {
  it('含減少動態、webkit 毛玻璃、不支援 backdrop-filter 的退回', () => {
    expect(UPDATE_PROMPT_FX_CSS).toContain('prefers-reduced-motion');
    expect(UPDATE_PROMPT_FX_CSS).toContain('-webkit-backdrop-filter');
    expect(UPDATE_PROMPT_FX_CSS).toContain('@supports not');
    expect(UPDATE_PROMPT_FX_CSS).toContain('backdrop-filter: blur(16px) saturate(160%)');
    expect(UPDATE_PROMPT_FX_CSS).toContain('rgba(17,24,39,.94)');
    expect(UPDATE_PROMPT_FX_CSS).toContain('animation: none !important');
    expect(UPDATE_PROMPT_FX_CSS).toContain('opacity: 0 !important');
    expect(UPDATE_PROMPT_FX_CSS).toContain('站長 2026-11-10 選定 B 銅金；R-UI-005 例外');
    expect(UPDATE_PROMPT_FX_CSS).toContain('--c1: #f3c876');
    expect(UPDATE_PROMPT_FX_CSS).toContain('--c2: #c58a33');
    expect(UPDATE_PROMPT_FX_CSS).toContain('min(420px, calc(100vw - 48px))');
    expect(UPDATE_PROMPT_FX_CSS).toContain('bottom: calc(72px + env(safe-area-inset-bottom, 0px))');
    expect(UPDATE_PROMPT_FX_CSS).toContain('z-index: 100000');
    expect(UPDATE_PROMPT_FX_CSS).toContain('mix-blend-mode: screen');
  });
});
