// 招募中卡的「光軌＋右上角星芒」（站長 11-22，顧問 §3.565 後續：招募中要有多分頁提示那套光軌與星芒）。
// 由 InAppCardList 在清單有招募中卡時動態載入，不進首頁入口。幾何、keyframes、星芒 SVG 全部重用
// core/update-prompt-fx 已匯出的 bindOrbitLayout／buildFlareSvg（多分頁提示 multi-tab-fx 也是用這兩支），不另寫。
// 效能：只對畫面內的卡啟動（IntersectionObserver），同時最多 MAX_ACTIVE 張；分頁在背景就全部停；
// prefers-reduced-motion 只留一顆靜態星芒（邊框色在 competitions.css，不靠這支）。卡片尺寸變動由 bindOrbitLayout 的 ResizeObserver 重算。
// 掛點是 InAppCardList 只在招募中卡畫的空 <i class="cpl-fx-slot">（裁在卡片圓角內：星芒露出卡外會撐出整頁橫向捲動）；清理時把 slot 裡的光軌、星芒、各實例 <style> 與監聽全部拿掉。

import { bindOrbitLayout, buildFlareSvg } from '@/core/update-prompt-fx';

export const RECRUIT_FX_STYLE_ID = 'cpl-recruit-fx-style';
/** 同時跑光軌的卡數上限（顧問 §3.565：最多 3 張，其餘只有邊框）。 */
export const MAX_ACTIVE = 3;
/** 外框（.cpl-card__link）的圓角。 */
const RADIUS = 14;
/** 繞一圈秒數，同多分頁提示。 */
const MOVE_SEC = 4.2;
/** jsdom 沒有版面時的設計盒（360 寬清單卡外框約 344×146）。 */
const FALLBACK_W = 344;
const FALLBACK_H = 146;

/** 顏色：多分頁提示銅金原樣（顧問 §3.576 選 A；青綠 B 只留在 harness 的 ?fx=b 比較用）。 */
export const RECRUIT_FX_CSS = `
.cpl-fx-slot{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden;border-radius:14px;--c1:#f3c876;--c2:#c58a33;--tint:#fde68a}
.cpl-fx-slot>.orbit{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.cpl-fx-slot>.orbit rect{fill:none;stroke-linecap:round}
.cpl-fx-slot>.orbit .base{stroke:none}
.cpl-fx-slot>.orbit .tail{stroke:var(--c1);stroke-width:3;opacity:.4;filter:blur(3px)}
.cpl-fx-slot>.orbit .mid{stroke:var(--c1);stroke-width:2;opacity:.95}
.cpl-fx-slot>.orbit .head{stroke:#fff;stroke-width:3;filter:drop-shadow(0 0 4px var(--c1)) drop-shadow(0 0 8px var(--c2))}
.cpl-fx-slot>.burst{position:absolute;right:-30px;top:-30px;width:88px;height:88px;opacity:0;mix-blend-mode:screen}
.cpl-fx-slot>.burst svg{width:100%;height:100%;overflow:visible}
.cpl-fx-slot.is-still>.burst{opacity:.8;transform:scale(.85)}
@media (prefers-reduced-motion:reduce){.cpl-fx-slot>.orbit .tail,.cpl-fx-slot>.orbit .mid,.cpl-fx-slot>.orbit .head,.cpl-fx-slot>.burst{animation:none!important}}
`;

function ensureStaticStyle(): void {
  if (document.getElementById(RECRUIT_FX_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = RECRUIT_FX_STYLE_ID;
  style.textContent = RECRUIT_FX_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

let fxSeq = 0;

/** 在一個 slot 上掛光軌與星芒；回傳清理函式。still：不跑光軌，只放一顆靜態星芒。 */
function mount(slot: HTMLElement, still: boolean): () => void {
  const id = `cplfx${++fxSeq}`;
  slot.setAttribute('data-fx-id', id);
  const burst = document.createElement('span');
  burst.className = 'burst';
  burst.innerHTML = buildFlareSvg(id);
  if (still) {
    slot.classList.add('is-still');
    slot.appendChild(burst);
    return () => {
      burst.remove();
      slot.classList.remove('is-still');
      slot.removeAttribute('data-fx-id');
    };
  }
  const orbit = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  orbit.setAttribute('class', 'orbit');
  slot.append(orbit, burst);
  const style = document.createElement('style');
  style.setAttribute('data-cpl-fx-instance', id);
  (document.head ?? document.documentElement).appendChild(style);
  const unobserve = bindOrbitLayout(slot, orbit, style, id, {
    radius: RADIUS,
    moveSec: MOVE_SEC,
    selector: `.cpl-fx-slot[data-fx-id="${id}"]`,
    fallbackW: FALLBACK_W,
    fallbackH: FALLBACK_H,
  });
  return () => {
    unobserve();
    style.remove();
    orbit.remove();
    burst.remove();
    slot.removeAttribute('data-fx-id');
  };
}

/**
 * 對 root 裡的招募中卡（.cpl-fx-slot）啟動光軌：畫面內、而且依 DOM 順序是前 MAX_ACTIVE 張才跑；
 * 捲出畫面或分頁進背景就停。回傳整組清理（停監聽、拿掉所有光軌／星芒、實例 style 與靜態 style）。
 */
export function startRecruitFx(root: HTMLElement): () => void {
  ensureStaticStyle();
  const slots = [...root.querySelectorAll<HTMLElement>('.cpl-fx-slot')];
  const still = prefersReducedMotion();
  const visible = new Set<HTMLElement>();
  const running = new Map<HTMLElement, () => void>();
  let gone = false;

  const sync = (): void => {
    // 整組清理後還可能收到已排隊的舊 IntersectionObserver 回呼：不能再掛回（審查 P2-1）。
    if (gone) return;
    const want = document.hidden ? [] : slots.filter((slot) => visible.has(slot)).slice(0, MAX_ACTIVE);
    for (const [slot, stop] of running) {
      if (!want.includes(slot)) {
        stop();
        running.delete(slot);
      }
    }
    for (const slot of want) {
      if (!running.has(slot)) running.set(slot, mount(slot, still));
    }
  };

  let io: IntersectionObserver | null = null;
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const slot = entry.target as HTMLElement;
        if (entry.isIntersecting) visible.add(slot);
        else visible.delete(slot);
      }
      sync();
    });
    for (const slot of slots) io.observe(slot);
  } else {
    // 沒有 IntersectionObserver（極舊 WebView、jsdom）：當作前幾張都在畫面內。
    for (const slot of slots) visible.add(slot);
    sync();
  }
  document.addEventListener('visibilitychange', sync);

  return () => {
    if (gone) return;
    gone = true;
    io?.disconnect();
    document.removeEventListener('visibilitychange', sync);
    for (const stop of running.values()) stop();
    running.clear();
    document.getElementById(RECRUIT_FX_STYLE_ID)?.remove();
  };
}
