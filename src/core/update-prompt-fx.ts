// 更新通知彈窗特效（站長 2026-11-10 選定 B 銅金；預覽 update-prompt-orbit-v3）。
// 由 reload-safety 動態 import，不進首頁入口的靜態圖。
// 幾何與 keyframes 是純函式，DOM 套用集中在 applyUpdatePromptFx。

/** 靜態樣式只注入一次，id 固定，關閉提示框時留著。 */
export const UPDATE_PROMPT_FX_STYLE_ID = 'sw-reload-prompt-fx-style';

const RADIUS = 16;
const INSET = 0.5;
/** 光點繞一圈的秒數。全程等速，不停頓。 */
const MOVE_SEC = 3.6;
const HOLD_SEC = 0;
/** 星芒在尾巴離開右上角之後淡出的秒數。 */
const FADE_SEC = 0.7;
/** 彗尾長度佔周長的百分比。 */
const TAIL_PCT = 12;
const CYCLE_SEC = MOVE_SEC + HOLD_SEC;

/** jsdom 沒有版面、或尚未排到尺寸時的設計盒，讓光軌仍能畫出來。實機一律量 offset。 */
const FALLBACK_W = 372;
const FALLBACK_H = 132;

const LAYER_LEN = {
  tail: TAIL_PCT,
  mid: TAIL_PCT * 0.62,
  head: TAIL_PCT * 0.14,
} as const;

export interface OrbitGeom {
  w: number;
  h: number;
  r: number;
  inset: number;
  rw: number;
  rh: number;
  perimeter: number;
  /** 右上角在周長上的百分比（0–100）。 */
  ec: number;
}

export interface DashStop {
  pct: number;
  offset: number;
}

export interface LayerRun {
  name: 'tail' | 'mid' | 'head';
  /** 該層彗尾長度（pathLength 單位，周長 = 100）。dashoffset 從這個值線性走到 len-100。 */
  len: number;
  offset0: number;
  offset100: number;
  stops: DashStop[];
}

export interface BurstStop {
  pct: number;
  opacity: number;
  transform: string;
}

export interface OrbitMotion {
  ec: number;
  p1: number;
  p2: number;
  /** 彗尾後端離開右上角的週期百分比。 */
  pTail: number;
  /** 星芒淡出結束的週期百分比。 */
  p4: number;
  pre: number;
  /** 光點前端抵達後約 0.7% 週期，星芒放到 1.18 並全亮。 */
  popAt: number;
  breathPct: number;
  layers: LayerRun[];
  burst: BurstStop[];
}

/**
 * 照預覽 `wire()`：描邊內縮 0.5px，圓角 16。
 * 右上角（順時針走到頂邊直線結束、再加四分之一圓角的一半）的周長比例。
 */
export function computeOrbit(w: number, h: number): OrbitGeom {
  const r = RADIUS;
  const inset = INSET;
  const rw = w - 2 * inset;
  const rh = h - 2 * inset;
  const perimeter = 2 * (rw - 2 * r) + 2 * (rh - 2 * r) + 2 * Math.PI * r;
  const ec = perimeter > 0
    ? (100 * ((rw - 2 * r) + (Math.PI * r) / 4)) / perimeter
    : 0;
  return { w, h, r, inset, rw, rh, perimeter, ec };
}

function pushIncreasing<T extends { pct: number }>(stops: T[], stop: T): void {
  const prev = stops[stops.length - 1];
  if (prev && !(stop.pct > prev.pct)) return;
  stops.push(stop);
}

/**
 * 光軌與星芒的關鍵幀。
 * dashoffset 從 `len` 線性到 `len - 100`（不是 `100 + TAIL`）：
 * 相差剛好一個周長，圈尾位置等於圈頭位置，循環無縫。
 * HOLD 為 0，所以 p1 與 p2 重合，中間不插停頓幀。
 */
export function computeOrbitMotion(orbit: OrbitGeom): OrbitMotion {
  const total = 100;
  const t1 = (MOVE_SEC * orbit.ec) / total;
  const p1 = (t1 / CYCLE_SEC) * 100;
  const p2 = ((t1 + HOLD_SEC) / CYCLE_SEC) * 100;
  const pTail = p2 + ((MOVE_SEC * (TAIL_PCT / 100)) / CYCLE_SEC) * 100;
  const p4 = pTail + (FADE_SEC / CYCLE_SEC) * 100;
  const pre = Math.max(p1 - 0.01, 0);
  const popAt = p1 + 0.7;
  const breathPct = (popAt + pTail) / 2;

  const layers = (['tail', 'mid', 'head'] as const).map((name): LayerRun => {
    const len = LAYER_LEN[name];
    const offset0 = len;
    const offset100 = len - 100;
    const stops: DashStop[] = [{ pct: 0, offset: offset0 }];
    pushIncreasing(stops, { pct: p1, offset: len - orbit.ec });
    if (p2 > p1) pushIncreasing(stops, { pct: p2, offset: len - orbit.ec });
    pushIncreasing(stops, { pct: 100, offset: offset100 });
    return { name, len, offset0, offset100, stops };
  });

  const burst: BurstStop[] = [];
  const hidden = 'scale(.55) rotate(-6deg)';
  const gone = 'scale(.8) rotate(8deg)';
  pushIncreasing(burst, { pct: 0, opacity: 0, transform: hidden });
  if (pre > 0) pushIncreasing(burst, { pct: pre, opacity: 0, transform: hidden });
  pushIncreasing(burst, { pct: popAt, opacity: 1, transform: 'scale(1.18) rotate(0deg)' });
  pushIncreasing(burst, { pct: breathPct, opacity: 0.95, transform: 'scale(1.02) rotate(2deg)' });
  pushIncreasing(burst, { pct: pTail, opacity: 1, transform: 'scale(1.06) rotate(4deg)' });
  pushIncreasing(burst, { pct: p4, opacity: 0, transform: gone });
  pushIncreasing(burst, { pct: 100, opacity: 0, transform: gone });

  return { ec: orbit.ec, p1, p2, pTail, p4, pre, popAt, breathPct, layers, burst };
}

/** 星芒在給定週期百分比的不透明度（關鍵幀之間線性）。 */
export function sampleBurstOpacity(stops: readonly BurstStop[], pct: number): number {
  const first = stops[0];
  if (!first) return 0;
  if (pct <= first.pct) return first.opacity;
  for (let i = 1; i < stops.length; i += 1) {
    const right = stops[i];
    const left = stops[i - 1];
    if (!right || !left) continue;
    if (pct <= right.pct) {
      const span = right.pct - left.pct;
      if (span <= 0) return right.opacity;
      const t = (pct - left.pct) / span;
      return left.opacity + (right.opacity - left.opacity) * t;
    }
  }
  return stops[stops.length - 1]?.opacity ?? 0;
}

function fmtPct(n: number, prev: number): { text: string; value: number } {
  if (n === 0 && prev < 0) return { text: '0', value: 0 };
  let digits = 2;
  let text = n.toFixed(digits);
  let value = Number(text);
  while (value <= prev && digits < 6) {
    digits += 1;
    text = n.toFixed(digits);
    value = Number(text);
  }
  if (value <= prev) {
    value = Math.round((prev + 0.01) * 100) / 100;
    text = value.toFixed(2);
  }
  return { text, value };
}

function fmtOpacity(n: number): string {
  if (n === 0) return '0';
  if (n === 1) return '1';
  const raw = String(n);
  return raw.startsWith('0.') ? raw.slice(1) : raw;
}

function emitStops(stops: readonly { pct: number }[]): string[] {
  const texts: string[] = [];
  let prev = -1;
  for (const stop of stops) {
    const next = fmtPct(stop.pct, prev);
    texts.push(next.text);
    prev = next.value;
  }
  return texts;
}

/** 該實例的光軌與星芒 keyframes（百分比隨實測尺寸變，所以不能放進靜態樣式）。 */
export function buildKeyframes(id: string, orbit: OrbitGeom): string {
  const motion = computeOrbitMotion(orbit);
  const sel = `#sw-reload-deferred-prompt[data-fx-id="${id}"]`;
  let css = '';
  for (const layer of motion.layers) {
    const pcts = emitStops(layer.stops);
    const body = layer.stops.map((stop, i) => (
      `${pcts[i] ?? '0'}%{stroke-dashoffset:${stop.offset.toFixed(3)}}`
    )).join('');
    css += `@keyframes ${id}run${layer.name}{${body}}`;
    const gap = 100 - layer.len;
    const dash = layer.name === 'tail'
      ? `${layer.len} ${gap}`
      : `${layer.len.toFixed(2)} ${gap.toFixed(2)}`;
    css += `${sel} .orbit .${layer.name}{stroke-dasharray:${dash};animation:${id}run${layer.name} ${CYCLE_SEC}s linear infinite}`;
  }
  const burstPcts = emitStops(motion.burst);
  const burstBody = motion.burst.map((stop, i) => (
    `${burstPcts[i] ?? '0'}%{opacity:${fmtOpacity(stop.opacity)};transform:${stop.transform}}`
  )).join('');
  css += `@keyframes ${id}burst{${burstBody}}`;
  css += `${sel} .burst{animation:${id}burst ${CYCLE_SEC}s linear infinite}`;
  return css;
}

const REFRESH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';

/** 鏡頭星芒：亮白核心、細長放射光線（對角最長）、柔光暈。照預覽 `flare()`。 */
function buildFlareSvg(uid: string): string {
  const rays: ReadonlyArray<readonly [number, number, number, number]> = [
    [-45, 98, 1.5, 0.95], [45, 90, 1.4, 0.85], [0, 72, 1.9, 0.6], [90, 64, 1.7, 0.55],
    [-22, 58, 1.1, 0.7], [22, 60, 1.1, 0.7], [-68, 54, 1, 0.6], [68, 56, 1, 0.6],
    [-12, 44, 0.9, 0.45], [12, 46, 0.9, 0.45], [-78, 40, 0.8, 0.4], [78, 42, 0.8, 0.4],
  ];
  let paths = '';
  for (const ray of rays) {
    const ang = ray[0];
    const len = ray[1];
    const thick = ray[2];
    const opacity = ray[3];
    paths += `<path d="M${-len} 0 L0 ${-thick} L${len} 0 L0 ${thick}Z" fill="url(#${uid}r)" opacity="${opacity}" transform="rotate(${ang})"/>`;
  }
  return `<svg viewBox="-100 -100 200 200"><defs>` +
    `<linearGradient id="${uid}r" x1="0" x2="1" y1="0" y2="0">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset=".42" stop-color="#fff" stop-opacity=".9"/>` +
    `<stop offset=".5" stop-color="#fff"/>` +
    `<stop offset=".58" stop-color="#fff" stop-opacity=".9"/>` +
    `<stop offset="1" stop-color="#fff" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<radialGradient id="${uid}g">` +
    `<stop offset="0" stop-color="#fff" stop-opacity=".95"/>` +
    `<stop offset=".12" stop-color="#fff" stop-opacity=".7"/>` +
    `<stop offset=".35" stop-color="var(--tint)" stop-opacity=".35"/>` +
    `<stop offset="1" stop-color="var(--c2)" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<filter id="${uid}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".5"/></filter>` +
    `</defs>` +
    `<circle r="58" fill="url(#${uid}g)"/>` +
    `<g filter="url(#${uid}b)">${paths}</g>` +
    `<ellipse rx="34" ry="5" fill="#fff" opacity=".28" filter="url(#${uid}b)"/>` +
    `<ellipse rx="5" ry="30" fill="#fff" opacity=".22" filter="url(#${uid}b)"/>` +
    `<circle r="5.5" fill="#fff"/><circle r="2.4" fill="#fff"/></svg>`;
}

export const UPDATE_PROMPT_FX_CSS = `
#sw-reload-deferred-prompt.sw-reload-fx {
  /* 站長 2026-11-10 選定 B 銅金；R-UI-005 例外 */
  --c1: #f3c876;
  --c2: #c58a33;
  --glow: rgba(240, 196, 110, .30);
  --ico-bg: linear-gradient(135deg, #f3c876, #b9822f);
  --b1: #f3c876;
  --b2: #c58a33;
  --btn-text: #2b1a08;
  --tint: #fde68a;
  position: fixed;
  left: 50%;
  bottom: calc(72px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 100000;
  width: min(420px, calc(100vw - 48px));
  box-sizing: border-box;
  border-radius: 16px;
  padding: 14px;
  color: #fff;
  isolation: isolate;
  overflow: visible;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif;
  background:
    radial-gradient(120% 140% at 0% 0%, var(--glow), transparent 58%),
    linear-gradient(160deg, rgba(22, 28, 46, .52), rgba(10, 14, 26, .40));
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  backdrop-filter: blur(16px) saturate(160%);
  box-shadow:
    0 16px 40px rgba(0, 0, 0, .28),
    inset 0 0 0 1px rgba(255, 255, 255, .14),
    inset 0 1px 0 rgba(255, 255, 255, .22);
}
#sw-reload-deferred-prompt.sw-reload-fx .row {
  display: flex;
  align-items: center;
  gap: .7rem;
  position: relative;
  z-index: 2;
}
#sw-reload-deferred-prompt.sw-reload-fx .ico {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: var(--ico-bg);
  box-shadow: 0 0 18px var(--glow);
}
#sw-reload-deferred-prompt.sw-reload-fx .ico svg {
  width: 22px;
  height: 22px;
  color: #fff;
  animation: sw-reload-fx-spin 6s linear infinite;
}
@keyframes sw-reload-fx-spin { to { transform: rotate(360deg); } }
#sw-reload-deferred-prompt.sw-reload-fx .txt { min-width: 0; flex: 1; }
#sw-reload-deferred-prompt.sw-reload-fx .t1 {
  font-size: 1rem;
  font-weight: 900;
  letter-spacing: .02em;
  line-height: 1.25;
  text-shadow: 0 1px 6px rgba(0, 0, 0, .35);
}
#sw-reload-deferred-prompt.sw-reload-fx .t2 {
  font-size: .78rem;
  opacity: .86;
  margin-top: .15rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 5px rgba(0, 0, 0, .35);
}
#sw-reload-deferred-prompt.sw-reload-fx .acts {
  position: relative;
  z-index: 2;
  display: flex;
  gap: .5rem;
  margin-top: .8rem;
}
#sw-reload-deferred-prompt.sw-reload-fx button {
  font: inherit;
  cursor: pointer;
  border: 0;
  background: none;
  color: inherit;
}
#sw-reload-deferred-prompt.sw-reload-fx .go {
  position: relative;
  overflow: hidden;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  border-radius: 999px;
  font-weight: 900;
  font-size: .9rem;
  letter-spacing: .04em;
  color: var(--btn-text);
  background: linear-gradient(180deg, var(--b1), var(--b2));
  box-shadow: 0 6px 18px var(--glow), inset 0 1px 0 rgba(255, 255, 255, .5);
}
#sw-reload-deferred-prompt.sw-reload-fx .go::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 38%;
  left: -45%;
  transform: skewX(-20deg);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .55), transparent);
  animation: sw-reload-fx-sheen 3.6s ease-in-out infinite;
}
@keyframes sw-reload-fx-sheen {
  0%, 55% { left: -45%; }
  85%, 100% { left: 120%; }
}
#sw-reload-deferred-prompt.sw-reload-fx .later {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 1rem;
  border-radius: 999px;
  font-weight: 800;
  font-size: .85rem;
  color: rgba(255, 255, 255, .9);
  border: 1px solid rgba(255, 255, 255, .28);
  background: rgba(255, 255, 255, .10);
}
#sw-reload-deferred-prompt.sw-reload-fx .orbit {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
  overflow: visible;
}
#sw-reload-deferred-prompt.sw-reload-fx .orbit rect { fill: none; stroke-linecap: round; }
#sw-reload-deferred-prompt.sw-reload-fx .orbit .base {
  stroke: rgba(255, 255, 255, .14);
  stroke-width: 1;
}
#sw-reload-deferred-prompt.sw-reload-fx .orbit .tail {
  stroke: var(--c1);
  stroke-width: 3;
  opacity: .4;
  filter: blur(3px);
}
#sw-reload-deferred-prompt.sw-reload-fx .orbit .mid {
  stroke: var(--c1);
  stroke-width: 2;
  opacity: .95;
}
#sw-reload-deferred-prompt.sw-reload-fx .orbit .head {
  stroke: #fff;
  stroke-width: 3;
  filter: drop-shadow(0 0 4px var(--c1)) drop-shadow(0 0 8px var(--c2));
}
#sw-reload-deferred-prompt.sw-reload-fx .burst {
  position: absolute;
  right: -64px;
  top: -64px;
  width: 128px;
  height: 128px;
  pointer-events: none;
  z-index: 3;
  opacity: 0;
  mix-blend-mode: screen;
}
#sw-reload-deferred-prompt.sw-reload-fx .burst svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}
@media (prefers-reduced-motion: reduce) {
  #sw-reload-deferred-prompt.sw-reload-fx .orbit .tail,
  #sw-reload-deferred-prompt.sw-reload-fx .orbit .mid,
  #sw-reload-deferred-prompt.sw-reload-fx .orbit .head,
  #sw-reload-deferred-prompt.sw-reload-fx .burst,
  #sw-reload-deferred-prompt.sw-reload-fx .ico svg,
  #sw-reload-deferred-prompt.sw-reload-fx .go::after {
    animation: none !important;
  }
  #sw-reload-deferred-prompt.sw-reload-fx .burst {
    opacity: 0 !important;
  }
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  #sw-reload-deferred-prompt.sw-reload-fx {
    background: rgba(17,24,39,.94);
  }
}
`;

function ensureStaticStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(UPDATE_PROMPT_FX_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = UPDATE_PROMPT_FX_STYLE_ID;
  style.textContent = UPDATE_PROMPT_FX_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

function orbitRect(cls: string, geom: OrbitGeom): SVGRectElement {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('class', cls);
  rect.setAttribute('x', String(geom.inset));
  rect.setAttribute('y', String(geom.inset));
  rect.setAttribute('width', String(geom.rw));
  rect.setAttribute('height', String(geom.rh));
  rect.setAttribute('rx', String(geom.r));
  rect.setAttribute('pathLength', '100');
  return rect;
}

function readCopy(prompt: HTMLElement): { title: string; sub: string } {
  const blocks = prompt.querySelectorAll(':scope > div > div');
  const title = blocks.item(0)?.textContent ?? '';
  const sub = blocks.item(1)?.textContent ?? '';
  return {
    title: title || '有新版本可用',
    sub: sub || '完成目前操作後會自動更新。',
  };
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function fadeIn(prompt: HTMLElement): void {
  if (prefersReducedMotion()) {
    prompt.style.transition = '';
    prompt.style.opacity = '1';
    return;
  }
  prompt.style.opacity = '0';
  void prompt.offsetWidth;
  prompt.style.transition = 'opacity .28s ease';
  prompt.style.opacity = '1';
}

let fxSeq = 0;

/**
 * 把銅金毛玻璃、光軌、星芒套到既有提示框上。
 * 不重建按鈕節點，點擊監聽保持原樣。
 * 回傳清理函式：移除這個實例的 keyframes `<style>`、光軌與星芒。
 */
export function applyUpdatePromptFx(prompt: HTMLElement): () => void {
  ensureStaticStyle();
  const id = `swfx${++fxSeq}`;
  const nowBtn = prompt.querySelector<HTMLButtonElement>('[data-sw-reload-now]');
  const laterBtn = prompt.querySelector<HTMLButtonElement>('[data-sw-reload-later]');
  const copy = readCopy(prompt);

  const orbit = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  orbit.setAttribute('class', 'orbit');
  orbit.setAttribute('aria-hidden', 'true');

  const burst = document.createElement('span');
  burst.className = 'burst';
  burst.setAttribute('aria-hidden', 'true');
  burst.innerHTML = buildFlareSvg(id);

  const row = document.createElement('div');
  row.className = 'row';
  const ico = document.createElement('span');
  ico.className = 'ico';
  ico.setAttribute('aria-hidden', 'true');
  ico.innerHTML = REFRESH_SVG;
  const txt = document.createElement('div');
  txt.className = 'txt';
  const t1 = document.createElement('div');
  t1.className = 't1';
  t1.textContent = copy.title;
  const t2 = document.createElement('div');
  t2.className = 't2';
  t2.textContent = copy.sub;
  txt.append(t1, t2);
  row.append(ico, txt);

  const acts = document.createElement('div');
  acts.className = 'acts';
  if (nowBtn) {
    nowBtn.classList.add('go');
    nowBtn.removeAttribute('style');
    acts.append(nowBtn);
  }
  if (laterBtn) {
    laterBtn.classList.add('later');
    laterBtn.removeAttribute('style');
    acts.append(laterBtn);
  }

  prompt.classList.add('sw-reload-fx');
  prompt.setAttribute('data-fx-id', id);
  prompt.replaceChildren(orbit, burst, row, acts);
  prompt.style.cssText = 'opacity:0';

  const style = document.createElement('style');
  style.setAttribute('data-sw-reload-fx-instance', id);
  (document.head ?? document.documentElement).appendChild(style);

  // 光軌座標與星芒時間點取決於卡片實際尺寸；字型載入、旋轉螢幕、視窗縮放都會改變尺寸，所以尺寸一變就重新量測重算
  // （取代：原本只在掛載當下量一次，之後框線會和卡片錯位）。
  let lastW = -1;
  let lastH = -1;
  const layout = (): void => {
    const w = prompt.offsetWidth > 0 ? prompt.offsetWidth : FALLBACK_W;
    const h = prompt.offsetHeight > 0 ? prompt.offsetHeight : FALLBACK_H;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    const geom = computeOrbit(w, h);
    orbit.setAttribute('viewBox', `0 0 ${geom.w} ${geom.h}`);
    orbit.replaceChildren(
      orbitRect('base', geom),
      orbitRect('tail', geom),
      orbitRect('mid', geom),
      orbitRect('head', geom),
    );
    style.textContent = buildKeyframes(id, geom);
  };
  layout();
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null;
  observer?.observe(prompt);
  fadeIn(prompt);

  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    observer?.disconnect();
    style.remove();
    orbit.remove();
    burst.remove();
  };
}
