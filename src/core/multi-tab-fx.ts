// 多分頁警告特效（站長 2026-11-10 選定 B 銅金；預覽 multi-tab-prompt 右邊「設計後」）。
// 由 multi-tab-guard 動態 import，不進首頁入口的靜態圖。
// 光軌與星芒沿用 update-prompt-fx。這張卡片周長較大，一圈 4.2 秒、圓角 18。
// 不重建標題、內文與按鈕節點，文案與點擊監聽維持 guard 建立的那一份。

import { bindOrbitLayout, buildFlareSvg } from './update-prompt-fx';

/** 靜態樣式只注入一次，id 固定，關閉提示框時留著。 */
export const MULTI_TAB_FX_STYLE_ID = 'multi-tab-fx-style';

/** 光點繞一圈的秒數。預覽即用此值。 */
const MOVE_SEC = 4.2;
const RADIUS = 18;

/** jsdom 沒有版面時的設計盒，讓光軌仍能畫出來。實機一律量 offset。 */
const FALLBACK_W = 340;
const FALLBACK_H = 280;

const TABS_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="7" width="13" height="12" rx="2.5"/>' +
  '<path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3H19a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5H16"/>' +
  '<path d="M6.5 12h6"/>' +
  '</svg>';

export const MULTI_TAB_FX_CSS = `
#multi-tab-warning .multi-tab-modal.multi-tab-fx {
  /* 站長 2026-11-10 選定 B 銅金；R-UI-005 例外 */
  --c1: #f3c876;
  --c2: #c58a33;
  --glow: rgba(240, 196, 110, .30);
  --ico-bg: linear-gradient(135deg, #f3c876, #b9822f);
  --b1: #f3c876;
  --b2: #c58a33;
  --btn-text: #2b1a08;
  --tint: #fde68a;
  position: relative;
  width: 100%;
  max-width: 340px;
  border-radius: 18px;
  padding: 1.3rem 1.15rem 1.15rem;
  color: #fff;
  isolation: isolate;
  text-align: center;
  overflow: visible;
  background:
    radial-gradient(120% 120% at 0% 0%, var(--glow), transparent 56%),
    linear-gradient(160deg, rgba(22, 28, 46, .60), rgba(10, 14, 26, .48));
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  backdrop-filter: blur(16px) saturate(160%);
  box-shadow:
    0 16px 40px rgba(0, 0, 0, .30),
    inset 0 0 0 1px rgba(255, 255, 255, .14),
    inset 0 1px 0 rgba(255, 255, 255, .22);
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .ico {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  margin: 0 auto .7rem;
  display: grid;
  place-items: center;
  background: var(--ico-bg);
  box-shadow: 0 0 22px var(--glow);
  position: relative;
  z-index: 2;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .ico svg {
  width: 26px;
  height: 26px;
  color: #fff;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .multi-tab-title {
  position: relative;
  z-index: 2;
  font-size: 1.08rem;
  font-weight: 900;
  letter-spacing: .03em;
  text-shadow: 0 1px 6px rgba(0, 0, 0, .35);
  margin-bottom: .65rem;
  text-align: center;
  color: #fff;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .multi-tab-body {
  position: relative;
  z-index: 2;
  font-size: .85rem;
  line-height: 1.65;
  color: rgba(255, 255, 255, .88);
  text-shadow: 0 1px 5px rgba(0, 0, 0, .3);
  margin-bottom: 1rem;
  text-align: center;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .multi-tab-body span {
  font-size: .78rem !important;
  color: inherit !important;
  opacity: .7;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .multi-tab-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .30), transparent);
  margin: .6rem 0;
  border: 0;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .multi-tab-actions {
  position: relative;
  z-index: 2;
  display: flex;
  gap: .5rem;
  justify-content: stretch;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx button {
  font: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  transition: none;
  transform: none;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx #multi-tab-close {
  position: relative;
  overflow: hidden;
  flex: 1.25;
  min-height: 42px;
  border: 0;
  border-radius: 999px;
  padding: 0 .75rem;
  font-weight: 900;
  font-size: .9rem;
  letter-spacing: .03em;
  color: var(--btn-text);
  background: linear-gradient(180deg, var(--b1), var(--b2));
  box-shadow: 0 6px 18px var(--glow), inset 0 1px 0 rgba(255, 255, 255, .5);
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx #multi-tab-close::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 38%;
  left: -45%;
  transform: skewX(-20deg);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .55), transparent);
  animation: multi-tab-fx-sheen 3.6s ease-in-out infinite;
}
@keyframes multi-tab-fx-sheen {
  0%, 55% { left: -45%; }
  85%, 100% { left: 120%; }
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx #multi-tab-dismiss {
  flex: 1;
  min-height: 42px;
  border-radius: 999px;
  padding: 0 .75rem;
  font-weight: 800;
  font-size: .85rem;
  color: rgba(255, 255, 255, .92);
  border: 1px solid rgba(255, 255, 255, .28);
  background: rgba(255, 255, 255, .10);
  box-shadow: none;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx #multi-tab-close:hover,
#multi-tab-warning .multi-tab-modal.multi-tab-fx #multi-tab-dismiss:hover,
#multi-tab-warning .multi-tab-modal.multi-tab-fx #multi-tab-close:active,
#multi-tab-warning .multi-tab-modal.multi-tab-fx #multi-tab-dismiss:active {
  transform: none;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .orbit {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
  overflow: visible;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .orbit rect { fill: none; stroke-linecap: round; }
#multi-tab-warning .multi-tab-modal.multi-tab-fx .orbit .base {
  stroke: rgba(255, 255, 255, .14);
  stroke-width: 1;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .orbit .tail {
  stroke: var(--c1);
  stroke-width: 3;
  opacity: .4;
  filter: blur(3px);
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .orbit .mid {
  stroke: var(--c1);
  stroke-width: 2;
  opacity: .95;
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .orbit .head {
  stroke: #fff;
  stroke-width: 3;
  filter: drop-shadow(0 0 4px var(--c1)) drop-shadow(0 0 8px var(--c2));
}
#multi-tab-warning .multi-tab-modal.multi-tab-fx .burst {
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
#multi-tab-warning .multi-tab-modal.multi-tab-fx .burst svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}
@media (prefers-reduced-motion: reduce) {
  #multi-tab-warning .multi-tab-modal.multi-tab-fx .orbit .tail,
  #multi-tab-warning .multi-tab-modal.multi-tab-fx .orbit .mid,
  #multi-tab-warning .multi-tab-modal.multi-tab-fx .orbit .head,
  #multi-tab-warning .multi-tab-modal.multi-tab-fx .burst,
  #multi-tab-warning .multi-tab-modal.multi-tab-fx #multi-tab-close::after {
    animation: none !important;
  }
  #multi-tab-warning .multi-tab-modal.multi-tab-fx .burst {
    opacity: 0 !important;
  }
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  #multi-tab-warning .multi-tab-modal.multi-tab-fx {
    background: rgba(17,24,39,.94);
  }
}
/* 遮罩降級沿用現有 .multi-tab-overlay：不支援 backdrop-filter 時改不透明。 */
@supports not ((backdrop-filter: blur(10px)) or (-webkit-backdrop-filter: blur(10px))) {
  #multi-tab-warning.multi-tab-overlay {
    background: rgba(0, 0, 0, 0.72);
  }
}
`;

function ensureStaticStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(MULTI_TAB_FX_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MULTI_TAB_FX_STYLE_ID;
  style.textContent = MULTI_TAB_FX_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function fadeIn(el: HTMLElement): void {
  if (prefersReducedMotion()) {
    el.style.transition = '';
    el.style.opacity = '1';
    return;
  }
  el.style.opacity = '0';
  void el.offsetWidth;
  el.style.transition = 'opacity .28s ease';
  el.style.opacity = '1';
}

let fxSeq = 0;

/**
 * 把銅金毛玻璃、分頁圖示、光軌、星芒套到既有提示框上。
 * 不重建按鈕節點，點擊監聽保持原樣。
 * 回傳清理函式：移除這個實例的 keyframes `<style>`、光軌、星芒與圖示。
 */
export function applyMultiTabFx(overlay: HTMLElement): () => void {
  ensureStaticStyle();
  const modal = overlay.querySelector('.multi-tab-modal');
  if (!(modal instanceof HTMLElement)) {
    overlay.style.opacity = '1';
    return () => undefined;
  }

  const id = `mtfx${++fxSeq}`;
  modal.classList.add('multi-tab-fx');
  modal.setAttribute('data-fx-id', id);

  const orbit = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  orbit.setAttribute('class', 'orbit');
  orbit.setAttribute('aria-hidden', 'true');

  const burst = document.createElement('span');
  burst.className = 'burst';
  burst.setAttribute('aria-hidden', 'true');
  burst.innerHTML = buildFlareSvg(id);

  const ico = document.createElement('div');
  ico.className = 'ico';
  ico.setAttribute('aria-hidden', 'true');
  ico.innerHTML = TABS_SVG;

  const dismissBtn = overlay.querySelector('#multi-tab-dismiss');
  const closeBtn = overlay.querySelector('#multi-tab-close');
  dismissBtn?.classList.add('later');
  closeBtn?.classList.add('go');

  modal.insertBefore(ico, modal.firstChild);
  modal.insertBefore(burst, modal.firstChild);
  modal.insertBefore(orbit, modal.firstChild);

  const style = document.createElement('style');
  style.setAttribute('data-multi-tab-fx-instance', id);
  (document.head ?? document.documentElement).appendChild(style);

  const unobserve = bindOrbitLayout(modal, orbit, style, id, {
    radius: RADIUS,
    moveSec: MOVE_SEC,
    selector: `.multi-tab-modal[data-fx-id="${id}"]`,
    fallbackW: FALLBACK_W,
    fallbackH: FALLBACK_H,
  });
  fadeIn(overlay);

  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    unobserve();
    style.remove();
    orbit.remove();
    burst.remove();
    ico.remove();
    modal.classList.remove('multi-tab-fx');
    modal.removeAttribute('data-fx-id');
    dismissBtn?.classList.remove('later');
    closeBtn?.classList.remove('go');
  };
}
