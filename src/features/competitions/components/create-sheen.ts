// 站內篩選列「建立賽事」的反光（站長 11-24 看預覽選「反光每 3 秒一次」，顧問 §3.685）：
// 一道斜亮帶每 3 秒從左掃到右一次（掃過約 0.9 秒），提醒多用建立賽事。外觀照預覽第 1 種（105°、30%～70% 漸層、白 .65）。
// 由 InAppCardList 在有建立鈕、不是省流量時動態載入，不進首頁入口；樣式寫在這裡的字串（賽事 CSS 預算已滿）。
// 掛點是按鈕裡的 <i class="cpl-sheen">（行內樣式先絕對定位，載入前不佔版面）：這裡把它定成 22px 的按鈕面（上下內縮 11px、圓角 10，
// 同 list-v2.css 的建立賽事外觀）並裁切；亮帶是它的 ::after，用 transform 位移（交給合成層，不重排版面、不重繪按鈕）。
// 只在畫面內、分頁在前景時加 is-on 才跑；減少動態完全不掛。

export const CREATE_SHEEN_STYLE_ID = 'cpl-create-sheen-style';
/** 一輪秒數（站長選每 3 秒一次）。 */
export const SHEEN_CYCLE_SEC = 3;

export const CREATE_SHEEN_CSS = `
.cpl-sheen{top:11px;bottom:11px;left:0;right:0;border-radius:10px;overflow:hidden;pointer-events:none}
.cpl-sheen::after{content:'';position:absolute;top:0;bottom:0;left:0;width:300%;transform:translateX(-66.667%);background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.65) 50%,transparent 70%)}
.cpl-sheen.is-on::after{animation:cplSheen ${SHEEN_CYCLE_SEC}s ease-in-out infinite}
@keyframes cplSheen{0%,70%{transform:translateX(-66.667%)}100%{transform:translateX(0)}}
@media (prefers-reduced-motion:reduce){.cpl-sheen.is-on::after{animation:none}}
`;

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 在掛點上啟動反光；回傳清理（停監聽、拿掉 is-on 與樣式）。減少動態時什麼都不做。 */
export function startCreateSheen(slot: HTMLElement): () => void {
  if (prefersReducedMotion()) return () => {};
  if (!document.getElementById(CREATE_SHEEN_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = CREATE_SHEEN_STYLE_ID;
    style.textContent = CREATE_SHEEN_CSS;
    (document.head ?? document.documentElement).appendChild(style);
  }
  let visible = typeof IntersectionObserver !== 'function';
  let gone = false;
  const sync = (): void => {
    if (gone) return;
    slot.classList.toggle('is-on', visible && !document.hidden);
  };
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) visible = entry.isIntersecting;
      sync();
    })
    : null;
  io?.observe(slot);
  document.addEventListener('visibilitychange', sync);
  sync();
  return () => {
    if (gone) return;
    gone = true;
    io?.disconnect();
    document.removeEventListener('visibilitychange', sync);
    slot.classList.remove('is-on');
    document.getElementById(CREATE_SHEEN_STYLE_ID)?.remove();
  };
}
